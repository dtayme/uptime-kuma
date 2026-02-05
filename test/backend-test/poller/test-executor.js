const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");

const { executeAssignment } = require("../../../poller/executor");
const { UP, DOWN } = require("../../../src/util");

let server;
let baseUrl;

before(async () => {
    server = http.createServer((req, res) => {
        if (req.url === "/json") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.setHeader("content-type", "text/plain");
        res.end("hello world");
    });

    await new Promise((resolve) => {
        server.listen(0, () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    if (!server) {
        return;
    }
    await new Promise((resolve) => server.close(resolve));
});

describe("Poller executor", () => {
    test("unsupported monitor types return DOWN", async () => {
        const result = await executeAssignment({ type: "unsupported", config: {} });
        assert.strictEqual(result.status, DOWN);
        assert.ok(result.msg.includes("Unsupported"));
    });

    test("http check returns UP for 200", async () => {
        const result = await executeAssignment({
            type: "http",
            config: {
                url: baseUrl,
                timeout: 5,
            },
        });
        assert.strictEqual(result.status, UP);
    });

    test("keyword check matches response", async () => {
        const result = await executeAssignment({
            type: "keyword",
            config: {
                url: baseUrl,
                keyword: "hello",
                timeout: 5,
            },
        });
        assert.strictEqual(result.status, UP);
    });

    test("json-query check matches expected value", async () => {
        const result = await executeAssignment({
            type: "json-query",
            config: {
                url: `${baseUrl}/json`,
                jsonPath: "$.ok",
                jsonPathOperator: "==",
                expectedValue: "true",
                timeout: 5,
            },
        });
        assert.strictEqual(result.status, UP);
    });
});
