function getActiveQuestionIndex(session) {
    const currentQuestionIndex = session?.currentQuestionIndex;
    const lastMessage = session?.conversation?.[session.conversation.length - 1];
    const lastMessageQuestionIndex = lastMessage?.questionIndex ?? 0;

    if (
        !Number.isInteger(currentQuestionIndex) ||
        currentQuestionIndex < 0 ||
        lastMessage?.speaker !== "interviewer" ||
        lastMessageQuestionIndex !== currentQuestionIndex
    ) {
        return null;
    }

    return currentQuestionIndex;
}

module.exports = { getActiveQuestionIndex };
