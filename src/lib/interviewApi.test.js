import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAnswerResponseError,
  parseAnswerResponse,
  waitForAnswerResponse,
} from "./interviewApi.js";
import {
  claimVoiceAnswerSubmission,
  createVoiceAnswerCapture,
  getVoiceAnswerTranscript,
  releaseVoiceAnswerSubmission,
  updateVoiceAnswerCapture,
} from "./voiceRecovery.js";

test("answer responses parse JSON errors without treating them as successes", async () => {
  const response = new Response(
    JSON.stringify({
      success: false,
      message: "Evaluation unavailable.",
      phase: "answer evaluation",
    }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );

  const result = await parseAnswerResponse(response);
  assert.equal(result.data.success, false);
  assert.equal(result.data.phase, "answer evaluation");
  assert.equal(result.error, null);
});

test("answer submission errors retain HTTP status and backend phase", () => {
  assert.equal(
    formatAnswerResponseError(500, {
      message: "The server could not process this request.",
      phase: "answer request middleware",
    }),
    "The server could not process this request. (HTTP 500; phase: answer request middleware)",
  );
});

test("HTML, malformed JSON, and empty answer responses return useful retryable errors", async () => {
  const htmlResult = await parseAnswerResponse(new Response(
    "<!DOCTYPE html><title>Server Error</title>",
    { status: 500, headers: { "Content-Type": "text/html" } },
  ));
  assert.match(htmlResult.error, /HTML error page \(HTTP 500\)/);
  assert.equal(htmlResult.data, null);

  const malformedResult = await parseAnswerResponse(new Response(
    "{invalid",
    { status: 502, headers: { "Content-Type": "application/json" } },
  ));
  assert.match(malformedResult.error, /malformed JSON \(HTTP 502\)/);
  assert.equal(malformedResult.data, null);

  const emptyResult = await parseAnswerResponse(new Response("", { status: 500 }));
  assert.match(emptyResult.error, /empty response \(HTTP 500\)/);
  assert.equal(emptyResult.data, null);
});

test("answer submission waits for backend processing before returning success", async () => {
  let requests = 0;
  let processingNotified = 0;
  const response = await waitForAnswerResponse(
    "/answer",
    { method: "POST" },
    () => { processingNotified += 1; },
    {
      fetchRequest: async () => {
        requests += 1;
        return { status: requests === 1 ? 202 : 200 };
      },
      maxAttempts: 3,
      pollIntervalMs: 0,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(requests, 2);
  assert.equal(processingNotified, 1);
});

test("failed backend request keeps the finalized transcript available for retry", async () => {
  const capture = createVoiceAnswerCapture(1);
  updateVoiceAnswerCapture(capture, {
    finalTranscript: "This answer must remain available.",
  });
  const answer = claimVoiceAnswerSubmission(capture);
  assert.equal(answer, "This answer must remain available.");

  await assert.rejects(
    waitForAnswerResponse(
      "/answer",
      { method: "POST" },
      undefined,
      {
        fetchRequest: async () => {
          throw new Error("backend unavailable");
        },
      },
    ),
    /backend unavailable/,
  );

  releaseVoiceAnswerSubmission(capture);
  assert.equal(getVoiceAnswerTranscript(capture), answer);
  assert.equal(claimVoiceAnswerSubmission(capture), answer);
});

test("backend processing timeout returns a retryable error", async () => {
  const controllerAbort = new DOMException("aborted", "AbortError");
  const timers = {
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  };

  await assert.rejects(
    waitForAnswerResponse(
      "/answer",
      { method: "POST" },
      undefined,
      {
        fetchRequest: async (_url, { signal }) => {
          if (signal.aborted) throw controllerAbort;
          await new Promise((resolve) => setTimeout(resolve, 0));
          throw controllerAbort;
        },
        timers,
      },
    ),
    /Your transcript is saved here; please retry submission/,
  );
});
