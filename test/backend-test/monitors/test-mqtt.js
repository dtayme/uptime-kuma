const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const mqtt = require("mqtt");
const { MqttMonitorType } = require("../../../server/monitor-types/mqtt");
const { UP, PENDING } = require("../../../src/util");

const MQTT_READY_TIMEOUT_MS = 60000;
const MQTT_READY_RETRY_DELAY_MS = 1000;
const MQTT_READY_CONNECT_TIMEOUT_MS = 5000;
const MQTT_CONTAINER_STARTUP_TIMEOUT_MS = 120000;
const MQTT_CONTAINER_IMAGE = "hivemq/hivemq-ce:2023.5";
const MQTT_CONTAINER_PORT = 1883;
const MQTT_CONTAINER_TMPFS = {
    "/opt/hivemq/log": "rw",
    "/opt/hivemq/data": "rw",
};

/**
 *
 */
async function startMqttContainer() {
    return new GenericContainer(MQTT_CONTAINER_IMAGE)
        .withExposedPorts(MQTT_CONTAINER_PORT)
        .withWaitStrategy(Wait.forLogMessage(/Started HiveMQ in/i))
        .withTmpFs(MQTT_CONTAINER_TMPFS)
        .withStartupTimeout(MQTT_CONTAINER_STARTUP_TIMEOUT_MS)
        .start();
}

let hiveMQContainer;
let connectionString;
let mqttHost;
let mqttPort;

/**
 * Wait until the MQTT broker accepts a connection or the timeout elapses.
 * @returns {Promise<void>} Resolves when broker is ready.
 */
async function waitForMqttReady(connectionString) {
    const deadline = Date.now() + MQTT_READY_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            await new Promise((resolve, reject) => {
                const client = mqtt.connect(connectionString, {
                    reconnectPeriod: 0,
                    connectTimeout: MQTT_READY_CONNECT_TIMEOUT_MS,
                });

                const timeout = setTimeout(() => {
                    client.end(true);
                    reject(new Error("MQTT broker connection attempt timed out"));
                }, MQTT_READY_CONNECT_TIMEOUT_MS);

                const cleanup = (err) => {
                    clearTimeout(timeout);
                    client.end(true, () => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                };

                client.once("connect", () => cleanup());
                client.once("error", (error) => cleanup(error));
            });

            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, MQTT_READY_RETRY_DELAY_MS));
        }
    }

    const message = lastError ? `${lastError.message}` : "MQTT broker did not become ready in time";
    throw new Error(message);
}

/**
 * Runs an MQTT test with the
 * @param  {string} mqttSuccessMessage the message that the monitor expects
 * @param {null|"keyword"|"json-query"} mqttCheckType the type of check we perform
 * @param {string} receivedMessage what message is received from the mqtt channel
 * @param {string} monitorTopic which MQTT topic is monitored (wildcards are allowed)
 * @param {string} publishTopic to which MQTT topic the message is sent
 * @param {string|null} conditions JSON string of conditions or null
 * @returns {Promise<Heartbeat>} the heartbeat produced by the check
 */
async function testMqtt(
    mqttSuccessMessage,
    mqttCheckType,
    receivedMessage,
    monitorTopic = "test",
    publishTopic = "test",
    conditions = null
) {
    if (!connectionString) {
        throw new Error("MQTT test broker was not initialized");
    }
    const mqttMonitorType = new MqttMonitorType();
    const monitor = {
        jsonPath: "firstProp", // always return firstProp for the json-query monitor
        hostname: mqttHost,
        mqttTopic: monitorTopic,
        port: mqttPort,
        mqttUsername: null,
        mqttPassword: null,
        mqttWebsocketPath: null, // for WebSocket connections
        interval: 20, // controls the timeout
        mqttSuccessMessage: mqttSuccessMessage, // for keywords
        expectedValue: mqttSuccessMessage, // for json-query
        mqttCheckType: mqttCheckType,
        conditions: conditions, // for conditions system
    };
    const heartbeat = {
        msg: "",
        status: PENDING,
    };

    const testMqttClient = mqtt.connect(connectionString, {
        reconnectPeriod: 0,
        connectTimeout: MQTT_READY_CONNECT_TIMEOUT_MS,
    });
    const publishPromise = new Promise((resolve, reject) => {
        const onError = (error) => {
            testMqttClient.removeListener("connect", onConnect);
            reject(error);
        };
        const onConnect = () => {
            testMqttClient.publish(publishTopic, receivedMessage, { retain: true }, (publishError) => {
                if (publishError) {
                    onError(publishError);
                    return;
                }
                resolve();
            });
        };
        testMqttClient.once("error", onError);
        testMqttClient.once("connect", onConnect);
    });
    await publishPromise;

    try {
        await mqttMonitorType.check(monitor, heartbeat, {});
    } finally {
        try {
            await new Promise((resolve) => {
                testMqttClient.publish(publishTopic, "", { retain: true }, resolve);
            });
        } catch (error) {
            void error;
        }
        testMqttClient.end();
    }
    return heartbeat;
}

