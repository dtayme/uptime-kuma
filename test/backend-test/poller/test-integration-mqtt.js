const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const mqtt = require("mqtt");

const { executeAssignment } = require("../../../poller/executor");
const { UP } = require("../../../src/util");

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
 * Start the MQTT test container.
 * @returns {Promise<import("testcontainers").StartedTestContainer>} Started container
 */
async function startMqttContainer() {
    return new GenericContainer(MQTT_CONTAINER_IMAGE)
        .withExposedPorts(MQTT_CONTAINER_PORT)
        .withWaitStrategy(Wait.forLogMessage(/Started HiveMQ in/i))
        .withTmpFs(MQTT_CONTAINER_TMPFS)
        .withStartupTimeout(MQTT_CONTAINER_STARTUP_TIMEOUT_MS)
        .start();
}

/**
 * Wait until the MQTT broker is accepting connections.
 * @param {string} connectionString Connection URL
 * @returns {Promise<void>} Resolves when broker is ready
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

describe(
    "Poller executor MQTT integration",
    {
        concurrency: 1,
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        let container;
        let connectionString;
        let mqttHost;
        let mqttPort;

        before(async () => {
            container = await startMqttContainer();
            const host = container.getHost();
            mqttPort = container.getMappedPort(MQTT_CONTAINER_PORT);
            connectionString = `mqtt://${host}:${mqttPort}`;
            mqttHost = `mqtt://${host}`;
            await waitForMqttReady(connectionString);
        });

        after(async () => {
            if (container) {
                await container.stop();
                container = null;
            }
        });

        test("executeAssignment returns UP for keyword match", async () => {
            const topic = "poller/test";
            const message = "HELLO KEYWORD";

            const client = mqtt.connect(connectionString, {
                reconnectPeriod: 0,
                connectTimeout: MQTT_READY_CONNECT_TIMEOUT_MS,
            });

            await new Promise((resolve, reject) => {
                client.once("connect", () => {
                    client.publish(topic, message, { retain: true }, (error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
                client.once("error", reject);
            });

            try {
                const result = await executeAssignment({
                    type: "mqtt",
                    interval: 20,
                    config: {
                        hostname: mqttHost,
                        port: mqttPort,
                        mqttTopic: topic,
                        mqttSuccessMessage: "KEYWORD",
                        mqttCheckType: "keyword",
                        mqttUsername: null,
                        mqttPassword: null,
                        mqttWebsocketPath: null,
                    },
                });

                assert.strictEqual(result.status, UP);
                assert.match(result.msg, /Topic: poller\/test/);
            } finally {
                await new Promise((resolve) => {
                    client.publish(topic, "", { retain: true }, resolve);
                });
                client.end();
            }
        });
    }
);
