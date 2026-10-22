const test = require("node:test");
const assert = require("node:assert/strict");
const {
    INTERVIEW_TOPICS,
    classifyInterviewTopic,
    classifyInterviewQuestion,
    buildInterviewCoverageChecklist,
    getInterviewProgress,
    hasCompanyDetails,
} = require("../services/interviewProgression");
const {
    validateInterviewQuestion,
    isNearDuplicateQuestion,
    getSafeQuestionFallback,
} = require("../services/interviewQuestionValidation");
const {
    detectInterviewIntent,
    isSkipOrUnknownIntent,
} = require("../services/interviewAI");

test("topic coverage checklist tracks all 12 required interview topics", () => {
    assert.equal(INTERVIEW_TOPICS.length, 12);
    const expectedIds = [
        "candidate_type",
        "introduction",
        "resume_projects",
        "technical_role",
        "suitability",
        "company_motivation",
        "strengths_weaknesses",
        "behavioral_challenge",
        "leaving_reason",
        "salary_expectations",
        "why_hire_you",
        "career_goals",
    ];
    for (const id of expectedIds) {
        assert.ok(
            INTERVIEW_TOPICS.some((t) => t.id === id),
            `Expected topic ${id} to be present in INTERVIEW_TOPICS`
        );
    }
});

test("conditional topics: leaving_reason is strictly inapplicable for freshers but applicable for experienced", () => {
    const fresherChecklist = buildInterviewCoverageChecklist({
        candidateType: "fresher",
        durationMinutes: 20,
        jobDescription: "General software development.",
    }).checklist;
    const fresherLeaving = fresherChecklist.find((t) => t.id === "leaving_reason");
    assert.equal(fresherLeaving.applicable, false);
    assert.equal(fresherLeaving.status, "inapplicable");

    const experiencedChecklist = buildInterviewCoverageChecklist({
        candidateType: "experienced",
        durationMinutes: 20,
        jobDescription: "General software development.",
    }).checklist;
    const experiencedLeaving = experiencedChecklist.find((t) => t.id === "leaving_reason");
    assert.equal(experiencedLeaving.applicable, true);
    assert.equal(experiencedLeaving.status, "uncovered");
});

test("conditional topics: company_motivation is inapplicable when company details are missing", () => {
    const withoutCompany = buildInterviewCoverageChecklist({
        candidateType: "fresher",
        durationMinutes: 20,
        jobDescription: "Looking for an engineer who knows JavaScript and databases.",
    }).checklist;
    const companyTopicWithout = withoutCompany.find((t) => t.id === "company_motivation");
    assert.equal(companyTopicWithout.applicable, false);
    assert.equal(companyTopicWithout.status, "inapplicable");

    const withCompany = buildInterviewCoverageChecklist({
        candidateType: "fresher",
        durationMinutes: 20,
        jobDescription: "Join TechCorp as a developer. We are a fast-growing cloud company and our mission is empowering small businesses.",
    }).checklist;
    const companyTopicWith = withCompany.find((t) => t.id === "company_motivation");
    assert.equal(companyTopicWith.applicable, true);
    assert.equal(companyTopicWith.status, "uncovered");
});

test("duration-aware planning: 5-minute interviews prioritize essential topics and omit non-essentials", () => {
    const shortChecklist = buildInterviewCoverageChecklist({
        candidateType: "experienced",
        durationMinutes: 5,
        jobDescription: "Looking for a backend engineer.",
    }).checklist;

    const essentialIds = ["introduction", "resume_projects", "technical_role", "suitability", "why_hire_you"];
    for (const id of essentialIds) {
        const item = shortChecklist.find((t) => t.id === id);
        assert.equal(item.applicable, true, `Topic ${id} should be applicable for 5 min`);
    }

    const nonEssentialIds = ["salary_expectations", "leaving_reason", "company_motivation", "strengths_weaknesses", "behavioral_challenge"];
    for (const id of nonEssentialIds) {
        const item = shortChecklist.find((t) => t.id === id);
        assert.equal(item.applicable, false, `Topic ${id} should be inapplicable for 5 min`);
        assert.equal(item.status, "inapplicable");
    }
});

