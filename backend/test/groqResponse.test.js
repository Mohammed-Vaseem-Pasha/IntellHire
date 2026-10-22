const test = require("node:test");
const assert = require("node:assert/strict");
const {
    OPENING_QUESTION,
    buildInterviewQuestionPrompt,
    generateValidatedInterviewQuestion,
    generateInterviewQuestion,
    requestAssistantContent,
    shouldCompleteInterview,
    detectInterviewIntent,
    deduplicateResponseSentences,
    buildAnswerReply,
} = require("../services/interviewAI");
const {
    getInterviewProgress,
    getSubstantiveQuestionCount,
} = require("../services/interviewProgression");
const { getActiveQuestionIndex } = require("../services/interviewQuestionIndex");
const {
    validateInterviewQuestion,
} = require("../services/interviewQuestionValidation");

function responseWithContent(content) {
    return { choices: [{ message: { content } }] };
}

test("retries an empty Groq response and returns the valid next response", async () => {
    let calls = 0;
    const content = await requestAssistantContent(
        async () => {
            calls += 1;
            return responseWithContent(calls === 1 ? "" : "Tell me about your background.");
        },
        (value) => value.length > 0,
        "Interview question generation"
    );

    assert.equal(content, "Tell me about your background.");
    assert.equal(calls, 2);
});

test("fails with a clear diagnostic after two empty Groq responses", async () => {
    let calls = 0;
    await assert.rejects(
        requestAssistantContent(
            async () => {
                calls += 1;
                return responseWithContent("  ");
            },
            (value) => value.length > 0,
            "Interview question generation"
        ),
        /returned empty response content after 2 attempts/
    );
    assert.equal(calls, 2);
});

test("retries missing and malformed Groq message content", async () => {
    let calls = 0;
    const content = await requestAssistantContent(
        async () => {
            calls += 1;
            return calls === 1
                ? { choices: [{ message: { content: null } }] }
                : { choices: [{ message: { content: "What did you learn from your project?" } }] };
        },
        (value) => value.length > 0,
        "Interview question generation"
    );

    assert.equal(content, "What did you learn from your project?");
    assert.equal(calls, 2);
});

test("deduplicates repeated project question with minor wording differences", () => {
    assert.equal(
        deduplicateResponseSentences(
            "Could you describe your project on plant growth and yield prediction? Could you describe your project plant growth and yield prediction?"
        ),
        "Could you describe your project on plant growth and yield prediction?"
    );
});

test("deduplicates a repeated opening question", () => {
    assert.equal(
        deduplicateResponseSentences("Tell me about yourself. Tell me about yourself."),
        "Tell me about yourself."
    );
});

test("keeps candidate feedback when it is followed by a different question", () => {
    const feedback = "Your project explanation clearly described the model and its impact.";
    const question = "How did you evaluate the model's performance?";
    assert.equal(
        buildAnswerReply({
            answer: "I built a project.",
            evaluationFeedback: feedback,
            nextQuestion: question,
        }),
        feedback
    );
    assert.equal(
        deduplicateResponseSentences(`${feedback} ${question}`),
        `${feedback} ${question}`
    );
});

test("does not return feedback that repeats the next question", () => {
    assert.equal(
        buildAnswerReply({
            answer: "",
            evaluationFeedback: "Tell me about yourself.",
            nextQuestion: "Tell me about yourself.",
        }),
        ""
    );
});

test("retries malformed structured Groq output", async () => {
    let calls = 0;
    const content = await requestAssistantContent(
        async () => {
            calls += 1;
            return responseWithContent(calls === 1 ? "{broken json" : '{"technicalSkills":["Python"]}');
        },
        (value) => {
            try {
                return !Array.isArray(JSON.parse(value));
            } catch {
                return false;
            }
        },
        "Resume profile extraction"
    );

    assert.equal(content, '{"technicalSkills":["Python"]}');
    assert.equal(calls, 2);
});

