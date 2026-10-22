
import { useEffect, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import CinematicLoginView from "./components/CinematicLoginView";
import GlassBackground from "./components/GlassBackground";
import GlassTopNav from "./components/GlassTopNav";
import {
  formatAnswerResponseError,
  parseAnswerResponse,
  waitForAnswerResponse,
} from "./lib/interviewApi";
import { buildSpokenInterviewResponse } from "./lib/interviewResponse";
import {
  createSpeechPlaybackGate,
  isCurrentAnswerResponse,
  speakUtteranceOnce,
} from "./lib/speechPlayback";
import {
  NO_SPEECH_TIMEOUT_MS,
  RECOGNITION_SESSION_TIMEOUT_MS,
  getVoiceRecoveryAction,
  MAX_AUTOMATIC_VOICE_RETRIES,
  canFinalizeVoiceAnswer,
  createVoiceAnswerCapture,
  createVoiceAnswerPauseTimer,
  getAnswerPauseTimeout,
  getVoiceAnswerTranscript,
  preserveVoiceRecognitionResults,
  releaseVoiceAnswerSubmission,
  shouldFinalizeRecognitionError,
  updateVoiceAnswerCapture,
} from "./lib/voiceRecovery";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  FileUser,
  Save,
  Download,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Route,
  ShieldCheck,
  Sliders,
  Upload,
  User as UserIcon,
  X,
  ChartNoAxesCombined,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Clock,
} from "lucide-react";
import "./App.css";

const API_URL = "http://localhost:5000";
const configuredAnswerPause = getAnswerPauseTimeout(
  import.meta.env?.VITE_INTERVIEW_ANSWER_PAUSE_MS,
);

function getComparableScoreChange(history, index, scoreKey) {
  const currentScore = history[index]?.report?.[scoreKey];
  if (!Number.isFinite(currentScore)) return null;

  for (let olderIndex = index + 1; olderIndex < history.length; olderIndex += 1) {
    if (history[olderIndex]?.jobRole !== history[index]?.jobRole) continue;
    const previousScore = history[olderIndex]?.report?.[scoreKey];
    if (Number.isFinite(previousScore)) return currentScore - previousScore;
  }
  return null;
}

const agents = [
  {
    id: "resume",
    code: "MOD-01",
    name: "Resume Agent",
    category: "Career Intelligence",
    tagline: "ATS Optimization & Gap Analysis",
    description:
      "Deep structural parsing, ATS keyword alignment, and targeted role positioning for engineering profiles.",
    icon: FileUser,
    capabilities: ["ATS Scoring", "Keyword Matcher", "Impact Verbs"],
  },
  {
    id: "interview",
    code: "MOD-02",
    name: "Interview Agent",
    category: "Interview Preparation",
    tagline: "Role & Resume Conversational Interview",
    description:
      "A spoken recruiter conversation tailored to your target role, resume, and answers, followed by an evidence-based report.",
    icon: MessagesSquare,
    capabilities: ["Technical", "Behavioral HR", "Live Speech"],
  },
  {
    id: "feedback",
    code: "MOD-03",
    name: "Feedback Agent",
    category: "Performance Insights",
    tagline: "Quantitative Answer Diagnostics",
    description:
      "Review interview scores, strengths, improvements, and ideal answer concepts.",
    icon: ChartNoAxesCombined,
    capabilities: ["Answer Scoring", "Gap Analysis", "Clarity Metrics"],
  },
  {
    id: "roadmap",
    code: "MOD-04",
    name: "Career Roadmap",
    category: "Career Development",
    tagline: "Milestone & Skill Sequencing",
    description:
      "Build a learning path with sequenced skills, projects, and career milestones.",
    icon: Route,
    capabilities: ["Skill Sequences", "Projects", "Milestones"],
  },
];

function IntelliHireSymbol({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
      <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  );
}

function BrandLogo({ onClick, className = "" }) {
  return (
    <button className={`brand ${className}`} onClick={onClick} type="button">
      <span className="brand-symbol">
        <IntelliHireSymbol size={18} />
      </span>
      <span className="brand-text">
        IntelliHire<span style={{ fontWeight: 400 }}>AI</span>
        <span className="brand-badge">2026</span>
      </span>
    </button>
  );
}

