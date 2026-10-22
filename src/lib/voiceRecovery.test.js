import assert from "node:assert/strict";
import test from "node:test";
import {
  ANSWER_PAUSE_TIMEOUT_MS,
  canFinalizeVoiceAnswer,
  commitVoiceRecognitionResults,
  createVoiceAnswerCapture,
  createVoiceAnswerPauseTimer,
  getAnswerPauseTimeout,
  getVoiceAnswerTranscript,
  getVoiceRecoveryAction,
  MAX_AUTOMATIC_VOICE_RETRIES,
  preserveVoiceRecognitionResults,
  releaseVoiceAnswerSubmission,
  shouldFinalizeRecognitionError,
  updateVoiceAnswerCapture,
} from "./voiceRecovery.js";

function createFakeTimers() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();

  return {
    setTimeout(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= end)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id);
        now = task.at;
        task.callback();
      }
      now = end;
    },
  };
}

test("silence and temporary network failures receive at most two automatic retries", () => {
  assert.equal(getVoiceRecoveryAction("no-speech", 0), "retry");
  assert.equal(getVoiceRecoveryAction("network", 1), "retry");
  assert.equal(
    getVoiceRecoveryAction("no-speech", MAX_AUTOMATIC_VOICE_RETRIES),
    "manual",
  );
});

test("permission and device configuration errors never retry automatically", () => {
  assert.equal(getVoiceRecoveryAction("not-allowed", 0), "permission");
  assert.equal(getVoiceRecoveryAction("service-not-allowed", 0), "permission");
  assert.equal(getVoiceRecoveryAction("audio-capture", 0), "microphone");
  assert.equal(getVoiceRecoveryAction("aborted", 0), "aborted");
  assert.equal(getVoiceRecoveryAction("language-not-supported", 0), "manual");
});

test("recognition errors do not prematurely end an answer with a collected transcript", () => {
  assert.equal(shouldFinalizeRecognitionError("network", "A complete answer."), false);
  assert.equal(shouldFinalizeRecognitionError("no-speech", "A complete answer."), false);
  assert.equal(shouldFinalizeRecognitionError("network", ""), true);
  assert.equal(shouldFinalizeRecognitionError("not-allowed", "Partial answer"), true);
});

test("answer pause threshold defaults to 2.8 seconds and supports a bounded configuration", () => {
  assert.equal(ANSWER_PAUSE_TIMEOUT_MS, 2800);
  assert.equal(getAnswerPauseTimeout("3000"), 3000);
  assert.equal(getAnswerPauseTimeout("2000"), ANSWER_PAUSE_TIMEOUT_MS);
});

test("a resumed multi-sentence answer resets the pause timer and submits once after silence", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(2);
  const submitted = [];
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    (answer) => submitted.push(answer),
    timers,
  );

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I built a classifier.",
  });
  assert.equal(pauseTimer.reset(capture), true);
  timers.advance(2000);

  commitVoiceRecognitionResults(capture);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I evaluated it with sensitivity and specificity.",
  });
  assert.equal(pauseTimer.reset(capture), true);
  timers.advance(2799);
  assert.deepEqual(submitted, []);
  timers.advance(1);
  timers.advance(2800);

  assert.deepEqual(submitted, [
    "I built a classifier. I evaluated it with sensitivity and specificity.",
  ]);
  assert.equal(capture.submitted, true);
});

test("interim speech cancels finalization and is never included in a submitted transcript", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(0);
  const submitted = [];
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    (answer) => submitted.push(answer),
    timers,
  );

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I designed the API.",
  });
  pauseTimer.reset(capture);
  timers.advance(2000);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I designed the API.",
    interimTranscript: "Then I started",
  });
  assert.equal(pauseTimer.reset(capture), false);
  assert.equal(canFinalizeVoiceAnswer(capture), false);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  assert.deepEqual(submitted, []);

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I designed the API. Then I started integration testing.",
  });
  pauseTimer.reset(capture);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  assert.deepEqual(submitted, [
    "I designed the API. Then I started integration testing.",
  ]);
  assert.equal(
    getVoiceAnswerTranscript(capture),
    "I designed the API. Then I started integration testing.",
  );
});

