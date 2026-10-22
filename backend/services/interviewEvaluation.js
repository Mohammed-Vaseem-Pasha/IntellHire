const { performance } = require("node:perf_hooks");


function isRetryableEvaluationError(error) {
    const status = Number(error?.status || error?.statusCode);
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();

    // Don't retry when the daily quota is exhausted.
    if (
        code === "GROQ_QUOTA_EXCEEDED" ||
        message.includes("tokens per day") ||
        message.includes("daily token") ||
        message.includes("quota exceeded") ||
        message.includes("usage limit has been reached")
    ) {
        return false;
    }

    // Retry temporary server and network failures.
    return (
        (status === 429 && !message.includes("tokens per day")) ||
        status >= 500 ||
        (status === 400 &&
            /json_validate_failed|failed to generate json/i.test(message)) ||
        error?.name === "AbortError" ||
        [
            "ECONNRESET",
            "ETIMEDOUT",
            "ECONNREFUSED",
            "EAI_AGAIN",
            "UND_ERR_CONNECT_TIMEOUT",
        ].includes(code) ||
        code === "INVALID_EVALUATION_RESPONSE" ||
        /timed?\s*out|network|fetch failed|connection reset|socket hang up/i.test(message)
    );
}


async function runInterviewEvaluation(
    evaluate,
    { maxAttempts = 2, delayMs = 350, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}
) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await evaluate();
        } catch (error) {
            if (attempt >= maxAttempts || !isRetryableEvaluationError(error)) {
                throw error;
            }
            await sleep(delayMs * attempt);
        }
    }
}

function createEvaluationRetryCache({
    maxEntries = 500,
    ttlMs = 30 * 60 * 1000,
    now = Date.now,
} = {}) {
    const entries = new Map();

    function keyFor({ sessionId, questionIndex, submissionId }) {
        return `${sessionId}:${questionIndex}:${submissionId}`;
    }

    function prune() {
        for (const [key, entry] of entries) {
            if (entry.expiresAt <= now()) entries.delete(key);
        }
        while (entries.size > maxEntries) {
            entries.delete(entries.keys().next().value);
        }
    }

    return {
        get(identity) {
            prune();
            const key = keyFor(identity);
            const entry = entries.get(key);
            if (!entry) return null;
            entries.delete(key);
            entries.set(key, entry);
            return entry.value;
        },
        set(identity, value) {
            prune();
            const key = keyFor(identity);
            entries.delete(key);
            entries.set(key, { value, expiresAt: now() + ttlMs });
            prune();
        },
        delete(identity) {
            entries.delete(keyFor(identity));
        },
    };
}

function findExistingAnswerForRetry(conversation, questionIndex, submissionId, answer) {
    const candidateAnswers = (conversation || []).filter(
        (item) =>
            item.speaker === "candidate" &&
            item.questionIndex === questionIndex
    );
    return candidateAnswers.find((item) => item.submissionId === submissionId) ||
        candidateAnswers.find((item) => item.text === answer) ||
        null;
}

function getMatchingPendingEvaluation(pendingEvaluation, questionIndex, answer) {
    return pendingEvaluation?.questionIndex === questionIndex &&
        pendingEvaluation.answer === answer
        ? pendingEvaluation
        : null;
}

async function saveEvaluationCheckpoint(session, identity, checkpoint, cache) {
    const startedAt = performance.now();
    cache.set(identity, {
        answer: checkpoint.answer,
        question: checkpoint.question,
        evaluation: checkpoint.evaluation,
    });
    session.pendingEvaluation = checkpoint;
    await session.save();
    cache.delete(identity);
    console.info("[Interview timing] evaluation checkpoint save", {
        durationMs: Math.round(performance.now() - startedAt),
    });
}

module.exports = {
    createEvaluationRetryCache,
    findExistingAnswerForRetry,
    getMatchingPendingEvaluation,
    isRetryableEvaluationError,
    runInterviewEvaluation,
    saveEvaluationCheckpoint,
};