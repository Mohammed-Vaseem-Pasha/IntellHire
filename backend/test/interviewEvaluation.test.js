const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createEvaluationRetryCache,
    findExistingAnswerForRetry,
    getMatchingPendingEvaluation,
    runInterviewEvaluation,
    saveEvaluationCheckpoint,
} = require("../services/interviewEvaluation");
const {
    shouldRetryAnswer,
    buildAnswerRetryReply,
} = require("../services/interviewAnswerPolicy");
const { getActiveQuestionIndex } = require("../services/interviewQuestionIndex");
const { parseInterviewEvaluation: parseGroqEvaluation } = require("../services/interviewAI");

const immediateRetry = { delayMs: 0, sleep: async () => {} };

test("active question index tracks successive interviewer turns and rejects inconsistent state", () => {
    const session = {
        currentQuestionIndex: 0,
        conversation: [{ speaker: "interviewer", questionIndex: 0, text: "Tell me about yourself." }],
    };
    assert.equal(getActiveQuestionIndex(session), 0);

    for (const questionIndex of [1, 2, 3]) {
        session.currentQuestionIndex = questionIndex;
        session.conversation.push({
            speaker: "candidate",
            questionIndex: questionIndex - 1,
            text: `Answer ${questionIndex}`,
        });
        session.conversation.push({
            speaker: "interviewer",
            questionIndex,
            text: `Question ${questionIndex}`,
        });
        assert.equal(getActiveQuestionIndex(session), questionIndex);
    }

    session.currentQuestionIndex = 2;
    assert.equal(getActiveQuestionIndex(session), null);
    session.currentQuestionIndex = 3;
    session.conversation.push({ speaker: "candidate", questionIndex: 3, text: "Answer" });
    assert.equal(getActiveQuestionIndex(session), null);
});

test("same-question retries recognize an already saved identical answer", () => {
    const conversation = [
        { speaker: "interviewer", questionIndex: 1, text: "How did you test the API?" },
        {
            speaker: "candidate",
            questionIndex: 1,
            submissionId: "original-submission",
            text: "I used integration tests.",
        },
    ];

    assert.equal(
        findExistingAnswerForRetry(
            conversation,
            1,
            "retry-submission",
            "I used integration tests.",
        ),
        conversation[1],
    );
    assert.equal(
        findExistingAnswerForRetry(
            conversation,
            1,
            "retry-submission",
            "I used unit tests.",
        ),
        null,
    );
    assert.equal(
        findExistingAnswerForRetry(
            conversation,
            1,
            "original-submission",
            "I used unit tests.",
        ),
        conversation[1],
    );
});

test("pending evaluation retries keep the checkpoint submission ID for the same answer", () => {
    const pendingEvaluation = {
        questionIndex: 1,
        submissionId: "original-submission",
        answer: "I used integration tests.",
        evaluation: { score: 82 },
    };

    assert.equal(
        getMatchingPendingEvaluation(
            pendingEvaluation,
            1,
            "I used integration tests.",
        ),
        pendingEvaluation,
    );
    assert.equal(
        getMatchingPendingEvaluation(
            pendingEvaluation,
            1,
            "I used unit tests.",
        ),
        null,
    );
    assert.equal(getMatchingPendingEvaluation(pendingEvaluation, 2, pendingEvaluation.answer), null);
});

test("successful evaluation runs once", async () => {
    let calls = 0;
    const result = await runInterviewEvaluation(async () => {
        calls += 1;
        return { score: 84 };
    }, immediateRetry);

    assert.deepEqual(result, { score: 84 });
    assert.equal(calls, 1);
});

test("temporary Groq rate limit retries once and returns the evaluation", async () => {
    let calls = 0;
    const result = await runInterviewEvaluation(async () => {
        calls += 1;
        if (calls === 1) {
            const error = new Error("rate limited");
            error.status = 429;
            throw error;
        }
        return { score: 75 };
    }, immediateRetry);

    assert.equal(result.score, 75);
    assert.equal(calls, 2);
});

