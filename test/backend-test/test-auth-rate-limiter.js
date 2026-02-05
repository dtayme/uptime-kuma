const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const basicAuth = require("express-basic-auth");

const { loginRateLimiter } = require("../../server/rate-limiter");

/**
 * Create a test server with basic auth + rate limiting.
 * @returns {Promise<import("http").Server>} HTTP server
 */
function createServer() {
    const app = express();
    app.use(
        basicAuth({
            authorizer: (username, password, callback) => {
                loginRateLimiter.pass(`${username}-key`, null, 0).then((pass) => {
                    if (pass) {
                        const ok = username === "user" && password === "pass";
                        callback(null, ok);
                        if (!ok) {
                            loginRateLimiter.removeTokens(`${username}-key`, 1);
                        }
                    } else {
                        callback(null, false);
                    }
                });
            },
            authorizeAsync: true,
            challenge: true,
        })
    );

    app.get("/secure", (_req, res) => {
        res.json({ ok: true });
    });

    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

/**
 * Issue a basic-auth request to the test server.
 * @param {import("http").Server} server Server instance
 * @param {string} username Username
 * @param {string} password Password
 * @returns {Promise<Response>} Fetch response
 */
async function request(server, username, password) {
    const { port } = server.address();
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    return fetch(`http://127.0.0.1:${port}/secure`, {
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });
}

test("rate limiting is keyed per username", async () => {
    const server = await createServer();

    try {
        // Exhaust limiter for user "alice"
        for (let i = 0; i < 21; i++) {
            await request(server, "alice", "wrong");
        }

        const blocked = await request(server, "alice", "wrong");
        assert.equal(blocked.status, 401);

        const otherUser = await request(server, "bob", "wrong");
        assert.equal(otherUser.status, 401);

        // bob should not be blocked by alice's limiter
        const bobSecond = await request(server, "bob", "wrong");
        assert.equal(bobSecond.status, 401);
    } finally {
        server.close();
    }
});
