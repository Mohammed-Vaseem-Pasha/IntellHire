const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_DURATION_MINUTES = 45;
const DEFAULT_MIN_ASSESSMENT_TURNS = 5;
const DEFAULT_TARGET_QUESTION_COUNT = 10;
const DEFAULT_MAX_ANSWER_RETRIES = 3;

function readPositiveInteger(value, fallback, minimum = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function getInterviewLimits(env = process.env) {
    const configuredTarget = Number.parseInt(env.INTERVIEW_TARGET_QUESTIONS, 10);
    return {
        maxTurns: readPositiveInteger(env.INTERVIEW_MAX_TURNS, DEFAULT_MAX_TURNS, 8),
        maxDurationMinutes: readPositiveInteger(
            env.INTERVIEW_MAX_DURATION_MINUTES,
            DEFAULT_MAX_DURATION_MINUTES,
            10
        ),
        minAssessmentTurns: readPositiveInteger(
            env.INTERVIEW_MIN_ASSESSMENT_TURNS,
            DEFAULT_MIN_ASSESSMENT_TURNS,
            3
        ),
        maxAnswerRetries: readPositiveInteger(
            env.INTERVIEW_MAX_ANSWER_RETRIES,
            DEFAULT_MAX_ANSWER_RETRIES,
            1
        ),
        targetQuestionCount: Number.isInteger(configuredTarget) &&
            configuredTarget >= 10 &&
            configuredTarget <= 15
            ? configuredTarget
            : DEFAULT_TARGET_QUESTION_COUNT,
    };
}

function getInterviewTargetQuestionCount({
    jobRole = "",
    resumeProfile = {},
    durationMinutes = 20,
} = {}, env = process.env) {
    const limits = getInterviewLimits(env);
    if (env.INTERVIEW_TARGET_QUESTIONS !== undefined) {
        return limits.targetQuestionCount;
    }

    const roleRequiresTechnicalDepth =
        /software|developer|engineer|data scientist|machine learning|ai\/ml/i.test(jobRole);
    const resumeEvidenceCount = [
        resumeProfile?.projects?.length,
        resumeProfile?.experience?.length,
        resumeProfile?.internships?.length,
        resumeProfile?.technicalSkills?.length || resumeProfile?.skills?.length,
    ].filter((count) => Number(count) > 0).length;

    if (durationMinutes === 5) {
        return roleRequiresTechnicalDepth && resumeEvidenceCount >= 3 ? 5 : 4;
    }
    if (durationMinutes === 10) {
        return roleRequiresTechnicalDepth && resumeEvidenceCount >= 3 ? 8 : 7;
    }
    if (durationMinutes === 15) {
        return roleRequiresTechnicalDepth && resumeEvidenceCount >= 3 ? 12 : 10;
    }
    if (durationMinutes === 30) {
        return roleRequiresTechnicalDepth && resumeEvidenceCount >= 3 ? 22 : 20;
    }

    return roleRequiresTechnicalDepth && resumeEvidenceCount >= 3 ? 12 : limits.targetQuestionCount;
}

function reachedSafetyLimit({ answerCount, startedAt, now = Date.now(), limits }) {
    const startTime = new Date(startedAt).getTime();
    const durationLimitMs = limits.maxDurationMinutes * 60 * 1000;
    return (
        answerCount >= limits.maxTurns ||
        (Number.isFinite(startTime) && now - startTime >= durationLimitMs)
    );
}

function reachedDurationLimit({ startedAt, durationMinutes = 20, now = Date.now() }) {
    if (!startedAt) return false;
    const startTime = new Date(startedAt).getTime();
    if (!Number.isFinite(startTime)) return false;
    const durationLimitMs = durationMinutes * 60 * 1000;
    return (now - startTime) >= durationLimitMs;
}

module.exports = {
    getInterviewLimits,
    getInterviewTargetQuestionCount,
    reachedSafetyLimit,
    reachedDurationLimit,
};