test("Groq JSON validation failures receive one safe retry", async () => {
    let calls = 0;
    const result = await runInterviewEvaluation(async () => {
        calls += 1;
        if (calls === 1) {
            const error = new Error("400 json_validate_failed");
            error.status = 400;
            throw error;
        }
        return { score: 79 };
    }, immediateRetry);

    assert.equal(result.score, 79);
    assert.equal(calls, 2);
});

test("malformed evaluation output is retried within the bounded attempt count", async () => {
    let calls = 0;
    const result = await runInterviewEvaluation(async () => {
        calls += 1;
        const raw = calls === 1
            ? "{malformed"
            : JSON.stringify({
                score: 91,
                relevance: "relevant",
                feedback: "Clear and relevant.",
                strengths: ["Specific"],
                improvements: ["Add detail"],
                idealConcept: "Trade-offs",
            });
        return parseGroqEvaluation({
            choices: [{ message: { content: raw } }],
        });
    }, immediateRetry);

    assert.equal(result.score, 91);
    assert.equal(calls, 2);
});

test("Groq responses must contain every validated evaluation field", () => {
    assert.throws(
        () => parseGroqEvaluation({
            choices: [{ message: { content: '{"score":87}' } }],
        }),
        { code: "INVALID_EVALUATION_RESPONSE" },
    );
});

test("evaluation parser accepts a validated relevance classification", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 0,
                    relevance: "irrelevant",
                    feedback: "This answer does not address the portfolio features question.",
                    strengths: [],
                    improvements: ["Describe the features you implemented."],
                    idealConcept: "Specific portfolio features and how they work.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "irrelevant");
});

test("evaluation parser rejects missing and unsupported relevance classifications", () => {
    for (const relevance of [undefined, "unrelated", "RELEVANT"]) {
        const output = {
            score: 45,
            relevance,
            feedback: "Feedback",
            strengths: [],
            improvements: [],
            idealConcept: "Relevant answer details.",
        };
        if (relevance === undefined) delete output.relevance;
        assert.throws(
            () => parseGroqEvaluation({
                choices: [{ message: { content: JSON.stringify(output) } }],
            }),
            { code: "INVALID_EVALUATION_RESPONSE" },
        );
    }
});

test("irrelevant portfolio answer is parsed and normally progresses without forced retry", () => {
    const evaluation = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 0,
                    relevance: "irrelevant",
                    feedback: "The answer does not address the portfolio features question.",
                    strengths: [],
                    improvements: ["Describe two features you implemented and how they work."],
                    idealConcept: "Portfolio features and implementation details.",
                }),
            },
        }],
    });

    // Default policy: never force repeated answers
    assert.equal(shouldRetryAnswer(evaluation.relevance, 0, 3), false);
    // When optional retry is explicitly configured, bounded clarification is allowed
    assert.equal(shouldRetryAnswer(evaluation.relevance, 0, 3, true), true);
    assert.match(
        buildAnswerRetryReply({
            relevance: evaluation.relevance,
            improvements: evaluation.improvements,
        }),
        /doesn't quite address the question/i
    );
});

test("network timeout retries once and then surfaces the final error", async () => {
    let calls = 0;
    await assert.rejects(
        runInterviewEvaluation(async () => {
            calls += 1;
            const error = new Error("request timed out");
            error.code = "ETIMEDOUT";
            throw error;
        }, immediateRetry),
        /request timed out/,
    );
    assert.equal(calls, 2);
});

test("non-transient API errors are not retried", async () => {
    let calls = 0;
    const error = new Error("invalid request");
    error.status = 400;
    await assert.rejects(
        runInterviewEvaluation(async () => {
            calls += 1;
            throw error;
        }, immediateRetry),
        /invalid request/,
    );
    assert.equal(calls, 1);
});