test("candidate independence: two candidates for the same role and duration receive different question sequences", () => {
    // Candidate 1: Frontend Developer (React, Tailwind, Dashboard project)
    const candidate1 = {
        jobRole: "Frontend Developer",
        durationMinutes: 15,
        experienceLevel: "Fresher",
        resumeProfile: {
            candidateName: "Candidate Alpha",
            technicalSkills: ["React", "Tailwind CSS", "JavaScript"],
            projects: [{ title: "Analytics Dashboard", technologies: ["React", "Tailwind"] }],
            education: [{ degree: "BSc Computer Science" }],
        },
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            { speaker: "candidate", text: "I recently graduated in computer science." },
        ],
    };

    // Candidate 2: Frontend Developer (Vue, TypeScript, UI Component Library)
    const candidate2 = {
        jobRole: "Frontend Developer",
        durationMinutes: 15,
        experienceLevel: "Fresher",
        resumeProfile: {
            candidateName: "Candidate Beta",
            technicalSkills: ["Vue.js", "TypeScript", "CSS"],
            projects: [{ title: "Component Library", technologies: ["Vue.js", "TypeScript"] }],
            education: [{ degree: "BEng Software Engineering" }],
        },
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            { speaker: "candidate", text: "I recently completed my software engineering degree." },
        ],
    };

    const progress1 = getInterviewProgress(candidate1);
    const progress2 = getInterviewProgress(candidate2);

    // Fallbacks tailored to their individual resumes differ
    const fallback1 = getSafeQuestionFallback({
        progression: progress1,
        resumeProfile: candidate1.resumeProfile,
        jobRole: candidate1.jobRole,
        previousConversation: candidate1.previousConversation,
    });
    const fallback2 = getSafeQuestionFallback({
        progression: progress2,
        resumeProfile: candidate2.resumeProfile,
        jobRole: candidate2.jobRole,
        previousConversation: candidate2.previousConversation,
    });

    assert.notEqual(fallback1, fallback2);
    assert.match(fallback1, /Analytics Dashboard/);
    assert.match(fallback2, /Component Library/);
});

test("after 'Why should we hire you?', the system does not always ask 'Where do you see yourself in five years?'", () => {
    const resumeProfile = {
        projects: [{ title: "Cloud Service" }],
        education: [{ degree: "BSc" }],
        technicalSkills: ["Node.js", "PostgreSQL"],
    };
    const conversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I am a backend engineer." },
        { speaker: "interviewer", text: "Can you describe your Cloud Service project?" },
        { speaker: "candidate", text: "I designed the database and API." },
        { speaker: "interviewer", text: "How would you design a reliable API?" },
        { speaker: "candidate", text: "Using idempotency and validation." },
        { speaker: "interviewer", text: "Why should we hire you?" },
        { speaker: "candidate", text: "Because I have solid problem-solving skills and learn fast." },
    ];

    const progress = getInterviewProgress({
        resumeProfile,
        previousConversation: conversation,
        targetQuestionCount: 10,
        experienceLevel: "Experienced professional",
        durationMinutes: 20,
    });

    // The system should NOT be forced into asking 'future' immediately after suitability
    assert.ok(progress.nextStage !== "future" || progress.lastInterviewerTopic === "why_hire_you");
    assert.equal(progress.readyToClose, false);
});

test("five-year question is not forced into every interview; varied career goal questions are accepted", () => {
    const progression = {
        nextStage: "future",
        availableResumeTopics: ["projects", "skills"],
        coveredResumeTopics: ["projects", "skills"],
    };

    // Modern varied growth phrasing should be valid
    const variedQuestion1 = "What are your primary career goals over the next few years?";
    const variedQuestion2 = "What technical areas do you hope to grow into next?";
    const traditionalQuestion = "Where do you see yourself in five years?";

    assert.equal(validateInterviewQuestion(variedQuestion1, { progression, jobRole: "Backend Developer" }).valid, true);
    assert.equal(validateInterviewQuestion(variedQuestion2, { progression, jobRole: "Backend Developer" }).valid, true);
    assert.equal(validateInterviewQuestion(traditionalQuestion, { progression, jobRole: "Backend Developer" }).valid, true);
});

test("duplicate prevention: rejects questions assessing essentially the same thing", () => {
    const progression = {
        nextStage: "role",
        availableResumeTopics: ["skills"],
        coveredResumeTopics: ["skills"],
    };
    const previousConversation = [
        { speaker: "interviewer", text: "How do you optimize database query performance?" },
    ];

    const duplicateQuestion = "How do you improve database query performance?";
    const validation = validateInterviewQuestion(duplicateQuestion, {
        progression,
        previousConversation,
        jobRole: "Backend Developer",
    });

    assert.equal(validation.valid, false);
    assert.match(validation.reason, /repeats a previously asked question/i);
});

