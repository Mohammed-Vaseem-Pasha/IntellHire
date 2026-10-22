export const MAX_AUTOMATIC_VOICE_RETRIES = 2;
export const ANSWER_PAUSE_TIMEOUT_MS = 2800;
export const NO_SPEECH_TIMEOUT_MS = 20000;
export const RECOGNITION_SESSION_TIMEOUT_MS = 120000;

export function getAnswerPauseTimeout(configuredValue) {
  const timeout = Number(configuredValue);
  return Number.isFinite(timeout) && timeout >= 2500 && timeout <= 15000
    ? timeout
    : ANSWER_PAUSE_TIMEOUT_MS;
}

export function shouldFinalizeRecognitionError(error, transcript) {
  if (error === "not-allowed" || error === "service-not-allowed" ||
      error === "audio-capture" || error === "language-not-supported") {
    return true;
  }
  return !String(transcript || "").trim();
}

export function createVoiceAnswerCapture(questionIndex, initialTranscript = "") {
  return {
    questionIndex,
    completedTranscript: String(initialTranscript || "").trim(),
    currentFinalTranscript: "",
    interimTranscript: "",
    awaitingFinalTranscript: false,
    submitted: false,
  };
}

export function appendTranscriptSegment(existing = "", newSegment = "") {
  const base = String(existing || "").trim();
  const addition = String(newSegment || "").trim();
  if (!base) return addition;
  if (!addition) return base;

  // Exact match or addition already at the end of base
  if (base.toLowerCase().endsWith(addition.toLowerCase())) {
    return base;
  }

  const baseWords = base.split(/\s+/);
  const additionWords = addition.split(/\s+/);

  // Normalize a word for comparison (lowercase, strip surrounding punctuation)
  const clean = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

  // Find the longest overlap at the boundary
  const maxOverlap = Math.min(baseWords.length, additionWords.length);
  let overlapCount = 0;

  for (let len = maxOverlap; len >= 1; len--) {
    const baseSlice = baseWords.slice(baseWords.length - len);
    const additionSlice = additionWords.slice(0, len);
    let match = true;
    for (let i = 0; i < len; i++) {
      const b = clean(baseSlice[i]);
      const a = clean(additionSlice[i]);
      if (!b || !a || b !== a) {
        match = false;
        break;
      }
    }
    if (match) {
      overlapCount = len;
      break;
    }
  }

  if (overlapCount > 0) {
    const remaining = additionWords.slice(overlapCount).join(" ");
    return remaining ? `${base} ${remaining}`.trim() : base;
  }

  return `${base} ${addition}`.trim();
}

function joinTranscriptParts(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function updateVoiceAnswerCapture(
  capture,
  { finalTranscript = "", interimTranscript = "" } = {},
) {
  capture.currentFinalTranscript = String(finalTranscript || "").trim();
  capture.interimTranscript = String(interimTranscript || "").trim();
  if (capture.interimTranscript) {
    capture.awaitingFinalTranscript = true;
  } else if (capture.currentFinalTranscript) {
    capture.awaitingFinalTranscript = false;
  }
}

export function commitVoiceRecognitionResults(capture) {
  if (capture.currentFinalTranscript) {
    capture.completedTranscript = appendTranscriptSegment(
      capture.completedTranscript,
      capture.currentFinalTranscript,
    );
  }
  capture.currentFinalTranscript = "";
  capture.interimTranscript = "";
  return capture.completedTranscript;
}

export function preserveVoiceRecognitionResults(capture) {
  const hadInterim = Boolean(capture.interimTranscript);
  const awaitingFinalTranscript = Boolean(
    capture.awaitingFinalTranscript || hadInterim,
  );
  if (capture.currentFinalTranscript) {
    capture.completedTranscript = appendTranscriptSegment(
      capture.completedTranscript,
      capture.currentFinalTranscript,
    );
  }
  capture.currentFinalTranscript = "";
  // Interim results are transient preview only; never permanently bake them into the transcript.
  capture.interimTranscript = "";
  capture.awaitingFinalTranscript = awaitingFinalTranscript;
  return capture.completedTranscript;
}

export function getVoiceAnswerTranscript(capture, { includeInterim = true } = {}) {
  if (!capture) return "";
  // Use appendTranscriptSegment so that if the engine re-emits an overlapping final
  // transcript (Android Chrome re-emission pattern), the boundary is deduplicated.
  const base = appendTranscriptSegment(
    capture.completedTranscript,
    capture.currentFinalTranscript,
  );
  if (!includeInterim || !capture.interimTranscript) return base;
  return joinTranscriptParts(base, capture.interimTranscript);
}

export function canFinalizeVoiceAnswer(capture) {
  return Boolean(
    capture &&
      !capture.submitted &&
      !capture.awaitingFinalTranscript &&
      !capture.interimTranscript &&
      getVoiceAnswerTranscript(capture, { includeInterim: false }).length >= 2,
  );
}

export function claimVoiceAnswerSubmission(capture) {
  if (!canFinalizeVoiceAnswer(capture)) return null;
  capture.submitted = true;
  return getVoiceAnswerTranscript(capture, { includeInterim: false });
}

export function releaseVoiceAnswerSubmission(capture) {
  if (!capture) return;
  capture.submitted = false;
}

export function createVoiceAnswerPauseTimer(
  delayMs,
  onFinalize,
  timers = globalThis,
) {
  let timer = null;

  function clear() {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  return {
    clear,
    reset(capture) {
      clear();
      if (!canFinalizeVoiceAnswer(capture)) return false;
      timer = timers.setTimeout(() => {
        timer = null;
        const answer = claimVoiceAnswerSubmission(capture);
        if (answer) onFinalize(answer);
      }, delayMs);
      return true;
    },
  };
}

export function getVoiceRecoveryAction(error, retriesUsed) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "permission";
  }
  if (error === "audio-capture") return "microphone";
  if (error === "aborted") return "aborted";
  if (error === "no-speech" || error === "network" || !error) {
    return retriesUsed < MAX_AUTOMATIC_VOICE_RETRIES ? "retry" : "manual";
  }
  return "manual";
}
