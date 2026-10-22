async function getCompletedInterviewHistory(InterviewSession, firebaseUid) {
    // Return every persisted session so completed, interrupted, and recoverable
    // in-progress interviews are visible to the Feedback Agent.
    return InterviewSession.find({ firebaseUid })
        .select("_id jobRole createdAt updatedAt status interviewState completionReason currentQuestionIndex targetQuestionCount interruptedDraftAnswer interruptedDraftQuestion interruptedDraftQuestionIndex reportStatus report conversation")
        .sort({ updatedAt: -1, _id: -1 })
        .lean();
}

module.exports = { getCompletedInterviewHistory };
