const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const snmp = require("net-snmp");
const dgram = require("node:dgram");

const { executeAssignment } = require("../../../poller/executor");
const { UP } = require("../../../src/util");

const SNMP_READY_TIMEOUT_MS = 60000;
const SNMP_READY_RETRY_DELAY_MS = 1000;
const SNMP_READY_CONNECT_TIMEOUT_MS = 2000;

/**
 * Wait for the SNMP agent to respond to a query.
 * @param {string} host Hostname
 * @param {number} port Port
 * @param {string} community Community string
 * @param {string} oid OID to query
 * @returns {Promise<void>} Resolves when agent is ready
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
 * Allocate a free UDP port for the local SNMP agent.
 * @returns {Promise<number>} Free UDP port
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
 * Start a local SNMP agent for tests.
 * @param {number} port UDP port
 * @returns {import("net-snmp").Agent} SNMP agent instance
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

describe(
    "Poller executor SNMP integration",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("executeAssignment returns UP when SNMP agent responds", async () => {
            const hostIp = "127.0.0.1";
            const hostPort = await getFreeUdpPort();
            const agent = startSnmpAgent(hostPort);
            try {
                await waitForSnmpReady(hostIp, hostPort, "public", "1.3.6.1.2.1.1.1.0");

                const result = await executeAssignment({
                    type: "snmp",
                    config: {
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
                    },
                });

                assert.strictEqual(result.status, UP);
                assert.match(result.msg, /JSON query passes/);
            } finally {
                agent.close();
            }
        });
    }
);