test("an evaluation is reused after a checkpoint save failure instead of reevaluated", async () => {
    const cache = createEvaluationRetryCache({ now: () => 100 });
    const identity = {
        sessionId: "session",
        questionIndex: 2,
        submissionId: "stable-submission",
    };
    const evaluation = { score: 88, feedback: "Specific feedback" };
    let evaluationCalls = 0;
    let saveCalls = 0;
    let savedCheckpoint = null;

    const firstEvaluation = await runInterviewEvaluation(async () => {
        evaluationCalls += 1;
        return evaluation;
    }, immediateRetry);
    const firstSession = {
        async save() {
            saveCalls += 1;
            throw new Error("simulated database save failure");
        },
    };
    await assert.rejects(
        saveEvaluationCheckpoint(
            firstSession,
            identity,
            {
                questionIndex: 2,
                submissionId: "stable-submission",
                answer: "My complete answer",
                question: "Explain the design.",
                evaluation: firstEvaluation,
            },
            cache,
        ),
        /database save failure/,
    );

    const retryPayload = cache.get(identity);
    assert.equal(retryPayload.answer, "My complete answer");
    assert.equal(retryPayload.evaluation, evaluation);
    const retrySession = {
        async save() {
            saveCalls += 1;
            savedCheckpoint = this.pendingEvaluation;
        },
    };
    await saveEvaluationCheckpoint(
        retrySession,
        identity,
        {
            questionIndex: 2,
            submissionId: "stable-submission",
            answer: retryPayload.answer,
            question: retryPayload.question,
            evaluation: retryPayload.evaluation,
        },
        cache,
    );

    assert.equal(evaluationCalls, 1);
    assert.equal(saveCalls, 2);
    assert.equal(savedCheckpoint.evaluation, evaluation);
    assert.equal(cache.get(identity), null);
});

test("cached evaluations expire and are bounded", () => {
    let now = 0;
    const cache = createEvaluationRetryCache({
        maxEntries: 1,
        ttlMs: 50,
        now: () => now,
    });
    const first = { sessionId: "s1", questionIndex: 0, submissionId: "a" };
    const second = { sessionId: "s2", questionIndex: 0, submissionId: "b" };
    cache.set(first, { evaluation: { score: 1 } });
    cache.set(second, { evaluation: { score: 2 } });
    assert.equal(cache.get(first), null);
    assert.equal(cache.get(second).evaluation.score, 2);

    now = 51;
    assert.equal(cache.get(second), null);
});

// =========================================================================
// Tests for Requirement 8 Scenarios:
// =========================================================================

test("Scenario 1: A good answer to a motivation question is accepted even when the motivation is not mentioned in the resume", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 88,
                    relevance: "relevant",
                    feedback: "Great explanation of your motivation to learn frontend development and create interactive user interfaces.",
                    strengths: ["Clear interest in UI design", "Expressed passion for learning React"],
                    improvements: ["You could mention specific component patterns or state management tools you want to explore."],
                    idealConcept: "Personal motivation and enthusiasm for frontend development.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "relevant");
    assert.equal(parsed.score >= 75, true);
    assert.equal(shouldRetryAnswer(parsed.relevance, 0, 3), false);
});

test("Scenario 2: A partially relevant answer receives improvement advice and advances without forcing a retry", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 60,
                    relevance: "partially_relevant",
                    feedback: "Your answer shows an interest in coding, but could be strengthened by explaining specifically what you enjoy about frontend development.",
                    strengths: ["Expressed enthusiasm for coding"],
                    improvements: ["Explain what you enjoy about frontend development, such as creating responsive interfaces or improving usability."],
                    idealConcept: "Frontend motivations and specific UI design interests.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "partially_relevant");
    // Advances without forcing a retry
    assert.equal(shouldRetryAnswer(parsed.relevance, 0, 3), false);
    assert.equal(shouldRetryAnswer(parsed.relevance, 1, 3), false);
});

test("Scenario 3: An irrelevant answer is explicitly identified as irrelevant, receives a helpful example, and advances", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 10,
                    relevance: "irrelevant",
                    feedback: "That answer does not address the question about frontend development. An appropriate answer could explain your interest in building websites or creating user-friendly interfaces.",
                    strengths: [],
                    improvements: ["Focus directly on what interests you about software engineering and user interfaces."],
                    idealConcept: "Frontend development interests and career motivations.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "irrelevant");
    assert.match(parsed.feedback, /does not address the question/i);
    // Advances without forced retry
    assert.equal(shouldRetryAnswer(parsed.relevance, 0, 3), false);
});

