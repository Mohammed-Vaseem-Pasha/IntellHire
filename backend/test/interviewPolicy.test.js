const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getInterviewLimits,
    getInterviewTargetQuestionCount,
    reachedSafetyLimit,
} = require("../services/interviewPolicy");

test("interview safety limits are configurable from the backend environment", () => {
    assert.deepEqual(
        getInterviewLimits({
            INTERVIEW_MAX_TURNS: "36",
            INTERVIEW_MAX_DURATION_MINUTES: "55",
            INTERVIEW_MIN_ASSESSMENT_TURNS: "6",
            INTERVIEW_TARGET_QUESTIONS: "14",
        }),
        {
            maxTurns: 36,
            maxDurationMinutes: 55,
            minAssessmentTurns: 6,
            maxAnswerRetries: 3,
            targetQuestionCount: 14,
        }
    );
});

test("invalid safety limit values use the documented defaults", () => {
    assert.deepEqual(
        getInterviewLimits({
            INTERVIEW_MAX_TURNS: "7",
            INTERVIEW_MAX_DURATION_MINUTES: "not-a-number",
            INTERVIEW_MIN_ASSESSMENT_TURNS: "2",
            INTERVIEW_TARGET_QUESTIONS: "2",
        }),
        {
            maxTurns: 30,
            maxDurationMinutes: 45,
            minAssessmentTurns: 5,
            maxAnswerRetries: 3,
            targetQuestionCount: 10,
        }
    );
});

test("answer retry limit is configurable and defaults to three attempts", () => {
    assert.equal(getInterviewLimits({}).maxAnswerRetries, 3);
    assert.equal(getInterviewLimits({ INTERVIEW_MAX_ANSWER_RETRIES: "5" }).maxAnswerRetries, 5);
    assert.equal(getInterviewLimits({ INTERVIEW_MAX_ANSWER_RETRIES: "0" }).maxAnswerRetries, 3);
});

test("question target adapts to role and resume evidence within the planned range", () => {
    assert.equal(
        getInterviewTargetQuestionCount({
            jobRole: "Software Engineer",
            resumeProfile: {
                projects: [{}],
                experience: [{}],
                technicalSkills: ["JavaScript"],
            },
        }, {}),
        12
    );
    assert.equal(
        getInterviewTargetQuestionCount({ jobRole: "Product Designer" }, {}),
        10
    );
    assert.equal(
        getInterviewTargetQuestionCount({ jobRole: "Software Engineer" }, {
            INTERVIEW_TARGET_QUESTIONS: "15",
        }),
        15
    );
});

test("15 turns do not complete an interview when the adaptive interviewer needs more evidence", () => {
    const limits = { maxTurns: 30, maxDurationMinutes: 45 };
    const startedAt = Date.now() - 10 * 60 * 1000;
    assert.equal(
        reachedSafetyLimit({
            answerCount: 15,
            startedAt,
            now: Date.now(),
            limits,
        }),
        false
    );
});

test("turn and elapsed-time ceilings activate only as safety fallbacks", () => {
    const limits = { maxTurns: 30, maxDurationMinutes: 45 };
    const now = Date.now();
    assert.equal(
        reachedSafetyLimit({
            answerCount: 30,
            startedAt: now - 1000,
            now,
            limits,
        }),
        true
    );
    assert.equal(
        reachedSafetyLimit({
            answerCount: 12,
            startedAt: now - 45 * 60 * 1000,
            now,
            limits,
        }),
        true
    );
});

test("a configurable safety ceiling can be raised beyond the former 15-turn maximum", () => {
    const limits = getInterviewLimits({ INTERVIEW_MAX_TURNS: "40" });
    assert.equal(
        reachedSafetyLimit({
            answerCount: 16,
            startedAt: Date.now() - 1000,
            limits,
        }),
        false
    );
});
