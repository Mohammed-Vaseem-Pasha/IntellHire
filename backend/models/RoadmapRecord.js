const mongoose = require("mongoose");

const milestoneProgressSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
    note: { type: String, default: "" },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

const roadmapRecordSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    targetRole: { type: String, default: "" },
    experienceLevel: { type: String, default: "" },
    roadmap: { type: mongoose.Schema.Types.Mixed, required: true },
    milestoneProgress: {
      type: [milestoneProgressSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RoadmapRecord", roadmapRecordSchema);
