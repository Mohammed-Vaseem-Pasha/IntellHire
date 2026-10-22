const test = require("node:test");
const assert = require("node:assert/strict");
const {
    ANSWER_RELEVANCE_CATEGORIES,
    getAnswerRetryCount,
    shouldRetryAnswer,
    buildAnswerRetryReply,
    buildRetryLimitReply,
} = require("../services/interviewAnswerPolicy");

test("all supported answer-relevance categories are explicit", () => {
    assert.deepEqual(
        [...ANSWER_RELEVANCE_CATEGORIES].sort(),
        ["incorrect", "irrelevant", "insufficient", "partially_relevant", "relevant", "skipped", "unclear"].sort()
    );
});

test("relevant, partially relevant, and incorrect answers progress without forced retries", () => {
    assert.equal(shouldRetryAnswer("relevant", 0, 3), false);
    assert.equal(shouldRetryAnswer("partially_relevant", 0, 3), false);
    assert.equal(shouldRetryAnswer("partially_relevant", 1, 3), false);
    assert.equal(shouldRetryAnswer("incorrect", 0, 3), false);
    assert.equal(shouldRetryAnswer("skipped", 0, 3), false);
    assert.equal(shouldRetryAnswer("irrelevant", 0, 3), false);
    assert.equal(shouldRetryAnswer("unclear", 0, 3), false);
    assert.equal(shouldRetryAnswer("insufficient", 0, 3), false);
});

test("when optional retry is enabled, unclear and insufficient answers receive at most one bounded clarification", () => {
    assert.equal(shouldRetryAnswer("unclear", 0, 3, true), true);
    assert.equal(shouldRetryAnswer("unclear", 1, 3, true), false);
    assert.equal(shouldRetryAnswer("insufficient", 0, 3, true), true);
    assert.equal(shouldRetryAnswer("insufficient", 1, 3, true), false);
    // Relevant, partially relevant, incorrect, and skipped NEVER retry even if allowOptionalRetry is true
    assert.equal(shouldRetryAnswer("relevant", 0, 3, true), false);
    assert.equal(shouldRetryAnswer("partially_relevant", 0, 3, true), false);
    assert.equal(shouldRetryAnswer("incorrect", 0, 3, true), false);
    assert.equal(shouldRetryAnswer("skipped", 0, 3, true), false);
});

test("retry count is scoped to this interview question", () => {
    const requests = [
        { intent: "retry_answer", questionIndex: 2 },
        { intent: "candidate_question", questionIndex: 2 },
        { intent: "retry_answer", questionIndex: 1 },
        { intent: "retry_answer", questionIndex: 2 },
    ];

    assert.equal(getAnswerRetryCount(requests, 2), 2);
    assert.equal(getAnswerRetryCount(requests, 1), 1);
});

test("irrelevant answers receive correction rather than praise", () => {
    const reply = buildAnswerRetryReply({ relevance: "irrelevant" });
    assert.match(reply, /doesn't quite address the question/i);
    assert.doesNotMatch(reply, /great|nice|good answer|thanks for sharing/i);
});

test("partially relevant answer identifies the missing detail", () => {
    assert.match(
        buildAnswerRetryReply({
            relevance: "partially_relevant",
            improvements: ["explain how the feature works"],
        }),
        /addresses part of the question/i
    );
});

test("unclear and insufficient answers explicitly request clarification or detail", () => {
    assert.match(buildAnswerRetryReply({ relevance: "unclear" }), /clarify/i);
    assert.match(buildAnswerRetryReply({ relevance: "insufficient" }), /more detail/i);
});

test("retry exhaustion moves on without claiming an irrelevant answer was good", () => {
    const reply = buildRetryLimitReply("irrelevant");
    assert.match(reply, /does not address the question/i);
    assert.match(reply, /continue/i);
    assert.doesNotMatch(reply, /great|nice|good answer|thanks for sharing/i);
});
