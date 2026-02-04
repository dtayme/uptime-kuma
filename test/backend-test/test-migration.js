const { describe, test } = require("node:test");
const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const mysql = require("mysql2");

const MYSQL_READY_TIMEOUT_MS = 60000;
const MYSQL_READY_RETRY_DELAY_MS = 1000;
const MYSQL_READY_CONNECT_TIMEOUT_MS = 5000;

/**
 * Wait until MySQL/MariaDB accepts connections or the timeout elapses.
 * @returns {Promise<void>} Resolves when the server is ready.
 */
async function waitForMysqlReady(connectionString) {
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

    const message = lastError ? `${lastError.message}` : "Database did not become ready in time";
    throw new Error(message);
}

describe(
    "Database Migration",
    {
        concurrency: 1,
    },
    () => {
        test("SQLite migrations run successfully from fresh database", async () => {
            const testDbPath = path.join(__dirname, "../../data/test-migration.db");
            const testDbDir = path.dirname(testDbPath);

            // Ensure data directory exists
            if (!fs.existsSync(testDbDir)) {
                fs.mkdirSync(testDbDir, { recursive: true });
            }

            // Clean up any existing test database
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }

            // Use the same SQLite driver as the project
            const Dialect = require("knex/lib/dialects/better-sqlite3/index.js");

            const knex = require("knex");
            const db = knex({
                client: Dialect,
                connection: {
                    filename: testDbPath,
                },
                useNullAsDefault: true,
            });

            // Setup R (redbean) with knex instance like production code does
            const { R } = require("redbean-node");
            R.setup(db);

            try {
                // Use production code to initialize SQLite tables (like first run)
                const { createTables } = require("../../db/knex_init_db.js");
                await createTables();

                // Run all migrations like production code does
                await R.knex.migrate.latest({
                    directory: path.join(__dirname, "../../db/knex_migrations"),
                });

                // Test passes if migrations complete successfully without errors
            } finally {
                // Clean up
                await R.knex.destroy();
                if (fs.existsSync(testDbPath)) {
                    fs.unlinkSync(testDbPath);
                }
            }
        });

        test(
            "MariaDB migrations run successfully from fresh database",
            {
                skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
            },
            async () => {
                // Start MariaDB container (using MariaDB 12 to match current production)
                const mariadbDatabase = "kuma_test";
                const mariadbUser = "kuma";
                const mariadbPassword = "kuma";
                const mariadbContainer = await new GenericContainer("mariadb:12")
                    .withEnvironment({
                        MYSQL_ROOT_PASSWORD: "root",
                        MYSQL_DATABASE: mariadbDatabase,
                        MYSQL_USER: mariadbUser,
                        MYSQL_PASSWORD: mariadbPassword,
                    })
                    .withExposedPorts(3306)
                    .withWaitStrategy(Wait.forLogMessage(/port: 3306/i))
                    .withStartupTimeout(120000)
                    .start();

                const mariadbConnectionString = `mysql://${mariadbUser}:${mariadbPassword}@${mariadbContainer.getHost()}:${mariadbContainer.getMappedPort(3306)}/${mariadbDatabase}`;
                await waitForMysqlReady(mariadbConnectionString);

                const knex = require("knex");
                const knexInstance = knex({
                    client: "mysql2",
                    connection: {
                        host: mariadbContainer.getHost(),
                        port: mariadbContainer.getMappedPort(3306),
                        user: mariadbUser,
                        password: mariadbPassword,
                        database: mariadbDatabase,
                        connectTimeout: 60000,
                    },
                    pool: {
                        min: 0,
                        max: 10,
                        acquireTimeoutMillis: 60000,
                        idleTimeoutMillis: 60000,
                    },
                });

                // Setup R (redbean) with knex instance like production code does
                const { R } = require("redbean-node");
                R.setup(knexInstance);

                try {
                    // Use production code to initialize MariaDB tables
                    const { createTables } = require("../../db/knex_init_db.js");
                    await createTables();

                    // Run all migrations like production code does
                    await R.knex.migrate.latest({
                        directory: path.join(__dirname, "../../db/knex_migrations"),
                    });

                    // Test passes if migrations complete successfully without errors
                } finally {
                    // Clean up
                    try {
                        await R.knex.destroy();
                    } catch (e) {
                        void e;
                        // Ignore cleanup errors
                    }
                    try {
                        await mariadbContainer.stop();
                    } catch (e) {
                        void e;
                        // Ignore cleanup errors
                    }
                }
            }
        );

        test(
            "MySQL migrations run successfully from fresh database",
            {
                skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
            },
            async () => {
                // Start MySQL 8.0 container (the version mentioned in the issue)
                const mysqlDatabase = "kuma_test";
                const mysqlUser = "kuma";
                const mysqlPassword = "kuma";
                const mysqlContainer = await new GenericContainer("mysql:8.0")
                    .withEnvironment({
                        MYSQL_ROOT_PASSWORD: "root",
                        MYSQL_DATABASE: mysqlDatabase,
                        MYSQL_USER: mysqlUser,
                        MYSQL_PASSWORD: mysqlPassword,
                    })
                    .withExposedPorts(3306)
                    .withWaitStrategy(Wait.forLogMessage(/port: 3306/i))
                    .withStartupTimeout(120000)
                    .start();

                const mysqlConnectionString = `mysql://${mysqlUser}:${mysqlPassword}@${mysqlContainer.getHost()}:${mysqlContainer.getMappedPort(3306)}/${mysqlDatabase}`;
                await waitForMysqlReady(mysqlConnectionString);

                const knex = require("knex");
                const knexInstance = knex({
                    client: "mysql2",
                    connection: {
                        host: mysqlContainer.getHost(),
                        port: mysqlContainer.getMappedPort(3306),
                        user: mysqlUser,
                        password: mysqlPassword,
                        database: mysqlDatabase,
                        connectTimeout: 60000,
                    },
                    pool: {
                        min: 0,
                        max: 10,
                        acquireTimeoutMillis: 60000,
                        idleTimeoutMillis: 60000,
                    },
                });

                // Setup R (redbean) with knex instance like production code does
                const { R } = require("redbean-node");
                R.setup(knexInstance);

                try {
                    // Use production code to initialize MySQL tables
                    const { createTables } = require("../../db/knex_init_db.js");
                    await createTables();

                    // Run all migrations like production code does
                    await R.knex.migrate.latest({
                        directory: path.join(__dirname, "../../db/knex_migrations"),
                    });

                    // Test passes if migrations complete successfully without errors
                } finally {
                    // Clean up
                    try {
                        await R.knex.destroy();
                    } catch (e) {
                        void e;
                        // Ignore cleanup errors
                    }
                    try {
                        await mysqlContainer.stop();
                    } catch (e) {
                        void e;
                        // Ignore cleanup errors
                    }
                }
            }
        );
    }
);