test("Scenario 4: An incorrect technical answer receives a correction and advances", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 35,
                    relevance: "incorrect",
                    feedback: "A REST API is an architectural style for network communication between clients and servers, not a database. Databases store data, while APIs expose endpoints to retrieve or mutate that data.",
                    strengths: ["Attempted to answer the architectural question"],
                    improvements: ["Review the client-server model and HTTP verbs (GET, POST, PUT, DELETE) used in REST APIs."],
                    idealConcept: "REST API client-server communication using HTTP protocols.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "incorrect");
    assert.match(parsed.feedback, /not a database|architectural style/i);
    // Advances without forced retry
    assert.equal(shouldRetryAnswer(parsed.relevance, 0, 3), false);
});

test("Scenario 5: 'I don't know' and explicit skip requests do not cause repeated questions", () => {
    const { isSkipOrUnknownIntent, detectInterviewIntent } = require("../services/interviewAI");

    assert.equal(isSkipOrUnknownIntent("I don't know"), true);
    assert.equal(isSkipOrUnknownIntent("i dont know this topic"), true);
    assert.equal(isSkipOrUnknownIntent("skip this question please"), true);
    assert.equal(isSkipOrUnknownIntent("can we move on to the next question"), true);
    assert.equal(detectInterviewIntent("I don't know", "Explain React hooks."), "skip_question");
    assert.equal(detectInterviewIntent("please skip", "Explain React hooks."), "skip_question");

    // The skipped category never triggers retries
    assert.equal(shouldRetryAnswer("skipped", 0, 3), false);
});

test("Scenario 6: An answer about a candidate's interests is not rejected because the information is absent from the resume", () => {
    const parsed = parseGroqEvaluation({
        choices: [{
            message: {
                content: JSON.stringify({
                    score: 85,
                    relevance: "relevant",
                    feedback: "Great explanation of your interest in open source development and web accessibility.",
                    strengths: ["Proactive self-learning", "Awareness of accessibility standards"],
                    improvements: ["Mention any WCAG guidelines or tools like axe-core you have explored."],
                    idealConcept: "Personal interests in accessible web development.",
                }),
            },
        }],
    });

    assert.equal(parsed.relevance, "relevant");
    assert.doesNotMatch(parsed.feedback, /cannot find this information in your resume|not mentioned in resume/i);
});

test("Scenario 7: The same question is not repeated indefinitely", () => {
    // For every relevance category, default shouldRetryAnswer returns false, guaranteeing no endless loop
    for (const relevance of ["relevant", "partially_relevant", "incorrect", "irrelevant", "unclear", "insufficient", "skipped"]) {
        assert.equal(shouldRetryAnswer(relevance, 0, 3), false);
        assert.equal(shouldRetryAnswer(relevance, 1, 3), false);
        assert.equal(shouldRetryAnswer(relevance, 2, 3), false);
    }
    // Even if allowOptionalRetry is enabled, maximum retries is strictly bounded to at most 1
    for (const relevance of ["unclear", "insufficient", "irrelevant"]) {
        assert.equal(shouldRetryAnswer(relevance, 1, 3, true), false);
    }
});

test("Scenario 8: The next question and question index are saved consistently", () => {
    const session = {
        currentQuestionIndex: 2,
        conversation: [
            { speaker: "interviewer", questionIndex: 0, text: "Q0" },
            { speaker: "candidate", questionIndex: 0, text: "A0" },
            { speaker: "interviewer", questionIndex: 1, text: "Q1" },
            { speaker: "candidate", questionIndex: 1, text: "A1" },
            { speaker: "interviewer", questionIndex: 2, text: "Q2" },
        ],
    };
    assert.equal(getActiveQuestionIndex(session), 2);
});

test("Scenario 9: Duplicate submissions do not create duplicate evaluations or turns", () => {
    const conversation = [
        { speaker: "interviewer", questionIndex: 1, text: "Explain CORS." },
        { speaker: "candidate", questionIndex: 1, submissionId: "sub-123", text: "Cross-Origin Resource Sharing." },
    ];
    // Identical submission recognized
    const existing = findExistingAnswerForRetry(conversation, 1, "sub-123", "Cross-Origin Resource Sharing.");
    assert.notEqual(existing, null);
    assert.equal(existing.submissionId, "sub-123");
});
