const { describe, test } = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");

const {
    initSchema,
    queueDepth,
    enqueueResult,
    dequeueBatch,
    markDelivered,
    updateRetry,
    pruneExpired,
    loadAssignments,
    saveAssignments,
} = require("../../../poller/queue");

describe("Poller queue", () => {
    test("queue operations behave as expected", () => {
        const db = new Database(":memory:");
        initSchema(db);

        assert.strictEqual(queueDepth(db), 0);

        const now = Date.now();

        enqueueResult(db, {
            monitorId: 1,
            ts: now,
            status: 1,
            latencyMs: 42,
            msg: "OK",
        });

        enqueueResult(db, {
            monitorId: 2,
            ts: now - 1000,
            status: 0,
            latencyMs: null,
            msg: "Down",
            nextRetryAt: now + 100000,
        });

        assert.strictEqual(queueDepth(db), 2);

        const batch = dequeueBatch(db, 10);
        assert.strictEqual(batch.length, 1);
        assert.strictEqual(batch[0].monitor_id, 1);

        updateRetry(db, batch[0].id, 1, Date.now() + 5000);

        markDelivered(db, [batch[0].id]);
        assert.strictEqual(queueDepth(db), 1);

        pruneExpired(db, 0);
        assert.strictEqual(queueDepth(db), 0);
    });

    test("assignment snapshot roundtrip", () => {
        const db = new Database(":memory:");
        initSchema(db);

        const snapshot = {
            assignments: [{ monitor_id: 10, type: "http" }],
        };

        saveAssignments(db, 1234, snapshot);
        const loaded = loadAssignments(db);

        assert.ok(loaded);
        assert.strictEqual(loaded.assignmentVersion, 1234);
        assert.strictEqual(loaded.assignments.length, 1);
        assert.strictEqual(loaded.assignments[0].monitor_id, 10);
    });
});