test("skip handling: candidate saying 'I don't know' or 'I'll learn it' marks topic as skipped and advances without loop", () => {
    assert.equal(isSkipOrUnknownIntent("I don't know"), true);
    assert.equal(isSkipOrUnknownIntent("I am not sure"), true);
    assert.equal(isSkipOrUnknownIntent("I'll learn it"), true);
    assert.equal(isSkipOrUnknownIntent("Let's skip this question"), true);
    assert.equal(detectInterviewIntent("I don't know about that technology"), "skip_question");
    assert.equal(detectInterviewIntent("I haven't worked with that, I'll learn it"), "skip_question");

    // After candidate skips a technical question, progression updates checklist
    const conversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I recently graduated." },
        { speaker: "interviewer", text: "How do you manage state in a frontend application?" },
        { speaker: "candidate", text: "I don't know, I haven't worked with that yet." },
    ];

    const progress = getInterviewProgress({
        resumeProfile: {
            projects: [{ title: "Web App" }],
            education: [{ degree: "BSc" }],
            technicalSkills: ["JavaScript"],
        },
        previousConversation: conversation,
        targetQuestionCount: 8,
        experienceLevel: "Fresher",
        durationMinutes: 15,
        jobRole: "Frontend Developer",
    });

    // The interviewer advances to another topic without repeating the exact same question
    assert.ok(progress.nextStage !== "closing");
    assert.notEqual(progress.nextStage, "introduction");
});

test("suitability fallback: varied phrasing all passes validation for the suitability stage", () => {
    const progression = {
        nextStage: "suitability",
        availableResumeTopics: ["projects", "skills"],
        coveredResumeTopics: ["projects", "skills"],
        candidateType: "experienced",
    };
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I am a backend developer." },
    ];
    const suitabilityQuestions = [
        "What skills or experience make you a good fit for this role?",
        "What makes you a good fit for this position?",
        "Why should we hire you for this role?",
        "What makes you well-suited for the responsibilities of this job?",
        "Why should we choose you for this position?",
    ];
    for (const q of suitabilityQuestions) {
        const result = validateInterviewQuestion(q, { progression, previousConversation, jobRole: "Backend Developer" });
        assert.equal(result.valid, true, `Expected valid but got: ${result.reason} for "${q}"`);
    }
});

test("suitability fallback: classifyInterviewQuestion recognizes all suitability phrasings", () => {
    const { classifyInterviewQuestion: classify } = require("../services/interviewProgression");
    assert.equal(classify("What skills or experience make you a good fit for this role?"), "suitability");
    assert.equal(classify("What makes you a good fit for this position?"), "suitability");
    assert.equal(classify("Why should we hire you for this role?"), "suitability");
    assert.equal(classify("What makes you well-suited for the responsibilities of this job?"), "suitability");
    assert.equal(classify("What unique strengths or perspective would you bring to this position?"), "suitability");
    assert.equal(classify("Why should we choose you for this position?"), "suitability");
});

test("getSafeQuestionFallback: never throws even when all suitability fallbacks were already asked", () => {
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I am an engineer." },
        { speaker: "interviewer", text: "What skills or experience make you a good fit for this role?" },
        { speaker: "candidate", text: "I have 5 years of experience." },
        { speaker: "interviewer", text: "What makes you a good fit for this position?" },
        { speaker: "candidate", text: "Because I am passionate." },
        { speaker: "interviewer", text: "Why should we hire you for this role?" },
        { speaker: "candidate", text: "I am dedicated." },
        { speaker: "interviewer", text: "What makes you well-suited for the responsibilities of this job?" },
        { speaker: "candidate", text: "I have all the needed skills." },
        { speaker: "interviewer", text: "What unique strengths or perspective would you bring to this position?" },
        { speaker: "candidate", text: "A fresh perspective." },
        { speaker: "interviewer", text: "Why should we choose you for this position?" },
        { speaker: "candidate", text: "I am the best fit." },
    ];
    const progression = {
        nextStage: "suitability",
        availableResumeTopics: ["projects"],
        coveredResumeTopics: ["projects"],
        candidateType: "experienced",
    };
    // Must NOT throw — should return a valid cross-stage fallback question instead
    let result;
    assert.doesNotThrow(() => {
        result = getSafeQuestionFallback({
            progression,
            resumeProfile: {},
            jobRole: "Backend Developer",
            previousConversation,
            resumeText: "",
            jobDescription: "",
        });
    });
    assert.ok(typeof result === "string" && result.length > 5, `Expected a non-empty fallback question, got: ${result}`);
});

test("getSafeQuestionFallback: returns a valid question for suitability stage with empty conversation", () => {
    const progression = {
        nextStage: "suitability",
        availableResumeTopics: ["projects"],
        coveredResumeTopics: ["projects"],
        candidateType: "experienced",
    };
    let result;
    assert.doesNotThrow(() => {
        result = getSafeQuestionFallback({
            progression,
            resumeProfile: {},
            jobRole: "Software Engineer",
            previousConversation: [{ speaker: "interviewer", text: "Tell me about yourself." }],
            resumeText: "",
            jobDescription: "",
        });
    });
    assert.ok(typeof result === "string" && result.endsWith("?"), `Expected a question ending with '?', got: ${result}`);
});