test("empty or interim-only transcripts cannot be finalized", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(1);
  let submissions = 0;
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    () => { submissions += 1; },
    timers,
  );

  updateVoiceAnswerCapture(capture, { interimTranscript: "I think" });
  assert.equal(pauseTimer.reset(capture), false);
  timers.advance(10000);
  assert.equal(submissions, 0);
  assert.equal(capture.submitted, false);
});

test("an unfinalized recognition fragment survives a browser restart without submitting", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(3);
  let submissions = 0;
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    () => { submissions += 1; },
    timers,
  );

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I led the migration.",
  });
  pauseTimer.reset(capture);
  commitVoiceRecognitionResults(capture);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "",
    interimTranscript: "The most difficult part was",
  });
  commitVoiceRecognitionResults(capture);

  assert.equal(capture.awaitingFinalTranscript, true);
  assert.equal(canFinalizeVoiceAnswer(capture), false);
  assert.equal(getVoiceAnswerTranscript(capture), "I led the migration.");
  assert.equal(pauseTimer.reset(capture), false);
  timers.advance(10000);
  assert.equal(submissions, 0);

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "The most difficult part was coordinating the rollout.",
  });
  assert.equal(capture.awaitingFinalTranscript, false);
  assert.equal(pauseTimer.reset(capture), true);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
});

test("an interim transcript survives recognition ending and remains editable until finalized", () => {
  const capture = createVoiceAnswerCapture(6);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I designed the service.",
    interimTranscript: "I also handled",
  });

  preserveVoiceRecognitionResults(capture);

  assert.equal(
    getVoiceAnswerTranscript(capture),
    "I designed the service. I also handled",
  );
  assert.equal(capture.awaitingFinalTranscript, true);
  assert.equal(canFinalizeVoiceAnswer(capture), false);

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "the migration plan.",
  });
  assert.equal(
    getVoiceAnswerTranscript(capture, { includeInterim: false }),
    "I designed the service. I also handled the migration plan.",
  );
  assert.equal(capture.awaitingFinalTranscript, false);
});

test("a short answer is submitted once after the pause, not on repeated finalization callbacks", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(0);
  const submitted = [];
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    (answer) => submitted.push(answer),
    timers,
  );

  updateVoiceAnswerCapture(capture, { finalTranscript: "Python." });
  pauseTimer.reset(capture);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  pauseTimer.reset(capture);
  assert.equal(capture.submitted, true);
  assert.deepEqual(submitted, ["Python."]);
});

test("an unexpected recognition end preserves final segments and finalizes once", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(5);
  const submitted = [];
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    (answer) => submitted.push(answer),
    timers,
  );

  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I migrated the service.",
  });
  commitVoiceRecognitionResults(capture);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "I added monitoring.",
  });
  commitVoiceRecognitionResults(capture);
  pauseTimer.reset(capture);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  pauseTimer.reset(capture);

  assert.deepEqual(submitted, ["I migrated the service. I added monitoring."]);
});

test("failed backend submission retains the transcript and permits a deliberate retry", () => {
  const timers = createFakeTimers();
  const capture = createVoiceAnswerCapture(4);
  let requests = 0;
  const pauseTimer = createVoiceAnswerPauseTimer(
    ANSWER_PAUSE_TIMEOUT_MS,
    async (answer) => {
      requests += 1;
      assert.equal(answer, "The service returned an error.");
      if (requests === 1) releaseVoiceAnswerSubmission(capture);
    },
    timers,
  );
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "The service returned an error.",
  });
  pauseTimer.reset(capture);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  assert.equal(getVoiceAnswerTranscript(capture), "The service returned an error.");
  assert.equal(capture.submitted, false);
  pauseTimer.reset(capture);
  timers.advance(ANSWER_PAUSE_TIMEOUT_MS);
  assert.equal(requests, 2);
});
