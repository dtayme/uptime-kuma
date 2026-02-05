const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const mysql = require("mysql2");

const { executeAssignment } = require("../../../poller/executor");
const { UP } = require("../../../src/util");

const MYSQL_READY_TIMEOUT_MS = 60000;
const MYSQL_READY_RETRY_DELAY_MS = 1000;
const MYSQL_READY_CONNECT_TIMEOUT_MS = 5000;

/**
 * Wait for MariaDB to accept connections.
 * @param {string} connectionString Connection string
 * @returns {Promise<void>} Resolves when ready
 */
async function waitForMariaDbReady(connectionString) {
    const deadline = Date.now() + MYSQL_READY_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            await new Promise((resolve, reject) => {
                const connection = mysql.createConnection({
                    uri: connectionString,
                    connectTimeout: MYSQL_READY_CONNECT_TIMEOUT_MS,
                });

                connection.query("SELECT 1", (err) => {
                    try {
                        connection.end();
                    } catch (_) {
                        void _;
                        connection.destroy();
                    }

                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });

            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, MYSQL_READY_RETRY_DELAY_MS));
        }
    }

    const message = lastError ? `${lastError.message}` : "MariaDB did not become ready in time";
    throw new Error(message);
}

/**
 * Start a MariaDB container for integration tests.
 * @returns {Promise<{container: import("testcontainers").StartedTestContainer, connectionString: string}>} Container details
 */
async function createAndStartMariaDBContainer() {
    const database = "test";
    const username = "test";
    const password = "test";
    const port = 3306;
    const container = await new GenericContainer("mariadb:10.11")
        .withEnvironment({
            MARIADB_DATABASE: database,
            MARIADB_USER: username,
            MARIADB_PASSWORD: password,
            MARIADB_ROOT_PASSWORD: password,
        })
        .withExposedPorts(port)
        .withWaitStrategy(Wait.forLogMessage(/port: 3306/))
        .withStartupTimeout(120000)
        .start();

    const connectionString = `mysql://${username}:${password}@${container.getHost()}:${container.getMappedPort(port)}/${database}`;
    await waitForMariaDbReady(connectionString);

    return {
        container,
        connectionString,
    };
}

describe(
    "Poller executor MySQL integration",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("executeAssignment returns UP for condition-matching query", async () => {
            const { container, connectionString } = await createAndStartMariaDBContainer();

            try {
                const result = await executeAssignment({
                    type: "mysql",
                    config: {
                        databaseConnectionString: connectionString,
                        databaseQuery: "SELECT 42 AS value",
                        conditions: JSON.stringify([
                            {
                                type: "expression",
                                andOr: "and",
                                variable: "result",
                                operator: "equals",
                                value: "42",
                            },
                        ]),
                    },
                });

                assert.strictEqual(result.status, UP);
            } finally {
                await container.stop();
            }
        });
    }
);