test("follow-up prompt is grounded in the latest answer and all interview context", () => {
    const prompt = buildInterviewQuestionPrompt({
        resumeText: "Built a brain tumor classifier using Vision Transformers.",
        resumeProfile: { projects: [{ title: "Brain tumor classifier" }] },
        jobRole: "AI/ML Engineer",
        jobDescription: "Evaluate and deploy machine-learning models.",
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            { speaker: "candidate", text: "I recently graduated and enjoy machine learning." },
            { speaker: "interviewer", text: "Tell me about a project you developed." },
            {
                speaker: "candidate",
                text: "I developed a brain tumor classifier using Vision Transformers.",
            },
        ],
    });

    assert.match(prompt, /AI\/ML Engineer/);
    assert.match(prompt, /Evaluate and deploy machine-learning models/);
    assert.match(prompt, /Brain tumor classifier/);
    assert.match(prompt, /I developed a brain tumor classifier using Vision Transformers/);
    assert.match(prompt, /avoid repeated questions/);
    assert.match(prompt, /Return only one short question/);
});

test("first interview question is exact and independent of candidate and role context", async () => {
    assert.equal(OPENING_QUESTION, "Tell me about yourself.");
    assert.equal(await generateInterviewQuestion({
        jobRole: "Software Engineer",
        jobDescription: "Seeking a software engineer interested in distributed systems.",
        resumeProfile: {
            candidateName: "Mohammed",
            interests: ["distributed systems"],
            experience: [{ role: "Software Engineer", summary: "Built APIs." }],
        },
        previousConversation: [],
    }), "Tell me about yourself.");
});

function roleStageConversation(jobRole = "AI/ML Engineer") {
    const resumeProfile = {
        projects: [{ title: "Brain tumor classifier", technologies: ["Vision Transformers"] }],
        education: [{ degree: "BSc Data Science" }],
        technicalSkills: ["Python", "PyTorch"],
    };
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I recently graduated in data science." },
        { speaker: "interviewer", text: "Can you describe your Brain tumor classifier project?" },
        { speaker: "candidate", text: "I built a brain tumor classification model using Vision Transformers." },
        { speaker: "interviewer", text: "What did you study in your degree?" },
        { speaker: "candidate", text: "Data science and statistics." },
        { speaker: "interviewer", text: "Which technical skills have you used?" },
        { speaker: "candidate", text: "Python and PyTorch." },
    ];
    return { resumeProfile, previousConversation, jobRole };
}

test("question validation accepts one AI/ML topic and rejects combined requests", () => {
    const context = roleStageConversation();
    const progression = getInterviewProgress(context);
    assert.equal(progression.nextStage, "role");
    assert.equal(
        validateInterviewQuestion("Why did you choose Vision Transformers?", { ...context, progression }).valid,
        true,
    );
    assert.equal(
        validateInterviewQuestion(
            "Why did you choose Vision Transformers, and how did you evaluate the model?",
            { ...context, progression },
        ).valid,
        false,
    );
    assert.equal(
        validateInterviewQuestion(
            "Could you introduce yourself, focusing on how your experience relates to this role?",
            { ...context, progression },
        ).valid,
        false,
    );
    assert.equal(
        validateInterviewQuestion(
            "Explain your main project and describe the challenges you faced.",
            { ...context, progression },
        ).valid,
        false,
    );
    assert.equal(
        validateInterviewQuestion(
            "Good morning, Mohammed. Could you describe your background?",
            { ...context, progression },
        ).valid,
        false,
    );
    assert.equal(
        validateInterviewQuestion("What is your favorite movie?", {
            progression,
            previousConversation: [],
            jobRole: "AI/ML Engineer",
            resumeProfile: context.resumeProfile,
        }).valid,
        false,
    );
    assert.equal(
        validateInterviewQuestion("Can you explain your main project?", {
            progression: { ...progression, nextStage: "resume", availableResumeTopics: ["projects"], coveredResumeTopics: [] },
            previousConversation: [],
            jobRole: "AI/ML Engineer",
        }).valid,
        true,
    );
    assert.equal(validateInterviewQuestion("How do HTML and CSS work together?", {
        progression,
        previousConversation: [],
        jobRole: "Frontend Developer",
    }).valid, true);
});

test("question generation retries an invalid combined question before returning it", async () => {
    const context = roleStageConversation();
    const responses = [
        "Why did you choose Vision Transformers, and how did you evaluate the model?",
        "Why did you choose Vision Transformers?",
    ];
    const prompts = [];
    const question = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async (prompt) => {
            prompts.push(prompt);
            return responses.shift();
        },
    });
    assert.equal(question, "Why did you choose Vision Transformers?");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /previous draft was rejected/i);
});

