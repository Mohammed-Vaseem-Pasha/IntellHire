require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { performance } = require("node:perf_hooks");
const { auth } = require("./firebaseAdmin");
const User = require("./models/User");
const ResumeRecord = require("./models/ResumeRecord");
const RoadmapRecord = require("./models/RoadmapRecord");

const InterviewSession = require("./models/InterviewSession");
const { getCompletedInterviewHistory } = require("./services/interviewHistory");
const {
    createEvaluationRetryCache,
    runInterviewEvaluation,
    findExistingAnswerForRetry,
    getMatchingPendingEvaluation,
    saveEvaluationCheckpoint,
} = require("./services/interviewEvaluation");
const { getActiveQuestionIndex } = require("./services/interviewQuestionIndex");
const {
    isConclusionPrompt,
    getInterviewProgress,
    INTERVIEW_TOPICS,
} = require("./services/interviewProgression");
const {
    ANSWER_RELEVANCE_CATEGORIES,
    getAnswerRetryCount,
    shouldRetryAnswer,
    buildAnswerRetryReply,
    buildRetryLimitReply,
} = require("./services/interviewAnswerPolicy");

const {
    OPENING_QUESTION,
    extractResumeProfile,
    generateInterviewQuestion,
    shouldCompleteInterview,
    evaluateInterviewAnswer,
    generateFinalReport,
    detectInterviewIntent,
    buildCandidateQuestionReply,
    buildAnswerReply,
    generateCareerRoadmap,
} = require("./services/interviewAI");
const {
    getInterviewLimits,
    getInterviewTargetQuestionCount,
    reachedDurationLimit,
} = require("./services/interviewPolicy");


const app = express();
const PORT = process.env.PORT || 5000;
const evaluationRetryCache = createEvaluationRetryCache();
const REQUEST_BODY_ERROR_TYPES = new Set([
    "charset.unsupported",
    "encoding.unsupported",
    "entity.parse.failed",
    "entity.too.large",
    "entity.verify.failed",
    "request.aborted",
    "request.size.invalid",
    "stream.encoding.set",
    "stream.not.readable",
]);

function getInterviewStartErrorMessage(error, phase) {
    const status = Number(error?.status || error?.statusCode);
    const detail = String(error?.message || "").toLowerCase();
    if (/GROQ_API_KEY is missing/i.test(error?.message || "")) {
        return "Interview AI is not configured on the backend. Set GROQ_API_KEY and restart the backend.";
    }
    if (status === 401 || status === 403) {
        return "The  API rejected the backend credentials. Check the backend GROQ_API_KEY configuration.";
    }
    if (status === 429) {
        return "The  API is rate-limiting interview setup. Please wait briefly and try again.";
    }
    if (status === 404) {
        return "The configured Groq model was not found or is unavailable. Check the backend model configuration.";
    }
    if (/question generation/i.test(phase)) {
        return detail.includes("empty") || detail.includes("invalid response")
            ? "The model returned an empty or invalid opening question twice. Please retry the interview."
            : "The opening question could not be generated. Check the Groq model configuration and backend logs, then retry.";
    }
    if (/resume profile/i.test(phase)) {
        return detail.includes("empty") || detail.includes("invalid")
            ? "The  model returned an empty or invalid resume analysis twice. Please retry with a readable PDF."
            : "The resume could not be analyzed by Groq. Check the backend model configuration and retry.";
    }
    if (/MongoDB session creation|MongoDB session save/i.test(phase)) {
        return "The interview session could not be saved. Check the backend MongoDB connection and try again.";
    }
    if (status >= 400 && status < 500) {
        return `The API rejected the interview setup request (HTTP ${status}). Check the configured model and request limits.`;
    }
    if (/timeout|ECONN|fetch failed|network/i.test(error?.message || "")) {
        return "The interview AI service could not be reached. Check the backend network connection and try again.";
    }
    return `Interview setup failed during ${phase}. Check the backend logs for details and try again.`;
}

function getInterviewStartErrorStatus(error, phase) {
    if (/GROQ_API_KEY is missing/i.test(error?.message || "")) return 503;
    if (/opening question generation|resume profile analysis/i.test(phase)) {
        return error?.status === 429 ? 503 : 502;
    }
    if (/timeout|ECONN|fetch failed|network/i.test(error?.message || "")) return 503;
    return 500;
}

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://mohammed-vaseem-pasha.github.io",
];

app.use(
    cors({
        origin: allowedOrigins,
        credentials: true,
    })
);

app.use(express.json());
// Basic route
app.get("/", (req, res) => {
    res.send("IntelliHire AI backend is running!");
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        database:
            mongoose.connection.readyState === 1
                ? "connected"
                : "disconnected",
    });
});

// Verify Firebase login and create/find the user's account
app.get("/api/auth/me", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";

        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Firebase ID token is required.",
            });
        }

        const idToken = authHeader.slice(7);
        const decodedToken = await auth.verifyIdToken(idToken);

        // Create the account only if it does not already exist.
        // $setOnInsert prevents existing balances from being reset.
        let user;

        try {
            user = await User.findOneAndUpdate(
                { firebaseUid: decodedToken.uid },
                {
                    $setOnInsert: {
                        firebaseUid: decodedToken.uid,
                        email: decodedToken.email || "",
                        displayName: decodedToken.name || "",
                        coins: 150,
                        trialGranted: true,
                    },
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                    setDefaultsOnInsert: true,
                }
            );
        } catch (dbError) {
            // Another simultaneous request may have created this user first.
            if (dbError.code !== 11000) {
                throw dbError;
            }

            user = await User.findOne({
                firebaseUid: decodedToken.uid,
            });
        }

        if (!user) {
            throw new Error("Could not retrieve the user account.");
        }

        return res.json({
            success: true,
            user: {
                uid: user.firebaseUid,
                email: user.email,
                displayName: user.displayName,
                coins: user.coins,
                trialGranted: user.trialGranted,
            },
        });
    } catch (error) {
        console.error("Authentication error:", error.message);

        return res.status(401).json({
            success: false,
            message: "Authentication failed. Please sign in again.",
        });
    }
});

// Update user profile display name
app.put("/api/auth/profile", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Firebase ID token is required.",
            });
        }

        const idToken = authHeader.slice(7);
        const decodedToken = await auth.verifyIdToken(idToken);
        const { displayName } = req.body || {};

        if (!displayName || !displayName.trim()) {
            return res.status(400).json({
                success: false,
                message: "Display name cannot be empty.",
            });
        }

        const updatedUser = await User.findOneAndUpdate(
            { firebaseUid: decodedToken.uid },
            { displayName: displayName.trim() },
            { new: true }
        );

        return res.json({
            success: true,
            user: {
                uid: updatedUser ? updatedUser.firebaseUid : decodedToken.uid,
                email: updatedUser ? updatedUser.email : (decodedToken.email || ""),
                displayName: updatedUser ? updatedUser.displayName : displayName.trim(),
            },
        });
    } catch (error) {
        console.error("Profile update error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to update profile.",
        });
    }
});

app.get("/api/interview/history", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in first.",
            });
        }

        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const interviews = await getCompletedInterviewHistory(
            InterviewSession,
            decoded.uid
        );
        return res.json({ success: true, interviews });
    } catch (error) {
        console.error("Interview history retrieval error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Interview history could not be loaded. Please try again.",
        });
    }
});

// Dynamic AI Career Roadmap generation
app.post("/api/roadmap/generate", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in to generate a career roadmap.",
            });
        }

        await auth.verifyIdToken(authHeader.slice(7));

        const { targetRole, currentSkills, experienceLevel } = req.body || {};
        const safeRole = typeof targetRole === "string" ? targetRole.trim().slice(0, 150) : "";

        if (!safeRole) {
            return res.status(400).json({
                success: false,
                message: "Target career role is required (e.g. AI/ML Engineer, Frontend Developer).",
            });
        }

        const roadmap = await generateCareerRoadmap({
            targetRole: safeRole,
            currentSkills: typeof currentSkills === "string" ? currentSkills.slice(0, 1000) : "",
            experienceLevel: typeof experienceLevel === "string" ? experienceLevel.slice(0, 100) : "Entry Level",
        });

        return res.json({
            success: true,
            roadmap,
        });
    } catch (error) {
        console.error("Roadmap generation endpoint error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to generate career roadmap. Please try again.",
        });
    }
});

// ─── Roadmap Persistence ────────────────────────────────────────────────────

// GET /api/roadmap/current — retrieve the user's persisted roadmap
app.get("/api/roadmap/current", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Please sign in first." });
        }
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const record = await RoadmapRecord.findOne({ firebaseUid: decoded.uid }).lean();
        if (!record) return res.json({ success: true, record: null });
        return res.json({ success: true, record });
    } catch (error) {
        console.error("Roadmap current retrieval error:", error.message);
        return res.status(500).json({ success: false, message: "Could not load saved roadmap." });
    }
});