describe(
    "MqttMonitorType",
    {
        concurrency: 1,
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        before(async () => {
            hiveMQContainer = await startMqttContainer();
            const host = hiveMQContainer.getHost();
            mqttPort = hiveMQContainer.getMappedPort(MQTT_CONTAINER_PORT);
            connectionString = `mqtt://${host}:${mqttPort}`;
            mqttHost = `mqtt://${host}`;
            await waitForMqttReady(connectionString);
        });

        after(async () => {
            if (hiveMQContainer) {
                await hiveMQContainer.stop();
                hiveMQContainer = null;
                connectionString = null;
                mqttHost = null;
                mqttPort = null;
            }
        });

        test("check() sets status to UP when keyword is found in message (type=default)", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: test; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when keyword is found in nested topic", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-", "a/b/c", "a/b/c");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: a/b/c; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when keyword is found in nested topic with special characters", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-", "a/'/$/./*/%", "a/'/$/./*/%");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: a/'/$/./*/%; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when keyword is found using # wildcard", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-", "a/#", "a/b/c");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: a/b/c; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when keyword is found using + wildcard", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-", "a/+/c", "a/b/c");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: a/b/c; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when keyword is found using + and # wildcards", async () => {
            const heartbeat = await testMqtt("KEYWORD", null, "-> KEYWORD <-", "a/+/c/#", "a/b/c/d/e");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: a/b/c/d/e; Message: -> KEYWORD <-");
        });

        test("check() rejects with timeout when topic does not match", async () => {
            await assert.rejects(
                testMqtt("keyword will not be checked anyway", null, "message", "x/y/z", "a/b/c"),
                new Error("Timeout, Message not received")
            );
        });

        test("check() rejects with timeout when # wildcard is not last character", async () => {
            await assert.rejects(
                testMqtt("", null, "# should be last character", "#/c", "a/b/c"),
                new Error("Timeout, Message not received")
            );
        });

        test("check() rejects with timeout when + wildcard topic does not match", async () => {
            await assert.rejects(
                testMqtt("", null, "message", "x/+/z", "a/b/c"),
                new Error("Timeout, Message not received")
            );
        });

        test("check() sets status to UP when keyword is found in message (type=keyword)", async () => {
            const heartbeat = await testMqtt("KEYWORD", "keyword", "-> KEYWORD <-");
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: test; Message: -> KEYWORD <-");
        });

        test("check() rejects when keyword is not found in message (type=default)", async () => {
            await assert.rejects(
                testMqtt("NOT_PRESENT", null, "-> KEYWORD <-"),
                new Error("Message Mismatch - Topic: test; Message: -> KEYWORD <-")
            );
        });

        test("check() rejects when keyword is not found in message (type=keyword)", async () => {
            await assert.rejects(
                testMqtt("NOT_PRESENT", "keyword", "-> KEYWORD <-"),
                new Error("Message Mismatch - Topic: test; Message: -> KEYWORD <-")
            );
        });

        test("check() sets status to UP when json-query finds expected value", async () => {
            // works because the monitors' jsonPath is hard-coded to "firstProp"
            const heartbeat = await testMqtt("present", "json-query", '{"firstProp":"present"}');
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Message received, expected value is found");
        });

        test("check() rejects when json-query path returns undefined", async () => {
            // works because the monitors' jsonPath is hard-coded to "firstProp"
            await assert.rejects(
                testMqtt("[not_relevant]", "json-query", "{}"),
                new Error("Message received but value is not equal to expected value, value was: [undefined]")
            );
        });

        test("check() rejects when json-query value does not match expected value", async () => {
            // works because the monitors' jsonPath is hard-coded to "firstProp"
            await assert.rejects(
                testMqtt("[wrong_success_messsage]", "json-query", '{"firstProp":"present"}'),
                new Error("Message received but value is not equal to expected value, value was: [present]")
            );
        });

        // Conditions system tests
        test("check() sets status to UP when message condition matches (contains)", async () => {
            const conditions = JSON.stringify([
                {
                    type: "expression",
                    variable: "message",
                    operator: "contains",
                    value: "KEYWORD",
                },
            ]);
            const heartbeat = await testMqtt("", null, "-> KEYWORD <-", "test", "test", conditions);
            assert.strictEqual(heartbeat.status, UP);
            assert.strictEqual(heartbeat.msg, "Topic: test; Message: -> KEYWORD <-");
        });

        test("check() sets status to UP when topic condition matches (equals)", async () => {
            const conditions = JSON.stringify([
                {
                    type: "expression",
                    variable: "topic",
                    operator: "equals",
                    value: "sensors/temp",
                },
            ]);
            const heartbeat = await testMqtt("", null, "any message", "sensors/temp", "sensors/temp", conditions);
            assert.strictEqual(heartbeat.status, UP);
        });

        test("check() rejects when message condition does not match", async () => {
            const conditions = JSON.stringify([
                {
                    type: "expression",
                    variable: "message",
                    operator: "contains",
                    value: "EXPECTED",
                },
            ]);
            await assert.rejects(
                testMqtt("", null, "actual message without keyword", "test", "test", conditions),
                new Error("Conditions not met - Topic: test; Message: actual message without keyword")
            );
        });

        test("check() sets status to UP with multiple conditions (AND)", async () => {
            const conditions = JSON.stringify([
                {
                    type: "expression",
                    variable: "topic",
                    operator: "equals",
                    value: "test",
                },
                {
                    type: "expression",
                    variable: "message",
                    operator: "contains",
                    value: "success",
                    andOr: "and",
                },
            ]);
            const heartbeat = await testMqtt("", null, "operation success", "test", "test", conditions);
            assert.strictEqual(heartbeat.status, UP);
        });
    }
);
