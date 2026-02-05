const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const settingsStore = new Map();
const Settings = {
    get: async (key) => settingsStore.get(key),
    set: async (key, value) => {
        settingsStore.set(key, value);
    },
};

const stubServer = {
    io: {
        to() {
            return { emit() {} };
        },
    },
    entryPage: "dashboard",
};

const stubUptimeKumaServer = {
    getInstance: () => stubServer,
};

const stubStatusPage = {
    async slugToID(slug) {
        return slug === "test" ? 1 : null;
    },
    async loadDomainMappingList() {},
};

const stubDatabase = {
    uploadDir: "/tmp/",
};

const stubImageDataURI = {
    async outputFile() {},
};

let storedStatusPage = null;
const stubR = {
    async findOne(_table, _where, params) {
        if (_table === "status_page" && params?.[0] === "test") {
            return {
                id: 1,
                slug: "test",
                title: "Test",
                icon: "",
                toJSON: async () => ({}),
                updateDomainNameList: async () => {},
            };
        }
        return null;
    },
    dispense(table) {
        if (table === "status_page") {
            return {
                id: 1,
                slug: "test",
                title: "Test",
                icon: "",
                toJSON: async () => ({}),
                updateDomainNameList: async () => {},
            };
        }
        return {};
    },
    isoDateTime() {
        return new Date().toISOString();
    },
    async store(bean) {
        if (bean && bean.slug) {
            storedStatusPage = bean;
        }
        return bean;
    },
    async exec() {},
};

/**
 * Register a stub module in Node's require cache.
 * @param {string} modulePath Module path
 * @param {object} exports Module exports
 * @returns {void}
 */
function stubModule(modulePath, exports) {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    };
}

stubModule(require.resolve("redbean-node"), { R: stubR });
stubModule(path.join(repoRoot, "server", "settings.js"), { Settings });
stubModule(path.join(repoRoot, "server", "uptime-kuma-server.js"), { UptimeKumaServer: stubUptimeKumaServer });
stubModule(path.join(repoRoot, "server", "model", "status_page.js"), stubStatusPage);
stubModule(path.join(repoRoot, "server", "database.js"), stubDatabase);
stubModule(path.join(repoRoot, "server", "image-data-uri.js"), stubImageDataURI);
stubModule(path.join(repoRoot, "server", "modules", "apicache.js"), { clear() {} });

const { statusPageSocketHandler } = require(path.join(repoRoot, "server", "socket-handlers", "status-page-socket-handler.js"));

/**
 * Create a lightweight socket stub for status page handlers.
 * @returns {{on: function, emit: function, handlers: Map, userID: number}} Socket stub
 */
function createSocket() {
    const handlers = new Map();
    return {
        on(event, handler) {
            handlers.set(event, handler);
        },
        emit(event, ...args) {
            const handler = handlers.get(event);
            if (handler) {
                handler(...args);
            }
        },
        handlers,
        userID: 1,
    };
}

/**
 * Build a PNG data URI payload of the requested size.
 * @param {number} byteLength Raw payload size
 * @returns {string} Data URI
 */
function makeDataUri(byteLength) {
    const payload = "A".repeat(byteLength);
    const base64 = Buffer.from(payload).toString("base64");
    return `data:image/png;base64,${base64}`;
}

test("status page logo rejects oversized data URI", async () => {
    settingsStore.clear();
    settingsStore.set("statusPageLogoMaxBytes", 1024);
    const socket = createSocket();
    statusPageSocketHandler(socket);

    const handler = socket.handlers.get("saveStatusPage");
    assert.ok(handler);

    await new Promise((resolve) => {
        handler(
            "test",
            { slug: "test", title: "Test", description: "", logo: "", theme: "auto" },
            makeDataUri(2048),
            [],
            (res) => {
                assert.equal(res.ok, false);
                assert.match(res.msg, /maximum size/i);
                resolve();
            }
        );
    });
});

test("status page logo accepts undersized data URI", async () => {
    settingsStore.clear();
    settingsStore.set("statusPageLogoMaxBytes", 2048);
    const socket = createSocket();
    statusPageSocketHandler(socket);

    const handler = socket.handlers.get("saveStatusPage");
    assert.ok(handler);

    await new Promise((resolve) => {
        handler(
            "test",
            { slug: "test", title: "Test", description: "", logo: "", theme: "auto" },
            makeDataUri(1024),
            [],
            (res) => {
                assert.equal(res.ok, true);
                resolve();
            }
        );
    });

    assert.ok(storedStatusPage);
});
