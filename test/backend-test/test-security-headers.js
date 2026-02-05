const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
let helmet = null;
try {
    helmet = require("helmet");
} catch {
    helmet = null;
}

const { buildHelmetConfig, permissionsPolicyMiddleware } = require("../../server/security-headers");

/**
 * Create a test server with Helmet configured.
 * @param {boolean} isDev Whether to use dev config
 * @returns {Promise<{server: import("http").Server, baseUrl: string}>} Server and base URL
 */
async function createServer(isDev) {
    const app = express();
    if (!helmet) {
        throw new Error("Helmet is not installed");
    }
    app.use(helmet(buildHelmetConfig(isDev)));
    app.use(permissionsPolicyMiddleware());
    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    return { server, baseUrl };
}

/**
 * Read a header value as a string.
 * @param {Response} response Fetch response
 * @param {string} name Header name
 * @returns {string} Header value
 */
function getHeader(response, name) {
    return response.headers.get(name) || "";
}

test("helmet adds CSP + referrer + permissions headers (prod)", async (t) => {
    if (!helmet) {
        t.skip("helmet not installed");
        return;
    }
    const { server, baseUrl } = await createServer(false);
    try {
        const res = await fetch(`${baseUrl}/health`);
        const csp = getHeader(res, "content-security-policy");
        const referrer = getHeader(res, "referrer-policy");
        const permissions = getHeader(res, "permissions-policy");

        assert.ok(csp.includes("default-src 'self'"));
        assert.ok(csp.includes("object-src 'none'"));
        assert.ok(csp.includes("base-uri 'self'"));
        assert.ok(csp.includes("frame-ancestors 'self'"));
        assert.ok(csp.includes("img-src 'self' data: blob: https:"));
        assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"));
        assert.equal(referrer, "strict-origin-when-cross-origin");
        assert.ok(permissions.includes("geolocation=()"));
        assert.ok(permissions.includes("camera=()"));
        assert.ok(permissions.includes("microphone=()"));
    } finally {
        server.close();
    }
});

test("helmet CSP includes unsafe-eval in dev", async (t) => {
    if (!helmet) {
        t.skip("helmet not installed");
        return;
    }
    const { server, baseUrl } = await createServer(true);
    try {
        const res = await fetch(`${baseUrl}/health`);
        const csp = getHeader(res, "content-security-policy");
        assert.ok(csp.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));
    } finally {
        server.close();
    }
});
