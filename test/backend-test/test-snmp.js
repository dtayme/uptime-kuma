const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { SNMPMonitorType } = require("../../server/monitor-types/snmp");
const { UP } = require("../../src/util");
const snmp = require("net-snmp");
const dgram = require("node:dgram");

const SNMP_READY_TIMEOUT_MS = 60000;
const SNMP_READY_RETRY_DELAY_MS = 1000;
const SNMP_READY_CONNECT_TIMEOUT_MS = 2000;

/**
 * Wait until the SNMP agent responds or the timeout elapses.
 * @returns {Promise<void>} Resolves when SNMP is ready.
 */
async function waitForSnmpReady(host, port, community, oid) {
    const deadline = Date.now() + SNMP_READY_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
        let session;
        try {
            session = snmp.createSession(host, community, {
                port,
                retries: 0,
                timeout: SNMP_READY_CONNECT_TIMEOUT_MS,
                version: snmp.Version["2c"],
            });

            await new Promise((resolve, reject) => {
                session.on("error", reject);
                session.get([oid], (error) => {
                    error ? reject(error) : resolve();
                });
            });

            session.close();
            return;
        } catch (error) {
            lastError = error;
            if (session) {
                try {
                    session.close();
                } catch (_) {
                    void _;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, SNMP_READY_RETRY_DELAY_MS));
        }
    }

    const message = lastError ? `${lastError.message}` : "SNMP agent did not become ready in time";
    throw new Error(message);
}

/**
 *
 */
/**
 * Get a free UDP port for the local SNMP agent.
 * @returns {Promise<number>} The available UDP port.
 */
async function getFreeUdpPort() {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket("udp4");
        socket.once("error", reject);
        socket.bind(0, () => {
            const address = socket.address();
            socket.close(() => resolve(address.port));
        });
    });
}

/**
 *
 */
/**
 * Start a local SNMP agent.
 * @returns {import("net-snmp").Agent} The started agent.
 */
function startSnmpAgent(port) {
    const agent = snmp.createAgent(
        {
            port,
            accessControlModelType: snmp.AccessControlModelType.Simple,
        },
        (error) => {
            if (error) {
                throw error;
            }
        }
    );

    const authorizer = agent.getAuthorizer();
    authorizer.addCommunity("public");
    const acm = authorizer.getAccessControlModel();
    acm.setCommunityAccess("public", snmp.AccessLevel.ReadOnly);

    const sysDescrProvider = {
        name: "sysDescr",
        type: snmp.MibProviderType.Scalar,
        oid: "1.3.6.1.2.1.1.1",
        scalarType: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess["read-only"],
        defVal: "Uptime Kuma Test Agent",
    };
    agent.registerProvider(sysDescrProvider);
    agent.getMib().setScalarValue("sysDescr", "Uptime Kuma Test Agent");

    return agent;
}

describe("SNMPMonitorType", () => {
    test(
        "check() sets heartbeat to UP when SNMP agent responds",
        {
            skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
        },
        async () => {
            const hostIp = "127.0.0.1";
            const hostPort = await getFreeUdpPort();
            const agent = startSnmpAgent(hostPort);
            try {
                await waitForSnmpReady(hostIp, hostPort, "public", "1.3.6.1.2.1.1.1.0");

                const monitor = {
                    type: "snmp",
                    hostname: hostIp,
                    port: hostPort,
                    snmpVersion: "2c",
                    radiusPassword: "public",
                    snmpOid: "1.3.6.1.2.1.1.1.0",
                    timeout: 5,
                    maxretries: 1,
                    jsonPath: "$",
                    jsonPathOperator: "!=",
                    expectedValue: "",
                };

                const snmpMonitor = new SNMPMonitorType();
                const heartbeat = {};

                await snmpMonitor.check(monitor, heartbeat);

                assert.strictEqual(heartbeat.status, UP);
                assert.match(heartbeat.msg, /JSON query passes/);
            } finally {
                agent.close();
            }
        }
    );

    test(
        "check() throws when SNMP agent does not respond",
        {
            skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
        },
        async () => {
            const monitor = {
                type: "snmp",
                hostname: "127.0.0.1",
                port: 65530, // Assuming no SNMP agent is running here
                snmpVersion: "2c",
                radiusPassword: "public",
                snmpOid: "1.3.6.1.2.1.1.1.0",
                timeout: 1,
                maxretries: 1,
            };

            const snmpMonitor = new SNMPMonitorType();
            const heartbeat = {};

            await assert.rejects(() => snmpMonitor.check(monitor, heartbeat), /timeout|RequestTimedOutError/i);
        }
    );

    test("check() uses SNMPv3 noAuthNoPriv session when version is 3", async () => {
        const originalCreateV3Session = snmp.createV3Session;
        const originalCreateSession = snmp.createSession;

        let createV3Called = false;
        let createSessionCalled = false;
        let receivedOptions = null;

        // Stub createV3Session
        snmp.createV3Session = function (_host, _username, options) {
            createV3Called = true;
            receivedOptions = options;

            return {
                on: () => {},
                close: () => {},
                // Stop execution after session creation to avoid real network I/O.
                get: (_oids, cb) => cb(new Error("stop test here")),
            };
        };

        // Stub createSession
        snmp.createSession = function () {
            createSessionCalled = true;
            return {};
        };

        const monitor = {
            type: "snmp",
            hostname: "127.0.0.1",
            port: 161,
            timeout: 5,
            maxretries: 1,
            snmpVersion: "3",
            snmp_v3_username: "testuser",
            snmpOid: "1.3.6.1.2.1.1.1.0",
        };

        const snmpMonitor = new SNMPMonitorType();
        const heartbeat = {};

        await assert.rejects(() => snmpMonitor.check(monitor, heartbeat), /stop test here/);

        // Assertions
        assert.strictEqual(createV3Called, true);
        assert.strictEqual(createSessionCalled, false);
        assert.strictEqual(receivedOptions.securityLevel, snmp.SecurityLevel.noAuthNoPriv);

        // Restore originals
        snmp.createV3Session = originalCreateV3Session;
        snmp.createSession = originalCreateSession;
    });
});
