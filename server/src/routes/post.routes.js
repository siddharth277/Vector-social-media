import express from "express";
import { 
    createPost, 
    deletePost, 
    getPosts, 
    getPostsByUser, 
    getSinglePost, 
    getTopPostsOfWeek,
    getTopPostsOfMonth,
    toggleLike, 
    incrementShare,
    updatePost,toggleBookmark,
    getBookmarks,
    searchPosts
} from "../controllers/post.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";
import { uploadImage } from "../middlewares/upload.middleware.js";
import optionalAuth from "../middlewares/optionalAuth.middleware.js";

const postRouter = express.Router();

postRouter.post("/", authMiddleware, uploadImage("image"), createPost);
postRouter.get("/search", optionalAuth, searchPosts);
postRouter.get("/", optionalAuth, getPosts);
postRouter.get("/top-week", optionalAuth, getTopPostsOfWeek);
postRouter.get("/top-month", optionalAuth, getTopPostsOfMonth);
postRouter.get("/bookmarks", authMiddleware, getBookmarks); 
postRouter.get("/user/:userId", optionalAuth, getPostsByUser);
postRouter.get("/:postId", optionalAuth, getSinglePost);
postRouter.post("/like/:id", authMiddleware, toggleLike);
postRouter.put("/:id/like", authMiddleware, toggleLike);
postRouter.put("/:id/share", authMiddleware, incrementShare);
postRouter.put("/:id", authMiddleware, uploadImage("image"), updatePost);
postRouter.delete("/:id", authMiddleware, deletePost);
postRouter.post("/:id/bookmark", authMiddleware, toggleBookmark);

export default postRouter;
