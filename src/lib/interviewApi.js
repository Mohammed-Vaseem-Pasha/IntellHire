export async function parseAnswerResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  const body = await response.text();
  const status = response.status || 0;

  if (!body.trim()) {
    return {
      data: null,
      error: `The server returned an empty response (HTTP ${status}). Your answer is still available; retry submission.`,
    };
  }

  if (!/application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    const responseType = /text\/html/i.test(contentType) || /^\s*<!doctype html|^\s*<html/i.test(body)
      ? "HTML error page"
      : "non-JSON response";
    return {
      data: null,
      error: `The server returned a ${responseType} (HTTP ${status}). Your answer is still available; retry submission.`,
    };
  }

  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Unexpected JSON response shape.");
    }
    return { data, error: null };
  } catch {
    return {
      data: null,
      error: `The server returned malformed JSON (HTTP ${status}). Your answer is still available; retry submission.`,
    };
  }
}

export function formatAnswerResponseError(status, data) {
  const message = data?.message || data?.error || "Answer evaluation failed.";
  const phase = typeof data?.phase === "string" ? `; phase: ${data.phase}` : "";
  return `${message} (HTTP ${status}${phase})`;
}

export async function waitForAnswerResponse(
  url,
  options,
  onProcessing,
  {
    fetchRequest = globalThis.fetch,
    timers = globalThis,
    timeoutMs = 45000,
    maxAttempts = 90,
    pollIntervalMs = 500,
  } = {},
) {
  const controller = new AbortController();
  const timeout = timers.setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetchRequest(url, {
        ...options,
        signal: controller.signal,
      });
      if (response.status !== 202) return response;
      onProcessing?.();
      await new Promise((resolve) => timers.setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      "The answer is taking longer than expected. Your transcript is saved here; please retry submission.",
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Answer processing timed out. Your transcript is saved here; please retry submission.",
      );
    }
    throw error;
  } finally {
    timers.clearTimeout(timeout);
  }
}
