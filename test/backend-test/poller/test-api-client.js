const { describe, test, afterEach } = require("node:test");
const assert = require("node:assert");

const { PollerApiClient } = require("../../../poller/api-client");

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

describe("Poller API client", () => {
    test("includes bearer token and parses response", async () => {
        global.fetch = async (url, options) => {
            assert.ok(url.endsWith("/api/poller/heartbeat"));
            assert.strictEqual(options.headers.authorization, "Bearer test-token");
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true }),
            };
        };

        const client = new PollerApiClient({
            baseUrl: "https://central.example.com/",
            accessToken: "test-token",
            pollerId: 1,
        });

        const response = await client.heartbeat({ status: "online" });
        assert.deepStrictEqual(response, { ok: true });
    });

    test("fetchAssignments sets query params", async () => {
        global.fetch = async (url) => {
            const parsed = new URL(url);
            assert.strictEqual(parsed.searchParams.get("since_version"), "42");
            assert.strictEqual(parsed.searchParams.get("poller_id"), "9");
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true }),
            };
        };

        const client = new PollerApiClient({
            baseUrl: "https://central.example.com/",
            accessToken: null,
            pollerId: 9,
        });

        await client.fetchAssignments(42);
    });

    test("request throws on non-ok response", async () => {
        global.fetch = async () => ({
            ok: false,
            status: 500,
            text: async () => "fail",
        });

        const client = new PollerApiClient({
            baseUrl: "https://central.example.com/",
            accessToken: null,
            pollerId: null,
        });

        await assert.rejects(() => client.heartbeat({ status: "online" }), /Poller API request failed/);
    });
});