// POST /api/roadmap/save — upsert the user's active roadmap (replaces existing)
app.post("/api/roadmap/save", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Please sign in first." });
        }
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const { targetRole, experienceLevel, roadmap } = req.body || {};
        if (!roadmap || typeof roadmap !== "object") {
            return res.status(400).json({ success: false, message: "Roadmap data is required." });
        }
        // Count milestones (total across all phases) to initialise progress array
        const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
        const milestoneCount = phases.reduce((acc, p) => {
            const ms = Array.isArray(p.milestones) ? p.milestones.length : 0;
            return acc + ms;
        }, 0);
        const milestoneProgress = Array.from({ length: milestoneCount }, () => ({
            status: "pending",
            note: "",
            completedAt: null,
        }));
        const record = await RoadmapRecord.findOneAndUpdate(
            { firebaseUid: decoded.uid },
            {
                $set: {
                    targetRole: String(targetRole || "").slice(0, 200),
                    experienceLevel: String(experienceLevel || "").slice(0, 100),
                    roadmap,
                    milestoneProgress,
                },
            },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        return res.json({ success: true, record });
    } catch (error) {
        console.error("Roadmap save error:", error.message);
        return res.status(500).json({ success: false, message: "Could not save roadmap. Please retry." });
    }
});

// PATCH /api/roadmap/milestone/:index — update one milestone's status + note
app.patch("/api/roadmap/milestone/:index", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Please sign in first." });
        }
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const idx = parseInt(req.params.index, 10);
        if (!Number.isFinite(idx) || idx < 0) {
            return res.status(400).json({ success: false, message: "Invalid milestone index." });
        }
        const { status, note } = req.body || {};
        const VALID_STATUSES = ["pending", "in_progress", "completed"];
        if (status !== undefined && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Status must be pending, in_progress, or completed." });
        }
        const record = await RoadmapRecord.findOne({ firebaseUid: decoded.uid });
        if (!record) {
            return res.status(404).json({ success: false, message: "No saved roadmap found. Generate and save a roadmap first." });
        }
        if (idx >= record.milestoneProgress.length) {
            return res.status(400).json({ success: false, message: "Milestone index out of range." });
        }
        if (status !== undefined) {
            record.milestoneProgress[idx].status = status;
            record.milestoneProgress[idx].completedAt = status === "completed" ? new Date() : null;
        }
        if (note !== undefined) {
            record.milestoneProgress[idx].note = String(note).slice(0, 2000);
        }
        record.markModified("milestoneProgress");
        await record.save();
        return res.json({ success: true, milestoneProgress: record.milestoneProgress });
    } catch (error) {
        console.error("Roadmap milestone update error:", error.message);
        return res.status(500).json({ success: false, message: "Could not update milestone. Please retry." });
    }
});

// ─── Resume workspace persistence: analysis history and user-built resumes. ──
app.get("/api/resume/records", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Please sign in first." });
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const records = await ResumeRecord.find({ firebaseUid: decoded.uid }).sort({ updatedAt: -1 }).lean();
        return res.json({ success: true, records });
    } catch (error) {
        console.error("Resume records retrieval error:", error.message);
        return res.status(500).json({ success: false, message: "Resume records could not be loaded." });
    }
});

app.post("/api/resume/records", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Please sign in first." });
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const { kind, title, targetJobTitle, jobDescription, resumeData, analysisData, recordId, fileName, extractedCharacterCount } = req.body || {};
        if (!["analysis", "builder"].includes(kind)) return res.status(400).json({ success: false, message: "Record kind must be analysis or builder." });
        if (kind === "builder" && (!resumeData || typeof resumeData !== "object")) return res.status(400).json({ success: false, message: "Resume builder data is required." });
        if (kind === "analysis" && (!analysisData || typeof analysisData !== "object")) return res.status(400).json({ success: false, message: "Analysis results are required." });
        const safe = {
            title: String(title || (kind === "builder" ? "My Resume" : "Resume Analysis")).slice(0, 200),
            targetJobTitle: String(targetJobTitle || "").slice(0, 200),
            jobDescription: String(jobDescription || "").slice(0, 12000),
            fileName: String(fileName || "").slice(0, 255),
            extractedCharacterCount: Math.max(0, Number(extractedCharacterCount) || 0),
            ...(kind === "builder" ? { resumeData } : { analysisData }),
        };
        let record;
        if (recordId && mongoose.isValidObjectId(recordId)) {
            record = await ResumeRecord.findOneAndUpdate(
                { _id: recordId, firebaseUid: decoded.uid, kind },
                { $set: safe }, { new: true, runValidators: true }
            );
            if (!record) return res.status(404).json({ success: false, message: "Resume record not found." });
        } else {
            record = await ResumeRecord.create({ firebaseUid: decoded.uid, kind, ...safe });
        }
        return res.status(200).json({ success: true, record });
    } catch (error) {
        console.error("Resume record save error:", error.message);
        return res.status(500).json({ success: false, message: "Resume changes could not be saved. Please retry." });
    }
});

// Configure Multer for PDF file uploads (in-memory buffer, max 10MB)
const multer = require("multer");
const { extractTextFromPdf, analyzeResume } = require("./services/resumeAnalyzer");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max limit
    },
    fileFilter: (req, file, cb) => {
        const isPdfMime = file.mimetype === "application/pdf";
        const isPdfExt = file.originalname.toLowerCase().endsWith(".pdf");
        if (isPdfExt && (!file.mimetype || isPdfMime)) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file format. Only PDF (.pdf) documents are accepted."));
        }
    },
});

// Authenticated Resume Analysis Endpoint (Cost: 25 Credits)
app.post("/api/resume/analyze", (req, res, next) => {
    upload.single("resume")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({
                    success: false,
                    message: "File exceeds maximum size limit of 10MB. Please upload a smaller PDF.",
                });
            }
            return res.status(400).json({
                success: false,
                message: `File upload error: ${err.message}`,
            });
        } else if (err) {
            return res.status(400).json({
                success: false,
                message: err.message,
            });
        }
        next();
    });
}, async (req, res) => {
    try {
        // 1. Authenticate Request
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Please sign in.",
            });
        }

        const idToken = authHeader.slice(7);
        let decodedToken;
        try {
            decodedToken = await auth.verifyIdToken(idToken);
        } catch (authErr) {
            console.error("Resume analysis auth verification failed:", authErr.message);
            return res.status(401).json({
                success: false,
                message: "Authentication token invalid or expired. Please sign in again.",
            });
        }

        // 2. Verify User
        const user = await User.findOne({ firebaseUid: decodedToken.uid });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User account not found. Please re-authenticate.",
            });
        }

        // 3. Validate Inputs
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "Resume document is required. Please upload a PDF file.",
            });
        }

        const jobDescription = (req.body.jobDescription || "").trim();
        const targetJobTitle = (req.body.targetJobTitle || "").trim().slice(0, 200);
        if (jobDescription.length > 12000) {
            return res.status(400).json({
                success: false,
                message: "Job description must be 12,000 characters or fewer.",
            });
        }
        if (jobDescription && jobDescription.length < 20) {
            return res.status(400).json({
                success: false,
                message: "If providing a job description, it must contain at least 20 characters.",
            });
        }

        // 4. Extract Text from PDF
        let extractedText = "";
        try {
            extractedText = await extractTextFromPdf(req.file.buffer);
        } catch (pdfError) {
            return res.status(422).json({
                success: false,
                message: pdfError.message || "Failed to extract readable text from PDF.",
            });
        }

        // 5. Perform Real ATS Analysis
        let analysisData;
        try {
            analysisData = await analyzeResume(extractedText, jobDescription, targetJobTitle);
        } catch (analysisError) {
            return res.status(500).json({
                success: false,
                message: `Analysis processing failed: ${analysisError.message}`,
            });
        }

        // 6. Persist the analysis so it remains available after refresh or logout.
        let savedAnalysis;
        try {
            savedAnalysis = await ResumeRecord.create({
                firebaseUid: decodedToken.uid,
                kind: "analysis",
                title: targetJobTitle ? `Resume analysis — ${targetJobTitle}` : `Resume analysis — ${req.file.originalname}`,
                targetJobTitle,
                jobDescription,
                fileName: req.file.originalname,
                extractedCharacterCount: extractedText.length,
                analysisData: { fileName: req.file.originalname, fileSizeBytes: req.file.size, characterCount: extractedText.length, ...analysisData },
            });
        } catch (saveError) {
            console.error("Resume analysis persistence error:", saveError.message);
            return res.status(500).json({ success: false, message: "Analysis could not be saved." });
        }

        // 7. Return Structured Results
        return res.json({
            success: true,
            message: "Resume analysis completed successfully.",
            recordId: savedAnalysis._id,
            data: {
                fileName: req.file.originalname,
                fileSizeBytes: req.file.size,
                characterCount: extractedText.length,
                ...analysisData,
            },
        });
    } catch (error) {
        console.error("Resume analysis endpoint error:", error);
        return res.status(500).json({
            success: false,
            message: "An internal server error occurred while processing the resume analysis.",
            error: error.message,
        });
    }
});

