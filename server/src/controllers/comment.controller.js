import mongoose from "mongoose";
import Comment from "../models/comment.model.js";
import Post from "../models/post.model.js";
import User from "../models/user.model.js";
import Follow from "../models/follow.model.js";
import Notification from "../models/notification.model.js";
import { getIO } from "../socket/socket.js";

// Hard upper bound on comments returned per request.
const MAX_LIMIT = 50;

// ── Shared helper: extract and resolve @mentions from text ─────────────────
// Returns MongoDB ObjectIds for every valid @username found in content.
// Deduplicates usernames before hitting the DB.
async function resolveMentions(content) {
    const mentionRegex = /@([a-zA-Z0-9_]{3,30})/g;
    const rawUsernames = [
        ...new Set(
            [...content.matchAll(mentionRegex)].map(m => m[1].toLowerCase())
        ),
    ];
    if (rawUsernames.length === 0) return [];
    const users = await User.find(
        { username: { $in: rawUsernames } },
        { _id: 1 }
    ).lean();
    return users.map(u => u._id);
}

// ── Fire mention notifications ─────────────────────────────────────────────
// Sends a "mention" notification + socket event to each mentioned user.
// Skips: the actor themselves, and any userId in skipIds
// (e.g. the post author who already received a "comment" notification).
async function fireMentionNotifications({ mentionedUserIds, senderId, postId, commentId, skipIds = [] }) {
    const io = getIO();
    const skipSet = new Set(skipIds.map(String));

    for (const mentionedId of mentionedUserIds) {
        const mentionedStr = mentionedId.toString();
        if (mentionedStr === senderId || skipSet.has(mentionedStr)) continue;

        try {
            const notification = await Notification.create({
                recipient: mentionedId,
                sender: senderId,
                type: "mention",
                post: postId,
                ...(commentId ? { comment: commentId } : {}),
            });
            io.to(mentionedStr).emit("notification:new", {
                notificationId: notification._id,
                type: notification.type,
            });
        } catch (err) {
            // 11000 = duplicate key — silently skip if already notified
            if (err.code !== 11000) throw err;
        }
    }
}

export const addComment = async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;

        if (!content?.trim()) {
            return res.status(400).json({ message: "Comment cannot be empty" });
        }

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        const authorUser = await User.findById(post.author);

        if (req.user) {
            const currentUserId = req.user.id;
            const isBlocked =
                req.user.blockedUsers?.some(id => id.toString() === post.author.toString()) ||
                authorUser?.blockedUsers?.some(id => id.toString() === currentUserId);
            if (isBlocked) {
                return res.status(403).json({ message: "Action forbidden due to block status" });
            }

            if (authorUser?.isPrivate && currentUserId !== post.author.toString()) {
                const isFollower = await Follow.exists({
                    follower: currentUserId,
                    following: post.author,
                    status: "accepted",
                });
                if (!isFollower) {
                    return res.status(403).json({
                        message: "This post is from a private account. Follow them to comment.",
                    });
                }
            }
        }

        // Re-verify block status and follow right before create
        if (req.user) {
            const [freshAuthor, freshCurrent] = await Promise.all([
                User.findById(post.author).select("blockedUsers isPrivate"),
                User.findById(req.user.id).select("blockedUsers"),
            ]);
            const stillBlocked =
                freshCurrent?.blockedUsers?.some(id => id.toString() === post.author.toString()) ||
                freshAuthor?.blockedUsers?.some(id => id.toString() === req.user.id);
            if (stillBlocked) {
                return res.status(403).json({ message: "Action forbidden due to block status" });
            }
            if (freshAuthor?.isPrivate && req.user.id !== post.author.toString()) {
                const isStillFollower = await Follow.exists({
                    follower: req.user.id,
                    following: post.author,
                    status: "accepted",
                });
                if (!isStillFollower) {
                    return res.status(403).json({
                        message: "This post is from a private account. Follow them to comment.",
                    });
                }
            }
        }

        // Resolve @mentions before creating the comment
        const mentionedUserIds = await resolveMentions(content);

        const comment = await Comment.create({
            post: postId,
            author: req.user.id,
            content,
            mentions: mentionedUserIds,
        });

        await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

        const populated = await comment.populate("author", "username name avatar");

        const io = getIO();

        // Notify the post author about the new comment (existing behaviour)
        if (post.author.toString() !== req.user.id) {
            const notification = await Notification.create({
                recipient: post.author,
                sender: req.user.id,
                type: "comment",
                post: post._id,
                comment: comment._id,
            });
            io.to(post.author.toString()).emit("notification:new", {
                notificationId: notification._id,
                type: notification.type,
            });
        }

        // Fire mention notifications — skip the post author (already notified above)
        await fireMentionNotifications({
            mentionedUserIds,
            senderId: req.user.id,
            postId: post._id,
            commentId: comment._id,
            skipIds: [post.author],
        });

        return res.status(201).json(populated);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

export const getPostComments = async (req, res) => {
    try {
        const { postId } = req.params;

        const post = await Post.findById(postId).select("author");
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        const postAuthor = await User.findById(post.author).select("blockedUsers isPrivate");

        if (req.user) {
            const currentUserId = req.user.id;
            const isBlocked =
                req.user.blockedUsers?.some(id => id.toString() === post.author.toString()) ||
                postAuthor?.blockedUsers?.some(id => id.toString() === currentUserId);
            if (isBlocked) {
                return res.status(403).json({ message: "Action forbidden due to block status" });
            }

            if (postAuthor?.isPrivate && currentUserId !== post.author.toString()) {
                const isFollower = await Follow.exists({
                    follower: currentUserId,
                    following: post.author,
                    status: "accepted",
                });
                if (!isFollower) {
                    return res.status(403).json({
                        message: "This post is from a private account. Follow them to see it.",
                    });
                }
            }
        } else if (postAuthor?.isPrivate) {
            return res.status(403).json({
                message: "This post is from a private account. Follow them to see it.",
            });
        }

        const cursor = req.query.cursor || null;
        // Clamp limit to MAX_LIMIT (from updated repo)
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), MAX_LIMIT);

        let excludeUserIds = [];
        if (req.user) {
            const currentUserId = req.user._id || req.user.id;
            const blockers = await User.find({ blockedUsers: currentUserId }).select("_id");
            const blockerIds = blockers.map(u => u._id);
            const blockedIds = req.user.blockedUsers || [];
            excludeUserIds = [...blockedIds, ...blockerIds];
        }

        let filter = {
            post: postId,
            ...(excludeUserIds.length ? { author: { $nin: excludeUserIds } } : {}),
        };

        if (cursor) {
            if (mongoose.Types.ObjectId.isValid(cursor)) {
                filter._id = { $lt: cursor };
            } else {
                return res.status(400).json({ success: false, message: "Invalid cursor format" });
            }
        }

        const comments = await Comment.find(filter)
            .sort({ _id: -1 })
            .limit(limit)
            .populate("author", "username name avatar");

        const hasMore = comments.length === limit;
        const nextCursor = hasMore ? comments[comments.length - 1]._id : null;

        res.json({ comments, nextCursor, hasMore });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteComment = async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.commentId);
        if (!comment) {
            return res.status(404).json({ message: "Comment not found" });
        }
        if (comment.author.toString() !== req.user.id) {
            return res.status(403).json({ message: "Not allowed" });
        }

        await comment.deleteOne();

        // Clean up the comment notification AND any mention notifications tied to it
        await Notification.deleteMany({
            comment: comment._id,
            type: { $in: ["comment", "mention"] },
        });

        await Post.findByIdAndUpdate(comment.post, { $inc: { commentsCount: -1 } });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
