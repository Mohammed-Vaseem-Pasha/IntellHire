import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpokenInterviewResponse,
  deduplicateInterviewResponse,
} from "./interviewResponse.js";

test("deduplicates repeated project questions with minor wording differences", () => {
  assert.equal(
    deduplicateInterviewResponse(
      "Could you describe your project on plant growth and yield prediction? Could you describe your project plant growth and yield prediction?",
    ),
    "Could you describe your project on plant growth and yield prediction?",
  );
});

test("deduplicates the repeated opening question", () => {
  assert.equal(
    deduplicateInterviewResponse("Tell me about yourself. Tell me about yourself."),
    "Tell me about yourself.",
  );
});

test("keeps one feedback statement and a different next question in spoken output", () => {
  assert.equal(
    buildSpokenInterviewResponse(
      "Your project explanation clearly described the model and its impact.",
      "How did you evaluate the model's performance?",
    ),
    "Your project explanation clearly described the model and its impact. How did you evaluate the model's performance?",
  );
});

test("does not collapse meaningfully different follow-up questions", () => {
  const response =
    "How did you evaluate the model? What would you improve in the model?";
  assert.equal(deduplicateInterviewResponse(response), response);
});

test("removes a repeated question combined from separate response fields", () => {
  assert.equal(
    buildSpokenInterviewResponse(
      "Could you describe your project on plant growth and yield prediction?",
      "Could you describe your project plant growth and yield prediction?",
    ),
    "Could you describe your project on plant growth and yield prediction?",
  );
});
