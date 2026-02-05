const { describe, test } = require("node:test");
const assert = require("node:assert");

const { Scheduler } = require("../../../poller/scheduler");

describe("Poller scheduler", () => {
    test("scheduler executes due assignments", async () => {
        const results = [];
        const executeAssignment = async () => ({ status: 1, msg: "OK", latencyMs: 10 });
        const enqueueResult = (record) => results.push(record);

        const scheduler = new Scheduler({ logger: null, executeAssignment, enqueueResult });
        scheduler.updateAssignments([
            { monitor_id: 1, interval: 1, type: "http" },
            { monitor_id: 2, interval: 1, type: "dns" },
        ]);

        await scheduler.tick();

        assert.strictEqual(results.length, 2);
        assert.ok(results.every((entry) => entry.status === 1));
    });

    test("scheduler respects interval between runs", async () => {
        const results = [];
        const executeAssignment = async () => ({ status: 1, msg: "OK", latencyMs: 5 });
        const enqueueResult = (record) => results.push(record);

        const scheduler = new Scheduler({ logger: null, executeAssignment, enqueueResult });
        scheduler.updateAssignments([{ monitor_id: 1, interval: 60, type: "http" }]);

        await scheduler.tick();
        await scheduler.tick();

        assert.strictEqual(results.length, 1);
    });
});
