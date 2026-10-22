const test = require("node:test");
const assert = require("node:assert/strict");
const { getCompletedInterviewHistory } = require("../services/interviewHistory");

function createSessionModel(documents) {
    const calls = {};
    const query = {
        select(projection) {
            calls.projection = projection;
            return this;
        },
        sort(order) {
            calls.sort = order;
            return this;
        },
        lean() {
            const filtered = documents.filter((document) =>
                Object.entries(calls.filter).every(([key, value]) => {
                    if (value && Array.isArray(value.$in)) return value.$in.includes(document[key]);
                    return document[key] === value;
                })
            );
            // Apply the actual sort config recorded by the sort() call
            const sortEntries = Object.entries(calls.sort || {});
            calls.result = filtered.sort((left, right) => {
                for (const [key, direction] of sortEntries) {
                    const leftValue = left[key];
                    const rightValue = right[key];
                    let comparison = 0;
                    if (leftValue instanceof Date && rightValue instanceof Date) {
                        comparison = leftValue - rightValue;
                    } else if (typeof leftValue === "string" && typeof rightValue === "string") {
                        comparison = leftValue.localeCompare(rightValue);
                    } else {
                        comparison = (leftValue ?? 0) - (rightValue ?? 0);
                    }
                    if (comparison !== 0) return comparison * direction;
                }
                return 0;
            });
            return Promise.resolve(calls.result);
        },
    };

    return {
        calls,
        model: {
            find(filter) {
                calls.filter = filter;
                return query;
            },
        },
    };
}

test("history is sorted by updatedAt descending with _id as tie-breaker", async () => {
    const documents = [
        { _id: "b", firebaseUid: "candidate-a", status: "completed", createdAt: new Date(2), updatedAt: new Date(20) },
        { _id: "a", firebaseUid: "candidate-a", status: "completed", createdAt: new Date(1), updatedAt: new Date(30) },
        { _id: "c", firebaseUid: "candidate-b", status: "completed", createdAt: new Date(1), updatedAt: new Date(40) },
        { _id: "d", firebaseUid: "candidate-a", status: "in_progress", createdAt: new Date(0), updatedAt: new Date(10) },
        { _id: "e", firebaseUid: "candidate-a", status: "cancelled", createdAt: new Date(3), updatedAt: new Date(50) },
    ];
    const { model, calls } = createSessionModel(documents);

    const history = await getCompletedInterviewHistory(model, "candidate-a");

    assert.deepEqual(calls.filter, {
        firebaseUid: "candidate-a",
    });
    assert.equal(calls.projection, "_id jobRole createdAt updatedAt status interviewState completionReason currentQuestionIndex targetQuestionCount interruptedDraftAnswer interruptedDraftQuestion interruptedDraftQuestionIndex reportStatus report conversation");
    assert.deepEqual(calls.sort, { updatedAt: -1, _id: -1 });
    // Descending updatedAt: e(50) > a(30) > b(20) > d(10)
    assert.deepEqual(history.map(({ _id }) => _id), ["e", "a", "b", "d"]);
});

test("newest completed interview with a score appears first", async () => {
    const documents = [
        {
            _id: "older-completed",
            firebaseUid: "user-1",
            status: "completed",
            reportStatus: "ready",
            report: { overallScore: 72 },
            createdAt: new Date(100),
            updatedAt: new Date(200),
        },
        {
            _id: "newer-completed",
            firebaseUid: "user-1",
            status: "completed",
            reportStatus: "ready",
            report: { overallScore: 85 },
            createdAt: new Date(300),
            updatedAt: new Date(400),
        },
    ];
    const { model } = createSessionModel(documents);

    const history = await getCompletedInterviewHistory(model, "user-1");

    assert.equal(history[0]._id, "newer-completed");
    assert.equal(history[0].report.overallScore, 85);
    assert.equal(history[1]._id, "older-completed");
    assert.equal(history[1].report.overallScore, 72);
});

test("in-progress session with null score does not hide a completed interview's score", async () => {
    const documents = [
        {
            _id: "completed-session",
            firebaseUid: "user-1",
            status: "completed",
            reportStatus: "ready",
            report: { overallScore: 90 },
            createdAt: new Date(100),
            updatedAt: new Date(200),
        },
        {
            _id: "in-progress-session",
            firebaseUid: "user-1",
            status: "in_progress",
            reportStatus: "not_started",
            report: { overallScore: null },
            createdAt: new Date(300),
            updatedAt: new Date(400),
        },
    ];
    const { model } = createSessionModel(documents);

    const history = await getCompletedInterviewHistory(model, "user-1");

    // in_progress is first by updatedAt, but the dashboard must look for a scored interview
    assert.equal(history[0]._id, "in-progress-session");
    assert.equal(history[0].report.overallScore, null);
    assert.equal(history[1]._id, "completed-session");
    assert.equal(history[1].report.overallScore, 90);

    // Simulate what the dashboard should do: find first with a valid score
    const latestScoredInterview = history.find(
        (i) => i.report?.overallScore != null && (i.status === "completed" || i.status === "cancelled")
    );
    assert.equal(latestScoredInterview._id, "completed-session");
    assert.equal(latestScoredInterview.report.overallScore, 90);
});

test("history keeps the persisted report and report status for safe retry", async () => {
    const report = {
        overallScore: 82,
        communicationScore: 76,
        technicalScore: 88,
        strengths: ["Clear examples"],
        questionReviews: [{ candidateAnswer: "A grounded answer" }],
    };
    const { model } = createSessionModel([
        {
            _id: "session-1",
            firebaseUid: "candidate-a",
            status: "completed",
            reportStatus: "failed",
            report,
            createdAt: new Date(1),
            updatedAt: new Date(1),
        },
    ]);

    const [interview] = await getCompletedInterviewHistory(model, "candidate-a");

    assert.equal(interview.reportStatus, "failed");
    assert.deepEqual(interview.report, report);
});

test("tie-breaker uses _id descending when updatedAt values are identical", async () => {
    const sameTime = new Date(500);
    const documents = [
        { _id: "alpha", firebaseUid: "user-1", status: "completed", createdAt: sameTime, updatedAt: sameTime },
        { _id: "bravo", firebaseUid: "user-1", status: "completed", createdAt: sameTime, updatedAt: sameTime },
        { _id: "charlie", firebaseUid: "user-1", status: "completed", createdAt: sameTime, updatedAt: sameTime },
    ];
    const { model } = createSessionModel(documents);

    const history = await getCompletedInterviewHistory(model, "user-1");

    // _id descending: charlie > bravo > alpha
    assert.deepEqual(history.map(({ _id }) => _id), ["charlie", "bravo", "alpha"]);
});

test("missing updatedAt values are handled safely", async () => {
    const documents = [
        { _id: "has-timestamp", firebaseUid: "user-1", status: "completed", createdAt: new Date(100), updatedAt: new Date(200) },
        { _id: "no-timestamp", firebaseUid: "user-1", status: "completed", createdAt: new Date(50), updatedAt: null },
    ];
    const { model } = createSessionModel(documents);

    const history = await getCompletedInterviewHistory(model, "user-1");

    // Document with a valid updatedAt should sort before null
    assert.equal(history[0]._id, "has-timestamp");
});
