const { classifyInterviewQuestion, classifyInterviewTopic } = require("./interviewProgression");

const CONTENT_STOP_WORDS = new Set([
    "a", "about", "an", "and", "are", "at", "be", "by", "can", "could",
    "did", "do", "does", "during", "explain", "for", "from", "had", "has",
    "have", "how", "i", "in", "into", "is", "it", "my", "of", "on",
    "or", "please", "the", "their", "them", "there", "this", "to", "was",
    "were", "what", "when", "where", "which", "who", "why", "with", "would",
    "me", "you", "your",
]);

function normalizeQuestionTokens(question) {
    return String(question || "")
        .toLowerCase()
        .replace(/[^a-z0-9+#.]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((token) => token && !CONTENT_STOP_WORDS.has(token))
        .map((token) => {
            if (/^(biggest|greatest|main|primary)$/.test(token)) return "main";
            if (/^(obstacle|problem|issue|difficulty|difficulties)$/.test(token)) return "challenge";
            if (/^challenges$/.test(token)) return "challenge";
            if (/^projects$/.test(token)) return "project";
            if (/^(faced|encountered|experienced)$/.test(token)) return "experience";
            if (/^(optimize|optimizing|improve|improving|boost|tuning|tune)$/.test(token)) return "improve";
            return token;
        });
}

function isNearDuplicateQuestion(candidate, previousQuestions) {
    const candidateTokens = new Set(normalizeQuestionTokens(candidate));
    if (candidateTokens.size < 2) return false;

    return previousQuestions.some((previous) => {
        const previousTokens = new Set(normalizeQuestionTokens(previous));
        if (previousTokens.size < 2) return false;
        const shared = [...candidateTokens].filter((token) => previousTokens.has(token)).length;
        const smallerSize = Math.min(candidateTokens.size, previousTokens.size);
        return (shared >= 2 && shared / smallerSize >= 0.75) || (shared >= 3 && shared / smallerSize >= 0.6);
    });
}

function asksMultipleRequests(question) {
    const text = String(question || "").toLowerCase();
    if ((text.match(/\?/g) || []).length !== 1) return true;

    return /\band\s+(?:(?:also|then)\s+)?(?:how|what|why|which|where|when|who|whether|could|would|did|do|does|have|has|can|are|is|was|were)\b/.test(text) ||
        /\band\s+(?:(?:also|then)\s+)?(?:explain|describe|discuss|tell|share|outline|compare|evaluate|assess|walk|elaborate|identify|summarize|mention|analyze|analyse|provide|give)\b/.test(text) ||
        /\band\s+(?:(?:also|then)\s+)?(?:build|choose|design|implement|measure|solve|test|improve|handle|manage|resolve|use|create|develop|deploy|debug|justify|reflect)\b/.test(text) ||
        /\b(?:focusing on|while explaining|while describing|as well as)\b/.test(text) ||
        /\band\s+(?:also\s+)?(?:the\s+)?(?:technologies|tools|challenges|responsibilities|experience|skills|results|outcomes)\b/.test(text);
}

function getContextTerms({ resumeProfile = {}, resumeText = "", jobDescription = "" }) {
    const profileText = JSON.stringify(resumeProfile || {});
    return new Set(
        `${profileText} ${resumeText} ${jobDescription}`
            .toLowerCase()
            .match(/[a-z][a-z0-9+#.-]{2,}/g)?.filter((term) =>
                !CONTENT_STOP_WORDS.has(term) &&
                !["candidate", "resume", "experience", "project", "skills", "role", "job"].includes(term)
            ) || []
    );
}

function questionMatchesContext(question, contextTerms) {
    const questionTerms = new Set(normalizeQuestionTokens(question));
    return [...questionTerms].some((term) => term.length >= 4 && contextTerms.has(term));
}

function questionMatchesRole(question, jobRole) {
    const text = String(question || "").toLowerCase();
    const role = String(jobRole || "").toLowerCase();
    let pattern;
    if (/frontend|front-end|ui developer/.test(role)) {
        pattern = /javascript|react|html|css|browser|front.?end|ui|state|accessibility|render|component/;
    } else if (/backend|back-end/.test(role)) {
        pattern = /api|back.?end|server|database|auth|sql|cache|endpoint|security|scalab|architecture/;
    } else if (/full[\s-]?stack/.test(role)) {
        pattern = /front.?end|back.?end|api|database|integrat|application|full.?stack|end.?to.?end/;
    } else if (/data scientist/.test(role)) {
        pattern = /data|statistic|analys|model|feature|experiment|visual|metric|sql|python/;
    } else if (/ai|machine learning|ml engineer/.test(role)) {
        pattern = /model|machine.?learning|\bml\b|dataset|data|feature|training|metric|overfit|inference|deploy|python|pytorch|tensorflow|neural|classifier|transformer/;
    } else if (/python developer|python engineer/i.test(role)) {
        pattern = /python|code|function|exception|list|dictionary|decorator|class|testing|pytest|library|virtualenv|package|async/;
    } else if (/data analyst/i.test(role)) {
        pattern = /sql|query|table|join|metric|data|cleaning|visualization|chart|dashboard|statistic|excel|power bi|tableau|analys/;
    } else if (/software engineer|developer|engineer/.test(role)) {
        pattern = /code|program|software|system|design|test|debug|api|architecture|reliab|maintain|scalab|algorithm/;
    } else {
        pattern = /role|responsibilit|technical|system|problem|design|test|api|database|project|skill/;
    }
    return pattern.test(text);
}

function normalizeStageIdentifier(stage) {
    const raw = String(stage || "").trim().toLowerCase();
    if (!raw) return "role";
    if (raw === "why_hire_you") return "suitability";
    if (raw === "company_motivation" || raw === "leaving_reason" || raw === "salary_expectations") return "motivation";
    if (raw === "career_goals") return "future";
    if (raw === "behavioral_challenge" || raw === "strengths_weaknesses") return "behavioral";
    if (raw === "technical_role") return "role";
    return raw;
}

function matchesInterviewStage(question, progression) {
    const stage = normalizeStageIdentifier(progression?.nextStage);
    const classification = classifyInterviewQuestion(question);
    const topic = classifyInterviewTopic(question);

    if (stage === "introduction") return question.trim() === "Tell me about yourself.";
    if (stage === "resume") {
        if (!classification.startsWith("resume:")) return false;
        const resumeTopic = classification.slice("resume:".length);
        return (progression.availableResumeTopics || []).includes(resumeTopic) &&
            !(progression.coveredResumeTopics || []).includes(resumeTopic);
    }
    if (stage === "role") return true;
    if (stage === "follow_up") return classification === "role" || classification === "behavioral" || classification.startsWith("resume:") || topic === "technical_role" || topic === "behavioral_challenge";
    if (stage === "motivation") return classification === "motivation" || classification === "suitability" || topic === "company_motivation" || topic === "leaving_reason" || topic === "salary_expectations" || topic === "suitability";
    if (stage === "suitability") return classification === "suitability" || classification === "motivation" || topic === "suitability" || topic === "why_hire_you";
    if (stage === "future") return classification === "future" || classification === "motivation" || topic === "career_goals";
    if (stage === "behavioral") return classification === "behavioral" || topic === "behavioral_challenge" || topic === "strengths_weaknesses";
    return true;
}

function validateInterviewQuestion(question, {
    progression,
    previousConversation = [],
    jobRole = "",
    resumeProfile = {},
    resumeText = "",
    jobDescription = "",
} = {}) {
    const text = String(question || "").trim();
    if (!text || (text.match(/\?/g) || []).length !== 1) {
        return { valid: false, reason: "Return exactly one complete question." };
    }
    if (!/^(what|why|how|which|where|when|who|can|could|would|is|are|do|does|did|have|has|tell|describe|explain|share|walk)\b/i.test(text)) {
        return { valid: false, reason: "Remove greetings and introductory wording; return only the question." };
    }
    if (!/\?\s*$/.test(text)) {
        return { valid: false, reason: "Do not append commentary after the question." };
    }
    if (text.split(/\s+/).length > 20) {
        return { valid: false, reason: "Keep the question short, ideally 5 to 15 words." };
    }
    if (asksMultipleRequests(text)) {
        return { valid: false, reason: "Ask about one primary topic only; remove the second request." };
    }

    const previousQuestions = previousConversation
        .filter((item) => item.speaker === "interviewer")
        .map((item) => item.text);
    if (isNearDuplicateQuestion(text, previousQuestions)) {
        return { valid: false, reason: "This repeats a previously asked question; choose a new topic." };
    }
    if (!matchesInterviewStage(text, progression)) {
        return { valid: false, reason: `The question does not belong to the current ${progression.nextStage} stage.` };
    }
    if ((progression.nextStage === "role" || progression.nextStage === "follow_up") &&
        !questionMatchesRole(text, jobRole) &&
        !questionMatchesContext(text, getContextTerms({ resumeProfile, resumeText, jobDescription }))) {
        return { valid: false, reason: "Make the question relevant to the selected role, resume, or job description." };
    }

    return { valid: true, reason: "" };
}

function getSafeQuestionFallback({
    progression,
    resumeProfile = {},
    jobRole = "",
    previousConversation = [],
    resumeText = "",
    jobDescription = "",
}) {
    const profile = resumeProfile || {};
    const uncoveredTopic = progression.availableResumeTopics?.find(
        (topic) => !progression.coveredResumeTopics?.includes(topic)
    );
    const project = progression.projectTracking?.uncoveredProjects?.[0] || profile.projects?.[0] || {};
    const experience = profile.experience?.[0] || {};
    const internship = profile.internships?.[0] || {};
    const skill = profile.technicalSkills?.[0] || profile.skills?.[0] || "";
    const isFresher = progression.candidateType === "fresher";

    const byStage = {
        resume: {
            projects: [
                project.title ? `Can you describe your ${project.title} project?` : "Can you describe a project from your resume?",
                project.title ? `What challenge did you face in your ${project.title} project?` : "What challenge did you face in a project?",
            ],
            experience: [
                experience.company ? `What was your role at ${experience.company}?` : "What responsibility shaped your previous role?",
                "What did you learn in your previous role?",
            ],
            internships: [
                internship.company ? `What did you work on at ${internship.company}?` : "What did you work on during your internship?",
                "What did you learn during your internship?",
            ],
            education: ["What subject from your education prepared you for this role?"],
            skills: [
                skill ? `How have you used ${skill}?` : "Which technical skill have you used most?",
                "Which technical skill would you like to discuss?",
            ],
            achievements: ["Which achievement are you most proud of?"],
            background: ["What detail from your background matters most?"],
        },
        role: /frontend|front-end|ui developer/i.test(jobRole)
            ? [
                "How do you manage state in a frontend application?",
                "How do you test interactive user interfaces?",
                "How would you improve frontend performance?",
                "How do you approach accessibility in a user interface?",
                "How do you debug a rendering issue?",
            ]
            : /backend|back-end/i.test(jobRole)
                ? [
                    "How would you design a reliable API?",
                    "How do you protect a backend service?",
                    "How do you diagnose a slow database query?",
                    "How would you improve service reliability?",
                    "How do you test a backend integration?",
                ]
                : /full[\s-]?stack/i.test(jobRole)
                    ? [
                        "How do you connect an interface to an API?",
                        "How do you structure data across an application?",
                        "How do you test a full-stack application?",
                        "How do you debug an end-to-end failure?",
                        "How would you improve application reliability?",
                    ]
                    : /data scientist/i.test(jobRole)
                        ? [
                            "How do you validate a data analysis?",
                            "How do you measure a model's performance?",
                            "How do you detect data leakage?",
                            "How do you handle missing values in a dataset?",
                            "How do you communicate uncertainty in data analysis?",
                        ]
                        : /ai|machine learning|ml engineer/i.test(jobRole)
                            ? [
                                "How would you evaluate a machine-learning model?",
                                "How do you detect overfitting in a model?",
                                "How do you monitor model drift?",
                                "How do you select an evaluation metric?",
                                "How do you optimize model inference?",
                            ]
                            : /python developer|python engineer/i.test(jobRole)
                                ? [
                                    "How do you handle exceptions in Python?",
                                    "How do you structure Python unit tests?",
                                    "How do you manage dependencies in a Python project?",
                                    "How do Python dictionaries perform lookups?",
                                    "How do you profile Python code performance?",
                                ]
                                : /data analyst/i.test(jobRole)
                                    ? [
                                        "How do you write an efficient SQL query with joins?",
                                        "How do you handle missing values in data analysis?",
                                        "How do you validate the accuracy of a dataset?",
                                        "How do you choose visualizations for business stakeholders?",
                                        "How do you identify outliers in a dataset?",
                                    ]
                                    : [
                                        "How do you test a software design?",
                                        "How do you debug an unfamiliar codebase?",
                                        "How do you design a maintainable software component?",
                                        "How do you handle a production reliability issue?",
                                        "How would you improve test coverage?",
                                    ],
        motivation: isFresher
            ? [
                "What interests you about this role?",
                "What motivated you to pursue this career path?",
                "What aspects of this position excite you most?",
            ]
            : [
                "What motivated your search for this role?",
                "What interests you about this position?",
                "What drove your decision to seek this career transition?",
            ],
        suitability: [
            "What skills or experience make you a good fit for this role?",
            "What makes you a good fit for this position?",
            "Why should we hire you for this role?",
            "What makes you well-suited for the responsibilities of this job?",
            "What unique strengths or perspective would you bring to this position?",
            "Why should we choose you for this position?",
        ],
        future: [
            "What are your primary career goals over the next few years?",
            "Where do you see yourself in five years?",
            "What technical areas do you hope to grow into next?",
            "Where do you see your career heading in the future?",
        ],
        behavioral: isFresher
            ? [
                "Can you tell me about a time you worked on a team project?",
                "What would you consider your greatest personal strength?",
                "How do you handle challenging deadlines when learning new skills?",
            ]
            : [
                "How do you handle difficult disagreements with teammates or stakeholders?",
                "What is an area of growth you have actively worked to improve?",
                "Can you describe a challenging project failure and how you resolved it?",
            ],
        follow_up: [
            ...(isFresher
                ? [
                    "Can you tell me about a time you worked on a team project?",
                    "What would you consider your greatest personal strength?",
                ]
                : [
                    "How do you handle difficult disagreements with teammates or stakeholders?",
                    "What is an area of growth you have actively worked to improve?",
                ]),
            ...(/frontend|front-end|ui developer/i.test(jobRole)
                ? [
                    "How would you improve frontend performance?",
                    "How do you approach accessibility in a user interface?",
                    "How do you debug a rendering issue?",
                ]
                : /backend|back-end/i.test(jobRole)
                    ? [
                        "How do you diagnose a slow database query?",
                        "How would you improve service reliability?",
                        "How do you test a backend integration?",
                    ]
                    : /full[\s-]?stack/i.test(jobRole)
                        ? [
                            "How do you test a full-stack application?",
                            "How do you debug an end-to-end failure?",
                            "How would you improve application reliability?",
                        ]
                        : /data scientist/i.test(jobRole)
                            ? [
                                "How do you detect data leakage?",
                                "How do you handle missing values?",
                                "How do you communicate analytical uncertainty?",
                            ]
                            : /ai|machine learning|ml engineer/i.test(jobRole)
                                ? [
                                    "How do you monitor model drift?",
                                    "How do you select an evaluation metric?",
                                    "How do you optimize model inference?",
                                ]
                                : /python developer|python engineer/i.test(jobRole)
                                    ? [
                                        "How do you handle exceptions in Python?",
                                        "How do you structure Python unit tests?",
                                        "How do you manage dependencies in a Python project?",
                                    ]
                                    : /data analyst/i.test(jobRole)
                                        ? [
                                            "How do you write an efficient SQL query with joins?",
                                            "How do you handle missing values in data analysis?",
                                            "How do you choose visualizations for business stakeholders?",
                                        ]
                                        : [
                                            "How do you design a maintainable software component?",
                                            "How do you handle a production reliability issue?",
                                            "How would you improve test coverage?",
                                        ]),
        ],
        closing: "Is there an important experience we have not discussed?",
    };
    const validationArgs = { progression, previousConversation, jobRole, resumeProfile, resumeText, jobDescription };
    const tryFind = (questions) =>
        (Array.isArray(questions) ? questions : (questions ? [questions] : []))
            .find((q) => validateInterviewQuestion(q, validationArgs).valid);

    const normalizedStage = normalizeStageIdentifier(progression.nextStage);
    const fallback = byStage[progression.nextStage] ?? byStage[normalizedStage];

    if (normalizedStage === "resume") {
        const topicFallbacks = fallback?.[uncoveredTopic] || fallback?.background || [];
        const safeQuestion = tryFind(topicFallbacks);
        if (safeQuestion) return safeQuestion;
        // Graceful cross-stage fallback — do not throw
    } else {
        const candidates = typeof fallback === "string" ? [fallback] : (fallback || []);
        const safeQuestion = tryFind(candidates);
        if (safeQuestion) return safeQuestion;
    }

    // All primary stage fallbacks were rejected (e.g. already asked).
    // Search across other stages for any unasked valid question.
    const crossStagePriority = [
        ...(Array.isArray(byStage.suitability) ? byStage.suitability : []),
        ...(Array.isArray(byStage.future) ? byStage.future : []),
        ...(Array.isArray(byStage.behavioral)
            ? byStage.behavioral
            : isFresher
                ? [
                    "What would you consider your greatest personal strength?",
                    "Can you tell me about a time you worked on a team project?",
                ]
                : [
                    "What is an area of growth you have actively worked to improve?",
                    "How do you handle difficult disagreements with teammates or stakeholders?",
                ]),
        ...(Array.isArray(byStage.motivation)
            ? byStage.motivation
            : [
                "What interests you about this role?",
                "What motivated you to pursue this career path?",
            ]),
        ...(Array.isArray(byStage.role)
            ? byStage.role.slice(0, 3)
            : [
                "How do you approach solving a complex technical problem?",
                "How do you ensure the quality of your work?",
            ]),
        // Absolute last-resort generic questions that pass all structural checks
        "Why should we hire you for this role?",
        "What skills or experience make you a good fit for this role?",
        "What are your primary career goals over the next few years?",
        "What would you consider your greatest personal strength?",
    ];

    // For cross-stage fallback, relax the stage-matching rule by temporarily
    // patching the progression to "role" so no stage check blocks us.
    const relaxedProgression = { ...progression, nextStage: "role" };
    for (const q of crossStagePriority) {
        if (!q) continue;
        const result = validateInterviewQuestion(q, { ...validationArgs, progression: relaxedProgression });
        if (result.valid) return q;
    }

    // Absolute last resort — return a guaranteed-valid generic question.
    return "What skills or experience make you a good fit for this role?";
}

module.exports = {
    getSafeQuestionFallback,
    isNearDuplicateQuestion,
    validateInterviewQuestion,
};
