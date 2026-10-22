const mongoose = require("mongoose");

const conversationItemSchema = new mongoose.Schema({
  speaker: {
    type: String,
    enum: ["interviewer", "candidate"],
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  questionIndex: {
    type: Number,
    default: 0,
  },
  submissionId: {
    type: String,
    default: "",
  },
});

const pendingEvaluationSchema = new mongoose.Schema(
  {
    questionIndex: Number,
    submissionId: String,
    answer: String,
    question: String,
    evaluation: {
      score: Number,
      relevance: {
        type: String,
        enum: ["relevant", "partially_relevant", "incorrect", "irrelevant", "unclear", "insufficient", "skipped"],
      },
      feedback: String,
      strengths: [{ type: String }],
      improvements: [{ type: String }],
      idealConcept: String,
    },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      index: true,
    },
    userEmail: {
      type: String,
      default: "",
    },
    jobRole: {
      type: String,
      required: true,
      trim: true,
    },
    jobDescription: {
      type: String,
      default: "",
    },
    interviewType: {
      type: String,
      enum: ["Technical", "HR & Behavioral", "System Design", "Mixed"],
      default: "Technical",
    },
    experienceLevel: {
      type: String,
      enum: ["Fresher", "Experienced professional"],
      default: "Fresher",
    },
    durationMinutes: {
      type: Number,
      enum: [5, 10, 15, 20, 30],
      default: 15,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    language: {
      type: String,
      default: "English",
    },
    resumeFileName: {
      type: String,
      default: "",
    },
    resumeText: {
      type: String,
      default: "",
    },
    resumeProfile: {
      candidateName: { type: String, default: "" },
      summary: { type: String, default: "" },
      skills: [{ type: String }],
      technicalSkills: [{ type: String }],
      softSkills: [{ type: String }],
      projects: [
        {
          title: String,
          description: String,
          technologies: [String],
        },
      ],
      experience: [
        {
          role: String,
          company: String,
          duration: String,
          summary: String,
        },
      ],
      internships: [
        {
          role: String,
          company: String,
          duration: String,
          summary: String,
        },
      ],
      education: [
        {
          degree: String,
          institution: String,
          year: String,
        },
      ],
      certifications: [{ type: String }],
      achievements: [{ type: String }],
      interests: [{ type: String }],
    },
    conversation: [conversationItemSchema],
    currentQuestionIndex: {
      type: Number,
      default: 0,
    },
    processingQuestionIndex: {
      type: Number,
      default: null,
    },
    pendingEvaluation: {
      type: pendingEvaluationSchema,
      default: null,
    },
    safetyMaxTurns: {
      type: Number,
      default: 30,
    },
    safetyMaxDurationMinutes: {
      type: Number,
      default: 45,
    },
    targetQuestionCount: {
      type: Number,
      min: 2,
      max: 35,
      default: 10,
    },
    minimumAssessmentTurns: {
      type: Number,
      default: 3,
    },
    topicCoverage: [
      {
        topicId: { type: String, required: true },
        name: { type: String, default: "" },
        status: {
          type: String,
          enum: ["uncovered", "covered", "skipped", "inapplicable"],
          default: "uncovered",
        },
      },
    ],
    candidateRequests: [
      {
        text: { type: String, required: true },
        intent: {
          type: String,
          enum: ["candidate_question", "clarification", "continue", "finish", "retry_answer", "skip_question"],
          required: true,
        },
        questionIndex: { type: Number, required: true },
        submissionId: { type: String, required: true },
        relevance: {
          type: String,
          enum: ["relevant", "partially_relevant", "incorrect", "irrelevant", "unclear", "insufficient", "skipped"],
        },
        reply: { type: String, default: "" },
        score: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    completionReason: {
      type: String,
      enum: ["plan_complete", "candidate_requested", "safety_limit", "time_limit", "interrupted", ""],
      default: "",
    },
    interviewState: {
      type: String,
      enum: ["ready", "asking", "evaluating", "completed", "cancelled"],
      default: "ready",
    },
    completionMessage: {
      type: String,
      default: "",
    },
    interruptedDraftAnswer: {
      type: String,
      default: "",
    },
    interruptedDraftQuestion: {
      type: String,
      default: "",
    },
    interruptedDraftQuestionIndex: {
      type: Number,
      default: null,
    },
    reportStatus: {
      type: String,
      enum: ["not_started", "pending", "generating", "ready", "failed"],
      default: "not_started",
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "cancelled"],
      default: "in_progress",
    },
    creditsDeducted: {
      type: Number,
      default: 40,
    },
    aiEngineUsed: {
      type: String,
      default: "IntelliHire Grounded Engine",
    },
    report: {
      overallScore: { type: Number, default: null },
      answerRelevanceScore: { type: Number, default: null },
      scoreExplanation: { type: String, default: "" },
      technicalScore: { type: Number, default: null },
      problemSolvingScore: { type: Number, default: null },
      communicationScore: { type: Number, default: null },
      roleAlignmentScore: { type: Number, default: null },
      strengths: [{ type: String }],
      improvements: [{ type: String }],
      technicalGaps: [{ type: String }],
      communicationFeedback: { type: String, default: "" },
      answerCompletenessFeedback: { type: String, default: "" },
      projectUnderstandingFeedback: { type: String, default: "" },
      behavioralFeedback: { type: String, default: "" },
      exampleImprovements: [{ type: String }],
      recommendedTopics: [{ type: String }],
      nextSteps: [{ type: String }],
      actionableRecommendations: [{ type: String }],
      experienceLevel: { type: String, default: "" },
      durationMinutes: { type: Number, default: null },
      skippedQuestionsCount: { type: Number, default: 0 },
      skippedTopics: [{ type: String }],
      questionReviews: [
        {
          questionIndex: Number,
          question: String,
          candidateAnswer: String,
          feedback: String,
          relevance: {
            type: String,
            enum: ["relevant", "partially_relevant", "incorrect", "irrelevant", "unclear", "insufficient", "skipped"],
          },
          idealConcept: String,
          score: Number,
          strengths: [{ type: String }],
          improvements: [{ type: String }],
          isSkipped: { type: Boolean, default: false },
          skipReason: { type: String, default: "" },
        },
      ],
      evaluatedAt: Date,
      evaluationDisclaimer: {
        type: String,
        default:
          "Practice-only AI evaluation based on recognized answer transcripts. Facial expressions, body language, and vocal confidence are not measured.",
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