// Start only after MongoDB connects
app.post("/api/interview/start", (req, res, next) => {
    upload.single("resume")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            const message = err.code === "LIMIT_FILE_SIZE"
                ? "Resume PDFs must be 10 MB or smaller."
                : `Resume upload failed: ${err.message}`;
            return res.status(400).json({ success: false, message });
        }
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    let phase = "authentication";

    try {
        const authHeader = req.headers.authorization || "";

        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in first.",
            });
        }

        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const uid = decoded.uid;
        phase = "account lookup";
        const user = await User.findOne({ firebaseUid: uid });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User account not found.",
            });
        }

        const requestData = req.body || {};
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "A PDF resume is required to start a personalized interview.",
            });
        }
        const safeRole = typeof requestData.jobRole === "string"
            ? requestData.jobRole.trim()
            : "";
        if (!safeRole || safeRole.length > 200) {
            return res.status(400).json({
                success: false,
                message: "A target job role of up to 200 characters is required.",
            });
        }
        const safeDescription = typeof requestData.jobDescription === "string"
            ? requestData.jobDescription.trim()
            : "";
        if (safeDescription.length > 12000) {
            return res.status(400).json({
                success: false,
                message: "Job description must be 12,000 characters or fewer.",
            });
        }
        let resumeText;
        phase = "PDF resume extraction";
        try {
            resumeText = await extractTextFromPdf(req.file.buffer);
        } catch (resumeError) {
            return res.status(400).json({
                success: false,
                message: resumeError.message || "Could not read the uploaded resume.",
            });
        }
        if (resumeText.length > 20000) {
            return res.status(400).json({
                success: false,
                message: "Resume text must be 20,000 characters or fewer.",
            });
        }
        const safeResume = resumeText.trim();
        phase = "resume profile analysis";
        const resumeProfile = safeResume
            ? await extractResumeProfile(safeResume)
            : {
                candidateName: "",
                summary: "",
                skills: [],
                technicalSkills: [],
                softSkills: [],
                projects: [],
                experience: [],
                internships: [],
                education: [],
                certifications: [],
                achievements: [],
                interests: [],
            };
        const interviewLimits = getInterviewLimits();
        const safeExperienceLevel = requestData.experienceLevel === "Experienced professional"
            ? "Experienced professional"
            : "Fresher";
        const parsedDuration = Number.parseInt(requestData.durationMinutes, 10);
        const selectedDuration = [5, 10, 15, 20, 30].includes(parsedDuration)
            ? parsedDuration
            : 15;

        const targetQuestionCount = getInterviewTargetQuestionCount({
            jobRole: safeRole,
            resumeProfile,
            durationMinutes: selectedDuration,
        });
        const interviewType = "Mixed";
        const language = "English";
        const resumeFileName = req.file?.originalname || "";

        // Keep the opening independent of model wording and role-specific context.
        phase = "opening question generation";
        const firstQuestion = OPENING_QUESTION;

        const initialProgress = getInterviewProgress({
            resumeProfile,
            previousConversation: [{
                speaker: "interviewer",
                text: firstQuestion,
                questionIndex: 0,
            }],
            targetQuestionCount,
            experienceLevel: safeExperienceLevel,
            durationMinutes: selectedDuration,
            jobRole: safeRole,
            jobDescription: safeDescription,
        });

        const session = new InterviewSession({
            firebaseUid: uid,
            userEmail: decoded.email || "",
            jobRole: safeRole,
            jobDescription: safeDescription,
            interviewType,
            experienceLevel: safeExperienceLevel,
            durationMinutes: selectedDuration,
            startedAt: new Date(),
            language: language.trim().slice(0, 40) || "English",
            resumeText: safeResume,
            resumeFileName: String(resumeFileName).slice(0, 255),
            resumeProfile,
            safetyMaxTurns: interviewLimits.maxTurns,
            safetyMaxDurationMinutes: Math.max(selectedDuration + 15, interviewLimits.maxDurationMinutes),
            minimumAssessmentTurns: interviewLimits.minAssessmentTurns,
            targetQuestionCount,
            topicCoverage: (initialProgress.topicChecklist || []).map((t) => ({
                topicId: t.id,
                name: t.name,
                status: t.status,
            })),
            interviewState: "asking",
            currentQuestionIndex: 0,
            status: "in_progress",
            reportStatus: "not_started",
            creditsDeducted: 0,
            conversation: [{
                speaker: "interviewer",
                text: firstQuestion,
                questionIndex: 0,
            }],
        });

        phase = "MongoDB session creation";
        await session.save();

        return res.status(201).json({
            success: true,
            message: "Interview started.",
            sessionId: session._id,
            question: firstQuestion,
            questionIndex: 0,
            responseId: `${session._id}:question:0`,
            targetQuestionCount,
            durationMinutes: selectedDuration,
            experienceLevel: safeExperienceLevel,
            startedAt: session.startedAt,
            interviewState: "asking",
            interviewCompleted: false,
            resumeProfile,
            topicCoverage: session.topicCoverage,
        });
    } catch (error) {
        const safeMessage = getInterviewStartErrorMessage(error, phase);
        console.error("Interview start error:", {
            phase,
            name: error.name,
            status: error.status || error.statusCode || null,
            code: error.code || null,
            message: error.message,
        });

        return res.status(getInterviewStartErrorStatus(error, phase)).json({
            success: false,
            message: safeMessage,
            phase,
        });
    }
});