test("question generation cleans repeated sentences before validation and return", async () => {
    const context = roleStageConversation();
    const question = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async () =>
            "How did you evaluate model performance? How did you evaluate the model performance?",
    });
    assert.equal(question, "How did you evaluate model performance?");
});

test("question generation uses a validated stage fallback after bounded invalid drafts", async () => {
    const context = roleStageConversation("AI/ML Engineer");
    let calls = 0;
    const question = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async () => {
            calls += 1;
            return "Good morning. Could you introduce yourself and discuss your experience?";
        },
    });
    assert.equal(calls, 2);
    assert.equal(question, "How would you evaluate a machine-learning model?");
});

test("question generation uses a validated stage fallback after empty model output", async () => {
    const context = roleStageConversation("AI/ML Engineer");
    let calls = 0;
    const question = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async () => {
            calls += 1;
            throw new Error("Interview question generation returned empty response content after 2 attempts.");
        },
    });

    assert.equal(calls, 1);
    assert.equal(question, "How would you evaluate a machine-learning model?");
    assert.equal(validateInterviewQuestion(question, {
        progression: getInterviewProgress(context),
        previousConversation: context.previousConversation,
        jobRole: context.jobRole,
    }).valid, true);
});

test("rephrased project challenge questions are recognized as duplicates", () => {
    const progression = {
        nextStage: "role",
        availableResumeTopics: ["projects", "education", "skills"],
        coveredResumeTopics: ["projects", "education", "skills"],
    };
    const previousConversation = [
        { speaker: "interviewer", text: "What was your biggest project challenge?" },
    ];
    const result = validateInterviewQuestion(
        "What was the main challenge you faced in your project?",
        { progression, previousConversation, jobRole: "Software Engineer" },
    );
    assert.equal(result.valid, false);
    assert.match(result.reason, /repeats a previously asked question/);
});

test("role-specific questions differ for AI/ML and backend roles", async () => {
    const aiMl = roleStageConversation("AI/ML Engineer");
    const backend = {
        jobRole: "Backend Developer",
        resumeProfile: {
            projects: [{ title: "Order API", technologies: ["Node.js", "PostgreSQL"] }],
            education: [{ degree: "BSc Information Technology" }],
            technicalSkills: ["Node.js", "PostgreSQL"],
        },
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            { speaker: "candidate", text: "I recently graduated in information technology." },
            { speaker: "interviewer", text: "Can you describe your Order API project?" },
            { speaker: "candidate", text: "I built an order service." },
            { speaker: "interviewer", text: "What did you study in your degree?" },
            { speaker: "candidate", text: "Information technology." },
            { speaker: "interviewer", text: "Which technical skills have you used?" },
            { speaker: "candidate", text: "Node.js and PostgreSQL." },
        ],
    };
    const aiQuestion = await generateValidatedInterviewQuestion({
        ...aiMl,
        generateCandidateQuestion: async () => "How did you evaluate the classifier?",
    });
    const backendQuestion = await generateValidatedInterviewQuestion({
        ...backend,
        generateCandidateQuestion: async () => "How would you secure the Order API?",
    });
    assert.match(aiQuestion, /classifier/);
    assert.match(backendQuestion, /Order API/);
    assert.notEqual(aiQuestion, backendQuestion);
});

test("multi-turn progression derives the current stage without returning to introduction", async () => {
    const context = roleStageConversation();
    assert.equal(
        getInterviewProgress(context).nextStage,
        "role",
    );
    let prompt = "";
    const nextQuestion = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async (value) => {
            prompt = value;
            return "How did you evaluate the classifier?";
        },
    });
    assert.equal(nextQuestion, "How did you evaluate the classifier?");
    assert.match(prompt, /Required next stage:\s*role/);
    assert.doesNotMatch(nextQuestion, /Tell me about yourself|why should we hire/i);
});

