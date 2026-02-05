const { describe, test, afterEach } = require("node:test");
const assert = require("node:assert");
const { R } = require("redbean-node");
const { Settings } = require("../../../server/settings");

const {
    buildAssignmentsForPoller,
    computeAssignmentVersion,
    parseCapabilities,
    pollerHasCapability,
    pollerWeight,
} = require("../../../server/poller/assignments");

const originalFind = R.find;
const originalSettingsGet = Settings.get;

afterEach(() => {
    R.find = originalFind;
    Settings.get = originalSettingsGet;
    Settings.stopCacheCleaner();
});

describe("Poller assignments", () => {
    test("parseCapabilities handles JSON strings and objects", () => {
        assert.deepStrictEqual(parseCapabilities('{"http":true}'), { http: true });
        assert.deepStrictEqual(parseCapabilities({ dns: true }), { dns: true });
        assert.deepStrictEqual(parseCapabilities("not-json"), {});
        assert.deepStrictEqual(parseCapabilities(null), {});
    });

    test("pollerHasCapability respects required capability", () => {
        assert.strictEqual(pollerHasCapability({ http: true }, ""), true);
        assert.strictEqual(pollerHasCapability({ http: true }, "http"), true);
        assert.strictEqual(pollerHasCapability({ http: false }, "http"), false);
        assert.strictEqual(pollerHasCapability({}, "dns"), false);
    });

    test("pollerWeight scales by configured weight and load", () => {
        assert.strictEqual(pollerWeight({ weight: 100, status: "online", queue_depth: 0 }), 1);
        assert.strictEqual(pollerWeight({ weight: 200, status: "online", queue_depth: 0 }), 2);
        assert.ok(pollerWeight({ weight: 100, status: "degraded", queue_depth: 0 }) < 1);
        assert.ok(pollerWeight({ weight: 100, status: "online", queue_depth: 4 }) < 1);
    });

    test("computeAssignmentVersion is deterministic", () => {
        const assignments = [
            { monitor_id: 1, type: "http" },
            { monitor_id: 2, type: "dns" },
        ];
        const first = computeAssignmentVersion(assignments);
        const second = computeAssignmentVersion(assignments);
        assert.strictEqual(first, second);
    });

    test("buildAssignmentsForPoller respects modes, capabilities, and availability", async () => {
        const pollerA = {
            id: 1,
            status: "online",
            region: "us-east",
            datacenter: "dc-1",
            capabilities: JSON.stringify({ http: true, dns: true }),
            weight: 100,
            queue_depth: 0,
        };
        const pollerB = {
            id: 2,
            status: "offline",
            region: "us-east",
            datacenter: "dc-2",
            capabilities: JSON.stringify({ http: true, dns: true }),
            weight: 100,
            queue_depth: 0,
        };

        const monitors = [
            {
                id: 11,
                interval: 60,
                type: "http",
                url: "https://example.com",
                poller_mode: "auto",
                poller_capability: "http",
            },
            {
                id: 12,
                interval: 60,
                type: "dns",
                hostname: "example.com",
                poller_mode: "grouped",
                poller_region: "us-east",
                poller_datacenter: "dc-1",
                poller_capability: "dns",
            },
            {
                id: 13,
                interval: 60,
                type: "http",
                url: "https://example.com",
                poller_mode: "pinned",
                poller_id: 1,
                poller_capability: "http",
            },
            {
                id: 14,
                interval: 60,
                type: "http",
                url: "https://example.com",
                poller_mode: "auto",
                poller_capability: "mqtt",
            },
        ];

        R.find = async (table) => {
            if (table === "poller") {
                return [pollerA, pollerB];
            }
            if (table === "monitor") {
                return monitors;
            }
            return [];
        };

        Settings.get = async () => undefined;

        const assignments = await buildAssignmentsForPoller(pollerA);
        const ids = assignments.map((entry) => entry.monitor_id).sort((a, b) => a - b);

        assert.deepStrictEqual(ids, [11, 12, 13]);
        assert.ok(assignments.find((entry) => entry.monitor_id === 11).config.url);
    });
});
