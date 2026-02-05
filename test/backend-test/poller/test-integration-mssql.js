const { describe, test } = require("node:test");
const assert = require("node:assert");
const { MSSQLServerContainer } = require("@testcontainers/mssqlserver");

const { executeAssignment } = require("../../../poller/executor");
const { UP } = require("../../../src/util");

/**
 * Start a test MSSQL container.
 * @returns {Promise<{container: import("@testcontainers/mssqlserver").StartedMSSQLServerContainer, connectionString: string}>} Container details
 */
async function createAndStartMSSQLContainer() {
    const container = await new MSSQLServerContainer("mcr.microsoft.com/mssql/server:2022-latest")
        .acceptLicense()
        .withStartupTimeout(120000)
        .start();

    return {
        container,
        connectionString: container.getConnectionUri(false),
    };
}

describe(
    "Poller executor MSSQL integration",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("executeAssignment returns UP for reachable MSSQL", async () => {
            const { container, connectionString } = await createAndStartMSSQLContainer();

            try {
                const result = await executeAssignment({
                    type: "sqlserver",
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
