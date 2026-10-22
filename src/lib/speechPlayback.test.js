import assert from "node:assert/strict";
import test from "node:test";
import { buildSpokenInterviewResponse } from "./interviewResponse.js";
import {
  createSpeechPlaybackGate,
  isCurrentAnswerResponse,
  speakUtteranceOnce,
} from "./speechPlayback.js";

test("the opening and five consecutive normal interview responses play once each", () => {
  const playbackGate = createSpeechPlaybackGate();
  const playbackCalls = [];
  const responses = [
    { id: "session-1:question:0", text: "Tell me about yourself." },
    { id: "session-1:submission-1", reply: "Thanks for sharing.", question: "What was your project goal?" },
    { id: "session-1:submission-2", reply: "That sounds useful.", question: "How did you measure its impact?" },
    { id: "session-1:submission-3", reply: "Good example.", question: "How did you test the API?" },
    { id: "session-1:submission-4", reply: "That is helpful.", question: "What would you improve?" },
    { id: "session-1:submission-5", reply: "Thanks for explaining.", question: "How did you handle failures?" },
  ];

  for (const response of responses) {
    const text = response.question
      ? buildSpokenInterviewResponse(response.reply, response.question)
      : response.text;
    assert.equal(text.split(response.question || response.text).length - 1, 1);
    if (playbackGate.claim(response.id)) {
      const request = { speakStarted: false };
      speakUtteranceOnce(request, () => playbackCalls.push(response.id));
      assert.equal(speakUtteranceOnce(request, () => playbackCalls.push(response.id)), false);
    }
    assert.equal(playbackGate.claim(response.id), false);
  }

  assert.deepEqual(playbackCalls, responses.map(({ id }) => id));
});

test("a single speech request cannot call speechSynthesis.speak twice", () => {
  const request = { speakStarted: false };
  const synthesis = { speakCalls: [], speak(utterance) { this.speakCalls.push(utterance); } };
  const utterance = { text: "Can you walk me through the features?" };

  assert.equal(speakUtteranceOnce(request, () => synthesis.speak(utterance)), true);
  assert.equal(speakUtteranceOnce(request, () => synthesis.speak(utterance)), false);
  assert.deepEqual(synthesis.speakCalls, [utterance]);
});

test("similar question text with different response IDs remains eligible to play", () => {
  const playbackGate = createSpeechPlaybackGate();
  const played = [];
  const similarQuestions = [
    { id: "session-1:submission-a", text: "What did you learn from your project?" },
    { id: "session-1:submission-b", text: "What did you learn from your project?" },
  ];

  for (const response of similarQuestions) {
    if (playbackGate.claim(response.id)) played.push(response.text);
  }

  assert.equal(played.length, 2);
});

test("candidate-question, clarification, retry, and completion responses have independent IDs", () => {
  const playbackGate = createSpeechPlaybackGate();
  const responseIds = [
    "session-1:candidate-request-1",
    "session-1:clarification-1",
    "session-1:voice-retry:2:1",
    "session-1:completion-submission-9",
  ];

  assert.deepEqual(responseIds.map((id) => playbackGate.claim(id)), [true, true, true, true]);
  assert.deepEqual(responseIds.map((id) => playbackGate.claim(id)), [false, false, false, false]);
});

test("a new response can replace playback while duplicate IDs remain suppressed", () => {
  const playbackGate = createSpeechPlaybackGate();
  const playbackCalls = [];
  const play = (id) => {
    const claimed = playbackGate.claim(id);
    if (claimed) playbackCalls.push(id);
    return claimed;
  };

  assert.equal(play("session-1:answer:submission-1"), true);
  assert.equal(play("session-1:answer:submission-2"), true);
  assert.equal(play("session-1:answer:submission-1"), false);
  assert.deepEqual(playbackCalls, [
    "session-1:answer:submission-1",
    "session-1:answer:submission-2",
  ]);
});

test("clearing the playback gate allows a new interview session", () => {
  const playbackGate = createSpeechPlaybackGate();
  assert.equal(playbackGate.claim("session-1:question:0"), true);
  playbackGate.clear();
  assert.equal(playbackGate.claim("session-1:question:0"), true);
});

test("rejects playback without a stable response ID", () => {
  const playbackGate = createSpeechPlaybackGate();

  assert.throws(
    () => playbackGate.claim(""),
    /stable response ID is required/,
  );
});

test("late answer responses cannot apply after the session, turn, or submission changes", () => {
  const token = {};
  const response = {
    requestToken: token,
    activeRequestToken: token,
    sessionId: "session-1",
    activeSessionId: "session-1",
    questionIndex: 2,
    activeQuestionIndex: 2,
    submissionId: "submission-2",
    activeSubmissionId: "submission-2",
  };

  assert.equal(isCurrentAnswerResponse(response), true);
  assert.equal(
    isCurrentAnswerResponse({ ...response, activeRequestToken: {} }),
    false,
  );
  assert.equal(
    isCurrentAnswerResponse({ ...response, activeSessionId: "session-2" }),
    false,
  );
  assert.equal(
    isCurrentAnswerResponse({ ...response, activeQuestionIndex: 3 }),
    false,
  );
  assert.equal(
    isCurrentAnswerResponse({ ...response, activeSubmissionId: "submission-3" }),
    false,
  );
});