test("candidate answers can cover motivation and future-goal stages", () => {
    const resumeProfile = {
        projects: [{ title: "Campus planner" }],
        education: [{ degree: "BSc Computer Science" }],
        technicalSkills: ["JavaScript"],
    };
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I graduated in computer science, built a campus planner, and used JavaScript." },
        { speaker: "interviewer", text: "What did you study in your degree?" },
        { speaker: "candidate", text: "I am interested in this role because it fits my career goal." },
        { speaker: "interviewer", text: "How would you test this software design?" },
        { speaker: "interviewer", text: "How would you debug this system?" },
        { speaker: "candidate", text: "In five years, I see myself leading a software team." },
    ];
    assert.equal(getInterviewProgress({ resumeProfile, previousConversation }).nextStage, "suitability");
});

test("fresher resume is explored before role questions and closing stages", () => {
    const resumeProfile = {
        projects: [{ title: "Campus planner" }],
        education: [{ degree: "BSc Computer Science" }],
        technicalSkills: ["JavaScript", "React"],
    };
    const introduction = [{ speaker: "interviewer", text: "Tell me about yourself." }];
    assert.equal(getInterviewProgress({ resumeProfile, previousConversation: introduction }).nextStage, "resume");

    const explored = [
        ...introduction,
        { speaker: "candidate", text: "I am a recent computer science graduate." },
        { speaker: "interviewer", text: "Can you explain your campus planner project?" },
        { speaker: "candidate", text: "I built it as my final year project." },
        { speaker: "interviewer", text: "What did you study in your degree?" },
        { speaker: "candidate", text: "I studied computer science." },
        { speaker: "interviewer", text: "Which technical skills have you used?" },
        { speaker: "candidate", text: "JavaScript and React." },
    ];
    assert.equal(getInterviewProgress({ resumeProfile, previousConversation: explored }).nextStage, "role");
});

test("topics disclosed clearly during introduction are not needlessly re-asked", () => {
    const progress = getInterviewProgress({
        resumeProfile: {
            projects: [{ title: "Campus planner", technologies: ["React"] }],
            education: [{ degree: "BSc Computer Science" }],
            technicalSkills: ["React", "JavaScript"],
        },
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            {
                speaker: "candidate",
                text: "I graduated in computer science and built the Campus planner with React.",
            },
        ],
    });

    assert.deepEqual(
        progress.coveredResumeTopics.sort(),
        ["education", "projects", "skills"],
    );
    assert.equal(progress.nextStage, "role");
});

test("experienced candidate progression explores employment history and does not close early", () => {
    const resumeProfile = {
        experience: [{ role: "Backend Engineer", company: "Example Corp" }],
        projects: [{ title: "Billing API" }],
        education: [{ degree: "BEng" }],
        technicalSkills: ["Node.js", "PostgreSQL"],
    };
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "candidate", text: "I have five years in backend roles." },
        { speaker: "interviewer", text: "What were your responsibilities at Example Corp?" },
        { speaker: "candidate", text: "I owned a billing service." },
        { speaker: "interviewer", text: "Tell me about the billing API project." },
        { speaker: "candidate", text: "I built the API in Node.js." },
        { speaker: "interviewer", text: "What did you study in your degree?" },
        { speaker: "candidate", text: "Computer engineering." },
    ];
    const progress = getInterviewProgress({ resumeProfile, previousConversation });
    assert.equal(progress.candidateType, "experienced");
    assert.equal(progress.nextStage, "role");
    assert.equal(progress.readyToClose, false);
});

test("role questions are tailored to selected role and resume evidence", () => {
    const previousConversation = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "interviewer", text: "Can you explain your machine learning project?" },
        { speaker: "interviewer", text: "What did you study at university?" },
        { speaker: "interviewer", text: "Which technical skills have you used?" },
    ];
    const aiPrompt = buildInterviewQuestionPrompt({
        resumeProfile: {
            projects: [{ title: "Image classifier", technologies: ["Python", "PyTorch"] }],
            education: [{ degree: "BSc Computer Science" }],
            technicalSkills: ["Python", "PyTorch"],
        },
        jobRole: "AI/ML Engineer",
        jobDescription: "Evaluate and deploy machine-learning models.",
        previousConversation,
    });
    assert.match(aiPrompt, /model choice, data preprocessing, evaluation metrics, overfitting, and deployment constraints/i);
    assert.match(aiPrompt, /Required next stage:\s*role/);
    assert.match(aiPrompt, /Role questions already asked:\s*0\/2/);
    assert.match(aiPrompt, /5-15 words/);

    const backendPrompt = buildInterviewQuestionPrompt({
        resumeProfile: { projects: [{ title: "API" }], education: [{ degree: "BSc" }], technicalSkills: ["Node.js"] },
        jobRole: "Backend Developer",
        previousConversation,
    });
    assert.match(backendPrompt, /API design, data modeling, database trade-offs, authentication, and server-side testing/i);
    assert.doesNotMatch(backendPrompt, /React components\/state/);
});