function ErrorMessage({ children }) {
  if (!children) return null;
  return (
    <div className="alert-error" role="alert">
      <AlertCircle size={16} />
      <span>{children}</span>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [walletLoading, setWalletLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [landingMobileNav, setLandingMobileNav] = useState(false);

  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileUpdating, setProfileUpdating] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (user?.displayName && !profileDisplayName) {
      setProfileDisplayName(user.displayName);
    }
  }, [user?.displayName]);

  async function handleUpdateDisplayName(e) {
    if (e?.preventDefault) e.preventDefault();
    const trimmed = profileDisplayName.trim();
    if (!trimmed) {
      setProfileError("Display name cannot be empty.");
      return;
    }
    setProfileUpdating(true);
    setProfileError("");
    setProfileSuccess("");
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmed });
      }
      try {
        if (auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          await fetch(`${API_URL}/api/auth/profile`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ displayName: trimmed }),
          });
        }
      } catch (backendErr) {
        console.warn("Backend profile sync notice:", backendErr);
      }
      setUser((prev) => (prev ? { ...prev, displayName: trimmed } : prev));
      setProfileSuccess("Profile name updated successfully!");
      setTimeout(() => setProfileSuccess(""), 4000);
    } catch (err) {
      console.error("Failed to update profile name:", err);
      setProfileError(err?.message || "Failed to update profile name.");
    } finally {
      setProfileUpdating(false);
    }
  }

  const [resumeFile, setResumeFile] = useState(null);
  const resumeFileInputRef = useRef(null);
  const [jobDescription, setJobDescription] = useState("");
  const [targetJobTitle, setTargetJobTitle] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("idle");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [resumeRecords, setResumeRecords] = useState([]);
  const [resumeRecordsError, setResumeRecordsError] = useState("");

  // Career Roadmap Agent state
  const [roadmapRole, setRoadmapRole] = useState("Frontend Developer");
  const [roadmapExperienceLevel, setRoadmapExperienceLevel] = useState("Entry Level");
  const [roadmapCurrentSkills, setRoadmapCurrentSkills] = useState("");
  const [roadmapData, setRoadmapData] = useState(null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState("");
  // Roadmap persistence
  const [roadmapMilestoneProgress, setRoadmapMilestoneProgress] = useState([]);
  const [roadmapSaveStatus, setRoadmapSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [roadmapSavedId, setRoadmapSavedId] = useState(null);

  const [interviewResumeFile, setInterviewResumeFile] = useState(null);
  const interviewResumeInputRef = useRef(null);
  const [interviewJobRole, setInterviewJobRole] = useState("");
  const [otherInterviewJobRole, setOtherInterviewJobRole] = useState("");
  const [interviewJobDescription, setInterviewJobDescription] = useState("");
  const [interviewExperienceLevel, setInterviewExperienceLevel] = useState("Fresher");
  const [interviewDurationMinutes, setInterviewDurationMinutes] = useState(15);
  const [interviewStartedAt, setInterviewStartedAt] = useState(null);
  const [interviewRemainingSeconds, setInterviewRemainingSeconds] = useState(null);
  const [interviewTargetCount, setInterviewTargetCount] = useState(10);
  const [showInterviewGuidance, setShowInterviewGuidance] = useState(false);

  // Interview session
  const [interviewAnswer, setInterviewAnswer] = useState("");
  const interviewAnswerRef = useRef("");
  const [interviewSessionId, setInterviewSessionId] = useState(null);
  const interviewSessionIdRef = useRef(null);

  const [interviewQuestion, setInterviewQuestion] = useState("");
  const [interviewQuestionIndex, setInterviewQuestionIndex] = useState(0);
  const interviewQuestionIndexRef = useRef(0);
  const [interviewStatus, setInterviewStatus] = useState("idle");
  const interviewPhaseRef = useRef("idle");

  useEffect(() => {
    if (!interviewStartedAt || interviewStatus === "completed" || page !== "interview" || !interviewSessionId) {
      return;
    }
    const updateTimer = () => {
      const elapsedSeconds = Math.floor((Date.now() - new Date(interviewStartedAt).getTime()) / 1000);
      const totalSeconds = (interviewDurationMinutes || 15) * 60;
      const remaining = Math.max(0, totalSeconds - elapsedSeconds);
      setInterviewRemainingSeconds(remaining);
    };
    updateTimer();
    const timerId = setInterval(updateTimer, 1000);
    return () => clearInterval(timerId);
  }, [interviewStartedAt, interviewDurationMinutes, interviewStatus, page, interviewSessionId]);

  function formatRemainingTime(seconds) {
    if (!Number.isFinite(seconds)) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  const [interviewFeedback, setInterviewFeedback] = useState(null);
  const [interviewReport, setInterviewReport] = useState(null);
  const [interviewReportStatus, setInterviewReportStatus] = useState("not_started");
  const [interviewCompletionMessage, setInterviewCompletionMessage] = useState("");
  const [interviewResumeProfile, setInterviewResumeProfile] = useState(null);
  const [interviewError, setInterviewError] = useState("");
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [interviewHistory, setInterviewHistory] = useState([]);
  const [interviewHistoryStatus, setInterviewHistoryStatus] = useState("idle");
  const [interviewHistoryError, setInterviewHistoryError] = useState("");
  const [historyReportBusyId, setHistoryReportBusyId] = useState(null);
  const [historyReportError, setHistoryReportError] = useState("");

  const recognitionRef = useRef(null);
  const submittingRef = useRef(false);
  const activeAnswerRequestRef = useRef(null);
  const submittedQuestionRef = useRef(null);
  const answerSubmissionIdRef = useRef(null);
  const autoInterviewRef = useRef(false);
  const recognitionRetryRef = useRef({ questionIndex: null, count: 0 });
  const recoveryInProgressRef = useRef(false);
  const reportGenerationRef = useRef(false);
  const retryTimerRef = useRef(null);
  const listenStartTimerRef = useRef(null);
  const listenStartWaitRef = useRef({ questionIndex: null, attempts: 0 });
  const recognitionSilenceTimerRef = useRef(null);
  const recognitionErrorTimerRef = useRef(null);
  const recognitionStartTimerRef = useRef(null);
  const recognitionSessionTimerRef = useRef(null);
  const voiceAnswerCaptureRef = useRef(null);
  const answerPauseTimerRef = useRef(null);
  const speechRequestRef = useRef(null);
  const speechUtteranceRef = useRef(null);
  const speechPlaybackGateRef = useRef(null);
  if (!speechPlaybackGateRef.current) {
    speechPlaybackGateRef.current = createSpeechPlaybackGate();
  }
  const microphonePermissionRef = useRef(false);
  const mountedRef = useRef(true);
  const historyRequestRef = useRef(0);
  const historyReportBusyRef = useRef(new Set());

  function setInterviewPhase(phase, questionIndex = interviewQuestionIndexRef.current) {
    if (questionIndex !== interviewQuestionIndexRef.current) return false;
    interviewPhaseRef.current = phase;
    setInterviewStatus(phase);
    return true;
  }

  function updateInterviewAnswer(answer) {
    const value = String(answer ?? "");
    interviewAnswerRef.current = value;
    setInterviewAnswer(value);
  }

  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setWallet(null);
      setError("");
      setInterviewHistory([]);
      setInterviewHistoryError("");
      setInterviewHistoryStatus(currentUser ? "loading" : "idle");
      historyRequestRef.current += 1;

      if (!currentUser) {
        setLoading(false);
        setWalletLoading(false);
        return;
      }

      void loadInterviewHistory(currentUser);
      void loadResumeRecords(currentUser);
      void loadSavedRoadmap(currentUser);
      setWalletLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to load wallet data.");
        }

        setWallet(data.user);
      } catch (err) {
        console.error("Wallet loading error:", err);
        setError(
          "Unable to synchronize your wallet. Make sure the backend is running."
        );
      } finally {
        setWalletLoading(false);
        setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort?.();
    };
  }, []);

  async function loadResumeRecords(currentUser = auth.currentUser) {
    if (!currentUser) { setResumeRecords([]); return; }
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/api/resume/records`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Resume records could not be loaded.");
      setResumeRecords(Array.isArray(data.records) ? data.records : []);
      setResumeRecordsError("");
    } catch (err) {
      setResumeRecordsError(err.message || "Resume records could not be loaded.");
    }
  }

  async function generateRoadmap(overrideRole) {
    const roleToUse = (typeof overrideRole === "string" ? overrideRole : roadmapRole).trim();
    if (!roleToUse) {
      setRoadmapError("Please enter or select a target career role.");
      return;
    }

    setRoadmapLoading(true);
    setRoadmapError("");
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Please sign in to generate your career roadmap.");
      const token = await currentUser.getIdToken();

      const response = await fetch(`${API_URL}/api/roadmap/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetRole: roleToUse,
          experienceLevel: roadmapExperienceLevel,
          currentSkills: roadmapCurrentSkills,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.roadmap) {
        throw new Error(data.message || "Failed to generate roadmap.");
      }

      setRoadmapData(data.roadmap);
      // Reset milestone progress when a new roadmap is generated
      setRoadmapMilestoneProgress([]);
      setRoadmapSaveStatus("idle");
      setRoadmapSavedId(null);
    } catch (err) {
      console.error("Roadmap generation error:", err);
      setRoadmapError(err.message || "Unable to generate career roadmap. Please try again.");
    } finally {
      setRoadmapLoading(false);
    }
  }

  async function loadSavedRoadmap(currentUser = auth.currentUser) {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/api/roadmap/current`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success && data.record) {
        setRoadmapData(data.record.roadmap);
        setRoadmapRole(data.record.targetRole || "Frontend Developer");
        setRoadmapExperienceLevel(data.record.experienceLevel || "Entry Level");
        setRoadmapMilestoneProgress(Array.isArray(data.record.milestoneProgress) ? data.record.milestoneProgress : []);
        setRoadmapSavedId(data.record._id);
        setRoadmapSaveStatus("saved");
      }
    } catch (err) {
      console.error("Load saved roadmap error:", err);
    }
  }

  async function saveRoadmap() {
    if (!roadmapData) return;
    setRoadmapSaveStatus("saving");
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not signed in.");
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/api/roadmap/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ targetRole: roadmapRole, experienceLevel: roadmapExperienceLevel, roadmap: roadmapData }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Save failed.");
      setRoadmapMilestoneProgress(Array.isArray(data.record.milestoneProgress) ? data.record.milestoneProgress : []);
      setRoadmapSavedId(data.record._id);
      setRoadmapSaveStatus("saved");
    } catch (err) {
      console.error("Save roadmap error:", err);
      setRoadmapSaveStatus("error");
    }
  }

  async function updateMilestone(index, status, note) {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/api/roadmap/milestone/${index}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRoadmapMilestoneProgress(data.milestoneProgress);
      }
    } catch (err) {
      console.error("Milestone update error:", err);
    }
  }


  async function loadInterviewHistory(currentUser = auth.currentUser) {
    const requestId = ++historyRequestRef.current;
    if (!currentUser) {
      setInterviewHistory([]);
      setInterviewHistoryStatus("idle");
      return;
    }

    setInterviewHistoryStatus("loading");
    setInterviewHistoryError("");

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/api/interview/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.interviews)) {
        throw new Error(data.message || "Interview history could not be loaded.");
      }
      if (requestId !== historyRequestRef.current) return;
      setInterviewHistory(data.interviews);
      setInterviewHistoryStatus("ready");
    } catch (historyError) {
      if (requestId !== historyRequestRef.current) return;
      console.error("Interview history loading error:", historyError);
      setInterviewHistoryError(
        historyError.message || "Interview history could not be loaded. Please try again."
      );
      setInterviewHistoryStatus("failed");
    }
  }

  async function retryHistoricalReport(sessionId) {
    if (!sessionId || historyReportBusyRef.current.has(sessionId)) return;
    historyReportBusyRef.current.add(sessionId);
    setHistoryReportBusyId(sessionId);
    setHistoryReportError("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Please sign in again to retry this report.");
      const token = await currentUser.getIdToken();
      let response;
      let data;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        response = await fetch(
          `${API_URL}/api/interview/${encodeURIComponent(sessionId)}/report`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        data = await response.json();
        if (response.status !== 202) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (!response?.ok || !data?.success || data.reportStatus !== "ready" || !data.report) {
        throw new Error(data?.message || "The final report could not be saved. Please retry.");
      }
      await loadInterviewHistory(currentUser);
    } catch (retryError) {
      console.error("Historical interview report retry failed:", retryError);
      setHistoryReportError(retryError.message || "The report could not be saved. Please retry.");
    } finally {
      historyReportBusyRef.current.delete(sessionId);
      setHistoryReportBusyId(null);
    }
  }

  async function handleLogin() {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // auth/popup-closed-by-user and auth/cancelled-popup-request are normal
      // user-driven cancellations — not errors to display.
      const silentCodes = new Set([
        "auth/popup-closed-by-user",
        "auth/cancelled-popup-request",
        "auth/user-cancelled",
      ]);
      if (err?.code && silentCodes.has(err.code)) {
        // Popup was dismissed — nothing to report.
        return;
      }
      // auth/popup-blocked: the browser blocked the popup window.
      if (err?.code === "auth/popup-blocked") {
        setError(
          "Sign-in popup was blocked by your browser. " +
            "Allow popups for this site and try again."
        );
        return;
      }
      console.error("Login error:", err);
      setError(
        err?.message ||
          "Sign-in failed. Please try again."
      );
    }
  }

  async function handleLogout() {
    stopInterviewSpeech();
    try {
      await signOut(auth);
      setPage("dashboard");
      setWallet(null);
      setError("");
      resetInterview();
    } catch (err) {
      console.error("Logout error:", err);
      setError("Unable to sign out. Please try again.");
    }
  }

  async function handleResumeSubmit(e) {
    e.preventDefault();
    setAnalysisError("");

    if (!resumeFile) {
      setAnalysisError("Please select a resume PDF.");
      return;
    }

    if (jobDescription.trim() && jobDescription.trim().length < 20) {
      setAnalysisError("If providing a job description, please enter at least 20 characters.");
      return;
    }

    setAnalysisStatus("analyzing");

    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("resume", resumeFile);
      formData.append("jobDescription", jobDescription.trim());
      formData.append("targetJobTitle", targetJobTitle.trim());

      const response = await fetch(`${API_URL}/api/resume/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Resume analysis failed.");
      }

      setAnalysisResult(data.data);
      setAnalysisStatus("completed");
      void loadResumeRecords(auth.currentUser);
    } catch (err) {
      setAnalysisError(err.message || "Resume analysis failed.");
      setAnalysisStatus("failed");
    }
  }

  function resetResume() {
    setResumeFile(null);
    if (resumeFileInputRef.current) resumeFileInputRef.current.value = "";
    setJobDescription("");
    setTargetJobTitle("");
    setAnalysisResult(null);
    setAnalysisStatus("idle");
    setAnalysisError("");
  }

  function stopInterviewSpeech({ preserveAnswerCapture = false } = {}) {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (listenStartTimerRef.current) {
      window.clearTimeout(listenStartTimerRef.current);
      listenStartTimerRef.current = null;
    }
    listenStartWaitRef.current = { questionIndex: null, attempts: 0 };
    if (recognitionSilenceTimerRef.current) {
      window.clearTimeout(recognitionSilenceTimerRef.current);
      recognitionSilenceTimerRef.current = null;
    }
    if (recognitionErrorTimerRef.current) {
      window.clearTimeout(recognitionErrorTimerRef.current);
      recognitionErrorTimerRef.current = null;
    }
    if (recognitionStartTimerRef.current) {
      window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
    }
    if (recognitionSessionTimerRef.current) {
      window.clearTimeout(recognitionSessionTimerRef.current);
      recognitionSessionTimerRef.current = null;
    }
    answerPauseTimerRef.current?.clear();
    answerPauseTimerRef.current = null;
    if (!preserveAnswerCapture) voiceAnswerCaptureRef.current = null;
    if (speechRequestRef.current) {
      speechRequestRef.current.cancelled = true;
      speechRequestRef.current.cleanup?.();
      speechRequestRef.current = null;
    }
    speechUtteranceRef.current = null;
    const activeRecognition = recognitionRef.current;
    recognitionRef.current = null;
    if (activeRecognition) {
      activeRecognition.onresult = null;
      activeRecognition.onerror = null;
      activeRecognition.onend = null;
      try {
        activeRecognition.abort?.();
      } catch {
        // Recognition may already have stopped.
      }
    }
    recoveryInProgressRef.current = false;
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Speech synthesis may already have stopped.
    }
  }

  function resetInterview() {
    autoInterviewRef.current = false;
    stopInterviewSpeech();
    speechPlaybackGateRef.current.clear();
    submittingRef.current = false;
    activeAnswerRequestRef.current = null;
    submittedQuestionRef.current = null;
    answerSubmissionIdRef.current = null;
    interviewSessionIdRef.current = null;
    interviewQuestionIndexRef.current = 0;
    recognitionRetryRef.current = { questionIndex: null, count: 0 };
    reportGenerationRef.current = false;
    microphonePermissionRef.current = false;
    setInterviewSessionId(null);
    setInterviewQuestion("");
    setInterviewQuestionIndex(0);
    updateInterviewAnswer("");
    setInterviewFeedback(null);
    setInterviewReport(null);
    setInterviewReportStatus("not_started");
    setInterviewCompletionMessage("");
    setInterviewResumeProfile(null);
    setInterviewStartedAt(null);
    setInterviewRemainingSeconds(null);
    setInterviewError("");
    setInterviewStatus("idle");
    interviewPhaseRef.current = "idle";
    setInterviewBusy(false);
  }

  async function endInterview() {
    const sessionId = interviewSessionIdRef.current || interviewSessionId;
    autoInterviewRef.current = false;
    activeAnswerRequestRef.current = null;
    stopInterviewSpeech();

    let endError = "";
    let shouldGeneratePartialReport = false;
    if (sessionId && auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(
          `${API_URL}/api/interview/${encodeURIComponent(sessionId)}/end`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              answerDraft: String(interviewAnswerRef.current || "").trim(),
              question: interviewQuestion,
              questionIndex: interviewQuestionIndexRef.current,
            }),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "The interview could not be ended on the server.");
        }
        shouldGeneratePartialReport = data.reportStatus === "pending";
      } catch (err) {
        endError = `Interview ended in this browser, but the server could not update the session: ${err.message}`;
      }
    }

    resetInterview();
    if (sessionId && auth.currentUser) {
      // Generate partial feedback from evaluated answers when the user ends early,
      // then refresh history so the Feedback Agent can compare this interview later.
      void (async () => {
        if (shouldGeneratePartialReport) {
          try {
            const token = await auth.currentUser.getIdToken();
            await fetch(`${API_URL}/api/interview/${encodeURIComponent(sessionId)}/report`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (partialReportError) {
            console.warn("Partial interview report generation will need retry:", partialReportError);
          }
        }
        await loadInterviewHistory(auth.currentUser);
      })();
    }
    if (endError) setInterviewError(endError);
  }
  function speakInterviewText(
    text,
    {
      questionIndex = interviewQuestionIndex,
      autoListen = autoInterviewRef.current,
      onSpeechEnd = null,
      updateStatus = true,
      responseId,
      trigger = "unspecified",
    } = {}
  ) {
    console.log("[SPEECH DEBUG]", {
  text,
  questionIndex,
  responseId,
  trigger,
  time: performance.now(),
});
    if (!text) return;

    const didStartPlayback = speechPlaybackGateRef.current.claim(responseId);
    if (!didStartPlayback) {
      if (import.meta.env.DEV) {
        console.debug("[Interview speech] duplicate trigger suppressed", { responseId, trigger });
      }
      return;
    }

    let callbackHandled = false;
    const finishCallback = () => {
      if (callbackHandled) return;
      callbackHandled = true;
      onSpeechEnd?.();
    };
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") {
      autoInterviewRef.current = false;
      if (updateStatus) setInterviewStatus("voice-error");
      setInterviewError(
        "Spoken audio is unavailable in this browser. You can continue by reading the question and typing your answer."
      );
      finishCallback();
      return;
    }

    if (speechRequestRef.current) {
      const staleRequest = speechRequestRef.current;
      staleRequest.cancelled = true;
      staleRequest.cleanup?.();
      window.clearTimeout(staleRequest.startTimer);
      speechRequestRef.current = null;
      speechUtteranceRef.current = null;
      synthesis.cancel();
    }

    const request = { cancelled: false, utterance: null, cleanup: null, speakStarted: false };
    speechRequestRef.current = request;

    const beginSpeech = () => {
      if (
        request.cancelled ||
        speechRequestRef.current !== request ||
        !mountedRef.current
      ) {
        return;
      }

      const voices = synthesis.getVoices();
      const englishVoices = voices.filter((voice) =>
        /^en([_-]|$)/i.test(voice.lang)
      );
      const selectedVoice =
        englishVoices.find((voice) => voice.default) ||
        englishVoices.find((voice) => /^en[-_]US$/i.test(voice.lang)) ||
        englishVoices[0];
      const utterance = new SpeechSynthesisUtterance(text);
      request.utterance = utterance;
      speechUtteranceRef.current = utterance;
      utterance.lang = selectedVoice?.lang || "en-US";
      utterance.rate = 0.95;
      utterance.volume = 1;
      if (selectedVoice) utterance.voice = selectedVoice;

      utterance.onstart = () => {
        if (
          speechRequestRef.current === request &&
          mountedRef.current &&
          updateStatus &&
          questionIndex === interviewQuestionIndexRef.current
        ) {
          window.clearTimeout(request.startTimer);
          request.startTimer = null;
          setInterviewError("");
          setInterviewPhase("asking", questionIndex);
        }
      };

      utterance.onend = () => {
        if (speechRequestRef.current !== request) return;
        window.clearTimeout(request.startTimer);
        speechRequestRef.current = null;
        request.cleanup?.();
        speechUtteranceRef.current = null;
        if (!mountedRef.current) return;

        if (
          !submittingRef.current &&
          autoListen &&
          autoInterviewRef.current &&
          questionIndex === interviewQuestionIndexRef.current
        ) {
          startVoiceAnswer(questionIndex);
        }
        finishCallback();
      };

      utterance.onerror = (event) => {
        if (speechRequestRef.current !== request) return;
        window.clearTimeout(request.startTimer);
        speechRequestRef.current = null;
        request.cleanup?.();
        speechUtteranceRef.current = null;
        autoInterviewRef.current = false;
        if (updateStatus) setInterviewStatus("voice-error");
        setInterviewError(
          `Browser speech playback failed (${event.error || "unknown error"}). Read the visible question and type your answer to continue.`
        );
        finishCallback();
      };

      try {
        if (synthesis.paused) synthesis.resume();
        speakUtteranceOnce(request, () => {
          if (import.meta.env.DEV) {
            console.debug("[Interview speech] speechSynthesis.speak", {
              utteranceText: utterance.text,
              responseId,
              questionIndex,
              trigger,
              timestamp: new Date().toISOString(),
            });
          }
          synthesis.speak(utterance);
        });
        request.startTimer = window.setTimeout(() => {
          if (speechRequestRef.current !== request) return;
          speechRequestRef.current = null;
          request.cleanup?.();
          speechUtteranceRef.current = null;
          autoInterviewRef.current = false;
          synthesis.cancel();
          setInterviewStatus("voice-error");
          setInterviewError(
            "The browser did not start speech playback. Read the visible question and type your answer to continue."
          );
          finishCallback();
        }, 8000);
      } catch (error) {
        if (speechRequestRef.current === request) {
          window.clearTimeout(request.startTimer);
          speechRequestRef.current = null;
          request.cleanup?.();
          speechUtteranceRef.current = null;
          autoInterviewRef.current = false;
          if (updateStatus) setInterviewStatus("voice-error");
          setInterviewError(
            `Browser could not start speech playback: ${error.message || "unknown error"}. Read the visible question and type your answer to continue.`
          );
          finishCallback();
        }
      }
    };

    const voices = synthesis.getVoices();
    if (voices.length > 0) {
      beginSpeech();
      return;
    }

    setInterviewStatus("preparing-speech");
    let settled = false;
    let voiceLookupTimer;
    const finishVoiceLookup = () => {
      if (settled) return;
      settled = true;
      synthesis.removeEventListener?.("voiceschanged", finishVoiceLookup);
      if (synthesis.onvoiceschanged === finishVoiceLookup) {
        synthesis.onvoiceschanged = null;
      }
      window.clearTimeout(voiceLookupTimer);
      beginSpeech();
    };
    request.cleanup = () => {
      settled = true;
      synthesis.removeEventListener?.("voiceschanged", finishVoiceLookup);
      if (synthesis.onvoiceschanged === finishVoiceLookup) {
        synthesis.onvoiceschanged = null;
      }
      window.clearTimeout(voiceLookupTimer);
    };
    voiceLookupTimer = window.setTimeout(finishVoiceLookup, 1200);
    if (typeof synthesis.addEventListener === "function") {
      synthesis.addEventListener("voiceschanged", finishVoiceLookup, { once: true });
      if (synthesis.getVoices().length > 0) finishVoiceLookup();
    } else {
      synthesis.onvoiceschanged = finishVoiceLookup;
    }
  }

  function showInterviewStartGuidance() {
    if (!interviewResumeFile) {
      setInterviewError("Please upload a PDF resume to start your interview.");
      return;
    }
    setInterviewError("");
    setShowInterviewGuidance(true);
  }

  async function startInterview() {
    if (interviewBusy || interviewSessionId) return;

    setInterviewError("");
    const targetRole = interviewJobRole === "Other"
      ? otherInterviewJobRole.trim()
      : interviewJobRole.trim();
    if (!interviewResumeFile) {
      setInterviewError("Please upload a PDF resume to start your interview.");
      return;
    }

    if (!targetRole) {
      setInterviewError("Please select or enter your target job role.");
      return;
    }
    if (targetRole.length > 200) {
      setInterviewError("Your target job role must be 200 characters or fewer.");
      return;
    }
    if (interviewJobDescription.trim().length > 12000) {
      setInterviewError("The job description must be 12,000 characters or fewer.");
      return;
    }
    if (!["Fresher", "Experienced professional"].includes(interviewExperienceLevel)) {
      setInterviewError("Please select candidate experience level.");
      return;
    }
    if (![5, 10, 15, 20, 30].includes(Number(interviewDurationMinutes))) {
      setInterviewError("Please select a valid interview duration.");
      return;
    }
    setInterviewFeedback(null);
    autoInterviewRef.current = false;
    submittedQuestionRef.current = null;
    recognitionRetryRef.current = { questionIndex: null, count: 0 };
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    microphonePermissionRef.current = false;
    setInterviewReport(null);
    updateInterviewAnswer("");
    setInterviewBusy(true);
    setInterviewStatus("starting");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Please sign in before starting an interview.");
      }

      let microphoneSetupError = "";
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not expose microphone access.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        microphonePermissionRef.current = true;
      } catch (microphoneError) {
        microphonePermissionRef.current = false;
        microphoneSetupError = microphoneError?.name === "NotAllowedError"
          ? "Microphone permission was denied. You can retry microphone access or type your answer."
          : "Microphone access is unavailable. You can retry it or type your answer.";
      }

      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append("resume", interviewResumeFile);
      formData.append("jobRole", targetRole);
      formData.append("jobDescription", interviewJobDescription.trim());
      formData.append("experienceLevel", interviewExperienceLevel);
      formData.append("durationMinutes", String(interviewDurationMinutes));
      const response = await fetch(`${API_URL}/api/interview/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "The interview could not be started."
        );
      }

      if (!data.sessionId || !data.question) {
        throw new Error("The server did not return a valid interview session.");
      }
      interviewSessionIdRef.current = data.sessionId;
      setInterviewSessionId(data.sessionId);
      setInterviewQuestion(data.question);
      setInterviewQuestionIndex(data.questionIndex ?? 0);
      interviewQuestionIndexRef.current = data.questionIndex ?? 0;
      setInterviewResumeProfile(data.resumeProfile ?? null);
      const sessionStarted = data.startedAt ? new Date(data.startedAt) : new Date();
      setInterviewStartedAt(sessionStarted);
      const serverDuration = data.durationMinutes ?? interviewDurationMinutes;
      setInterviewDurationMinutes(serverDuration);
      setInterviewRemainingSeconds(serverDuration * 60);
      setInterviewTargetCount(data.targetQuestionCount ?? 10);
      if (data.experienceLevel) setInterviewExperienceLevel(data.experienceLevel);
      setInterviewPhase("asking", data.questionIndex ?? 0);
      autoInterviewRef.current = true;
      answerSubmissionIdRef.current = null;
      if (microphoneSetupError) setInterviewError(microphoneSetupError);

      speakInterviewText(data.question, {
        questionIndex: data.questionIndex ?? 0,
        responseId: data.responseId || `${data.sessionId}:question:${data.questionIndex ?? 0}`,
        trigger: "interview-start",
      });
    } catch (err) {
      setInterviewStatus("error");
      setInterviewError(err.message || "Unable to start the interview.");
    } finally {
      setInterviewBusy(false);
    }
  }

  async function generateInterviewReport(sessionId) {
    if (reportGenerationRef.current || !sessionId) return;
    reportGenerationRef.current = true;
    setInterviewReportStatus("generating");
    setInterviewError("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Your session expired. Please sign in again.");
      const token = await currentUser.getIdToken();
      let response;
      let data;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        response = await fetch(
          `${API_URL}/api/interview/${encodeURIComponent(sessionId)}/report`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        data = await response.json();
        if (response.status !== 202) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      if (!response?.ok || !data?.success || data.reportStatus !== "ready" || !data.report) {
        throw new Error(data?.message || "The final report could not be generated.");
      }
      setInterviewReport(data.report);
      setInterviewReportStatus("ready");
      void loadInterviewHistory(currentUser);
    } catch (reportError) {
      console.error("Interview report request failed:", reportError);
      setInterviewReportStatus("failed");
      setInterviewError(reportError.message || "The final report could not be generated.");
    } finally {
      reportGenerationRef.current = false;
    }
  }

  async function submitInterviewAnswer(answerOverride, questionIndex = interviewQuestionIndex, { isSkip = false } = {}) {
    let answer = String(
      answerOverride === undefined ? interviewAnswerRef.current : answerOverride
    ).trim();
    if (isSkip && !answer) {
      answer = "Let's skip this question";
    }
    // Recognition callbacks outlive their render; prefer the synchronously assigned session ref.
    const sessionId = interviewSessionIdRef.current || interviewSessionId;
    if (questionIndex !== interviewQuestionIndexRef.current) return;

    if (
      (!answer && !isSkip) ||
      !sessionId ||
      submittingRef.current ||
      submittedQuestionRef.current === questionIndex
    ) {
      if (!answer && !isSkip) setInterviewError("Please speak or type your answer before submitting.");
      else if (!sessionId) {
        setInterviewError(
          "The interview session is not ready. Please wait for the question to finish loading."
        );
      }
      return;
    }

    submittingRef.current = true;
    const answerRequestToken = {};
    activeAnswerRequestRef.current = answerRequestToken;
    submittedQuestionRef.current = questionIndex;
    setInterviewBusy(true);
    setInterviewError("");
    updateInterviewAnswer(answer);
    setInterviewPhase("submitting", questionIndex);
    stopInterviewSpeech({ preserveAnswerCapture: true });
    if (
      !answerSubmissionIdRef.current ||
      answerSubmissionIdRef.current.questionIndex !== questionIndex ||
      answerSubmissionIdRef.current.answer !== answer
    ) {
      answerSubmissionIdRef.current = {
        questionIndex,
        answer,
        id: window.crypto?.randomUUID?.() ||
          `answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }
    const requestSubmissionId = answerSubmissionIdRef.current.id;

    let answerRequestStartedAt = null;
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const token = await currentUser.getIdToken();
      answerRequestStartedAt = performance.now();
      const response = await waitForAnswerResponse(
        `${API_URL}/api/interview/${encodeURIComponent(sessionId)}/answer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            answer,
            questionIndex,
            submissionId: requestSubmissionId,
            isSkip,
          }),
        },
        () => setInterviewPhase("evaluating", questionIndex),
      );

      const responseReceivedAt = performance.now();
      const { data, error: responseError } = await parseAnswerResponse(response);
      const responseParsedAt = performance.now();
      console.info("[Interview timing] frontend answer request", {
        questionIndex,
        requestMs: Math.round(responseReceivedAt - answerRequestStartedAt),
        jsonParseMs: Math.round(responseParsedAt - responseReceivedAt),
        status: response.status,
      });
      if (import.meta.env.DEV && data?.success) {
        console.debug("[Interview speech] answer response received", {
          responseId: data.responseId || `${sessionId}:${requestSubmissionId}`,
          questionIndex: data.questionIndex ?? questionIndex,
          intent: data.intent || "answer",
          reply: data.reply || "",
          nextQuestion: data.nextQuestion || "",
          timestamp: new Date().toISOString(),
        });
      }

      if (responseError) {
        throw new Error(responseError);
      }

      if (!response.ok || !data.success) {
        throw new Error(formatAnswerResponseError(response.status, data));
      }

      if (typeof data.interviewCompleted !== "boolean") {
        throw new Error("The server did not provide an explicit interview completion state.");
      }
      if (
        data.interviewCompleted !== (data.interviewState === "completed")
      ) {
        throw new Error("The server returned inconsistent interview completion state.");
      }
      if (!isCurrentAnswerResponse({
        requestToken: answerRequestToken,
        activeRequestToken: activeAnswerRequestRef.current,
        sessionId,
        activeSessionId: interviewSessionIdRef.current,
        questionIndex,
        activeQuestionIndex: interviewQuestionIndexRef.current,
        submissionId: requestSubmissionId,
        activeSubmissionId: answerSubmissionIdRef.current?.id,
      })) {
        if (import.meta.env.DEV) {
          console.debug("[Interview speech] stale answer response ignored", {
            responseId: data.responseId || `${sessionId}:${requestSubmissionId}`,
            questionIndex,
          });
        }
        return;
      }
      const responseSubmissionId = requestSubmissionId;

      if (data.intent && data.intent !== "answer") {
        setInterviewFeedback(data.intent === "retry_answer" || data.intent === "skip_question" ? data.evaluation ?? null : null);
        updateInterviewAnswer("");
        answerPauseTimerRef.current?.clear();
        answerPauseTimerRef.current = null;
        voiceAnswerCaptureRef.current = null;

        if (data.interviewCompleted) {
          autoInterviewRef.current = false;
          stopInterviewSpeech();
          recognitionRetryRef.current = { questionIndex: null, count: 0 };
          recoveryInProgressRef.current = false;
          microphonePermissionRef.current = false;
          setInterviewReport(data.report ?? null);
          setInterviewReportStatus(
            data.reportStatus === "ready"
              ? "ready"
              : data.reportStatus === "failed"
                ? "failed"
                : data.reportStatus === "pending" || data.reportStatus === "generating"
                ? "pending"
                : "not_started"
          );
          setInterviewCompletionMessage(data.finalMessage || "Thank you for your time. That concludes your interview. Your interview is now complete.");
          setInterviewPhase("completed", questionIndex);
          setInterviewQuestion("");
          setPage("interview");
          speakInterviewText(
            data.finalMessage || "Thank you for your time. That concludes your interview. Your interview is now complete.",
            {
              questionIndex,
              autoListen: false,
              onSpeechEnd: () => {
                if (data.reportStatus === "pending") void generateInterviewReport(sessionId);
              },
              updateStatus: false,
              responseId: data.responseId || `${sessionId}:${responseSubmissionId}`,
              trigger: "answer-completion",
            }
          );
          return;
        }

        const intentQuestion = data.nextQuestion || interviewQuestion || "";
        const resolvedQuestionIndex = Number.isInteger(data.questionIndex) ? data.questionIndex : questionIndex;
        submittedQuestionRef.current = null;
        answerSubmissionIdRef.current = null;
        recognitionRetryRef.current = {
          questionIndex: resolvedQuestionIndex,
          count: 0,
        };
        setInterviewQuestion(intentQuestion);
        setInterviewQuestionIndex(resolvedQuestionIndex);
        interviewQuestionIndexRef.current = resolvedQuestionIndex;
        recoveryInProgressRef.current = false;
        setInterviewPhase("asking", resolvedQuestionIndex);
        const spokenResponse = buildSpokenInterviewResponse(data.reply, intentQuestion);
        speakInterviewText(spokenResponse, {
          questionIndex: resolvedQuestionIndex,
          responseId: data.responseId || `${sessionId}:${responseSubmissionId}`,
          trigger: "candidate-question-response",
        });
        return;
      }

      if (!data.interviewCompleted && !data.nextQuestion) {
        throw new Error("The server did not return the next question.");
      }

      setInterviewFeedback(data.evaluation ?? null);
      updateInterviewAnswer("");
      answerPauseTimerRef.current?.clear();
      answerPauseTimerRef.current = null;
      voiceAnswerCaptureRef.current = null;

      if (data.interviewCompleted) {
        autoInterviewRef.current = false;
        stopInterviewSpeech();
        recognitionRetryRef.current = { questionIndex: null, count: 0 };
        recoveryInProgressRef.current = false;
        microphonePermissionRef.current = false;
        setInterviewReport(data.report ?? null);
        setInterviewReportStatus(
          data.reportStatus === "ready"
            ? "ready"
            : data.reportStatus === "failed"
              ? "failed"
              : data.reportStatus === "pending" || data.reportStatus === "generating"
              ? "pending"
              : "not_started"
        );
        setInterviewCompletionMessage(data.finalMessage || "Thank you for your time. That concludes your interview. Your interview is now complete.");
        setInterviewPhase("completed", questionIndex);
        setInterviewQuestion("");
        setPage("interview");
        speakInterviewText(
          data.finalMessage || "Thank you for your time. That concludes your interview. Your interview is now complete.",
          {
            questionIndex,
            autoListen: false,
            onSpeechEnd: () => {
              if (data.reportStatus === "pending") void generateInterviewReport(sessionId);
            },
            updateStatus: false,
            responseId: data.responseId || `${sessionId}:${responseSubmissionId}`,
            trigger: "answer-completion",
          }
        );
      } else if (data.nextQuestion) {
        submittedQuestionRef.current = null;
        answerSubmissionIdRef.current = null;
        const nextQuestionIndex = data.questionIndex ?? 0;
        recognitionRetryRef.current = {
          questionIndex: nextQuestionIndex,
          count: 0,
        };
        setInterviewQuestion(data.nextQuestion);
        setInterviewQuestionIndex(nextQuestionIndex);
        interviewQuestionIndexRef.current = nextQuestionIndex;
        recoveryInProgressRef.current = false;
        setInterviewPhase("asking", nextQuestionIndex);
        const spokenText = buildSpokenInterviewResponse(data.reply, data.nextQuestion);
        speakInterviewText(spokenText, {
          questionIndex: nextQuestionIndex,
          responseId: data.responseId || `${sessionId}:${responseSubmissionId}`,
          trigger: "answer-response",
        });
      } else {
        setInterviewStatus("error");
        setInterviewError("The server did not return the next question.");
      }
    } catch (err) {
      if (activeAnswerRequestRef.current !== answerRequestToken) return;
      if (answerRequestStartedAt !== null) {
        console.warn("[Interview timing] frontend answer request failed", {
          questionIndex,
          durationMs: Math.round(performance.now() - answerRequestStartedAt),
          errorName: err.name || "Error",
        });
      }
      submittedQuestionRef.current = null;
      releaseVoiceAnswerSubmission(voiceAnswerCaptureRef.current);
      updateInterviewAnswer(answer);
      setInterviewPhase("answer-error", questionIndex);
      setInterviewError(err.message || "Could not submit your answer.");
    } finally {
      if (activeAnswerRequestRef.current === answerRequestToken) {
        activeAnswerRequestRef.current = null;
        submittingRef.current = false;
        setInterviewBusy(false);
      }
    }
  }

  function skipInterviewQuestion() {
    if (interviewBusy || !(interviewSessionIdRef.current || interviewSessionId) || interviewStatus === "completed") {
      return;
    }
    stopInterviewSpeech({ preserveAnswerCapture: false });
    void submitInterviewAnswer("Let's skip this question", interviewQuestionIndexRef.current, { isSkip: true });
  }

  function retryVoiceAnswer(questionIndex) {
    if (
      !autoInterviewRef.current ||
      !(interviewSessionIdRef.current || interviewSessionId) ||
      submittingRef.current ||
      recognitionRef.current ||
      speechUtteranceRef.current ||
      recoveryInProgressRef.current ||
      questionIndex !== interviewQuestionIndexRef.current
    ) {
      return;
    }

    const retryState = recognitionRetryRef.current;
    if (retryState.questionIndex !== questionIndex) {
      recognitionRetryRef.current = { questionIndex, count: 0 };
    }
    if (recognitionRetryRef.current.count >= MAX_AUTOMATIC_VOICE_RETRIES) {
      autoInterviewRef.current = false;
      setInterviewStatus("voice-error");
      setInterviewError(
        "I'm having trouble hearing you. You can retry the microphone or type your answer below."
      );
      return;
    }

    recognitionRetryRef.current.count += 1;
    const retryNumber = recognitionRetryRef.current.count;
    const retryMessage = retryNumber === 1
      ? "Take your time. When you're ready, please continue."
      : "I'm here when you're ready. You can continue speaking or type your answer.";
    const capturedFinalAnswer = getVoiceAnswerTranscript(
      voiceAnswerCaptureRef.current,
      { includeInterim: false },
    );
    if (!capturedFinalAnswer) updateInterviewAnswer("");
    setInterviewError("");
    setInterviewStatus("retrying");
    recoveryInProgressRef.current = true;
    speakInterviewText(
      retryMessage,
      {
        questionIndex,
        autoListen: false,
        onSpeechEnd: () => {
        if (
          !autoInterviewRef.current ||
          submittingRef.current ||
          !(interviewSessionIdRef.current || interviewSessionId) ||
          questionIndex !== interviewQuestionIndexRef.current
        ) {
          recoveryInProgressRef.current = false;
          return;
        }
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          recoveryInProgressRef.current = false;
          startVoiceAnswer(questionIndex);
        }, 700);
        },
        responseId: `${interviewSessionIdRef.current || interviewSessionId}:voice-retry:${questionIndex}:${retryNumber}`,
        trigger: "voice-retry",
      }
    );
  }

  function startVoiceAnswer(questionIndex = interviewQuestionIndex) {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setInterviewError(
        "Automatic speech recognition is unavailable in this browser. Type your answer below, or use Retry microphone in a supported browser."
      );
      autoInterviewRef.current = false;
      setInterviewStatus("voice-error");
      return;
    }

    // Guard: need an active session
    if (
      !(interviewSessionIdRef.current || interviewSessionId) ||
      questionIndex !== interviewQuestionIndexRef.current ||
      !autoInterviewRef.current ||
      ["submitting", "evaluating", "completed"].includes(interviewPhaseRef.current)
    ) return;

    if (recognitionRef.current) {
      if (interviewPhaseRef.current === "listening") return;
      const staleRecognition = recognitionRef.current;
      recognitionRef.current = null;
      staleRecognition.onresult = null;
      staleRecognition.onerror = null;
      staleRecognition.onend = null;
      try {
        staleRecognition.abort?.();
      } catch {
        // A stale recognition instance can already be stopped.
      }
    }
    if (submittingRef.current || recoveryInProgressRef.current) return;
    if (
      window.speechSynthesis?.speaking ||
      window.speechSynthesis?.pending ||
      speechRequestRef.current ||
      speechUtteranceRef.current
    ) {
      setInterviewPhase("asking", questionIndex);
      if (listenStartWaitRef.current.questionIndex !== questionIndex) {
        listenStartWaitRef.current = { questionIndex, attempts: 0 };
      }
      if (listenStartWaitRef.current.attempts >= 32) {
        autoInterviewRef.current = false;
        setInterviewStatus("voice-error");
        setInterviewError(
          "The microphone could not start after the interviewer finished speaking. Retry the microphone or type your answer."
        );
        return;
      }
      listenStartWaitRef.current.attempts += 1;
      if (!listenStartTimerRef.current) {
        listenStartTimerRef.current = window.setTimeout(() => {
          listenStartTimerRef.current = null;
          startVoiceAnswer(questionIndex);
        }, 250);
      }
      return;
    }
    if (!microphonePermissionRef.current) {
      autoInterviewRef.current = false;
      setInterviewStatus("voice-error");
      setInterviewError(
        "Microphone access is unavailable or was denied. Retry microphone access or type your answer below."
      );
      return;
    }
    setInterviewError("");

    if (
      !voiceAnswerCaptureRef.current ||
      voiceAnswerCaptureRef.current.questionIndex !== questionIndex
    ) {
      answerPauseTimerRef.current?.clear();
      voiceAnswerCaptureRef.current = createVoiceAnswerCapture(questionIndex);
      answerPauseTimerRef.current = createVoiceAnswerPauseTimer(
        configuredAnswerPause,
        (answer) => {
          if (
            questionIndex !== interviewQuestionIndexRef.current ||
            voiceAnswerCaptureRef.current?.questionIndex !== questionIndex ||
            interviewPhaseRef.current !== "listening"
          ) return;
          updateInterviewAnswer(answer);
          void submitInterviewAnswer(answer, questionIndex);
        },
      );
    }
    const capture = voiceAnswerCaptureRef.current;

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      let recognitionError = "";
      let finalized = false;

      const armRecognitionEndFallback = () => {
        if (recognitionErrorTimerRef.current) {
          window.clearTimeout(recognitionErrorTimerRef.current);
        }
        recognitionErrorTimerRef.current = window.setTimeout(() => {
          recognitionErrorTimerRef.current = null;
          handleRecognitionEnd();
        }, 3000);
      };

      const stopRecognitionSafely = (reason) => {
        recognitionError = reason || recognitionError;
        try {
          recognition.stop();
        } catch {
          // Recognition may already have stopped.
        }
        armRecognitionEndFallback();
      };

      const resetNoSpeechTimer = () => {
        if (recognitionSilenceTimerRef.current) {
          window.clearTimeout(recognitionSilenceTimerRef.current);
        }
        recognitionSilenceTimerRef.current = window.setTimeout(() => {
          recognitionSilenceTimerRef.current = null;
          if (
            recognitionRef.current === recognition &&
            autoInterviewRef.current
          ) {
            stopRecognitionSafely("no-speech");
          }
        }, NO_SPEECH_TIMEOUT_MS);
      };

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition || !autoInterviewRef.current) return;
        if (recognitionStartTimerRef.current) {
          window.clearTimeout(recognitionStartTimerRef.current);
          recognitionStartTimerRef.current = null;
        }
        listenStartWaitRef.current = { questionIndex: null, attempts: 0 };
        setInterviewError("");
        setInterviewPhase("listening", questionIndex);
        if (recognitionSessionTimerRef.current) {
          window.clearTimeout(recognitionSessionTimerRef.current);
        }
        recognitionSessionTimerRef.current = window.setTimeout(() => {
          recognitionSessionTimerRef.current = null;
          if (recognitionRef.current !== recognition || finalized) return;
          stopRecognitionSafely("aborted");
        }, RECOGNITION_SESSION_TIMEOUT_MS);
        resetNoSpeechTimer();
      };

      recognition.onresult = (event) => {
        if (
          recognitionRef.current !== recognition ||
          !autoInterviewRef.current ||
          interviewPhaseRef.current !== "listening" ||
          questionIndex !== interviewQuestionIndexRef.current
        ) return;
        const results = Array.from(event.results);
        const finalTranscript = results
          .filter((result) => result.isFinal)
          .map((result) => result[0]?.transcript || "")
          .join(" ")
          .trim();
        const interimTranscript = results
          .filter((result) => !result.isFinal)
          .map((result) => result[0]?.transcript || "")
          .join(" ")
          .trim();
        updateVoiceAnswerCapture(capture, { finalTranscript, interimTranscript });
        resetNoSpeechTimer();
        updateInterviewAnswer(getVoiceAnswerTranscript(capture));
        if (canFinalizeVoiceAnswer(capture)) {
          answerPauseTimerRef.current?.reset(capture);
        } else {
          answerPauseTimerRef.current?.clear();
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        recognitionError = event.error;
        if (recognitionErrorTimerRef.current) {
          window.clearTimeout(recognitionErrorTimerRef.current);
        }
        recognitionErrorTimerRef.current = window.setTimeout(() => {
          recognitionErrorTimerRef.current = null;
          if (recognitionRef.current !== recognition) return;
          if (
            shouldFinalizeRecognitionError(
              recognitionError,
              getVoiceAnswerTranscript(capture, { includeInterim: false }),
            )
          ) {
            try {
              recognition.abort?.();
            } catch {
              // Recognition may already have stopped.
            }
            handleRecognitionEnd();
          } else if (recognitionRef.current === recognition) {
            try {
              recognition.stop();
            } catch {
              // Recognition may already have stopped.
            }
            armRecognitionEndFallback();
          }
        }, 5000);
      };

      const handleRecognitionEnd = () => {
        if (finalized || recognitionRef.current !== recognition) return;
        finalized = true;
        recognitionRef.current = null;
        if (questionIndex !== interviewQuestionIndexRef.current) return;
        if (recognitionSilenceTimerRef.current) {
          window.clearTimeout(recognitionSilenceTimerRef.current);
          recognitionSilenceTimerRef.current = null;
        }
        if (recognitionErrorTimerRef.current) {
          window.clearTimeout(recognitionErrorTimerRef.current);
          recognitionErrorTimerRef.current = null;
        }
        if (recognitionStartTimerRef.current) {
          window.clearTimeout(recognitionStartTimerRef.current);
          recognitionStartTimerRef.current = null;
        }
        if (recognitionSessionTimerRef.current) {
          window.clearTimeout(recognitionSessionTimerRef.current);
          recognitionSessionTimerRef.current = null;
        }
        preserveVoiceRecognitionResults(capture);
        updateInterviewAnswer(getVoiceAnswerTranscript(capture));
        const hasUsableAnswer = getVoiceAnswerTranscript(
          capture,
          { includeInterim: false },
        ).length >= 2;
        if (!autoInterviewRef.current || questionIndex !== interviewQuestionIndexRef.current) {
          if (hasUsableAnswer) answerPauseTimerRef.current?.reset(capture);
          return;
        }

        const recoveryAction = getVoiceRecoveryAction(
          recognitionError,
          recognitionRetryRef.current.questionIndex === questionIndex
            ? recognitionRetryRef.current.count
            : 0
        );
        if (recoveryAction === "permission") {
          microphonePermissionRef.current = false;
          autoInterviewRef.current = false;
          setInterviewStatus("voice-error");
          setInterviewError("Microphone permission was denied. Retry microphone access or type your answer below.");
          if (hasUsableAnswer) answerPauseTimerRef.current?.reset(capture);
          return;
        } else if (recoveryAction === "microphone") {
          microphonePermissionRef.current = false;
          autoInterviewRef.current = false;
          setInterviewStatus("voice-error");
          setInterviewError("No microphone is available. Connect or enable one, retry, or type your answer below.");
          if (hasUsableAnswer) answerPauseTimerRef.current?.reset(capture);
          return;
        } else if (recoveryAction === "aborted" && !hasUsableAnswer) {
          autoInterviewRef.current = false;
          setInterviewStatus("voice-error");
          setInterviewError("Speech recognition stopped unexpectedly. Retry the microphone or type your answer below.");
          return;
        }

        if (capture.awaitingFinalTranscript) {
          if (recoveryAction === "retry") {
            retryVoiceAnswer(questionIndex);
          } else {
            autoInterviewRef.current = false;
            setInterviewStatus("voice-error");
            setInterviewError(
              "Speech recognition ended before your full answer was captured. Retry the microphone or type your answer below.",
            );
          }
          return;
        }

        if (hasUsableAnswer) {
          answerPauseTimerRef.current?.reset(capture);
          setInterviewPhase("listening", questionIndex);
          if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            startVoiceAnswer(questionIndex);
          }, 250);
        } else if (recoveryAction === "retry") {
          retryVoiceAnswer(questionIndex);
        } else {
          autoInterviewRef.current = false;
          setInterviewStatus("voice-error");
          setInterviewError(
            recognitionError
              ? `Speech recognition failed (${recognitionError}). Retry the microphone or type your answer below.`
              : "No speech was captured. Retry the microphone or type your answer below.",
          );
        }
      };

      recognition.onend = handleRecognitionEnd;
      recognitionStartTimerRef.current = window.setTimeout(() => {
        recognitionStartTimerRef.current = null;
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort?.();
        } catch {
          // Recognition may already have stopped.
        }
        autoInterviewRef.current = false;
        setInterviewStatus("voice-error");
        setInterviewError(
          "The microphone did not start. Retry microphone access or type your answer below.",
        );
      }, 10000);
      recognition.start();
    } catch (err) {
      if (recognitionStartTimerRef.current) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.abort?.();
        } catch {
          // Recognition may already have stopped.
        }
      }
      recognitionRef.current = null;
      const errorName = err.name || "";
      if (/NotAllowed|PermissionDenied/i.test(errorName)) {
        microphonePermissionRef.current = false;
        autoInterviewRef.current = false;
        setInterviewStatus("voice-error");
        setInterviewError("Microphone permission was denied. Retry microphone access or type your answer below.");
      } else {
        retryVoiceAnswer(questionIndex);
      }
    }
  }

  async function retryMicrophoneAccess(questionIndex = interviewQuestionIndexRef.current) {
    if (
      interviewBusy ||
      submittingRef.current ||
      questionIndex !== interviewQuestionIndexRef.current
    ) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose microphone access.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      microphonePermissionRef.current = true;
      recognitionRetryRef.current = { questionIndex, count: 0 };
      recoveryInProgressRef.current = false;
      autoInterviewRef.current = true;
      setInterviewError("");
      setInterviewPhase("listening", questionIndex);
      startVoiceAnswer(questionIndex);
    } catch (error) {
      microphonePermissionRef.current = false;
      autoInterviewRef.current = false;
      setInterviewStatus("voice-error");
      setInterviewError(
        error?.name === "NotAllowedError"
          ? "Microphone permission is still denied. Change the browser permission or type your answer below."
          : "The microphone could not be started. Check the device connection or type your answer below."
      );
    }
  }

  if (loading) {
    return (
      <div className="boot-screen" style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative" }}>
        <GlassBackground />
        <div style={{ textAlign: "center", position: "relative", zIndex: 2 }}>
          <div
            className="brand-symbol"
            style={{ width: 52, height: 52, margin: "0 auto 18px", borderRadius: 14, background: "var(--navy-900)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 18px rgba(12,17,32,0.22)" }}
          >
            <IntelliHireSymbol size={28} style={{ color: "#fff" }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--navy-900)", margin: "0 0 8px" }}>IntelliHire AI</h2>
          <p style={{ color: "var(--navy-400)", fontSize: 13, margin: 0 }}>
            Synchronizing workspace…
          </p>
        </div>
      </div>
    );
  }


  if (!user) {
    return (
      <CinematicLoginView
        onLogin={handleLogin}
        authLoading={loading}
        authError={error}
        BrandLogo={BrandLogo}
      />
    );
  }

  /* Legacy Landing section removed */
  if (false && !user) {
    return (
      <div className="landing-root bg-grid-pattern">
        <header className="landing-nav">
          <div className="nav-container">
            <BrandLogo
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
            <nav className="nav-center">
              <a href="#platform" className="nav-link">Platform</a>
              <a href="#agents" className="nav-link">AI Agents</a>
              <a href="#how-it-works" className="nav-link">How It Works</a>
              <a href="#about" className="nav-link">About</a>
            </nav>
            <div className="nav-actions">
              <button className="btn-secondary" onClick={handleLogin}>Sign In</button>
              <button className="btn-primary" onClick={handleLogin}>
                Get Started <ArrowRight size={15} />
              </button>
              <button
                className="mobile-nav-toggle"
                onClick={() => setLandingMobileNav((v) => !v)}
                aria-label="Toggle navigation"
              >
                {landingMobileNav ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
          {landingMobileNav && (
            <div style={{ padding: 24, background: "#fff" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <a href="#platform" className="nav-link" onClick={() => setLandingMobileNav(false)}>Platform</a>
                <a href="#agents" className="nav-link" onClick={() => setLandingMobileNav(false)}>AI Agents</a>
                <a href="#how-it-works" className="nav-link" onClick={() => setLandingMobileNav(false)}>How It Works</a>
                <a href="#about" className="nav-link" onClick={() => setLandingMobileNav(false)}>About</a>
              </div>
            </div>
          )}
        </header>

        {error && <div style={{ maxWidth: 1280, margin: "16px auto", padding: "0 32px" }}><ErrorMessage>{error}</ErrorMessage></div>}

        <section className="landing-hero" id="platform">
          <div className="hero-grid">
            <div className="hero-left">
              <div className="hero-eyebrow">
                <span className="hero-eyebrow-dot" />
                INTELLIGENCE FOR YOUR NEXT MOVE
              </div>
              <h1 className="hero-headline">
                <span className="headline-line">Build your career.</span>
                <span className="headline-inverted">Not just your resume.</span>
              </h1>
              <p className="hero-description">
                Four intelligent agents to help you present your strengths,
                prepare for interviews, improve your performance, and plan your next move.
              </p>
              <div className="hero-actions">
                <button className="btn-primary btn-hero-primary" onClick={handleLogin}>
                  Explore IntelliHire <ArrowRight size={16} />
                </button>
                <a href="#how-it-works" className="btn-secondary btn-hero-secondary">
                  See how it works
                </a>
              </div>
              <div className="hero-trust">
                <div className="hero-trust-dots">
                  <span className="hero-trust-dot" />
                  <span className="hero-trust-dot" />
                  <span className="hero-trust-dot" />
                  <span className="hero-trust-dot" />
                </div>
                <span>4 specialized agents · One connected workspace</span>
              </div>
            </div>

            <div className="hero-right">
              <div className="app-window-frame">
                <div className="window-header">
                  <div className="window-controls">
                    <span className="window-dot" />
                    <span className="window-dot" />
                    <span className="window-dot" />
                  </div>
                  <span className="window-title">workspace / intellihire-v2.6</span>
                  <span style={{ width: 40 }} />
                </div>
                <div className="window-body">
                  <div className="window-sidebar">
                    <span className="brand-symbol" style={{ width: 26, height: 26 }}>
                      <IntelliHireSymbol size={14} />
                    </span>
                    <div className="sidebar-icon-mini active"><LayoutDashboard size={15} /></div>
                    <div className="sidebar-icon-mini"><FileUser size={15} /></div>
                    <div className="sidebar-icon-mini"><MessagesSquare size={15} /></div>
                    <div className="sidebar-icon-mini"><ChartNoAxesCombined size={15} /></div>
                    <div className="sidebar-icon-mini"><Route size={15} /></div>
                  </div>
                  <div className="window-canvas">
                    <div className="preview-topbar">
                      <div className="preview-user-info">
                        <strong>Candidate Workspace</strong>
                        <span>Interview and career tools</span>
                      </div>
                      <div className="preview-wallet-badge"><Sparkles size={13} /><span>FREE UNLIMITED</span></div>
                    </div>
                    <div className="preview-agents-grid">
                      {agents.map(({ id, code, name, icon: Icon }) => (
                        <div key={id} className="preview-agent-card">
                          <div className="preview-agent-header"><Icon size={16} /><span>{code}</span></div>
                          <h4>{name}</h4>
                          <p>Ready to deploy</p>
                        </div>
                      ))}
                    </div>
                    <div className="preview-lower-split">
                      <div className="preview-lower-box">
                        <h5>RECENT ACTIVITY</h5>
                        <p className="preview-empty-note">Start an agent to begin a session.</p>
                      </div>
                      <div className="preview-lower-box">
                        <h5>WORKSPACE STATUS</h5>
                        <div className="preview-checklist">
                          <div className="preview-check-item"><Check size={13} /><span>Resume analysis</span></div>
                          <div className="preview-check-item"><Check size={13} /><span>Voice interview</span></div>
                          <div className="preview-check-item"><Check size={13} /><span>Career feedback</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="agents" className="landing-section">
          <div className="section-header-editorial">
            <span className="section-eyebrow">THE INTELLIHIRE ARCHITECTURE</span>
            <h2 className="section-headline">Four specialized agents. One connected workflow.</h2>
            <p className="section-subtext">Dedicated tools for each phase of career preparation.</p>
          </div>
          <div className="suite-grid">
            {agents.map(({ id, code, name, category, description, capabilities, icon: Icon }) => (
              <article key={id} className="suite-card">
                <div className="suite-card-top">
                  <div className="suite-icon-box"><Icon size={22} /></div>
                  <span className="suite-number">{code}</span>
                </div>
                <span className="sidebar-group-label" style={{ padding: 0, marginBottom: 4 }}>{category}</span>
                <h3>{name}</h3>
                <p>{description}</p>
                <div className="suite-tags">
                  {capabilities.map((cap) => <span key={cap} className="suite-tag">{cap}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="landing-section">
          <div className="section-header-editorial">
            <span className="section-eyebrow">PRECISION WORKFLOW</span>
            <h2 className="section-headline">A rigorous process for career advancement.</h2>
            <p className="section-subtext">Move from resume diagnostics to interview practice and actionable feedback.</p>
          </div>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-header"><span className="step-badge">STEP 01</span><Upload size={18} className="step-icon" /></div>
              <h3>Ingest & Diagnose</h3>
              <p>Upload your resume and compare it with a target job description.</p>
            </div>
            <div className="step-card">
              <div className="step-header"><span className="step-badge">STEP 02</span><MessagesSquare size={18} className="step-icon" /></div>
              <h3>Simulate & Rehearse</h3>
              <p>Answer AI-generated interview questions by voice or text.</p>
            </div>
            <div className="step-card">
              <div className="step-header"><span className="step-badge">STEP 03</span><ChartNoAxesCombined size={18} className="step-icon" /></div>
              <h3>Quantify & Progress</h3>
              <p>Review answer feedback and identify skills to improve.</p>
            </div>
          </div>
          <div className="landing-cta-banner">
            <div className="cta-banner-content">
              <h2>Start your next chapter with clarity.</h2>
              <p>Sign in with Google to open your career workspace.</p>
            </div>
            <button className="btn-cta-white" onClick={handleLogin}>Get Started with Google <ArrowRight size={17} /></button>
          </div>
        </section>

        <section id="about" className="landing-section">
          <div className="section-header-editorial" style={{ maxWidth: 760 }}>
            <span className="section-eyebrow">ENGINEERING PHILOSOPHY</span>
            <h2 className="section-headline">Designed for signal, not marketing noise.</h2>
            <p className="section-subtext">
              IntelliHire AI brings resume alignment, interview rehearsal, performance
              feedback, and career planning into one connected workspace.
            </p>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="footer-left">
            <BrandLogo onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
            <span>© 2026 IntelliHire AI. All rights reserved.</span>
          </div>
          <div className="footer-right">
            <span>Enterprise Security</span>
            <span>Systems Operational</span>
          </div>
        </footer>
      </div>
    );
  }

  const currentAgent = agents.find((agent) => agent.id === page);
  const firstName = user.displayName?.split(" ")[0] || "Candidate";

  function changePage(nextPage) {
    setPage(nextPage);
    setMobileMenu(false);
    if (nextPage === "feedback") void loadInterviewHistory(auth.currentUser);
  }

  return (
    <div className="glass-app-root">
      <GlassBackground />
      {mobileMenu && <div className="mobile-overlay-backdrop" onClick={() => setMobileMenu(false)} />}
      <GlassTopNav
        user={user}
        page={page}
        changePage={changePage}
        handleLogout={handleLogout}
        mobileOpen={mobileMenu}
        setMobileOpen={setMobileMenu}
      />
      <main className="glass-main-content">

        {error && <div style={{ padding: "0 32px", marginTop: 16 }}><ErrorMessage>{error}</ErrorMessage></div>}

        {page === "dashboard" && (() => {
          const latestScoredInterview = interviewHistory.find(
            (i) => i.report?.overallScore != null && (i.status === "completed" || i.status === "cancelled")
          ) ?? null;
          const latestScore = latestScoredInterview?.report?.overallScore;
          const latestResume = resumeRecords[0];
          const latestAts = latestResume?.analysisData?.atsMatchScore;
          // Count completed milestones for progress chip
          const completedMilestones = roadmapMilestoneProgress.filter(m => m.status === "completed").length;
          const totalMilestones = roadmapMilestoneProgress.length;
          const roadmapProgressLabel = totalMilestones > 0
            ? `${completedMilestones}/${totalMilestones} done`
            : (roadmapData ? "0% started" : "Not generated");
          return (
            <div className="glass-overview">
              {/* Welcome header */}
              <div className="glass-welcome">
                <h1 className="glass-welcome-heading">Welcome back, {firstName}</h1>
                <p className="glass-welcome-sub">Your AI career workspace is ready. Pick an agent to continue.</p>
                {/* Progress strip */}
                <div className="glass-progress-strip">
                  <div className="glass-progress-chip">
                    <span className="glass-chip-label">Interviews</span>
                    <span className={`glass-chip-value ${interviewHistory.length === 0 ? "glass-chip-empty" : ""}`}>
                      {interviewHistory.length > 0 ? interviewHistory.length : "None yet"}
                    </span>
                  </div>
                  <div className="glass-progress-chip">
                    <span className="glass-chip-label">Latest Score</span>
                    <span className={`glass-chip-value ${!latestScore ? "glass-chip-empty" : ""}`}>
                      {latestScore != null ? `${latestScore}/100` : "Not yet"}
                    </span>
                  </div>
                  <div className="glass-progress-chip">
                    <span className="glass-chip-label">Resume ATS</span>
                    <span className={`glass-chip-value ${!latestAts ? "glass-chip-empty" : ""}`}>
                      {latestAts != null ? `${latestAts}%` : "Not yet"}
                    </span>
                  </div>
                  <div className="glass-progress-chip">
                    <span className="glass-chip-label">Target Role</span>
                    <span className={`glass-chip-value ${!roadmapRole ? "glass-chip-empty" : ""}`} title={roadmapRole || "Not selected"}>
                      {roadmapRole || "Not selected"}
                    </span>
                  </div>
                  <div className="glass-progress-chip">
                    <span className="glass-chip-label">Roadmap</span>
                    <span className={`glass-chip-value ${!roadmapData ? "glass-chip-empty" : ""}`}>
                      {roadmapProgressLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Asymmetric floating glass agent panels */}
              <div className="glass-agents-grid">
                {agents.map(({ id, name, tagline, description, capabilities, icon: Icon, code }) => {
                  const hasData =
                    id === "resume" ? resumeRecords.length > 0 :
                    id === "interview" ? interviewHistory.length > 0 :
                    id === "feedback" ? interviewHistory.length > 0 :
                    id === "roadmap" ? !!roadmapData :
                    false;
                  return (
                    <button
                      key={id}
                      className="glass-agent-panel"
                      data-area={id}
                      onClick={() => changePage(id)}
                      aria-label={`Open ${name}`}
                    >
                      <div className="glass-panel-top">
                        <div className="glass-panel-icon"><Icon size={20} aria-hidden="true" /></div>
                        <span className="glass-panel-code">{code}</span>
                      </div>
                      <div className="glass-panel-body">
                        <h2 className="glass-panel-name">{name}</h2>
                        <p className="glass-panel-tagline">{tagline}</p>
                        <p className="glass-panel-desc">{description}</p>
                      </div>
                      <div className="glass-panel-caps">
                        {capabilities.map((cap) => (
                          <span key={cap} className="glass-panel-cap">{cap}</span>
                        ))}
                      </div>
                      <div className="glass-panel-status">
                        <span className={`glass-panel-status-dot ${hasData ? "active" : ""}`} />
                        <span>{hasData ? "Data available" : "No sessions yet"}</span>
                      </div>
                      <span className="glass-panel-cta">Open agent <ArrowRight size={13} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {page === "resume" && (
          <div className="dashboard-content-area">
            <div className="workspace-page-intro">
              <div className="workspace-eyebrow">Resume Agent</div>
              <h1>Resume Diagnostics & Alignment</h1>
              <p>Upload a PDF resume and provide the target job description to evaluate ATS alignment.</p>
            </div>

            {analysisStatus === "completed" && analysisResult ? (
              <div className="analysis-results-view">
                {/* Hero Score Card */}
                          <div className="results-hero-card">
                  <div className="ats-score-badge-box">
                    <div className="ats-score-dial"><strong>{analysisResult.atsMatchScore}%</strong><small>{analysisResult.isJobSpecific ? "JOB MATCH" : "QUALITY"}</small></div>
                    <div className="ats-score-meta">
                      <h2>{analysisResult.isJobSpecific ? `Job Match Score: ${analysisResult.atsMatchScore}%` : `Resume Quality: ${analysisResult.atsMatchScore}%`}</h2>
                      <p>{analysisResult.scoreExplanation}</p>
                      {analysisResult.scoringCriteria && <p className="scoring-criteria-text">{analysisResult.scoringCriteria}</p>}
                      <small>{analysisResult.fileName} · {analysisResult.characterCount} characters extracted{analysisResult.aiEnhanced ? " · AI-Enhanced" : ""}</small>
                    </div>
                  </div>
                  <button className="btn-primary" onClick={resetResume}><RotateCcw size={14} /> Analyze Another Job</button>
                </div>

                {/* Score Breakdown */}
                <div className="score-breakdown-strip">
                  {Object.entries(analysisResult.scoreBreakdown || {}).map(([key, value]) => (
                    <div className="breakdown-factor-card" key={key}><div className="breakdown-factor-label">{key.replace(/([A-Z])/g, " $1").toUpperCase()}</div><strong>{value}</strong></div>
                  ))}
                </div>

                {/* Skills: Matched / Partial / Missing */}
                <div className="skills-comparison-split">
                  <div className="skills-panel-box">
                    <h3><CheckCircle2 size={18} /> Matched Skills</h3>
                    <div className="skills-pill-flow">
                      {(analysisResult.matchedSkills || []).length > 0
                        ? analysisResult.matchedSkills.map((skill) => <span key={skill} className="skill-pill-matched"><Check size={12} /> {skill}</span>)
                        : <span className="empty-skills-note">No exact skill matches detected</span>}
                    </div>
                  </div>
                  <div className="skills-panel-box">
                    <h3><Sparkles size={18} /> Partially Matched</h3>
                    {(analysisResult.partiallyMatchedSkills || []).length > 0 ? (
                      <div className="skills-detail-list">
                        {analysisResult.partiallyMatchedSkills.map((item, i) => (
                          <div key={i} className="skill-detail-item partial">
                            <strong>{item.skill}</strong>
                            <span>{item.reason}</span>
                          </div>
                        ))}
                      </div>
                    ) : <span className="empty-skills-note">No partial matches identified</span>}
                  </div>
                </div>

                {/* Missing / Unverified Skills */}
                {(analysisResult.missingSkillsDetailed || []).length > 0 && (
                  <div className="skills-panel-box">
                    <h3><AlertCircle size={18} /> Missing or Unverified Skills</h3>
                    <div className="skills-detail-list">
                      {analysisResult.missingSkillsDetailed.map((item, i) => (
                        <div key={i} className={`skill-detail-item ${item.genuinelyMissing ? 'missing' : 'unverified'}`}>
                          <div className="skill-detail-header">
                            <strong>{item.skill}</strong>
                            <span className={`importance-badge importance-${(item.importance || 'medium').toLowerCase()}`}>{item.importance || 'Medium'}</span>
                            {!item.genuinelyMissing && <span className="unverified-badge">May be present</span>}
                          </div>
                          <span>{item.reason}</span>
                          {item.recommendation && <em className="skill-recommendation">{item.recommendation}</em>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback: simple missing skills list if no detailed version */}
                {(analysisResult.missingSkillsDetailed || []).length === 0 && (analysisResult.missingSkills || []).length > 0 && (
                  <div className="skills-panel-box">
                    <h3><AlertCircle size={18} /> Missing Skills</h3>
                    <div className="skills-pill-flow">{analysisResult.missingSkills.map((skill) => <span key={skill} className="skill-pill-missing"><X size={12} /> {skill}</span>)}</div>
                  </div>
                )}

                {/* Required Skills by Importance */}
                {(analysisResult.requiredSkillsByImportance || []).length > 0 && (
                  <div className="skills-panel-box">
                    <h3>Required Skills by Importance</h3>
                    <div className="required-skills-grid">
                      {analysisResult.requiredSkillsByImportance.map((item, i) => (
                        <div key={i} className={`required-skill-item ${item.matched ? 'matched' : 'unmatched'}`}>
                          <span className="required-skill-name">{item.matched ? <Check size={12} /> : <X size={12} />} {item.skill}</span>
                          <span className={`importance-badge importance-${(item.importance || 'medium').toLowerCase()}`}>{item.importance}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strengths & Improvements */}
                <div className="skills-comparison-split">
                  <div className="skills-panel-box"><h3>Strengths</h3><ul>{(analysisResult.strengths || []).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                  <div className="skills-panel-box"><h3>Improvement Areas</h3><ul>{(analysisResult.suggestions || []).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                </div>

                <div className="skills-panel-box">
                  <h3>Role-Relevant Resume Evidence</h3>
                  {analysisResult.experienceAndEducation && (
                    <p>
                      Experience: {analysisResult.experienceAndEducation.detectedExperience} (
                      {analysisResult.experienceAndEducation.experienceStatus}). Education:{" "}
                      {analysisResult.experienceAndEducation.candidateEducation}
                      {analysisResult.isJobSpecific &&
                      analysisResult.experienceAndEducation.requiredEducation !== "Not explicitly stated"
                        ? `; job asks for ${analysisResult.experienceAndEducation.requiredEducation}`
                        : ""}
                    </p>
                  )}
                  <div className="skills-comparison-split">
                    {[
                      ["Relevant experience", analysisResult.roleEvidence?.relevantExperience],
                      ["Projects", analysisResult.roleEvidence?.projects],
                      ["Certifications", analysisResult.roleEvidence?.certifications],
                      ["Qualifications", analysisResult.roleEvidence?.qualifications],
                    ].map(([title, items]) => (
                      <div key={title}>
                        <h4>{title}</h4>
                        {items?.length ? (
                          <ul>
                            {items.map((item, i) => (
                              <li key={i}>
                                {typeof item === "string" ? item : item.evidence}
                                {typeof item !== "string" && item.whyRelevant
                                  ? ` — ${item.whyRelevant}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="empty-skills-note">No clear evidence detected in this section.</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ATS Keyword Recommendations */}
                {(analysisResult.atsKeywords || []).length > 0 && (
                  <div className="skills-panel-box">
                    <h3><Sparkles size={18} /> ATS Keyword Recommendations</h3>
                    <div className="skills-detail-list">
                      {analysisResult.atsKeywords.map((item, i) => (
                        <div key={i} className="skill-detail-item keyword">
                          <strong>{item.keyword}</strong>
                          <span>{item.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bullet Point Improvements */}
                {(analysisResult.bulletImprovements || []).length > 0 && (
                  <div className="skills-panel-box">
                    <h3>Suggested Bullet Improvements</h3>
                    <div className="bullet-improvements-list">
                      {analysisResult.bulletImprovements.map((item, i) => (
                        <div key={i} className="bullet-improvement-card">
                          {item.original && <div className="bullet-original"><span className="bullet-label">CURRENT</span><p>{item.original}</p></div>}
                          <div className="bullet-improved"><span className="bullet-label">IMPROVED</span><p>{item.improved}</p></div>
                          {item.note && <div className="bullet-note"><AlertCircle size={13} /> {item.note}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prioritized Action Plan */}
                {(analysisResult.actionPlan || []).length > 0 ? (
                  <div className="skills-panel-box">
                    <h3>Prioritized Action Plan</h3>
                    <div className="action-plan-list">
                      {analysisResult.actionPlan.map((item, i) => (
                        <div key={i} className="action-plan-item">
                          <span className="action-priority-num">{item.priority || i + 1}</span>
                          <div className="action-plan-content">
                            <strong>{item.action}</strong>
                            {item.reason && <span>{item.reason}</span>}
                            {item.impact && <span className={`importance-badge importance-${(item.impact || 'medium').toLowerCase()}`}>{item.impact} Impact</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="skills-panel-box"><h3>Recommended Actions</h3>{(analysisResult.recommendedActions || []).map((item, i) => <p key={i}><strong>{item.priority}:</strong> {item.action}</p>)}</div>
                )}

                {/* AI Insights */}
                {analysisResult.aiInsights && <div className="skills-panel-box"><h3><Sparkles size={18} /> AI Insights</h3><p>{analysisResult.aiInsights.executiveSummary}</p></div>}
              </div>
            ) : (
              <div className="resume-studio-grid">
                <form className="studio-panel" onSubmit={handleResumeSubmit}>
                  <div className="studio-panel-heading"><div><h2>Document & Role Ingestion</h2><p>Select a text-readable PDF (up to 10 MB) and provide the job posting.</p></div><FileText size={22} /></div>
                  <label className="form-field-label" htmlFor="resume-pdf-input">RESUME DOCUMENT <span>PDF FORMAT</span></label>
                  <label className="dropzone-box" htmlFor="resume-pdf-input">
                    <div className="dropzone-icon"><Upload size={20} /></div>
                    <strong>{resumeFile?.name || "Click to select resume PDF"}</strong>
                    <span>{resumeFile ? `${(resumeFile.size / 1024).toFixed(1)} KB` : "Select a PDF from your computer"}</span>
                    <input
                      ref={resumeFileInputRef}
                      id="resume-pdf-input"
                      type="file"
                      accept=".pdf,application/pdf"
                      disabled={analysisStatus === "analyzing"}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) {
                          setResumeFile(null);
                          return;
                        }
                        const isPdfName = file.name.toLowerCase().endsWith(".pdf");
                        if (!isPdfName || (file.type && file.type !== "application/pdf")) {
                          setAnalysisError("Please select a valid PDF file.");
                          setResumeFile(null);
                          e.target.value = "";
                        } else if (file.size > 10 * 1024 * 1024) {
                          setAnalysisError("PDF files must be 10 MB or smaller.");
                          setResumeFile(null);
                          e.target.value = "";
                        } else {
                          setResumeFile(file);
                          setAnalysisError("");
                        }
                      }}
                    />
                  </label>
                  <label className="form-field-label" htmlFor="target-job-title-input">TARGET JOB TITLE <span>OPTIONAL</span></label>
                  <input id="target-job-title-input" className="form-textarea" style={{ minHeight: 44 }} value={targetJobTitle} onChange={(e) => setTargetJobTitle(e.target.value)} placeholder="e.g. Senior Frontend Developer" />
                  <label className="form-field-label" htmlFor="job-description-input">TARGET JOB DESCRIPTION <span>RECOMMENDED</span></label>
                  <textarea id="job-description-input" className="form-textarea" rows={8} value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Paste the target job description here for job-specific matching..." />
                  <button className="btn-primary btn-run-analysis" type="submit" disabled={analysisStatus === "analyzing"}>{analysisStatus === "analyzing" ? "Analyzing..." : <>Analyze Resume <ArrowRight size={15} /></>}</button>
                  {analysisError && <ErrorMessage>{analysisError}</ErrorMessage>}
                  {analysisStatus === "analyzing" && <div className="alert-notice"><Clock size={16} /> Analyzing your resume... This may take a moment for AI-enhanced analysis.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 16, fontSize: 12, color: "var(--muted-text)" }}><ShieldCheck size={16} /><span>Resume analysis uses your authenticated backend.</span></div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* REAL INTERVIEW AGENT */}

        {page === "interview" && (
          <div className="dashboard-content-area">
            <div className="workspace-page-intro">
              <div className="workspace-eyebrow">Interview Agent</div>
              <h1>Role & Resume Interview</h1>
              <p>Meet a conversational interviewer that explores your experience, projects, and role-specific skills through an automatic spoken interview.</p>
            </div>

            <div className="interview-studio-layout">
              {interviewStatus === "idle" || interviewStatus === "error" && !interviewSessionId ? (
                <form className="studio-panel" onSubmit={(e) => { e.preventDefault(); showInterviewStartGuidance(); }}>
                  <div className="studio-panel-heading">
                    <div><h2>Personalize your interview</h2><p>Use your resume and target role to guide an adaptive, spoken interview.</p></div>
                    <MessagesSquare size={22} />
                  </div>

                  <label className="form-field-label" htmlFor="interview-experience-level">CANDIDATE EXPERIENCE LEVEL <span>REQUIRED</span></label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <button
                      type="button"
                      id="experience-fresher-btn"
                      className={interviewExperienceLevel === "Fresher" ? "btn-primary" : "btn-secondary"}
                      style={{ justifyContent: "center", padding: "10px 14px", fontWeight: 600 }}
                      onClick={() => setInterviewExperienceLevel("Fresher")}
                    >
                      Fresher (Student / Entry)
                    </button>
                    <button
                      type="button"
                      id="experience-experienced-btn"
                      className={interviewExperienceLevel === "Experienced professional" ? "btn-primary" : "btn-secondary"}
                      style={{ justifyContent: "center", padding: "10px 14px", fontWeight: 600 }}
                      onClick={() => setInterviewExperienceLevel("Experienced professional")}
                    >
                      Experienced Professional
                    </button>
                  </div>

                  <label className="form-field-label" htmlFor="interview-duration">INTERVIEW DURATION <span>REQUIRED</span></label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
                    {[5, 10, 15, 20, 30].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        className={interviewDurationMinutes === mins ? "btn-primary" : "btn-secondary"}
                        style={{ justifyContent: "center", padding: "8px 4px", fontSize: 13, fontWeight: 600 }}
                        onClick={() => setInterviewDurationMinutes(mins)}
                      >
                        {mins} min
                      </button>
                    ))}
                  </div>

                  <label className="form-field-label" htmlFor="interview-job-role">TARGET JOB ROLE <span>REQUIRED</span></label>
                  <select
                    id="interview-job-role"
                    className="form-textarea"
                    style={{ minHeight: 44 }}
                    value={interviewJobRole}
                    required
                    disabled={interviewBusy}
                    onChange={(event) => setInterviewJobRole(event.target.value)}
                  >
                    <option value="">Select a target role</option>
                    <option value="Software Engineer">Software Engineer</option>
                    <option value="Frontend Developer">Frontend Developer</option>
                    <option value="Backend Developer">Backend Developer</option>
                    <option value="Full-Stack Developer">Full-Stack Developer</option>
                    <option value="Data Scientist">Data Scientist</option>
                    <option value="AI/ML Engineer">AI/ML Engineer</option>
                    <option value="Other">Other role</option>
                  </select>
                  {interviewJobRole === "Other" && (
                    <input
                      className="form-textarea"
                      style={{ minHeight: 44, marginTop: 8 }}
                      aria-label="Enter target job role"
                      placeholder="Enter your target job role"
                      value={otherInterviewJobRole}
                      maxLength={200}
                      required
                      disabled={interviewBusy}
                      onChange={(event) => setOtherInterviewJobRole(event.target.value)}
                    />
                  )}

                  <label className="form-field-label" htmlFor="interview-resume-input">RESUME <span>REQUIRED PDF · UP TO 10 MB</span></label>
                  <label className="dropzone-box" htmlFor="interview-resume-input">
                    <div className="dropzone-icon"><Upload size={20} /></div>
                    <strong>{interviewResumeFile?.name || "Choose a resume PDF"}</strong>
                    <span>{interviewResumeFile ? `${(interviewResumeFile.size / 1024).toFixed(1)} KB · analyzed for interview context` : "Required to personalize questions about your experience, skills, and projects"}</span>
                    <input
                      ref={interviewResumeInputRef}
                      id="interview-resume-input"
                      type="file"
                      accept=".pdf,application/pdf"
                      disabled={interviewBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          setInterviewResumeFile(null);
                          return;
                        }
                        if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
                          setInterviewError("Please select a PDF resume.");
                          setInterviewResumeFile(null);
                          event.target.value = "";
                        } else if (file.size > 10 * 1024 * 1024) {
                          setInterviewError("Resume PDFs must be 10 MB or smaller.");
                          setInterviewResumeFile(null);
                          event.target.value = "";
                        } else {
                          setInterviewResumeFile(file);
                          setInterviewError("");
                        }
                      }}
                    />
                  </label>

                  <label className="form-field-label" htmlFor="interview-job-description">JOB DESCRIPTION <span>OPTIONAL</span></label>
                  <textarea
                    id="interview-job-description"
                    className="form-textarea"
                    rows={5}
                    maxLength={12000}
                    value={interviewJobDescription}
                    disabled={interviewBusy}
                    onChange={(event) => setInterviewJobDescription(event.target.value)}
                    placeholder="Paste the job description to make role-specific questions even more relevant."
                  />

                  {interviewError && <div style={{ marginTop: 12 }}><ErrorMessage>{interviewError}</ErrorMessage></div>}

                  <button type="submit" className="btn-primary btn-run-analysis" disabled={interviewBusy}>
                    {interviewBusy ? "Preparing interview..." : <>Start Personalized Interview <ArrowRight size={15} /></>}
                  </button>
                </form>
              ) : null}

              {interviewSessionId && interviewStatus !== "completed" && (
                <div className="interview-active-question-card">
                  <div className="question-meta-strip" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, letterSpacing: "0.05em" }}>QUESTION {interviewQuestionIndex + 1}</span>
                      <span style={{ fontSize: 12, padding: "2px 8px", background: "var(--background-gray)", borderRadius: 4, border: "1px solid var(--border-color)" }}>{interviewExperienceLevel}</span>
                      <span style={{ fontSize: 12, padding: "2px 8px", background: "var(--background-gray)", borderRadius: 4, border: "1px solid var(--border-color)" }}>{interviewJobRole === "Other" ? otherInterviewJobRole : interviewJobRole}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={16} style={{ color: (interviewRemainingSeconds != null && interviewRemainingSeconds < 120) ? "#ef4444" : "inherit" }} />
                      <strong style={{ fontSize: 14, fontFamily: "monospace", letterSpacing: "0.05em", color: (interviewRemainingSeconds != null && interviewRemainingSeconds < 120) ? "#ef4444" : "inherit" }}>
                        {formatRemainingTime(interviewRemainingSeconds)}
                      </strong>
                      <span style={{ fontSize: 11, color: "var(--muted-text)" }}>({interviewDurationMinutes}m)</span>
                    </div>
                  </div>

                  <div className="question-text-box">
                    {interviewQuestion || "Preparing your next question..."}
                  </div>
                  {interviewResumeProfile && (
                    <div className="alert-notice" style={{ marginTop: 12 }}>
                      <FileText size={16} />
                      <span>
                        Resume analyzed
                        {interviewResumeProfile.technicalSkills?.length
                          ? ` · Skills: ${interviewResumeProfile.technicalSkills.slice(0, 5).join(", ")}`
                          : ""}
                        {interviewResumeProfile.projects?.length
                          ? ` · ${interviewResumeProfile.projects.length} project${interviewResumeProfile.projects.length === 1 ? "" : "s"}`
                          : ""}
                        {interviewResumeProfile.education?.length
                          ? ` · ${interviewResumeProfile.education.length} education entr${interviewResumeProfile.education.length === 1 ? "y" : "ies"}`
                          : ""}
                      </span>
                    </div>
                  )}

                  <div
                    role="status"
                    aria-live="polite"
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "16px 0" }}
                  >
                    <strong style={{ fontSize: 13, color: "var(--muted-text)" }}>
                      {interviewStatus === "preparing-speech"
                        ? "Preparing interviewer audio..."
                        : interviewStatus === "asking"
                        ? "Interviewer is speaking..."
                        : interviewStatus === "listening"
                          ? "Listening to your answer..."
                          : interviewStatus === "retrying"
                            ? "Retrying microphone automatically..."
                            : interviewStatus === "submitting"
                              ? "Submitting your answer..."
                              : interviewStatus === "evaluating"
                              ? "Evaluating your answer..."
                              : interviewStatus === "starting"
                                ? "Starting interview..."
                                : interviewStatus === "answer-error"
                                  ? "Your answer is preserved. Review the error below and retry submission."
                                : interviewStatus === "voice-error"
                                  ? "Voice input needs attention. You can type your answer."
                                  : "Preparing the next step..."}
                    </strong>
                    {interviewStatus === "voice-error" &&
                      (window.SpeechRecognition || window.webkitSpeechRecognition) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void retryMicrophoneAccess(interviewQuestionIndexRef.current)}
                        disabled={interviewBusy}
                      >
                        Retry Microphone
                      </button>
                    )}
                    <button type="button" className="btn-secondary" onClick={() => void endInterview()} disabled={interviewBusy}>
                      End Interview
                    </button>
                  </div>

                  <label className="form-field-label" htmlFor="candidate-answer-textarea">YOUR ANSWER <span>TYPE HERE IF NEEDED</span></label>
                  <textarea
                    id="candidate-answer-textarea"
                    className="form-textarea"
                    rows={5}
                    value={interviewAnswer}
                    disabled={interviewBusy}
                    onChange={(event) => updateInterviewAnswer(event.target.value)}
                    placeholder="Speak your answer or type here if microphone input is unavailable."
                    aria-live="polite"
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void submitInterviewAnswer(undefined, interviewQuestionIndexRef.current)}
                      disabled={interviewBusy || interviewStatus === "completed"}
                    >
                      Submit Answer
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void skipInterviewQuestion()}
                      disabled={interviewBusy || interviewStatus === "completed"}
                      title="Skip this question and move on"
                    >
                      Skip Question
                    </button>
                  </div>

                  {interviewError && <div style={{ marginTop: 12 }}><ErrorMessage>{interviewError}</ErrorMessage></div>}
                </div>
              )}

              {interviewFeedback && (
                <div className="skills-panel-box">
                  <h2>Feedback for Your Previous Answer</h2>
                  <div className="metric-score-card">
                    <div className="metric-label">ANSWER SCORE</div>
                    <strong>{interviewFeedback.score ?? "—"}{interviewFeedback.score != null ? " / 100" : ""}</strong>
                  </div>
                  {interviewFeedback.feedback && <p style={{ marginTop: 12 }}>{interviewFeedback.feedback}</p>}
                  {interviewFeedback.strengths?.length > 0 && <>
                    <h3 style={{ marginTop: 16 }}>Strengths</h3>
                    <ul>{interviewFeedback.strengths.map((item, i) => <li key={i}>{item}</li>)}</ul>
                  </>}
                  {interviewFeedback.improvements?.length > 0 && <>
                    <h3 style={{ marginTop: 16 }}>Areas to Improve</h3>
                    <ul>{interviewFeedback.improvements.map((item, i) => <li key={i}>{item}</li>)}</ul>
                  </>}
                  {interviewFeedback.idealConcept && <>
                    <h3 style={{ marginTop: 16 }}>Ideal Answer Concepts</h3>
                    <p>{interviewFeedback.idealConcept}</p>
                  </>}
                </div>
              )}

              {interviewStatus === "completed" && (
                <div className="skills-panel-box interview-report-view">
                  {interviewError && <div style={{ marginBottom: 16 }}><ErrorMessage>{interviewError}</ErrorMessage></div>}
                  <div className="studio-panel-heading">
                    <div>
                      <h2>
                        {interviewReportStatus === "ready"
                          ? "Interview Completed"
                          : interviewReportStatus === "failed"
                            ? "Interview Finished — Report Save Failed"
                            : interviewReportStatus === "not_started"
                              ? "Interview Ended"
                            : "Saving Final Report"}
                      </h2>
                      <p>
                        {interviewReportStatus === "generating" || interviewReportStatus === "pending"
                          ? "Your answers are saved. The final feedback report is being generated and saved."
                          : interviewReportStatus === "failed"
                            ? "The interview answers are saved, but the final feedback report was not saved. Retry to finish saving it."
                            : interviewReportStatus === "not_started"
                              ? "The interview ended before an answer was evaluated, so a scored report is not available."
                            : "Your session has finished. Review the final report below."}
                      </p>
                    </div>
                    {interviewReportStatus === "ready" ? <CheckCircle2 size={22} /> : <Clock size={22} />}
                  </div>
                  {interviewCompletionMessage && (
                    <p className="report-section">{interviewCompletionMessage}</p>
                  )}
                  {interviewReportStatus === "failed" && interviewSessionId && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void generateInterviewReport(interviewSessionId)}
                      disabled={reportGenerationRef.current}
                    >
                      Retry Report Generation
                    </button>
                  )}
                  {interviewReport ? (
                    <div className="report-sections">
                      {/* Overall Score */}
                      <div className="report-score-hero">
                        <div className="ats-score-dial"><strong>{interviewReport.overallScore ?? "—"}</strong><small>OVERALL</small></div>
                        {interviewReport.scoreExplanation && <p>{interviewReport.scoreExplanation}</p>}
                      </div>
                      <h3>Assessment for {interviewJobRole === "Other" ? otherInterviewJobRole : interviewJobRole}</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 10, marginBottom: 20 }}>
                        {[
                          ["Answer relevance", interviewReport.answerRelevanceScore],
                          ["Role technical knowledge", interviewReport.technicalScore],
                          ["Problem-solving", interviewReport.problemSolvingScore],
                          ["Communication", interviewReport.communicationScore],
                          ["Role alignment", interviewReport.roleAlignmentScore],
                        ].filter(([, score]) => Number.isInteger(score)).map(([label, score]) => (
                          <div className="metric-score-card" key={label}>
                            <div className="metric-label">{label}</div>
                            <strong>{score} / 100</strong>
                          </div>
                        ))}
                      </div>

                      {/* Question Reviews */}
                      {Array.isArray(interviewReport.questionReviews) && interviewReport.questionReviews.length > 0 && (
                        <div className="report-section">
                          <h3>Question-by-Question Review</h3>
                          {interviewReport.questionReviews.map((review, i) => (
                            <div key={i} className="question-review-card">
                              <div className="review-header">
                                <span className="review-q-num">Q{(review.questionIndex ?? i) + 1}</span>
                                <span className="review-score">{review.score ?? "—"}/100</span>
                              </div>
                              <p className="review-question">{review.question}</p>
                              {review.feedback && <p className="review-feedback">{review.feedback}</p>}
                              {review.idealConcept && <p className="review-ideal"><strong>Key concepts:</strong> {review.idealConcept}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Strengths & Improvements side-by-side */}
                      <div className="skills-comparison-split">
                        {Array.isArray(interviewReport.strengths) && interviewReport.strengths.length > 0 && (
                          <div className="skills-panel-box"><h3><CheckCircle2 size={16} /> Strengths</h3><ul>{interviewReport.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                        )}
                        {Array.isArray(interviewReport.improvements) && interviewReport.improvements.length > 0 && (
                          <div className="skills-panel-box"><h3><AlertCircle size={16} /> Areas for Improvement</h3><ul>{interviewReport.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                        )}
                      </div>

                      {/* Technical Gaps */}
                      {Array.isArray(interviewReport.technicalGaps) && interviewReport.technicalGaps.length > 0 && (
                        <div className="report-section">
                          <h3>Technical Knowledge Gaps</h3>
                          <ul>{interviewReport.technicalGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                        </div>
                      )}

                      {/* Communication Feedback */}
                      {interviewReport.communicationFeedback && (
                        <div className="report-section">
                          <h3>Communication Feedback</h3>
                          <p>{interviewReport.communicationFeedback}</p>
                        </div>
                      )}
                      {interviewReport.answerCompletenessFeedback && (
                        <div className="report-section">
                          <h3>Relevance & Completeness</h3>
                          <p>{interviewReport.answerCompletenessFeedback}</p>
                        </div>
                      )}
                      {interviewReport.projectUnderstandingFeedback && (
                        <div className="report-section">
                          <h3>Project Understanding</h3>
                          <p>{interviewReport.projectUnderstandingFeedback}</p>
                        </div>
                      )}
                      {interviewReport.behavioralFeedback && (
                        <div className="report-section">
                          <h3>Problem-solving & Behavioral Responses</h3>
                          <p>{interviewReport.behavioralFeedback}</p>
                        </div>
                      )}

                      {/* Recommended Topics & Next Steps */}
                      <div className="skills-comparison-split">
                        {Array.isArray(interviewReport.recommendedTopics) && interviewReport.recommendedTopics.length > 0 && (
                          <div className="skills-panel-box"><h3><Sparkles size={16} /> Recommended Topics to Study</h3><ul>{interviewReport.recommendedTopics.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
                        )}
                        {Array.isArray(interviewReport.nextSteps) && interviewReport.nextSteps.length > 0 && (
                          <div className="skills-panel-box"><h3><ArrowRight size={16} /> Practical Next Steps</h3><ul>{interviewReport.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                        )}
                      </div>
                      {Array.isArray(interviewReport.exampleImprovements) && interviewReport.exampleImprovements.length > 0 && (
                        <div className="report-section">
                          <h3>Example Answer Improvements</h3>
                          <ul>{interviewReport.exampleImprovements.map((item, i) => <li key={i}>{item}</li>)}</ul>
                        </div>
                      )}

                      {interviewReport.evaluationDisclaimer && (
                        <p className="report-disclaimer">{interviewReport.evaluationDisclaimer}</p>
                      )}
                    </div>
                  ) : (
                    <p>The server marked the session complete but did not return a report object.</p>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
                    <button type="button" className="btn-primary" onClick={() => { resetInterview(); setPage("interview"); }}>
                      <RotateCcw size={15} /> Start New Interview
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => changePage("feedback")}>Open Feedback Agent</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {page === "feedback" && (
          <div className="dashboard-content-area">
            <div className="workspace-page-intro">
              <div className="workspace-eyebrow">SPECIALIST 03 / PERFORMANCE DIAGNOSTICS</div>
              <h1>Evaluation Scorecard</h1>
              <p>Review saved interview reports in chronological order and compare scores over time.</p>
            </div>
            {interviewFeedback ? (
              <div className="skills-panel-box">
                <div className="metric-score-card"><div className="metric-label">LATEST ANSWER SCORE</div><strong>{interviewFeedback.score ?? "—"}{interviewFeedback.score != null ? " / 100" : ""}</strong></div>
                <h3 style={{ marginTop: 16 }}>Feedback</h3><p>{interviewFeedback.feedback || "No general feedback returned."}</p>
                <h3 style={{ marginTop: 16 }}>Strengths</h3><ul>{(interviewFeedback.strengths || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                <h3 style={{ marginTop: 16 }}>Improvements</h3><ul>{(interviewFeedback.improvements || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                <button className="btn-primary" style={{ marginTop: 18 }} onClick={() => changePage("interview")}>Continue Interview <ArrowRight size={15} /></button>
              </div>
            ) : null}

            {interviewHistoryError && (
              <div style={{ marginBottom: 16 }}>
                <ErrorMessage>{interviewHistoryError}</ErrorMessage>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: 10 }}
                  onClick={() => void loadInterviewHistory(auth.currentUser)}
                >
                  Retry Loading History
                </button>
              </div>
            )}
            {historyReportError && (
              <div style={{ marginBottom: 16 }}>
                <ErrorMessage>{historyReportError}</ErrorMessage>
              </div>
            )}
            {interviewHistoryStatus === "loading" && (
              <div className="activity-empty-box" role="status">Loading your saved interview reports...</div>
            )}
            {interviewHistoryStatus === "ready" && interviewHistory.length > 0 && (
              <div style={{ display: "grid", gap: 18 }}>
                {interviewHistory.map((interview, index) => {
                  const report = interview.report || {};
                  const scores = [
                    ["Overall", "overallScore"],
                    ["Communication", "communicationScore"],
                    ["Technical", "technicalScore"],
                    ["Answer relevance", "answerRelevanceScore"],
                    ["Problem-solving", "problemSolvingScore"],
                    ["Role alignment", "roleAlignmentScore"],
                  ];
                  const isReportReady = interview.reportStatus === "ready";
                  return (
                    <section className="skills-panel-box" key={interview._id}>
                      <div className="studio-panel-heading">
                        <div>
                          <h2>{interview.jobRole || "Interview"}</h2>
                          <p>
                            Interview {index + 1} ·{" "}
                            {interview.createdAt
                              ? new Date(interview.createdAt).toLocaleDateString()
                              : "Date unavailable"}
                          </p>
                        </div>
                        <span>{interview.status === "cancelled" ? "Interview interrupted" : isReportReady ? "Report saved" : "Report needs attention"}</span>
                      </div>

                      {scores.some(([, key]) => Number.isFinite(report[key])) && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, margin: "16px 0" }}>
                          {scores.filter(([, key]) => Number.isFinite(report[key])).map(([label, key]) => {
                            const change = getComparableScoreChange(interviewHistory, index, key);
                            return (
                              <div className="metric-score-card" key={key}>
                                <div className="metric-label">{label}</div>
                                <strong>{report[key]} / 100</strong>
                                {change !== null && (
                                  <small>
                                    {change > 0 ? "+" : ""}{change} points vs previous same-role score
                                  </small>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {report.scoreExplanation && <p className="report-section">{report.scoreExplanation}</p>}
                      {interview.interruptedDraftAnswer && (
                        <div className="report-section">
                          <h3>Saved answer draft (not evaluated)</h3>
                          {interview.interruptedDraftQuestion && <p><strong>Question:</strong> {interview.interruptedDraftQuestion}</p>}
                          <p>{interview.interruptedDraftAnswer}</p>
                        </div>
                      )}
                      {!isReportReady && (
                        <div style={{ margin: "12px 0" }}>
                          <p>
                            {interview.status === "cancelled" && !(report.questionReviews?.length > 0)
                              ? "Interview interrupted. Your saved transcript is retained, but no answers were evaluated, so a scored report cannot be generated yet."
                              : interview.reportStatus === "generating"
                                ? "The report is still being generated."
                                : "The report is not ready yet. Retry safely to generate feedback from the answers already saved."}
                          </p>
                          {(report.questionReviews?.length > 0) && (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => void retryHistoricalReport(interview._id)}
                              disabled={historyReportBusyId === interview._id}
                            >
                              {historyReportBusyId === interview._id ? "Saving Report..." : "Retry Report Save"}
                            </button>
                          )}
                        </div>
                      )}

                      {report.questionReviews?.length > 0 && (
                        <div className="report-section">
                          <h3>Answer Evaluations</h3>
                          {report.questionReviews.map((review, reviewIndex) => (
                            <div className="question-review-card" key={`${interview._id}-${review.questionIndex ?? reviewIndex}`}>
                              <div className="review-header">
                                <span className="review-q-num">Q{(review.questionIndex ?? reviewIndex) + 1}</span>
                                <span className="review-score">{review.score ?? "—"}/100</span>
                              </div>
                              {review.question && <p className="review-question">{review.question}</p>}
                              {review.candidateAnswer && <p><strong>Answer:</strong> {review.candidateAnswer}</p>}
                              {review.feedback && <p className="review-feedback">{review.feedback}</p>}
                              {review.idealConcept && <p className="review-ideal"><strong>Key concepts:</strong> {review.idealConcept}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="skills-comparison-split">
                        {report.strengths?.length > 0 && (
                          <div className="skills-panel-box"><h3>Strengths</h3><ul>{report.strengths.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></div>
                        )}
                        {report.improvements?.length > 0 && (
                          <div className="skills-panel-box"><h3>Areas for Improvement</h3><ul>{report.improvements.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></div>
                        )}
                      </div>
                      {[
                        ["Technical gaps", report.technicalGaps],
                        ["Recommended topics", report.recommendedTopics],
                        ["Next steps", report.nextSteps],
                        ["Example improvements", report.exampleImprovements],
                      ].filter(([, items]) => items?.length > 0).map(([title, items]) => (
                        <div className="report-section" key={title}>
                          <h3>{title}</h3>
                          <ul>{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                        </div>
                      ))}
                      {[
                        ["Communication feedback", report.communicationFeedback],
                        ["Answer completeness", report.answerCompletenessFeedback],
                        ["Project understanding", report.projectUnderstandingFeedback],
                        ["Behavioral feedback", report.behavioralFeedback],
                      ].filter(([, text]) => text).map(([title, text]) => (
                        <div className="report-section" key={title}>
                          <h3>{title}</h3>
                          <p>{text}</p>
                        </div>
                      ))}
                      {report.evaluationDisclaimer && (
                        <p className="report-disclaimer">{report.evaluationDisclaimer}</p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            {interviewHistoryStatus === "ready" && interviewHistory.length === 0 && !interviewFeedback && (
              <div className="activity-empty-box"><div className="empty-icon-circle"><ChartNoAxesCombined size={22} /></div><strong>No interview feedback yet</strong><p>Start an interview and submit an answer to receive your evaluation.</p><button className="btn-secondary" onClick={() => changePage("interview")}>Start an Interview <ArrowRight size={14} /></button></div>
            )}
          </div>
        )}

        {page === "roadmap" && (
          <div className="dashboard-content-area">
            <div className="workspace-page-intro">
              <div className="workspace-eyebrow">SPECIALIST 04 / STRATEGIC SEQUENCING</div>
              <h1>Career Roadmap Agent</h1>
              <p>Generate an adaptive, multi-stage learning trajectory and project roadmap tailored to your target career.</p>
            </div>

            {/* Interactive Role Formulation Form */}
            <div className="studio-panel" style={{ marginBottom: 24 }}>
              <div className="studio-panel-heading">
                <div>
                  <h2>Target Career Configuration</h2>
                  <p>Choose or input your desired technical role and current experience level.</p>
                </div>
                <Route size={22} />
              </div>

              {/* Quick Preset Role Pills */}
              <div style={{ marginBottom: 16 }}>
                <span className="form-field-label" style={{ display: "block", marginBottom: 8 }}>POPULAR CAREER PATHWAYS</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    "AI/ML Engineer",
                    "Frontend Developer",
                    "Python Developer",
                    "Data Analyst",
                    "Full Stack Engineer",
                    "Cloud / DevOps Engineer",
                  ].map((rolePreset) => (
                    <button
                      key={rolePreset}
                      type="button"
                      className={roadmapRole === rolePreset ? "btn-primary" : "btn-secondary"}
                      style={{ padding: "6px 14px", fontSize: 13, borderRadius: 20 }}
                      onClick={() => {
                        setRoadmapRole(rolePreset);
                        void generateRoadmap(rolePreset);
                      }}
                      disabled={roadmapLoading}
                    >
                      {rolePreset}
                    </button>
                  ))}
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void generateRoadmap();
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div>
                    <label className="form-field-label" htmlFor="roadmap-role-input">TARGET CAREER ROLE <span>REQUIRED</span></label>
                    <input
                      id="roadmap-role-input"
                      className="form-input"
                      value={roadmapRole}
                      onChange={(e) => setRoadmapRole(e.target.value)}
                      placeholder="e.g. AI/ML Engineer, Mobile Developer, Data Scientist"
                      disabled={roadmapLoading}
                    />
                  </div>
                  <div>
                    <label className="form-field-label" htmlFor="roadmap-level-select">EXPERIENCE LEVEL</label>
                    <select
                      id="roadmap-level-select"
                      className="form-input"
                      value={roadmapExperienceLevel}
                      onChange={(e) => setRoadmapExperienceLevel(e.target.value)}
                      disabled={roadmapLoading}
                    >
                      <option value="Entry Level / Student">Entry Level / Student</option>
                      <option value="Career Transitioner">Career Transitioner</option>
                      <option value="Mid-Level (1-3 Years)">Mid-Level (1-3 Years)</option>
                      <option value="Senior Specialist">Senior Specialist</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label className="form-field-label" htmlFor="roadmap-skills-input">CURRENT SKILLS OR TECH STACK <span>OPTIONAL</span></label>
                  <input
                    id="roadmap-skills-input"
                    className="form-input"
                    value={roadmapCurrentSkills}
                    onChange={(e) => setRoadmapCurrentSkills(e.target.value)}
                    placeholder="e.g. Basic Python, JavaScript, Git (leaves out what you already know)"
                    disabled={roadmapLoading}
                  />
                </div>

                {roadmapError && (
                  <div style={{ marginBottom: 16 }}>
                    <ErrorMessage>{roadmapError}</ErrorMessage>
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={roadmapLoading || !roadmapRole.trim()}
                  >
                    {roadmapLoading ? (
                      <>
                        <Clock size={15} /> Generating Tailored Roadmap...
                      </>
                    ) : (
                      <>
                        Generate Roadmap <ArrowRight size={15} />
                      </>
                    )}
                  </button>

                  {roadmapData && !roadmapLoading && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void generateRoadmap()}
                    >
                      <RotateCcw size={14} /> Refresh Roadmap
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Loading Indicator */}
            {roadmapLoading && (
              <div className="alert-notice" style={{ marginBottom: 20 }}>
                <Clock size={18} />
                <span>Generating tailored career roadmap for <strong>{roadmapRole}</strong>. Consulting AI career models...</span>
              </div>
            )}

            {/* Error with Retry */}
            {roadmapError && !roadmapLoading && (
              <div style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void generateRoadmap()}
                  style={{ marginTop: 8 }}
                >
                  <RotateCcw size={14} /> Retry Generating Roadmap
                </button>
              </div>
            )}

            {/* Generated Roadmap Display */}
            {roadmapData && (() => {
              // Build a flat list of all milestones with phase context for the tracker
              const allMilestones = [];
              (roadmapData.phases || []).forEach((phase) => {
                (phase.milestones || []).forEach((ms) => {
                  allMilestones.push({ text: ms, phaseTitle: phase.title });
                });
              });
              const completedCount = roadmapMilestoneProgress.filter(m => m.status === "completed").length;
              return (
              <div>
                {/* Save banner — only when not yet saved */}
                {roadmapSaveStatus !== "saved" && (
                  <div className="roadmap-save-banner" style={{ marginBottom: 20 }}>
                    <p>
                      {roadmapSaveStatus === "saving"
                        ? "Saving roadmap…"
                        : roadmapSaveStatus === "error"
                        ? "Save failed — please try again."
                        : "Save this roadmap to track your milestone progress across sessions."}
                    </p>
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => void saveRoadmap()}
                      disabled={roadmapSaveStatus === "saving"}
                      style={{ flexShrink: 0 }}
                    >
                      <Save size={14} />
                      {roadmapSaveStatus === "saving" ? "Saving…" : "Save Roadmap"}
                    </button>
                  </div>
                )}
                {roadmapSaveStatus === "saved" && allMilestones.length > 0 && (
                  <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--navy-600)" }}>
                    <CheckCircle2 size={15} style={{ color: "#22c55e" }} />
                    Roadmap saved · {completedCount}/{allMilestones.length} milestones completed
                  </div>
                )}

                {/* Executive Overview */}
                <div className="studio-panel" style={{ marginBottom: 20, background: "linear-gradient(135deg, rgba(37,99,235,0.06), rgba(16,185,129,0.05))" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <div className="workspace-eyebrow" style={{ color: "var(--accent-color)" }}>CAREER BLUEPRINT</div>
                      <h2 style={{ margin: "4px 0 8px 0" }}>{roadmapData.role} Roadmap</h2>
                      <p style={{ color: "var(--text-secondary)", maxWidth: 720 }}>{roadmapData.overview}</p>
                    </div>
                    <span className="phase-skill-pill" style={{ fontSize: 13, padding: "6px 12px" }}>
                      Level: {roadmapData.experienceLevel || roadmapExperienceLevel}
                    </span>
                  </div>
                </div>

                {/* Structured Roadmap Stages */}
                <div className="roadmap-timeline">
                  {(roadmapData.phases || []).map((phase, i) => (
                    <div className="timeline-phase-card" key={phase.title || i}>
                      <div className="phase-number-indicator">
                        {String(phase.phaseNumber || i + 1).padStart(2, "0")}
                      </div>
                      <div className="phase-content" style={{ width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                          <h3 style={{ margin: 0 }}>{phase.title}</h3>
                          {phase.duration && (
                            <span style={{ fontSize: 12, color: "var(--muted-text)", fontWeight: 600 }}>
                              {phase.duration}
                            </span>
                          )}
                        </div>

                        {phase.description && (
                          <p style={{ margin: "8px 0 14px 0", color: "var(--text-secondary)" }}>
                            {phase.description}
                          </p>
                        )}

                        {/* Skills to Master */}
                        {Array.isArray(phase.skills) && phase.skills.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-text)" }}>Key Competencies &amp; Technologies</strong>
                            <div className="phase-skills-row" style={{ marginTop: 6 }}>
                              {phase.skills.map((skill) => (
                                <span key={skill} className="phase-skill-pill">{skill}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recommended Projects */}
                        {Array.isArray(phase.projects) && phase.projects.length > 0 && (
                          <div style={{ marginBottom: 12, background: "rgba(0,0,0,0.02)", padding: "10px 14px", borderRadius: 6, border: "1px solid var(--border-color)" }}>
                            <strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-primary)" }}>Recommended Hands-on Projects:</strong>
                            <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                              {phase.projects.map((proj, pIdx) => (
                                <li key={pIdx} style={{ fontSize: 13, margin: "4px 0", color: "var(--text-secondary)" }}>{proj}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Interactive Milestone Tracker */}
                        {Array.isArray(phase.milestones) && phase.milestones.length > 0 && (() => {
                          // Compute global offset for milestones in this phase
                          let offset = 0;
                          for (let pi = 0; pi < i; pi++) {
                            offset += (roadmapData.phases[pi]?.milestones?.length || 0);
                          }
                          return (
                            <div>
                              <p className="milestone-tracker-heading">Mastery Milestones</p>
                              <div className="milestone-list">
                                {phase.milestones.map((milestone, mIdx) => {
                                  const globalIdx = offset + mIdx;
                                  const prog = roadmapMilestoneProgress[globalIdx];
                                  const isDone = prog?.status === "completed";
                                  const note = prog?.note || "";
                                  const canTrack = roadmapSaveStatus === "saved";
                                  return (
                                    <div
                                      key={mIdx}
                                      className={`milestone-item${isDone ? " completed-milestone" : ""}`}
                                    >
                                      <button
                                        className={`milestone-checkbox-btn${isDone ? " checked" : ""}`}
                                        title={canTrack ? (isDone ? "Mark incomplete" : "Mark complete") : "Save roadmap first to track milestones"}
                                        disabled={!canTrack}
                                        onClick={() => canTrack && void updateMilestone(
                                          globalIdx,
                                          isDone ? "pending" : "completed",
                                          note
                                        )}
                                      >
                                        {isDone && <Check size={13} />}
                                      </button>
                                      <div className="milestone-body">
                                        <p className="milestone-title">{milestone}</p>
                                        {canTrack && (
                                          <textarea
                                            className="milestone-note-input"
                                            rows={1}
                                            placeholder="Add a reflection note…"
                                            value={note}
                                            onChange={(e) => {
                                              // Optimistic local update
                                              setRoadmapMilestoneProgress(prev => {
                                                const copy = [...prev];
                                                if (copy[globalIdx]) copy[globalIdx] = { ...copy[globalIdx], note: e.target.value };
                                                return copy;
                                              });
                                            }}
                                            onBlur={(e) => {
                                              void updateMilestone(globalIdx, prog?.status || "pending", e.target.value);
                                            }}
                                          />
                                        )}
                                        {prog && (
                                          <span className={`milestone-status-badge ${prog.status}`}>
                                            {prog.status === "in_progress" ? "In Progress" : prog.status === "completed" ? "Completed" : "Pending"}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Additional Guidance & Certifications Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
                  {Array.isArray(roadmapData.recommendedCertifications) && roadmapData.recommendedCertifications.length > 0 && (
                    <div className="studio-panel">
                      <div className="studio-panel-heading">
                        <div>
                          <h3>Recommended Certifications</h3>
                          <p>Recognized industry credentials that boost hiring probability.</p>
                        </div>
                        <ShieldCheck size={20} />
                      </div>
                      <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                        {roadmapData.recommendedCertifications.map((cert, cIdx) => (
                          <li key={cIdx} style={{ fontSize: 13, margin: "6px 0", color: "var(--text-secondary)" }}>{cert}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(roadmapData.actionableAdvice) && roadmapData.actionableAdvice.length > 0 && (
                    <div className="studio-panel">
                      <div className="studio-panel-heading">
                        <div>
                          <h3>Actionable Career Strategy</h3>
                          <p>Practices to accelerate job landing and technical credibility.</p>
                        </div>
                        <Sparkles size={20} />
                      </div>
                      <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                        {roadmapData.actionableAdvice.map((tip, tIdx) => (
                          <li key={tIdx} style={{ fontSize: 13, margin: "6px 0", color: "var(--text-secondary)" }}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              );
            })()}


            {/* Default State when no roadmap generated yet */}
            {!roadmapData && !roadmapLoading && (
              <div className="activity-empty-box">
                <div className="empty-icon-circle"><Route size={22} /></div>
                <strong>Ready to generate your career roadmap</strong>
                <p>Select one of the quick pathway pills above or enter your custom target role, then click "Generate Roadmap".</p>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void generateRoadmap()}
                  disabled={roadmapLoading}
                >
                  Generate {roadmapRole} Roadmap <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {page === "settings" && (
          <div className="dashboard-content-area">
            <div className="workspace-page-intro"><div className="workspace-eyebrow">PREFERENCES</div><h1>Workspace Settings</h1><p>Your authenticated account identity and profile settings.</p></div>
            <div className="studio-panel" style={{ maxWidth: 680 }}>
              <div className="studio-panel-heading"><div><h2>Profile Identity</h2><p>Authenticated via Firebase Google sign-in. You can update your display name anytime.</p></div><UserIcon size={20} /></div>
              <form onSubmit={handleUpdateDisplayName} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label className="form-field-label" htmlFor="settings-display-name">
                    DISPLAY NAME <span>EDITABLE</span>
                  </label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      id="settings-display-name"
                      className="form-textarea"
                      style={{ height: 44, padding: "10px 14px", flex: 1 }}
                      value={profileDisplayName}
                      onChange={(e) => {
                        setProfileDisplayName(e.target.value);
                        if (profileSuccess) setProfileSuccess("");
                        if (profileError) setProfileError("");
                      }}
                      placeholder="Enter your display name"
                      maxLength={60}
                    />
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={profileUpdating || !profileDisplayName.trim() || profileDisplayName.trim() === (user.displayName || "")}
                      style={{ padding: "10px 18px", height: 44, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      {profileUpdating ? "Saving…" : <><Save size={15} /> Save Name</>}
                    </button>
                  </div>
                  {profileSuccess && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, color: "#16a34a", fontSize: 13, fontWeight: 500 }}>
                      <CheckCircle2 size={15} /> {profileSuccess}
                    </div>
                  )}
                  {profileError && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, color: "#dc2626", fontSize: 13 }}>
                      <AlertCircle size={15} /> {profileError}
                    </div>
                  )}
                </div>

                <div>
                  <label className="form-field-label" htmlFor="settings-primary-email">
                    PRIMARY EMAIL <span>GOOGLE AUTH</span>
                  </label>
                  <input
                    id="settings-primary-email"
                    className="form-textarea"
                    style={{ height: 44, padding: "10px 14px", opacity: 0.8, cursor: "not-allowed" }}
                    value={user.email || ""}
                    disabled
                  />
                </div>

                <div>
                  <label className="form-field-label" htmlFor="settings-uid">
                    USER IDENTIFIER <span>READ ONLY</span>
                  </label>
                  <input
                    id="settings-uid"
                    className="form-textarea"
                    style={{ height: 44, padding: "10px 14px", fontSize: 12, opacity: 0.8, cursor: "not-allowed" }}
                    value={user.uid}
                    disabled
                  />
                </div>

                <div style={{ paddingTop: 16, borderTop: "1px solid rgba(255, 255, 255, 0.35)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--navy-500)" }}>Signed in with Google</span>
                  <button type="button" className="btn-secondary" onClick={handleLogout}>
                    <LogOut size={15} /> Sign Out
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
      {showInterviewGuidance && page === "interview" && (
        <div className="interview-guidance-backdrop">
          <section
            className="interview-guidance-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="interview-guidance-title"
            aria-describedby="interview-guidance-description"
          >
            <div className="interview-guidance-icon" aria-hidden="true">🎙️</div>
            <h2 id="interview-guidance-title">Important: Before You Start Your Interview</h2>
            <p id="interview-guidance-description">
              Please read these instructions carefully for a smooth interview experience.
            </p>
            <ul>
              <li><strong>Speak loudly and clearly</strong> so the AI interviewer can hear and understand your answers correctly.</li>
              <li><strong>Speak naturally and avoid mumbling</strong> so your answers can be evaluated accurately.</li>
              <li><strong>Wait until the AI interviewer finishes asking the question</strong> before you start answering.</li>
              <li><strong>Finish your complete answer before clicking “Submit Answer.”</strong> If you have finished speaking and the system does not automatically submit your answer, click the button to submit it.</li>
              <li><strong>If you need time to think, take a short pause</strong> and continue when you are ready.</li>
            </ul>
            <p className="interview-guidance-note">
              Clear communication helps the AI interviewer understand your answers, evaluate them properly, and ask relevant follow-up questions.
            </p>
            <p className="interview-guidance-emphasis">
              Please speak clearly and confidently to ensure your interview goes smoothly.
            </p>
            <button
              type="button"
              className="btn-primary interview-guidance-start"
              onClick={() => {
                setShowInterviewGuidance(false);
                void startInterview();
              }}
            >
              Got it! Let&apos;s Start
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
