const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const { Client } = require("pg");

const { executeAssignment } = require("../../../poller/executor");
const { UP } = require("../../../src/util");

const POSTGRES_READY_TIMEOUT_MS = 60000;
const POSTGRES_READY_RETRY_DELAY_MS = 1000;
const POSTGRES_READY_CONNECT_TIMEOUT_MS = 5000;

/**
 * Wait for Postgres to accept connections.
 * @param {string} connectionString Connection string
 * @returns {Promise<void>} Resolves when ready
 */
async function waitForPostgresReady(connectionString) {
    const deadline = Date.now() + POSTGRES_READY_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
        const client = new Client({
            connectionString,
            connectionTimeoutMillis: POSTGRES_READY_CONNECT_TIMEOUT_MS,
        });
        try {
            await client.connect();
            await client.query("SELECT 1");
            await client.end();
            return;
        } catch (error) {
            lastError = error;
            try {
                await client.end();
            } catch (_) {
                void _;
            }
            await new Promise((resolve) => setTimeout(resolve, POSTGRES_READY_RETRY_DELAY_MS));
        }
    }

    const message = lastError ? `${lastError.message}` : "Postgres did not become ready in time";
    throw new Error(message);
}

/**
 * Start a Postgres container for integration tests.
 * @returns {Promise<{container: import("testcontainers").StartedTestContainer, connectionString: string}>} Container details
 */
async function createAndStartPostgresContainer() {
    const database = "test";
    const username = "test";
    const password = "test";
    const port = 5432;
    const container = await new GenericContainer("postgres:16")
        .withEnvironment({
            POSTGRES_DB: database,
            POSTGRES_USER: username,
            POSTGRES_PASSWORD: password,
        })
        .withExposedPorts(port)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .withStartupTimeout(120000)
        .start();

    const connectionString = `postgres://${username}:${password}@${container.getHost()}:${container.getMappedPort(port)}/${database}`;
    await waitForPostgresReady(connectionString);

    return {
        container,
        connectionString,
    };
}

describe(
    "Poller executor Postgres integration",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("executeAssignment returns UP for successful query", async () => {
            const { container, connectionString } = await createAndStartPostgresContainer();

            try {
                const result = await executeAssignment({
                    type: "postgres",
                    config: {
                        databaseConnectionString: connectionString,
                        databaseQuery: "SELECT 1",
                        conditions: "[]",
                    },
                });

                assert.strictEqual(result.status, UP);
            } finally {
                await container.stop();
            }
        });
    }
);