app.post("/api/interview/:sessionId/answer", async (req, res) => {
    const requestStartedAt = performance.now();
    let claimedSessionId = null;
    let claimedQuestionIndex = null;
    let requestedQuestionIndex = null;
    let phase = "answer validation";
    let phaseStartedAt = requestStartedAt;
    let evaluationForRetry = null;
    let evaluationCacheIdentity = null;
    const startPhase = (nextPhase) => {
        console.info("[Interview timing] answer phase", {
            phase,
            durationMs: Math.round(performance.now() - phaseStartedAt),
        });
        phase = nextPhase;
        phaseStartedAt = performance.now();
    };
    try {
        const authHeader = req.headers.authorization || "";

        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in first.",
            });
        }

        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const { sessionId } = req.params;
        const {
            answer,
            questionIndex: submittedQuestionIndex,
            submissionId,
            isSkip,
        } = req.body || {};
        requestedQuestionIndex = submittedQuestionIndex;

        if (!mongoose.isValidObjectId(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid interview session ID.",
            });
        }

        const isExplicitSkip = Boolean(isSkip);
        const effectiveAnswer = typeof answer === "string" && answer.trim().length > 0
            ? answer
            : (isExplicitSkip ? "Let's skip this question" : (typeof answer === "string" ? answer : ""));

        if (typeof effectiveAnswer !== "string") {
            return res.status(400).json({
                success: false,
                message: "An answer is required.",
            });
        }
        if (!effectiveAnswer.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please provide an answer before submitting.",
            });
        }
        if (effectiveAnswer.trim().length > 12000) {
            return res.status(400).json({
                success: false,
                message: "Your answer must be 12,000 characters or fewer.",
            });
        }
        if (!Number.isInteger(requestedQuestionIndex) || requestedQuestionIndex < 0) {
            return res.status(400).json({
                success: false,
                message: "A valid interview question index is required.",
            });
        }
        if (typeof submissionId !== "string" || !submissionId || submissionId.length > 100) {
            return res.status(400).json({
                success: false,
                message: "An answer submission ID is required.",
            });
        }
        const responseId = `${sessionId}:${submissionId}`;

        let session = await InterviewSession.findOne({
            _id: sessionId,
            firebaseUid: decoded.uid,
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Interview session not found.",
            });
        }

        const cleanAnswer = effectiveAnswer.trim();
        const existingCandidateRequest = (session.candidateRequests || []).find(
            (request) => request.submissionId === submissionId
        );
        if (
            existingCandidateRequest?.intent === "retry_answer" &&
            existingCandidateRequest.text === cleanAnswer
        ) {
            const retryQuestion = [...(session.conversation || [])]
                .reverse()
                .find((item) => item.speaker === "interviewer" && item.questionIndex === existingCandidateRequest.questionIndex);
            return res.json({
                success: true,
                intent: "retry_answer",
                responseId,
                reply: existingCandidateRequest.reply,
                evaluation: {
                    score: existingCandidateRequest.score ?? 0,
                    relevance: existingCandidateRequest.relevance,
                    feedback: existingCandidateRequest.reply,
                    strengths: [],
                    improvements: [],
                    idealConcept: "",
                },
                nextQuestion: retryQuestion?.text || "",
                questionIndex: existingCandidateRequest.questionIndex,
                interviewCompleted: false,
                interviewState: "asking",
            });
        }
        if (existingCandidateRequest?.intent === "skip_question") {
            const nextInterviewerQuestion = [...(session.conversation || [])]
                .find((item) => item.speaker === "interviewer" && item.questionIndex === existingCandidateRequest.questionIndex + 1);
            return res.json({
                success: true,
                intent: "skip_question",
                responseId,
                reply: existingCandidateRequest.reply || "Understood, let's skip this question and move forward.",
                evaluation: {
                    score: 0,
                    relevance: "skipped",
                    feedback: "This question was skipped at candidate request.",
                    strengths: [],
                    improvements: ["Practice explaining this topic to address questions like this in future interviews."],
                    idealConcept: "",
                },
                interviewCompleted: session.status === "completed",
                interviewState: session.interviewState,
                completionReason: session.completionReason,
                finalMessage: session.status === "completed" ? session.completionMessage : null,
                completed: session.status === "completed",
                nextQuestion: session.status === "in_progress" ? nextInterviewerQuestion?.text || null : null,
                questionIndex: session.currentQuestionIndex,
                reportStatus: session.reportStatus,
                report: session.status === "completed" && session.reportStatus === "ready" ? session.report : undefined,
            });
        }
        const pendingEvaluation = session.pendingEvaluation;
        const matchingPendingEvaluation = getMatchingPendingEvaluation(
            pendingEvaluation,
            requestedQuestionIndex,
            cleanAnswer,
        );
        if (
            pendingEvaluation &&
            !matchingPendingEvaluation &&
            pendingEvaluation.questionIndex === requestedQuestionIndex
        ) {
            return res.status(409).json({
                success: false,
                message: "The previous answer is still being saved. Retry that same answer before continuing.",
            });
        }
        const priorAnswer = findExistingAnswerForRetry(
            session.conversation,
            requestedQuestionIndex,
            submissionId,
            cleanAnswer,
        );
        if (priorAnswer) {
            if (priorAnswer.text !== cleanAnswer) {
                return res.status(409).json({
                    success: false,
                    message: "This submission ID was already used for a different answer.",
                });
            }
            const previousEvaluation = (session.report?.questionReviews || []).find(
                (review) => review.questionIndex === requestedQuestionIndex
            );
            const currentQuestion = [...(session.conversation || [])]
                .reverse()
                .find((item) => item.speaker === "interviewer");
            const lastConversationItem = session.conversation?.[session.conversation.length - 1];
            if (
                session.processingQuestionIndex === requestedQuestionIndex &&
                lastConversationItem?.speaker === "candidate"
            ) {
                return res.status(202).json({
                    success: true,
                    answerStatus: "processing",
                });
            }
            if (
                session.status === "in_progress" &&
                lastConversationItem?.speaker === "candidate"
            ) {
                const orphanedAnswerId = priorAnswer._id;
                session.conversation = session.conversation.filter(
                    (item) => String(item._id) !== String(orphanedAnswerId)
                );
                session.interviewState = "asking";
                await session.save();
                if (previousEvaluation) {
                    evaluationRetryCache.set(
                        {
                            sessionId: String(session._id),
                            questionIndex: requestedQuestionIndex,
                            submissionId,
                        },
                        {
                            answer: cleanAnswer,
                            question: currentQuestion?.text || "",
                            evaluation: {
                                score: previousEvaluation.score,
                                feedback: previousEvaluation.feedback,
                                strengths: previousEvaluation.strengths,
                                improvements: previousEvaluation.improvements,
                                idealConcept: previousEvaluation.idealConcept,
                            },
                        }
                    );
                }
            }
            if (lastConversationItem?.speaker !== "candidate") {
                return res.json({
                    success: true,
                    intent: "answer",
                    responseId,
                    evaluation: previousEvaluation
                        ? {
                            score: previousEvaluation.score,
                            relevance: previousEvaluation.relevance || "unclear",
                            feedback: previousEvaluation.feedback,
                            strengths: previousEvaluation.strengths,
                            improvements: previousEvaluation.improvements,
                            idealConcept: previousEvaluation.idealConcept,
                        }
                        : null,
                    interviewCompleted: session.status === "completed",
                    interviewState: session.interviewState,
                    completionReason: session.completionReason,
                    finalMessage: session.status === "completed" ? session.completionMessage : null,
                    completed: session.status === "completed",
                    nextQuestion: session.status === "in_progress" ? currentQuestion?.text || null : null,
                    questionIndex: session.currentQuestionIndex,
                    reportStatus: session.reportStatus,
                    report: session.reportStatus === "ready" ? session.report : undefined,
                });
            }
        }

        if (
            session.status === "completed" &&
            existingCandidateRequest?.intent === "finish"
        ) {
            if (existingCandidateRequest.text !== cleanAnswer) {
                return res.status(409).json({
                    success: false,
                    message: "This submission ID was already used for a different request.",
                });
            }
            return res.json({
                success: true,
                intent: "finish",
                responseId,
                reply: session.completionMessage,
                interviewCompleted: true,
                interviewState: "completed",
                completionReason: session.completionReason,
                finalMessage: session.completionMessage,
                questionIndex: session.currentQuestionIndex,
                nextQuestion: null,
                reportStatus: session.reportStatus,
            });
        }

        if (session.status !== "in_progress") {
            return res.status(409).json({
                success: false,
                message: "This interview is no longer in progress.",
            });
        }

        const conversation = session.conversation || [];
        const lastMessage = conversation[conversation.length - 1];

        if (!lastMessage || lastMessage.speaker !== "interviewer") {
            return res.status(409).json({
                success: false,
                message: "The interview is not ready for an answer.",
            });
        }

        const activeQuestionIndex = getActiveQuestionIndex(session);
        if (
            activeQuestionIndex === null ||
            requestedQuestionIndex !== activeQuestionIndex
        ) {
            return res.status(409).json({
                success: false,
                message: "This answer does not match the current interview question.",
            });
        }
        const question = lastMessage.text;
        const questionIndex = activeQuestionIndex;
        const answerIntent = isExplicitSkip
            ? "skip_question"
            : detectInterviewIntent(cleanAnswer, question);
        const persistCandidateRequest = async (intent, { claimLock = false } = {}) => {
            const existingRequest = (session.candidateRequests || []).find(
                (request) => request.submissionId === submissionId
            );
            if (existingRequest && (
                existingRequest.text !== cleanAnswer ||
                existingRequest.intent !== intent
            )) return null;
            if (existingRequest && !claimLock) return session;
            if (existingRequest && claimLock) {
                const lockedSession = await InterviewSession.findOneAndUpdate(
                    {
                        _id: sessionId,
                        firebaseUid: decoded.uid,
                        status: "in_progress",
                        currentQuestionIndex: questionIndex,
                        processingQuestionIndex: null,
                    },
                    {
                        $set: {
                            interviewState: "evaluating",
                            processingQuestionIndex: questionIndex,
                        },
                    },
                    { new: true }
                );
                return lockedSession;
            }
            const update = {
                $push: {
                    candidateRequests: {
                        text: cleanAnswer,
                        intent,
                        questionIndex,
                        submissionId,
                        timestamp: new Date(),
                    },
                },
                $set: {
                    interviewState: claimLock ? "evaluating" : "asking",
                    ...(claimLock ? { processingQuestionIndex: questionIndex } : {}),
                },
            };
            const savedRequest = await InterviewSession.findOneAndUpdate(
                {
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    status: "in_progress",
                    currentQuestionIndex: questionIndex,
                    processingQuestionIndex: null,
                    "candidateRequests.submissionId": { $ne: submissionId },
                },
                update,
                { new: true }
            );
            if (savedRequest) return savedRequest;
            const latestSession = await InterviewSession.findOne({
                _id: sessionId,
                firebaseUid: decoded.uid,
            });
            return (latestSession?.candidateRequests || []).some(
                (request) => request.submissionId === submissionId
            )
                ? latestSession
                : null;
        };

        if (answerIntent === "candidate_question") {
            session = await persistCandidateRequest(answerIntent);
            if (!session) {
                return res.status(409).json({
                    success: false,
                    message: "The interview changed while saving your question. Please retry it.",
                });
            }
            return res.json({
                success: true,
                intent: "candidate_question",
                responseId,
                reply: buildCandidateQuestionReply({
                    answer: cleanAnswer,
                    question,
                    jobRole: session.jobRole,
                    jobDescription: session.jobDescription,
                    resumeProfile: session.resumeProfile,
                }),
                nextQuestion: question,
                questionIndex,
                interviewCompleted: false,
                interviewState: "asking",
            });
        }

        if (answerIntent === "clarification") {
            session = await persistCandidateRequest(answerIntent);
            if (!session) {
                return res.status(409).json({
                    success: false,
                    message: "The interview changed while saving your request. Please retry it.",
                });
            }
            return res.json({
                success: true,
                intent: "clarification",
                responseId,
                reply: "Of course. Here is the question again: ",
                nextQuestion: question,
                questionIndex,
                interviewCompleted: false,
                interviewState: "asking",
            });
        }
        if (answerIntent === "continue") {
            session = await persistCandidateRequest(answerIntent, {
                claimLock: isConclusionPrompt(question),
            });
            if (!session) {
                return res.status(409).json({
                    success: false,
                    message: "The interview changed while saving your request. Please retry it.",
                });
            }
            let nextQuestion = question;
            if (isConclusionPrompt(question)) {
                claimedSessionId = session._id;
                claimedQuestionIndex = questionIndex;
                startPhase("next interviewer response generation");
                nextQuestion = await generateInterviewQuestion({
                    resumeText: session.resumeText,
                    resumeProfile: session.resumeProfile,
                    jobRole: session.jobRole,
                    jobDescription: session.jobDescription,
                    previousConversation: conversation.slice(0, -1),
                    targetQuestionCount: session.targetQuestionCount || 10,
                });
                session.conversation = [
                    ...conversation.slice(0, -1),
                    {
                        speaker: "interviewer",
                        text: nextQuestion,
                        questionIndex,
                        timestamp: new Date(),
                    },
                ];
                session.processingQuestionIndex = null;
                session.interviewState = "asking";
                await session.save();
                claimedSessionId = null;
                claimedQuestionIndex = null;
            }
            return res.json({
                success: true,
                intent: "continue",
                responseId,
                reply: "Absolutely. Let's continue.",
                nextQuestion,
                questionIndex,
                interviewCompleted: false,
                interviewState: "asking",
            });
        }

        if (answerIntent === "finish") {
            const finalMessage =
                "Thank you for the conversation. We’ll end the interview here at your request. Your completed answers have been saved.";
            const completedSession = await InterviewSession.findOneAndUpdate(
                {
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    status: "in_progress",
                    currentQuestionIndex: questionIndex,
                    processingQuestionIndex: null,
                    "candidateRequests.submissionId": { $ne: submissionId },
                },
                {
                    $push: {
                        candidateRequests: {
                            text: cleanAnswer,
                            intent: "finish",
                            questionIndex,
                            submissionId,
                            timestamp: new Date(),
                        },
                        conversation: {
                            speaker: "interviewer",
                            text: finalMessage,
                            questionIndex,
                            timestamp: new Date(),
                        },
                    },
                    $set: {
                        currentQuestionIndex: questionIndex,
                        processingQuestionIndex: null,
                        interviewState: "completed",
                        status: "completed",
                        completionMessage: finalMessage,
                        reportStatus: (session.report?.questionReviews || []).length > 0
                            ? "pending"
                            : "not_started",
                        completionReason: "candidate_requested",
                    },
                },
                { new: true }
            );
            if (!completedSession) {
                return res.status(409).json({
                    success: false,
                    message: "The interview changed while saving your request to finish. Please retry it.",
                });
            }
            return res.json({
                success: true,
                intent: "finish",
                responseId,
                reply: "Thanks for the conversation. I’ll close the interview here.",
                finalMessage,
                interviewCompleted: true,
                interviewState: "completed",
                completionReason: "candidate_requested",
                questionIndex,
                nextQuestion: null,
                reportStatus: completedSession?.reportStatus,
            });
        }

        if (answerIntent === "skip_question") {
            session = await InterviewSession.findOneAndUpdate(
                {
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    status: "in_progress",
                    currentQuestionIndex: questionIndex,
                    processingQuestionIndex: null,
                },
                {
                    $set: {
                        processingQuestionIndex: questionIndex,
                        interviewState: "evaluating",
                    },
                },
                { new: true }
            );
            if (!session) {
                const activeEvaluation = await InterviewSession.findOne({
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    status: "in_progress",
                    processingQuestionIndex: questionIndex,
                });
                if (activeEvaluation) {
                    return res.status(202).json({
                        success: true,
                        answerStatus: "processing",
                    });
                }
                return res.status(409).json({
                    success: false,
                    message: "This question has already been processed or is being evaluated.",
                });
            }
            claimedSessionId = session._id;
            claimedQuestionIndex = questionIndex;

            const isTimeExpired = reachedDurationLimit({
                startedAt: session.startedAt,
                durationMinutes: session.durationMinutes,
            });

            const skipFeedback = "Understood. Let's move on to the next question.";
            const skipReview = {
                questionIndex,
                question,
                candidateAnswer: cleanAnswer,
                feedback: "This question was skipped or not answered at the candidate's request.",
                relevance: "skipped",
                idealConcept: "",
                score: 0,
                strengths: [],
                improvements: ["Practice explaining this topic to address questions like this in future interviews."],
                isSkipped: true,
                skipReason: cleanAnswer,
            };

            const updatedReviews = [
                ...(session.report?.questionReviews || []).filter(
                    (existingReview) => existingReview.questionIndex !== questionIndex
                ),
                skipReview,
            ];

            const updatedConversation = [
                ...conversation,
                {
                    speaker: "candidate",
                    text: cleanAnswer,
                    questionIndex,
                    submissionId,
                    timestamp: new Date(),
                },
            ];

            const targetQuestionCount = session.targetQuestionCount || 10;
            const completed = isTimeExpired || await shouldCompleteInterview({
                resumeProfile: session.resumeProfile,
                previousConversation: updatedConversation,
                targetQuestionCount,
                startedAt: session.startedAt,
                durationMinutes: session.durationMinutes,
                experienceLevel: session.experienceLevel,
            });

            const completionReason = isTimeExpired ? "time_limit" : "plan_complete";
            const finalMessage = isTimeExpired
                ? "Thank you for your time. The interview duration has been reached. Your interview is now complete."
                : "Thank you for your time. That concludes your interview. Your interview is now complete.";
            let nextQuestion = null;

            if (!completed) {
                startPhase("next interviewer response generation");
                nextQuestion = await generateInterviewQuestion({
                    resumeText: session.resumeText,
                    resumeProfile: session.resumeProfile,
                    jobRole: session.jobRole,
                    jobDescription: session.jobDescription,
                    previousConversation: updatedConversation,
                    targetQuestionCount,
                    experienceLevel: session.experienceLevel,
                    durationMinutes: session.durationMinutes,
                });

                updatedConversation.push({
                    speaker: "interviewer",
                    text: nextQuestion,
                    questionIndex: questionIndex + 1,
                    timestamp: new Date(),
                });
            } else {
                updatedConversation.push({
                    speaker: "interviewer",
                    text: finalMessage,
                    questionIndex,
                    timestamp: new Date(),
                });
            }

            session.conversation = updatedConversation;
            session.currentQuestionIndex = completed ? questionIndex : questionIndex + 1;
            session.processingQuestionIndex = null;
            session.interviewState = completed ? "completed" : "asking";
            session.pendingEvaluation = null;
            if (!session.report) session.report = {};
            session.report.questionReviews = updatedReviews;
            session.report.experienceLevel = session.experienceLevel;
            session.report.durationMinutes = session.durationMinutes;

            const allSkipped = updatedReviews.filter(r => r.isSkipped || r.relevance === "skipped");
            session.report.skippedQuestionsCount = allSkipped.length;
            session.report.skippedTopics = allSkipped.map(r => r.question.slice(0, 100));

            if (!session.candidateRequests) session.candidateRequests = [];
            session.candidateRequests.push({
                text: cleanAnswer,
                intent: "skip_question",
                questionIndex,
                submissionId,
                relevance: "skipped",
                reply: skipFeedback,
                score: 0,
                timestamp: new Date(),
            });

            if (completed) {
                const average = updatedReviews.length > 0
                    ? Math.round(updatedReviews.reduce((sum, item) => sum + item.score, 0) / updatedReviews.length)
                    : 0;

                session.status = "completed";
                session.completionMessage = finalMessage;
                session.completionReason = completionReason;
                session.reportStatus = "pending";
                session.report.overallScore = average;
                session.report.scoreExplanation = "Average of the recorded AI answer scores, reflecting any skipped questions as zero score.";
                session.report.strengths = [
                    ...new Set(updatedReviews.flatMap((item) => item.strengths || [])),
                ].slice(0, 6);
                session.report.improvements = [
                    ...new Set(updatedReviews.flatMap((item) => item.improvements || [])),
                ].slice(0, 6);
                session.report.evaluatedAt = new Date();
                const lowerScoringReviews = updatedReviews.filter((item) => item.score < 70 && !item.isSkipped);
                session.report.technicalGaps = lowerScoringReviews
                    .map((item) => item.idealConcept)
                    .filter(Boolean)
                    .slice(0, 6);
                session.report.communicationFeedback = "This evaluation uses recognized answer transcripts only; facial expressions, body language, and vocal confidence are not measured.";
                session.report.answerCompletenessFeedback = "Use the question-by-question feedback to review the relevance and completeness of each answer.";
                session.report.projectUnderstandingFeedback = "Project understanding is assessed only where projects were discussed; no unmentioned project details were assumed.";
                session.report.behavioralFeedback = "Behavioral and problem-solving feedback is limited to the situations and responses present in the transcript.";
                session.report.exampleImprovements = [
                    ...new Set(updatedReviews.flatMap((item) => item.improvements || [])),
                ].slice(0, 6);
                session.report.recommendedTopics = [
                    ...new Set(lowerScoringReviews.map((item) => item.idealConcept).filter(Boolean)),
                ].slice(0, 6);
                session.report.nextSteps = [
                    "Review the feedback for each question and practice a focused answer using specific examples.",
                    ...lowerScoringReviews.map((item) => item.idealConcept ? `Study and practice: ${item.idealConcept}` : "").filter(Boolean).slice(0, 4),
                ];
            }

            await session.save();
            claimedSessionId = null;
            claimedQuestionIndex = null;

            return res.json({
                success: true,
                intent: "skip_question",
                responseId,
                reply: skipFeedback,
                evaluation: {
                    score: 0,
                    relevance: "skipped",
                    feedback: "This question was skipped at candidate request.",
                    strengths: [],
                    improvements: ["Practice explaining this topic to address questions like this in future interviews."],
                    idealConcept: "",
                },
                interviewCompleted: completed,
                interviewState: session.interviewState,
                completionReason: session.completionReason,
                finalMessage: completed ? finalMessage : null,
                completed,
                nextQuestion,
                questionIndex: session.currentQuestionIndex,
                reportStatus: session.reportStatus,
                report: completed && session.reportStatus === "ready" ? session.report : undefined,
            });
        }

        session = await InterviewSession.findOneAndUpdate(
            {
                _id: sessionId,
                firebaseUid: decoded.uid,
                status: "in_progress",
                currentQuestionIndex: questionIndex,
                processingQuestionIndex: null,
            },
            {
                $set: {
                    processingQuestionIndex: questionIndex,
                    interviewState: "evaluating",
                },
            },
            { new: true }
        );
        if (!session) {
            const activeEvaluation = await InterviewSession.findOne({
                _id: sessionId,
                firebaseUid: decoded.uid,
                status: "in_progress",
                processingQuestionIndex: questionIndex,
            });
            if (activeEvaluation) {
                return res.status(202).json({
                    success: true,
                    answerStatus: "processing",
                });
            }
            return res.status(409).json({
                success: false,
                message: "An answer for this question has already been submitted or is being evaluated.",
            });
        }
        claimedSessionId = session._id;
        claimedQuestionIndex = questionIndex;

        evaluationCacheIdentity = {
            sessionId: String(session._id),
            questionIndex,
            submissionId: matchingPendingEvaluation
                ? pendingEvaluation.submissionId
                : submissionId,
        };
        const cachedEvaluation = matchingPendingEvaluation
            ? {
                answer: matchingPendingEvaluation.answer,
                question: matchingPendingEvaluation.question,
                evaluation: matchingPendingEvaluation.evaluation,
            }
            : evaluationRetryCache.get(evaluationCacheIdentity);
        if (
            cachedEvaluation &&
            (cachedEvaluation.answer !== cleanAnswer || cachedEvaluation.question !== question)
        ) {
            await InterviewSession.updateOne(
                {
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    processingQuestionIndex: questionIndex,
                },
                {
                    $set: {
                        processingQuestionIndex: null,
                        interviewState: "asking",
                    },
                }
            );
            claimedSessionId = null;
            claimedQuestionIndex = null;
            return res.status(409).json({
                success: false,
                message: "The saved evaluation does not match this answer. Please restore the original answer and retry.",
            });
        }

        startPhase("answer evaluation");
        evaluationForRetry = cachedEvaluation?.evaluation || await runInterviewEvaluation(
            () => evaluateInterviewAnswer({
                jobRole: session.jobRole,
                jobDescription: session.jobDescription,
                interviewType: session.interviewType,
                resumeText: session.resumeText,
                resumeProfile: session.resumeProfile,
                question,
                answer: cleanAnswer,
            }),
            { maxAttempts: 2, delayMs: 500 }
        );
        if (!ANSWER_RELEVANCE_CATEGORIES.has(evaluationForRetry.relevance)) {
            evaluationForRetry = {
                ...evaluationForRetry,
                relevance: "unclear",
            };
        }

        const { maxAnswerRetries } = getInterviewLimits();
        const previousAnswerRetries = getAnswerRetryCount(
            session.candidateRequests,
            questionIndex
        );
        if (shouldRetryAnswer(
            evaluationForRetry.relevance,
            previousAnswerRetries,
            maxAnswerRetries
        )) {
            const retryReply = buildAnswerRetryReply({
                relevance: evaluationForRetry.relevance,
                improvements: evaluationForRetry.improvements,
            });
            const retrySession = await InterviewSession.findOneAndUpdate(
                {
                    _id: sessionId,
                    firebaseUid: decoded.uid,
                    status: "in_progress",
                    currentQuestionIndex: questionIndex,
                    processingQuestionIndex: questionIndex,
                    "candidateRequests.submissionId": { $ne: submissionId },
                },
                {
                    $push: {
                        candidateRequests: {
                            text: cleanAnswer,
                            intent: "retry_answer",
                            questionIndex,
                            submissionId,
                            relevance: evaluationForRetry.relevance,
                            reply: retryReply,
                            score: evaluationForRetry.score,
                            timestamp: new Date(),
                        },
                    },
                    $set: {
                        processingQuestionIndex: null,
                        interviewState: "asking",
                        pendingEvaluation: null,
                    },
                },
                { new: true }
            );
            if (!retrySession) {
                return res.status(409).json({
                    success: false,
                    message: "The interview changed while saving your answer. Please retry submission.",
                });
            }

            evaluationRetryCache.delete(evaluationCacheIdentity);
            claimedSessionId = null;
            claimedQuestionIndex = null;
            return res.json({
                success: true,
                intent: "retry_answer",
                responseId,
                reply: retryReply,
                evaluation: {
                    score: evaluationForRetry.score,
                    relevance: evaluationForRetry.relevance,
                    feedback: retryReply,
                    strengths: [],
                    improvements: evaluationForRetry.improvements,
                    idealConcept: evaluationForRetry.idealConcept,
                },
                nextQuestion: question,
                questionIndex,
                interviewCompleted: false,
                interviewState: "asking",
            });
        }

        if (!evaluationForRetry.feedback || !evaluationForRetry.feedback.trim()) {
            evaluationForRetry = {
                ...evaluationForRetry,
                feedback: buildRetryLimitReply(evaluationForRetry.relevance),
            };
        }
        evaluationRetryCache.set(evaluationCacheIdentity, {
            answer: cleanAnswer,
            question,
            evaluation: evaluationForRetry,
        });

        startPhase("evaluation checkpoint save");
        await saveEvaluationCheckpoint(
            session,
            evaluationCacheIdentity,
            {
                questionIndex,
                submissionId: evaluationCacheIdentity.submissionId,
                answer: cleanAnswer,
                question,
                evaluation: evaluationForRetry,
            },
            evaluationRetryCache
        );

        startPhase("adaptive interview completion check");
        const updatedConversation = [
            ...conversation,
            {
                speaker: "candidate",
                text: cleanAnswer,
                questionIndex,
                submissionId: evaluationCacheIdentity.submissionId,
                timestamp: new Date(),
            },
        ];
        const targetQuestionCount = session.targetQuestionCount || 10;
        const isTimeExpired = reachedDurationLimit({
            startedAt: session.startedAt,
            durationMinutes: session.durationMinutes,
        });
        const completed = isTimeExpired || await shouldCompleteInterview({
            resumeProfile: session.resumeProfile,
            previousConversation: updatedConversation,
            targetQuestionCount,
            startedAt: session.startedAt,
            durationMinutes: session.durationMinutes,
            experienceLevel: session.experienceLevel,
        });
        const completionReason = isTimeExpired ? "time_limit" : "plan_complete";
        const finalMessage = isTimeExpired
            ? "Thank you for your time. The interview duration has been reached. Your interview is now complete."
            : "Thank you for your time. That concludes your interview. Your interview is now complete.";
        let nextQuestion = null;

        if (!completed) {
            startPhase("next interviewer response generation");
            nextQuestion = await generateInterviewQuestion({
                resumeText: session.resumeText,
                resumeProfile: session.resumeProfile,
                jobRole: session.jobRole,
                jobDescription: session.jobDescription,
                previousConversation: updatedConversation,
                targetQuestionCount,
                experienceLevel: session.experienceLevel,
                durationMinutes: session.durationMinutes,
            });

            updatedConversation.push({
                speaker: "interviewer",
                text: nextQuestion,
                questionIndex: questionIndex + 1,
                timestamp: new Date(),
            });
        } else {
            updatedConversation.push({
                speaker: "interviewer",
                text: finalMessage,
                questionIndex,
                timestamp: new Date(),
            });
        }

        const progressAfterAnswer = getInterviewProgress({
            resumeProfile: session.resumeProfile,
            previousConversation: updatedConversation,
            targetQuestionCount,
            experienceLevel: session.experienceLevel,
            durationMinutes: session.durationMinutes,
            jobRole: session.jobRole,
            jobDescription: session.jobDescription,
            sessionId: String(session._id),
        });
        session.topicCoverage = (progressAfterAnswer.topicChecklist || []).map((t) => ({
            topicId: t.id,
            name: t.name,
            status: t.status,
        }));

        const review = {
            questionIndex,
            question,
            candidateAnswer: cleanAnswer,
            feedback: evaluationForRetry.feedback,
            relevance: evaluationForRetry.relevance,
            idealConcept: evaluationForRetry.idealConcept,
            score: evaluationForRetry.score,
            strengths: evaluationForRetry.strengths,
            improvements: evaluationForRetry.improvements,
        };
        const updatedReviews = [
            ...(session.report?.questionReviews || []).filter(
                (existingReview) => existingReview.questionIndex !== questionIndex
            ),
            review,
        ];

        session.conversation = updatedConversation;
        session.currentQuestionIndex = completed ? questionIndex : questionIndex + 1;
        session.processingQuestionIndex = null;
        session.interviewState = completed ? "completed" : "asking";
        session.pendingEvaluation = null;
        if (!session.report) session.report = {};
        session.report.questionReviews = updatedReviews;
        session.report.experienceLevel = session.experienceLevel;
        session.report.durationMinutes = session.durationMinutes;

        const allSkipped = updatedReviews.filter(r => r.isSkipped || r.relevance === "skipped");
        session.report.skippedQuestionsCount = allSkipped.length;
        session.report.skippedTopics = allSkipped.map(r => r.question.slice(0, 100));

        if (completed) {
            const average = updatedReviews.length > 0
                ? Math.round(updatedReviews.reduce((sum, item) => sum + item.score, 0) / updatedReviews.length)
                : 0;

            session.status = "completed";
            session.completionMessage = finalMessage;
            session.completionReason = completionReason;
            session.reportStatus = "pending";
            session.report.overallScore = average;
            session.report.scoreExplanation =
                "Average of the recorded AI answer scores. This is an interview-practice estimate, not a validated hiring assessment.";
            session.report.strengths = [
                ...new Set(updatedReviews.flatMap((item) => item.strengths || [])),
            ].slice(0, 6);
            session.report.improvements = [
                ...new Set(updatedReviews.flatMap((item) => item.improvements || [])),
            ].slice(0, 6);
            session.report.evaluatedAt = new Date();
            const lowerScoringReviews = updatedReviews.filter(
                (item) => item.score < 70
            );
            session.report.technicalGaps = lowerScoringReviews
                .map((item) => item.idealConcept)
                .filter(Boolean)
                .slice(0, 6);
            session.report.communicationFeedback =
                "This evaluation uses recognized answer transcripts only; facial expressions, body language, and vocal confidence are not measured.";
            session.report.answerCompletenessFeedback =
                "Use the question-by-question feedback to review the relevance and completeness of each answer.";
            session.report.projectUnderstandingFeedback =
                "Project understanding is assessed only where projects were discussed; no unmentioned project details were assumed.";
            session.report.behavioralFeedback =
                "Behavioral and problem-solving feedback is limited to the situations and responses present in the transcript.";
            session.report.exampleImprovements = [
                ...new Set(updatedReviews.flatMap((item) => item.improvements || [])),
            ].slice(0, 6);
            session.report.recommendedTopics = [
                ...new Set(
                    lowerScoringReviews
                        .map((item) => item.idealConcept)
                        .filter(Boolean)
                ),
            ].slice(0, 6);
            session.report.nextSteps = [
                "Review the feedback for each question and practice a focused answer using specific examples.",
                ...lowerScoringReviews
                    .map((item) =>
                        item.idealConcept
                            ? `Study and practice: ${item.idealConcept}`
                            : ""
                    )
                    .filter(Boolean)
                    .slice(0, 4),
            ];

        }

        startPhase("interview session save");
        const finalSaveStartedAt = performance.now();
        await session.save();
        console.info("[Interview timing] final interview session save", {
            durationMs: Math.round(performance.now() - finalSaveStartedAt),
        });
        console.info("[Interview timing] answer request", {
            phase: "complete",
            durationMs: Math.round(performance.now() - requestStartedAt),
            questionIndex,
        });

        return res.json({
            success: true,
            intent: "answer",
            responseId,
            reply: buildAnswerReply({
                answer: cleanAnswer,
                nextQuestion,
                question,
                jobRole: session.jobRole,
                resumeProfile: session.resumeProfile,
                evaluationFeedback: evaluationForRetry.feedback,
            }),
            evaluation: {
                score: evaluationForRetry.score,
                relevance: evaluationForRetry.relevance,
                feedback: evaluationForRetry.feedback,
                strengths: evaluationForRetry.strengths,
                improvements: evaluationForRetry.improvements,
                idealConcept: evaluationForRetry.idealConcept,
            },
            interviewCompleted: completed,
            interviewState: session.interviewState,
            completionReason: session.completionReason,
            finalMessage: completed ? finalMessage : null,
            completed,
            nextQuestion,
            questionIndex: session.currentQuestionIndex,
            reportStatus: session.reportStatus,
            report: completed && session.reportStatus === "ready" ? session.report : undefined,
            topicCoverage: session.topicCoverage,
        });
    } catch (error) {
        console.error("Interview answer error:", {
            phase,
            sessionId: req.params.sessionId,
            questionIndex: requestedQuestionIndex ?? null,
            name: error.name,
            status: error.status || error.statusCode || null,
            code: error.code || null,
            message: error.message,
            phaseDurationMs: Math.round(performance.now() - phaseStartedAt),
            requestDurationMs: Math.round(performance.now() - requestStartedAt),
        });
        if (claimedSessionId && claimedQuestionIndex !== null) {
            try {
                await InterviewSession.updateOne(
                    {
                        _id: claimedSessionId,
                        status: "in_progress",
                        processingQuestionIndex: claimedQuestionIndex,
                    },
                    {
                        $set: {
                            processingQuestionIndex: null,
                            interviewState: "asking",
                        },
                    }
                );
            } catch (releaseError) {
                console.error("Interview answer lock release failed:", releaseError.message);
            }
        }

        const isQuotaError =
            error.code === "GROQ_QUOTA_EXCEEDED" ||
            error.status === 429 ||
            error.statusCode === 429;

        const responseMessage = isQuotaError
            ? "AI evaluation has reached its usage limit. Your answer is preserved; please try again later."
            : phase === "answer evaluation"
                ? "The answer evaluation service is temporarily unavailable. Your answer is preserved; retry submission without speaking it again."
                : phase === "evaluation checkpoint save"
                    ? "Your evaluation is ready but could not yet be saved. Your answer is preserved; retry submission to save it without another evaluation."
                    : phase === "next interviewer response generation"
                        ? "Your answer evaluation is saved, but the next question could not be prepared. Retry submission to continue without repeating the evaluation."
                        : phase === "interview session save"
                            ? "Your answer evaluation is saved, but this interview turn could not be finalized. Retry submission to continue without repeating the evaluation."
                            : "The interview could not save this turn. Your answer is preserved; please retry submission.";

        const responseStatus = isQuotaError
            ? 503
            : phase === "next interviewer response generation" ||
                phase === "answer evaluation"
                ? 502
                : 500;
        return res.status(responseStatus).json({
            success: false,
            message: responseMessage,
            phase,
            retryable: true,
            answerSaved: phase === "next interviewer response generation" || phase === "interview session save" || phase === "evaluation checkpoint save",
        });
    }
});