test("career, suitability, and behavioral questions follow role assessment adaptively", () => {
    const resumeProfile = {
        projects: [{ title: "App" }],
        education: [{ degree: "BSc" }],
        technicalSkills: ["JavaScript"],
    };
    const prior = [
        { speaker: "interviewer", text: "Tell me about yourself." },
        { speaker: "interviewer", text: "Tell me about your project." },
        { speaker: "interviewer", text: "What did you study in your degree?" },
        { speaker: "interviewer", text: "Which technical skills have you used?" },
        { speaker: "interviewer", text: "How would you test this software design?" },
        { speaker: "interviewer", text: "How would you improve maintainability?" },
    ];
    const initialProgress = getInterviewProgress({ resumeProfile, previousConversation: prior });
    assert.equal(initialProgress.readyToClose, false);
    assert.ok(["behavioral", "motivation", "suitability", "future"].includes(initialProgress.nextStage));

    prior.push({ speaker: "interviewer", text: "Can you tell me about a time you worked on a team project?" });
    prior.push({ speaker: "interviewer", text: "Why are you interested in this role?" });
    prior.push({ speaker: "interviewer", text: "Why should we hire you?" });
    prior.push({ speaker: "interviewer", text: "Where do you see your career heading over the next few years?" });
    const progress = getInterviewProgress({ resumeProfile, previousConversation: prior });
    assert.equal(progress.nextStage, "closing");
    assert.equal(progress.readyToClose, true);
});

test("adaptive completion is gated until required progression stages are explored", async () => {
    const completed = await shouldCompleteInterview({
        resumeProfile: {
            projects: [{ title: "Project" }],
            education: [{ degree: "BSc" }],
            technicalSkills: ["Python"],
        },
        jobRole: "Software Engineer",
        minimumAssessmentTurns: 1,
        previousConversation: [
            { speaker: "interviewer", text: "Tell me about yourself." },
            { speaker: "candidate", text: "I am a recent graduate." },
        ],
    });
    assert.equal(completed, false);
});

function plannedInterviewConversation(questionCount) {
    const questions = [
        "Tell me about yourself.",
        "Can you describe a project from your resume?",
        "What did you study in your degree?",
        "Which technical skills have you used?",
        "How would you test this software design?",
        "How would you debug an unfamiliar codebase?",
        "Why are you interested in this role?",
        "Why should we hire you?",
        "Where do you see yourself in five years?",
        "How do you design a maintainable software component?",
        "How do you handle a production reliability issue?",
        "How would you improve test coverage?",
    ];
    return questions.slice(0, questionCount).flatMap((question, index) => [
        { speaker: "interviewer", text: question, questionIndex: index },
        {
            speaker: "candidate",
            text: "I broke the problem down, tested my approach, and documented what I learned.",
            questionIndex: index,
            submissionId: `answer-${index}`,
        },
    ]);
}

test("completion remains false after each of the first nine planned questions", async () => {
    const resumeProfile = {
        projects: [{ title: "Portfolio application" }],
        education: [{ degree: "BSc Computer Science" }],
        technicalSkills: ["JavaScript", "React"],
    };
    for (let count = 1; count <= 9; count += 1) {
        assert.equal(
            await shouldCompleteInterview({
                resumeProfile,
                jobRole: "Software Engineer",
                previousConversation: plannedInterviewConversation(count),
                targetQuestionCount: 10,
            }),
            false,
            `Interview should remain active after question ${count}`
        );
    }
});

test("interview completes only after its configured target and final stage", async () => {
    const completed = await shouldCompleteInterview({
        resumeProfile: {
            projects: [{ title: "Portfolio application" }],
            education: [{ degree: "BSc Computer Science" }],
            technicalSkills: ["JavaScript", "React"],
        },
        jobRole: "Software Engineer",
        previousConversation: plannedInterviewConversation(10),
        targetQuestionCount: 10,
    });
    assert.equal(completed, true);
});

