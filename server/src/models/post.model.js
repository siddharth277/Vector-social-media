import mongoose from "mongoose";

const postSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  authorIsPrivate: {
    type: Boolean,
    default: false
  },

  content: {
    type: String,
    maxlength: 1000
  },

  image: {
    type: String,
  },

  imagePublicId: {
    type: String,
  },

  intent: {
    type: String,
    enum: ["ask", "build", "share", "discuss", "reflect"],
    required: true
  },

  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  commentsCount: {
    type: Number,
    default: 0,
  },

  sharesCount: {
    type: Number,
    default: 0,
  },

  // Existing field from repo — tracks which users shared this post
  sharedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  // userIds of every @mentioned user in the post content
  mentions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],

}, { timestamps: true });

postSchema.index({ content: "text", intent: "text" });

export default mongoose.model("Post", postSchema);