app.post("/api/interview/:sessionId/report", async (req, res) => {
    let claimedSession = null;
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in first.",
            });
        }

        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const { sessionId } = req.params;
        if (!mongoose.isValidObjectId(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid interview session ID.",
            });
        }

        const existingSession = await InterviewSession.findOne({
            _id: sessionId,
            firebaseUid: decoded.uid,
        });
        if (!existingSession) {
            return res.status(404).json({
                success: false,
                message: "Interview session not found.",
            });
        }
        if (!["completed", "cancelled"].includes(existingSession.status)) {
            return res.status(409).json({
                success: false,
                message: "End or complete the interview before generating its feedback report.",
            });
        }
        if ((existingSession.report?.questionReviews || []).length === 0) {
            return res.status(409).json({
                success: false,
                message: "A scored report is unavailable because no interview answers were evaluated.",
            });
        }
        if (existingSession.reportStatus === "ready") {
            return res.json({
                success: true,
                reportStatus: "ready",
                report: existingSession.report,
            });
        }

        claimedSession = await InterviewSession.findOneAndUpdate(
            {
                _id: sessionId,
                firebaseUid: decoded.uid,
                status: { $in: ["completed", "cancelled"] },
                reportStatus: { $in: ["pending", "failed"] },
            },
            { $set: { reportStatus: "generating" } },
            { new: true }
        );
        if (!claimedSession) {
            const latestSession = await InterviewSession.findOne({
                _id: sessionId,
                firebaseUid: decoded.uid,
            });
            if (latestSession?.reportStatus === "ready") {
                return res.json({
                    success: true,
                    reportStatus: "ready",
                    report: latestSession.report,
                });
            }
            if (latestSession?.reportStatus === "generating") {
                return res.status(202).json({
                    success: true,
                    reportStatus: "generating",
                });
            }
            return res.status(409).json({
                success: false,
                message: "The report is not ready to be generated.",
            });
        }

        const aiReport = await generateFinalReport({
            resumeProfile: claimedSession.resumeProfile,
            jobRole: claimedSession.jobRole,
            jobDescription: claimedSession.jobDescription,
            questionReviews: claimedSession.report.questionReviews || [],
            experienceLevel: claimedSession.experienceLevel,
            durationMinutes: claimedSession.durationMinutes,
        });
        if (!aiReport) {
            throw new Error("The AI did not return a valid interview report.");
        }

        claimedSession.report.experienceLevel = claimedSession.experienceLevel;
        claimedSession.report.durationMinutes = claimedSession.durationMinutes;
        const allSkipped = (claimedSession.report.questionReviews || []).filter(r => r.isSkipped || r.relevance === "skipped");
        claimedSession.report.skippedQuestionsCount = allSkipped.length;
        claimedSession.report.skippedTopics = allSkipped.map(r => r.question.slice(0, 100));

        claimedSession.report.answerRelevanceScore = aiReport.answerRelevanceScore;
        claimedSession.report.technicalScore = aiReport.technicalScore;
        claimedSession.report.problemSolvingScore = aiReport.problemSolvingScore;
        claimedSession.report.communicationScore = aiReport.communicationScore;
        claimedSession.report.roleAlignmentScore = aiReport.roleAlignmentScore;
        claimedSession.report.scoreExplanation =
            aiReport.scoreExplanation || claimedSession.report.scoreExplanation;
        claimedSession.report.strengths = aiReport.strengths.length > 0
            ? aiReport.strengths
            : claimedSession.report.strengths;
        claimedSession.report.improvements = aiReport.improvements.length > 0
            ? aiReport.improvements
            : claimedSession.report.improvements;
        claimedSession.report.technicalGaps = aiReport.technicalGaps;
        claimedSession.report.communicationFeedback = aiReport.communicationFeedback;
        claimedSession.report.answerCompletenessFeedback = aiReport.answerCompletenessFeedback;
        claimedSession.report.projectUnderstandingFeedback = aiReport.projectUnderstandingFeedback;
        claimedSession.report.behavioralFeedback = aiReport.behavioralFeedback;
        claimedSession.report.exampleImprovements = aiReport.exampleImprovements;
        claimedSession.report.recommendedTopics = aiReport.recommendedTopics;
        claimedSession.report.nextSteps = aiReport.nextSteps;
        claimedSession.report.evaluatedAt = new Date();
        claimedSession.reportStatus = "ready";
        if (claimedSession.status === "completed") {
            claimedSession.interviewState = "completed";
        } else {
            claimedSession.interviewState = "cancelled";
        }
        await claimedSession.save();

        return res.json({
            success: true,
            reportStatus: "ready",
            report: claimedSession.report,
        });
    } catch (error) {
        console.error("Interview report generation error:", error.message);
        if (claimedSession) {
            try {
                await InterviewSession.updateOne(
                    {
                        _id: claimedSession._id,
                        status: { $in: ["completed", "cancelled"] },
                        reportStatus: "generating",
                    },
                    { $set: { reportStatus: "failed" } }
                );
            } catch (releaseError) {
                console.error("Interview report lock release failed:", releaseError.message);
            }
        }
        return res.status(502).json({
            success: false,
            message: "The interview is complete, but the report could not be generated. Please retry report generation.",
        });
    }
});

