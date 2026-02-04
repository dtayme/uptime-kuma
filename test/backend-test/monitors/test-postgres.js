const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const { Client } = require("pg");
const { PostgresMonitorType } = require("../../../server/monitor-types/postgres");
const { UP, PENDING } = require("../../../src/util");

const POSTGRES_READY_TIMEOUT_MS = 60000;
const POSTGRES_READY_RETRY_DELAY_MS = 1000;

/**
 * Wait until Postgres accepts connections or the timeout elapses.
 * @returns {Promise<void>} Resolves when the server is ready.
 */
async function waitForPostgresReady(connectionString) {
    const deadline = Date.now() + POSTGRES_READY_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
        const client = new Client({ connectionString });
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
 * Helper function to create and start a Postgres container.
 * @returns {Promise<{container: import("testcontainers").StartedTestContainer, connectionString: string}>} The started container and connection string.
 */
async function createAndStartPostgresContainer() {
    const database = "test";
    const username = "test";
    const password = "test";
    const port = 5432;

    const container = await new GenericContainer("postgres:latest")
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
    "Postgres Single Node",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("check() sets status to UP when Postgres server is reachable", async () => {
            const { container, connectionString } = await createAndStartPostgresContainer();
            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                databaseConnectionString: connectionString,
            };

            const heartbeat = {
                msg: "",
                status: PENDING,
            };

            try {
                await postgresMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                await container.stop();
            }
        });

        test("check() rejects when Postgres server is not reachable", async () => {
            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                databaseConnectionString: "http://localhost:15432",
            };

            const heartbeat = {
                msg: "",
                status: PENDING,
            };

            // regex match any string
            const regex = /.+/;

            await assert.rejects(postgresMonitor.check(monitor, heartbeat, {}), regex);
        });
    }
);
