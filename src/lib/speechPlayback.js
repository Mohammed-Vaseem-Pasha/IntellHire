export function createSpeechPlaybackGate() {
  const startedResponseIds = new Set();

  return {
    claim(responseId) {
      if (typeof responseId !== "string" || !responseId.trim()) {
        throw new Error("A stable response ID is required for speech playback.");
      }
      if (startedResponseIds.has(responseId)) return false;

      startedResponseIds.add(responseId);
      return true;
    },
    clear() {
      startedResponseIds.clear();
    },
  };
}

export function speakUtteranceOnce(request, speak) {
  if (request.speakStarted) return false;
  request.speakStarted = true;
  speak();
  return true;
}

export function isCurrentAnswerResponse({
  requestToken,
  activeRequestToken,
  sessionId,
  activeSessionId,
  questionIndex,
  activeQuestionIndex,
  submissionId,
  activeSubmissionId,
}) {
  return requestToken === activeRequestToken &&
    sessionId === activeSessionId &&
    questionIndex === activeQuestionIndex &&
    submissionId === activeSubmissionId;
}
