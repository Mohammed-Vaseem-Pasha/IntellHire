const ANSWER_RELEVANCE_CATEGORIES = new Set([
    "relevant",
    "partially_relevant",
    "incorrect",
    "irrelevant",
    "unclear",
    "insufficient",
    "skipped",
]);

function getAnswerRetryCount(requests, questionIndex) {
    if (!Array.isArray(requests)) return 0;

    return requests.filter(
        (request) =>
            request?.intent === "retry_answer" &&
            request.questionIndex === questionIndex
    ).length;
}

function shouldRetryAnswer(relevance, previousRetries = 0, maxRetries = 3, allowOptionalRetry = false) {
    // By default, never force repeated answers: provide feedback and normally move forward.
    // Relevant, partially relevant, incorrect, and skipped answers always progress immediately.
    if (
        relevance === "relevant" ||
        relevance === "partially_relevant" ||
        relevance === "incorrect" ||
        relevance === "skipped"
    ) {
        return false;
    }

    // Only if optional retry is explicitly enabled, unclear/insufficient answers get at most 1 clarification
    if (allowOptionalRetry) {
        if (relevance === "unclear" || relevance === "insufficient") {
            return previousRetries < 1 && previousRetries < maxRetries;
        }
        if (relevance === "irrelevant") {
            return previousRetries < 1 && previousRetries < maxRetries;
        }
    }

    // Default policy: never force repeated answers
    return false;
}

function buildAnswerRetryReply({ relevance, improvements = [] }) {
    const missingDetail = Array.isArray(improvements)
        ? improvements.find((item) => typeof item === "string" && item.trim())
        : "";

    switch (relevance) {
        case "partially_relevant":
            return `Your answer addresses part of the question, but ${missingDetail || "it needs more specific detail"}.`;
        case "incorrect":
            return `There is a technical misconception in your answer, but let's move forward.`;
        case "unclear":
            return "I couldn't tell how your response addresses the question. Could you clarify?";
        case "insufficient":
            return "Could you provide more detail so I can assess your answer?";
        case "irrelevant":
            return "That doesn't quite address the question. An appropriate answer would focus on the topic asked.";
        case "skipped":
            return "Understood, let's move on to the next question.";
        default:
            return "Thank you for sharing that.";
    }
}

function buildRetryLimitReply(relevance) {
    if (!ANSWER_RELEVANCE_CATEGORIES.has(relevance)) {
        throw new Error(`Cannot finish an answer attempt with relevance "${relevance}".`);
    }
    if (relevance === "irrelevant") {
        return "That answer does not address the question. An appropriate answer would focus on the topic asked. Let's continue.";
    }
    if (relevance === "incorrect") {
        return "There was a technical correction for that topic. Let's move to the next question.";
    }
    if (relevance === "partially_relevant") {
        return "Your answer addressed part of the question. Let's continue to the next question.";
    }
    if (relevance === "skipped") {
        return "Understood. Let's move on to the next question.";
    }
    return "Let's move on to the next question.";
}

module.exports = {
    ANSWER_RELEVANCE_CATEGORIES,
    getAnswerRetryCount,
    shouldRetryAnswer,
    buildAnswerRetryReply,
    buildRetryLimitReply,
};
