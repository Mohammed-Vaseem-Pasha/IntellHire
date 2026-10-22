function normalizeSentence(sentence) {
  return sentence
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionSentence(sentence) {
  return /\?/.test(sentence) || /^(?:who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|was|were|tell|describe|explain)\b/i.test(sentence.trim());
}

function areDuplicateSentences(left, right) {
  const normalizedLeft = normalizeSentence(left);
  const normalizedRight = normalizeSentence(right);
  if (normalizedLeft === normalizedRight) return true;

  const leftIsQuestion = isQuestionSentence(left);
  if (leftIsQuestion !== isQuestionSentence(right)) return false;

  const leftWords = normalizedLeft.split(" ").filter(Boolean);
  const rightWords = normalizedRight.split(" ").filter(Boolean);
  if (Math.abs(leftWords.length - rightWords.length) > 1) return false;

  const leftTokens = new Set(leftWords);
  const rightTokens = new Set(rightWords);
  const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const diceSimilarity = (2 * sharedTokens) / (leftTokens.size + rightTokens.size);
  return diceSimilarity >= (leftIsQuestion ? 0.9 : 0.95);
}

export function deduplicateInterviewResponse(text) {
  if (typeof text !== "string" || !text.trim()) return text;

  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const cleaned = [];
  for (const sentence of sentences) {
    const current = sentence.trim();
    if (!current) continue;
    const previous = cleaned[cleaned.length - 1];
    if (!previous || !areDuplicateSentences(previous, current)) cleaned.push(current);
  }
  return cleaned.join(" ");
}

export function buildSpokenInterviewResponse(reply, question) {
  return deduplicateInterviewResponse(
    [reply, question].filter((value) => typeof value === "string" && value.trim()).join(" "),
  );
}