test("a longer configured plan stays active through question eleven", async () => {
    const context = {
        resumeProfile: {
            projects: [{ title: "Portfolio application" }],
            education: [{ degree: "BSc Computer Science" }],
            technicalSkills: ["JavaScript", "React"],
        },
        jobRole: "Software Engineer",
    };
    assert.equal(await shouldCompleteInterview({
        ...context,
        previousConversation: plannedInterviewConversation(11),
        targetQuestionCount: 12,
    }), false);
    assert.equal(await shouldCompleteInterview({
        ...context,
        previousConversation: plannedInterviewConversation(12),
        targetQuestionCount: 12,
    }), true);
});

test("conversation replies, conclusion prompts, and candidate requests are not substantive questions", () => {
    const conversation = [
        { speaker: "interviewer", text: "Tell me about yourself?" },
        { speaker: "interviewer", interactionType: "response", text: "Thanks for sharing. Would you like to continue?" },
        { speaker: "candidate", text: "What technologies does your team use?" },
        { speaker: "interviewer", text: "Would you like to conclude the interview?" },
    ];
    assert.equal(getSubstantiveQuestionCount(conversation), 1);
});

test("a candidate question preserves the active question index and does not count as an answer", async () => {
    const session = {
        currentQuestionIndex: 4,
        conversation: [{
            speaker: "interviewer",
            text: "How did you design the service?",
            questionIndex: 4,
        }],
        candidateRequests: [],
    };
    assert.equal(
        detectInterviewIntent("What technologies does your team use?", session.conversation[0].text),
        "candidate_question"
    );
    const beforeCount = getSubstantiveQuestionCount(session.conversation);
    session.candidateRequests.push({
        intent: "candidate_question",
        text: "What technologies does your team use?",
        questionIndex: session.currentQuestionIndex,
    });
    assert.equal(getActiveQuestionIndex(session), 4);
    assert.equal(getSubstantiveQuestionCount(session.conversation), beforeCount);
    assert.equal(await shouldCompleteInterview({
        previousConversation: session.conversation,
        targetQuestionCount: 10,
    }), false);
});

test("candidate intent detection separates continue, finish, questions, and ordinary answers", () => {
    assert.equal(
        detectInterviewIntent("No, I want to continue.", "Would you like to conclude the interview?"),
        "continue"
    );
    assert.equal(
        detectInterviewIntent("What technologies does your team use?", "Tell me about yourself?"),
        "candidate_question"
    );
    assert.equal(
        detectInterviewIntent("I want to finish the interview.", "Tell me about yourself?"),
        "finish"
    );
    assert.equal(
        detectInterviewIntent("Yes, I'm done.", "Would you like to conclude the interview?"),
        "finish"
    );
    assert.equal(
        detectInterviewIntent("What happens next?", "Would you like to conclude the interview?"),
        "candidate_question"
    );
    assert.equal(
        detectInterviewIntent("I finished the project last month.", "Tell me about yourself?"),
        "answer"
    );
});

test("temporary question generation failure uses a fallback and does not complete the interview", async () => {
    const context = {
        resumeProfile: {
            projects: [{ title: "Portfolio application" }],
            education: [{ degree: "BSc Computer Science" }],
            technicalSkills: ["JavaScript", "React"],
        },
        jobRole: "Software Engineer",
        previousConversation: plannedInterviewConversation(9),
    };
    const completed = await shouldCompleteInterview({
        ...context,
        targetQuestionCount: 10,
    });
    assert.equal(completed, false);
    const fallbackQuestion = await generateValidatedInterviewQuestion({
        ...context,
        generateCandidateQuestion: async () => {
            throw new Error("Groq is temporarily unavailable.");
        },
    });
    assert.match(fallbackQuestion, /\?$/);
    assert.equal(await shouldCompleteInterview({
        ...context,
        targetQuestionCount: 10,
    }), false);
});

test("opening prompt and stage plan do not expose upcoming questions", () => {
    const prompt = buildInterviewQuestionPrompt({
        jobRole: "Software Engineer",
        previousConversation: [],
    });

    assert.match(prompt, /Ask exactly: Tell me about yourself\./);
    assert.match(prompt, /never reveal the plan/i);
});