app.post("/api/interview/:sessionId/end", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Please sign in first.",
            });
        }

        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        const { sessionId } = req.params;
        if (!mongoose.isValidObjectId(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid interview session ID.",
            });
        }

        const session = await InterviewSession.findOne({
            _id: sessionId,
            firebaseUid: decoded.uid,
        });
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Interview session not found.",
            });
        }

        const draft = typeof req.body?.answerDraft === "string" ? req.body.answerDraft.trim().slice(0, 12000) : "";
        const draftQuestion = typeof req.body?.question === "string" ? req.body.question.trim().slice(0, 1000) : "";
        const draftQuestionIndex = Number.isInteger(req.body?.questionIndex) && req.body.questionIndex >= 0
            ? req.body.questionIndex
            : null;

        if (session.status === "in_progress") {
            if (draft && draftQuestion && draftQuestionIndex === session.currentQuestionIndex) {
                session.interruptedDraftAnswer = draft;
                session.interruptedDraftQuestion = draftQuestion;
                session.interruptedDraftQuestionIndex = draftQuestionIndex;
            }
            session.status = "cancelled";
            session.interviewState = "cancelled";
            session.completionReason = "interrupted";
            session.completionMessage = "The interview was ended early. Your recorded answers have been saved for partial feedback.";
            const reviews = session.report?.questionReviews || [];
            if (reviews.length > 0) {
                session.report.overallScore = Math.round(
                    reviews.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / reviews.length
                );
                session.report.scoreExplanation = "Partial interview feedback based only on answers evaluated before the interview was ended.";
                session.report.evaluatedAt = new Date();
                session.reportStatus = "pending";
            }
            await session.save();
        }
        return res.json({
            success: true,
            status: session.status,
            completionReason: session.completionReason,
            reportStatus: session.reportStatus,
            savedAnswerCount: (session.report?.questionReviews || []).length,
            hasSavedDraft: Boolean(session.interruptedDraftAnswer),
        });
    } catch (error) {
        console.error("Interview end error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not end the interview session.",
        });
    }
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    const isAnswerRequest = req.path.startsWith("/api/interview/") &&
        req.path.endsWith("/answer");
    const isRequestBodyError = REQUEST_BODY_ERROR_TYPES.has(error.type);
    const phase = isAnswerRequest
        ? isRequestBodyError
            ? "answer request body parsing"
            : "answer request middleware"
        : "request processing";
    const code = error.code || error.type || null;
    const message = String(error.message || "Unknown request error")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(?:gsk_|sk-)[A-Za-z0-9_-]+/g, "[redacted]");

    console.error("Unhandled request error:", {
        phase,
        method: req.method,
        path: req.path,
        status,
        name: error.name,
        type: error.type || null,
        code,
        message,
    });

    const safeMessage = status === 400
        ? "The request could not be read. Please retry your submission."
        : status === 413
            ? "The request is too large. Please shorten your answer and retry."
            : "The server could not process this request. Your answer is still available; retry submission.";
    return res.status(status).json({
        success: false,
        message: safeMessage,
        ...(isAnswerRequest ? { phase, retryable: status >= 500 } : {}),
    });
});

async function startServer() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is missing from backend/.env");
        }

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        });

        console.log("MongoDB connected successfully");

        app.listen(PORT, () => {
            console.log(`Backend running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Database startup failed:", error.message);
        process.exit(1);
    }
}

startServer();
