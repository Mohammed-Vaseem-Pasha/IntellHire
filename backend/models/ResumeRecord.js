const mongoose = require("mongoose");

const resumeRecordSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, index: true },
  kind: { type: String, enum: ["analysis", "builder"], required: true, index: true },
  title: { type: String, default: "Untitled resume", trim: true, maxlength: 200 },
  targetJobTitle: { type: String, default: "", maxlength: 200 },
  jobDescription: { type: String, default: "", maxlength: 12000 },
  fileName: { type: String, default: "", maxlength: 255 },
  extractedCharacterCount: { type: Number, default: 0 },
  analysisData: { type: mongoose.Schema.Types.Mixed, default: null },
  resumeData: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

resumeRecordSchema.index({ firebaseUid: 1, updatedAt: -1 });
module.exports = mongoose.model("ResumeRecord", resumeRecordSchema);
