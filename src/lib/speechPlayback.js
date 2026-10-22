export function createSpeechPlaybackGate() {
  const startedResponseIds = new Set();

  return {
    claim(responseId, { force = false } = {}) {
      if (typeof responseId !== "string" || !responseId.trim()) {
        throw new Error("A stable response ID is required for speech playback.");
      }
      if (!force && startedResponseIds.has(responseId)) return false;

      startedResponseIds.add(responseId);
      return true;
    },
    release(responseId) {
      if (typeof responseId === "string") {
        startedResponseIds.delete(responseId);
      }
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

export function primeSpeechSynthesis() {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    const silentUtterance = new SpeechSynthesisUtterance("");
    silentUtterance.volume = 0;
    silentUtterance.rate = 10;
    synth.speak(silentUtterance);
    return true;
  } catch (err) {
    console.debug("[Speech] primeSpeechSynthesis error:", err);
    return false;
  }
}

export function getEnglishVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const englishVoices = voices.filter((voice) =>
    voice && typeof voice.lang === "string" && /^en([_-]|$)/i.test(voice.lang)
  );
  return (
    englishVoices.find((voice) => voice.default) ||
    englishVoices.find((voice) => /^en[-_]US$/i.test(voice.lang)) ||
    englishVoices[0] ||
    voices[0] ||
    null
  );
}
