const axios = require("axios");
const https = require("https");
const http = require("http");
const net = require("net");
const { Resolver } = require("node:dns/promises");
const ping = require("@louislam/ping");
const dayjs = require("dayjs");
const mqtt = require("mqtt");
const jsonata = require("jsonata");
const snmp = require("net-snmp");
const mysql = require("mysql2");
const postgresConParse = require("pg-connection-string").parse;
const { Client: PostgresClient } = require("pg");
const mssql = require("mssql");
const { ConditionExpressionGroup } = require("../server/monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../server/monitor-conditions/evaluator");
const { UP, DOWN, evaluateJsonQuery } = require("../src/util");

const acceptedStatusCodeDefault = ["200-299"];

/**
 * Normalize accepted status code config.
 * @param {string|string[]|null|undefined} value Accepted status code config
 * @returns {string[]} Normalized status code rules
 */
function normalizeAcceptedStatuscodes(value) {
    if (!value) {
        return acceptedStatusCodeDefault;
    }
    if (Array.isArray(value)) {
        return value;
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : acceptedStatusCodeDefault;
    } catch {
        return acceptedStatusCodeDefault;
    }
}

/**
 * Determine if a status code matches any configured rules.
 * @param {number} status HTTP status code
 * @param {Array<string|number>} acceptedStatuscodes Accepted rules
 * @returns {boolean} True when the status code is accepted
 */
function isStatusCodeAccepted(status, acceptedStatuscodes) {
    if (!acceptedStatuscodes || acceptedStatuscodes.length === 0) {
        return status >= 200 && status <= 299;
    }

    return acceptedStatuscodes.some((rule) => {
        if (typeof rule === "number") {
            return status === rule;
        }
        if (typeof rule !== "string") {
            return false;
        }
        if (rule.includes("-")) {
            const [min, max] = rule.split("-").map((v) => Number.parseInt(v, 10));
            if (Number.isNaN(min) || Number.isNaN(max)) {
                return false;
            }
            return status >= min && status <= max;
        }
        const value = Number.parseInt(rule, 10);
        return !Number.isNaN(value) && status === value;
    });
}

/**
 * Normalize database query to a safe default.
 * @param {string|null|undefined} query Query string
 * @returns {string} Safe query string
 */
function normalizeDbQuery(query) {
    if (!query || (typeof query === "string" && query.trim() === "")) {
        return "SELECT 1";
    }
    return query;
}

/**
 * Build conditions expression group from monitor config.
 * @param {object} config Monitor config
 * @returns {import("../server/monitor-conditions/expression").ConditionExpressionGroup|null} Parsed conditions group
 * @throws {Error} When the conditions payload is invalid
 */
function buildConditions(config) {
    if (!config?.conditions) {
        return null;
    }
    try {
        return ConditionExpressionGroup.fromMonitor({ conditions: config.conditions });
    } catch {
        throw new Error("Invalid conditions payload");
    }
}

/**
 * Check if a conditions group has child expressions.
 * @param {import("../server/monitor-conditions/expression").ConditionExpressionGroup|null} conditions Conditions group
 * @returns {boolean} True when conditions are defined
 */
function hasConditions(conditions) {
    return Boolean(conditions && conditions.children && conditions.children.length > 0);
}

/**
 * Execute an HTTP check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number,body?:any}>} Result payload
 */
async function checkHttp(assignment) {
    const { config } = assignment;
    const timeoutMs = config.timeout ? config.timeout * 1000 : 10000;
    const headers = config.headers ? safeJsonParse(config.headers, {}) : {};
    const method = config.method || "GET";
    const body = config.body || undefined;
    const acceptedStatuscodes = normalizeAcceptedStatuscodes(config.accepted_statuscodes || config.accepted_statuscodes_json);

    const httpsAgent = new https.Agent({ rejectUnauthorized: !config.ignoreTls });
    const httpAgent = new http.Agent();

    const start = dayjs().valueOf();
    const response = await axios.request({
        url: config.url,
        method,
        headers,
        data: body,
        timeout: timeoutMs,
        httpAgent,
        httpsAgent,
        validateStatus: () => true,
    });
    const latencyMs = dayjs().valueOf() - start;

    if (!isStatusCodeAccepted(response.status, acceptedStatuscodes)) {
        return {
            status: DOWN,
            msg: `Unexpected status code ${response.status}`,
            latencyMs,
            body: response.data,
        };
    }

    return {
        status: UP,
        msg: "OK",
        latencyMs,
        body: response.data,
    };
}

/**
 * Execute a keyword check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkKeyword(assignment) {
    const { config } = assignment;
    const response = await checkHttp(assignment);
    if (response.status !== UP) {
        return response;
    }
    const body = response.body ?? "";
    const keyword = config.keyword || "";
    const invert = Boolean(config.invertKeyword);
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const hasKeyword = bodyStr.includes(keyword);

    if ((hasKeyword && !invert) || (!hasKeyword && invert)) {
        return {
            status: UP,
            msg: "Keyword matched",
            latencyMs: response.latencyMs,
        };
    }

    return {
        status: DOWN,
        msg: "Keyword not found",
        latencyMs: response.latencyMs,
    };
}

/**
 * Execute a JSON query check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkJsonQuery(assignment) {
    const { config } = assignment;
    const response = await checkHttp(assignment);
    if (response.status !== UP) {
        return response;
    }
    const body = response.body ?? "";
    const jsonPath = config.jsonPath || "";
    const jsonPathOperator = config.jsonPathOperator || "==";
    const expectedValue = config.expectedValue ?? "";
    const { status } = await evaluateJsonQuery(body, jsonPath, jsonPathOperator, expectedValue);

    if (status) {
        return {
            status: UP,
            msg: "JSON query matched",
            latencyMs: response.latencyMs,
        };
    }

    return {
        status: DOWN,
        msg: "JSON query failed",
        latencyMs: response.latencyMs,
    };
}

/**
 * Execute an ICMP ping check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkPing(assignment) {
    const { config } = assignment;
    const count = config.ping_count ?? 1;
    const numeric = config.ping_numeric !== undefined ? config.ping_numeric : true;
    const size = config.packetSize ?? 56;
    const timeout = config.ping_per_request_timeout ?? 2;
    const result = await ping.promise.probe(config.hostname, {
        v6: false,
        min_reply: count,
        numeric,
        packetSize: size,
        deadline: timeout,
        timeout,
    });
    if (!result.alive) {
        throw new Error(result.output || "Ping failed");
    }

    return {
        status: UP,
        msg: "",
        latencyMs: Number.parseFloat(result.time),
    };
}

/**
 * Execute a TCP port check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
function checkTcp(assignment) {
    const { config } = assignment;
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const socket = new net.Socket();
        const timeoutMs = config.timeout ? config.timeout * 1000 : 10000;

        const onError = (error) => {
            socket.destroy();
            reject(error);
        };

        socket.setTimeout(timeoutMs, () => {
            onError(new Error("TCP timeout"));
        });

        socket.once("error", onError);

        socket.connect(config.port, config.hostname, () => {
            const latencyMs = Date.now() - start;
            socket.end();
            resolve({
                status: UP,
                msg: "",
                latencyMs,
            });
        });
    });
}

/**
 * Execute a DNS resolution check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkDns(assignment) {
    const { config } = assignment;
    const resolver = new Resolver();
    const type = config.dns_resolve_type || "A";
    const servers = config.dns_resolve_server
        ? config.dns_resolve_server.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    if (servers.length) {
        resolver.setServers(servers);
    }

    const start = Date.now();
    let records;
    switch (type) {
        case "AAAA":
            records = await resolver.resolve6(config.hostname);
            break;
        case "CAA":
            records = await resolver.resolveCaa(config.hostname);
            break;
        case "CNAME":
            records = await resolver.resolveCname(config.hostname);
            break;
        case "MX":
            records = await resolver.resolveMx(config.hostname);
            break;
        case "NS":
            records = await resolver.resolveNs(config.hostname);
            break;
        case "PTR":
            records = await resolver.resolvePtr(config.hostname);
            break;
        case "SOA":
            records = await resolver.resolveSoa(config.hostname);
            break;
        case "SRV":
            records = await resolver.resolveSrv(config.hostname);
            break;
        case "TXT":
            records = await resolver.resolveTxt(config.hostname);
            break;
        case "A":
        default:
            records = await resolver.resolve4(config.hostname);
            break;
    }
    const latencyMs = Date.now() - start;

    return {
        status: UP,
        msg: Array.isArray(records) ? `Records: ${records.join(" | ")}` : "OK",
        latencyMs,
    };
}

/**
 * Connect to MQTT broker and receive a single message.
 * @param {string} hostname Broker hostname
 * @param {string} topic Topic to subscribe
 * @param {{port:number,username?:string,password?:string,websocketPath?:string,timeoutMs:number}} options Connection options
 * @returns {Promise<[string,string]>} Message topic and payload
 */
function mqttReceive(hostname, topic, options = {}) {
    return new Promise((resolve, reject) => {
        const { port, username, password, websocketPath, timeoutMs } = options;

        if (!/^(?:http|mqtt|ws)s?:\/\//.test(hostname)) {
            hostname = `mqtt://${hostname}`;
        }

        let mqttUrl = `${hostname}:${port}`;
        if (hostname.startsWith("ws://") || hostname.startsWith("wss://")) {
            if (websocketPath && !websocketPath.startsWith("/")) {
                mqttUrl = `${hostname}:${port}/${websocketPath || ""}`;
            } else {
                mqttUrl = `${hostname}:${port}${websocketPath || ""}`;
            }
        }

        let client;
        const timeoutId = setTimeout(() => {
            if (client) {
                client.end();
            }
            reject(new Error("Timeout, Message not received"));
        }, timeoutMs);

        client = mqtt.connect(mqttUrl, {
            username,
            password,
            clientId: `uptime-kuma_${Math.random().toString(16).slice(2, 10)}`,
        });

        client.on("connect", () => {
            try {
                client.subscribe(topic, () => {});
            } catch {
                client.end();
                clearTimeout(timeoutId);
                reject(new Error("Cannot subscribe topic"));
            }
        });

        client.on("error", (error) => {
            client.end();
            clearTimeout(timeoutId);
            reject(error);
        });

        client.on("message", (messageTopic, message) => {
            client.end();
            clearTimeout(timeoutId);
            resolve([messageTopic, message.toString("utf8")]);
        });
    });
}

/**
 * Execute an MQTT check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkMqtt(assignment) {
    const { config } = assignment;
    const start = Date.now();
    const timeoutMs = Math.max(1000, (assignment.interval || 20) * 1000 * 0.8);
    const [messageTopic, receivedMessage] = await mqttReceive(config.hostname, config.mqttTopic, {
        port: config.port,
        username: config.mqttUsername,
        password: config.mqttPassword,
        websocketPath: config.mqttWebsocketPath,
        timeoutMs,
    });
    const latencyMs = Date.now() - start;

    const conditions = buildConditions(config);
    if (hasConditions(conditions)) {
        let jsonValue = "";
        if (config.jsonPath) {
            try {
                const parsedMessage = JSON.parse(receivedMessage);
                const expression = jsonata(config.jsonPath);
                const result = await expression.evaluate(parsedMessage);
                jsonValue = result?.toString() ?? "";
            } catch (error) {
                void error;
                jsonValue = "";
            }
        }

        const conditionsResult = evaluateExpressionGroup(conditions, {
            topic: messageTopic,
            message: receivedMessage,
            json_value: jsonValue,
        });

        if (!conditionsResult) {
            throw new Error(`Conditions not met - Topic: ${messageTopic}; Message: ${receivedMessage}`);
        }

        return {
            status: UP,
            msg: `Topic: ${messageTopic}; Message: ${receivedMessage}`,
            latencyMs,
        };
    }

    const checkType = config.mqttCheckType || "keyword";
    if (checkType === "keyword") {
        if (receivedMessage != null && receivedMessage.includes(config.mqttSuccessMessage || "")) {
            return {
                status: UP,
                msg: `Topic: ${messageTopic}; Message: ${receivedMessage}`,
                latencyMs,
            };
        }
        throw new Error(`Message Mismatch - Topic: ${config.mqttTopic}; Message: ${receivedMessage}`);
    }

    if (checkType === "json-query") {
        const parsedMessage = JSON.parse(receivedMessage);
        const expression = jsonata(config.jsonPath);
        const result = await expression.evaluate(parsedMessage);
        if (result?.toString() === String(config.expectedValue ?? "")) {
            return {
                status: UP,
                msg: "Message received, expected value is found",
                latencyMs,
            };
        }
        throw new Error(
            `Message received but value is not equal to expected value, value was: [${result?.toString() ?? ""}]`
        );
    }

    throw new Error("Unknown MQTT Check Type");
}

/**
 * Execute an SNMP check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkSnmp(assignment) {
    const { config } = assignment;
    const start = Date.now();
    let session;
    try {
        const timeoutMs = config.timeout ? config.timeout * 1000 : 10000;
        const retries = Number.isFinite(Number.parseInt(config.maxretries, 10))
            ? Number.parseInt(config.maxretries, 10)
            : 0;
        const version = config.snmpVersion || "2c";
        const sessionOptions = {
            port: config.port || "161",
            retries,
            timeout: timeoutMs,
            version: snmp.Version[version],
        };

        if (version === "3") {
            if (!config.snmp_v3_username) {
                throw new Error("SNMPv3 username is required");
            }
            sessionOptions.securityLevel = snmp.SecurityLevel.noAuthNoPriv;
            sessionOptions.username = config.snmp_v3_username;
            session = snmp.createV3Session(config.hostname, config.snmp_v3_username, sessionOptions);
        } else {
            session = snmp.createSession(config.hostname, config.radiusPassword, sessionOptions);
        }

        const varbinds = await new Promise((resolve, reject) => {
            session.get([config.snmpOid], (error, result) => {
                error ? reject(error) : resolve(result);
            });
        });

        if (!varbinds || varbinds.length === 0) {
            throw new Error(`No varbinds returned from SNMP session (OID: ${config.snmpOid})`);
        }

        if (varbinds[0].type === snmp.ObjectType.NoSuchInstance) {
            throw new Error(`The SNMP query returned that no instance exists for OID ${config.snmpOid}`);
        }

        const value = varbinds[0].value;
        const { status, response } = await evaluateJsonQuery(
            value,
            config.jsonPath,
            config.jsonPathOperator,
            config.expectedValue
        );

        if (!status) {
            throw new Error(
                `JSON query does not pass (comparing ${response} ${config.jsonPathOperator} ${config.expectedValue})`
            );
        }

        return {
            status: UP,
            msg: `JSON query passes (comparing ${response} ${config.jsonPathOperator} ${config.expectedValue})`,
            latencyMs: Date.now() - start,
        };
    } finally {
        if (session) {
            session.close();
        }
    }
}

/**
 * Run a MySQL/MariaDB query and return row count info.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @param {string|undefined} password Password override
 * @returns {Promise<string>} Row count message
 */
function mysqlQuery(connectionString, query, password) {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection({
            uri: connectionString,
            password,
        });

        connection.on("error", (err) => {
            reject(err);
        });

        connection.query(query, (err, res) => {
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

            if (Array.isArray(res)) {
                resolve(`Rows: ${res.length}`);
            } else {
                resolve(`No Error, but the result is not an array. Type: ${typeof res}`);
            }
        });
    });
}

/**
 * Run a MySQL/MariaDB query expecting a single value result.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @param {string|undefined} password Password override
 * @returns {Promise<any>} Single value result
 */
function mysqlQuerySingleValue(connectionString, query, password) {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection({
            uri: connectionString,
            password,
        });

        connection.on("error", (err) => {
            reject(err);
        });

        connection.query(query, (err, res) => {
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

            if (!Array.isArray(res) || res.length === 0) {
                reject(new Error("Query returned no results"));
                return;
            }

            if (res.length > 1) {
                reject(new Error("Multiple values were found, expected only one value"));
                return;
            }

            const firstRow = res[0];
            const columnNames = Object.keys(firstRow);

            if (columnNames.length > 1) {
                reject(new Error("Multiple columns were found, expected only one value"));
                return;
            }

            resolve(firstRow[columnNames[0]]);
        });
    });
}

/**
 * Execute a MySQL/MariaDB check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkMysql(assignment) {
    const { config } = assignment;
    if (!config.databaseConnectionString) {
        throw new Error("Database connection string is required");
    }
    const start = Date.now();
    const query = normalizeDbQuery(config.databaseQuery);
    const conditions = buildConditions(config);
    const password = config.radiusPassword;

    try {
        if (hasConditions(conditions)) {
            const result = await mysqlQuerySingleValue(config.databaseConnectionString, query, password);
            const latencyMs = Date.now() - start;

            const conditionsResult = evaluateExpressionGroup(conditions, { result: String(result) });
            if (!conditionsResult) {
                throw new Error(`Query result did not meet the specified conditions (${result})`);
            }

            return {
                status: UP,
                msg: "Query did meet specified conditions",
                latencyMs,
            };
        }

        const result = await mysqlQuery(config.databaseConnectionString, query, password);
        return {
            status: UP,
            msg: result,
            latencyMs: Date.now() - start,
        };
    } catch (error) {
        if (error.message.includes("did not meet the specified conditions")) {
            throw error;
        }
        throw new Error(`Database connection/query failed: ${error.message}`);
    }
}

/**
 * Run a PostgreSQL query.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @returns {Promise<object>} Query result
 */
async function postgresQuery(connectionString, query) {
    return new Promise((resolve, reject) => {
        const config = postgresConParse(connectionString);

        if (typeof config.ssl === "string") {
            config.ssl = config.ssl === "true";
        }

        if (config.password === "") {
            reject(new Error("Password is undefined."));
            return;
        }
        const client = new PostgresClient(config);

        client.on("error", (error) => {
            reject(error);
        });

        client.connect((err) => {
            if (err) {
                reject(err);
                client.end();
            } else {
                try {
                    client.query(query, (queryError, res) => {
                        if (queryError) {
                            reject(queryError);
                        } else {
                            resolve(res);
                        }
                        client.end();
                    });
                } catch (error) {
                    reject(error);
                    client.end();
                }
            }
        });
    });
}

/**
 * Run a PostgreSQL query expecting a single value.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @returns {Promise<any>} Single value result
 */
async function postgresQuerySingleValue(connectionString, query) {
    const result = await postgresQuery(connectionString, query);
    if (!result?.rows || result.rows.length === 0) {
        throw new Error("Query returned no results");
    }
    if (result.rows.length > 1) {
        throw new Error("Multiple values were found, expected only one value");
    }
    const firstRow = result.rows[0];
    const columnNames = Object.keys(firstRow);
    if (columnNames.length > 1) {
        throw new Error("Multiple columns were found, expected only one value");
    }
    return firstRow[columnNames[0]];
}

/**
 * Execute a PostgreSQL check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkPostgres(assignment) {
    const { config } = assignment;
    if (!config.databaseConnectionString) {
        throw new Error("Database connection string is required");
    }
    const start = Date.now();
    const query = normalizeDbQuery(config.databaseQuery);
    const conditions = buildConditions(config);

    try {
        if (hasConditions(conditions)) {
            const result = await postgresQuerySingleValue(config.databaseConnectionString, query);
            const latencyMs = Date.now() - start;

            const conditionsResult = evaluateExpressionGroup(conditions, { result: String(result) });
            if (!conditionsResult) {
                throw new Error(`Query result did not meet the specified conditions (${result})`);
            }

            return {
                status: UP,
                msg: "Query did meet specified conditions",
                latencyMs,
            };
        }

        const result = await postgresQuery(config.databaseConnectionString, query);
        const rows = Array.isArray(result?.rows) ? result.rows.length : result?.rowCount || 0;
        return {
            status: UP,
            msg: `Rows: ${rows}`,
            latencyMs: Date.now() - start,
        };
    } catch (error) {
        if (error.message.includes("did not meet the specified conditions")) {
            throw error;
        }
        throw new Error(`Database connection/query failed: ${error.message}`);
    }
}

/**
 * Run a SQL Server query and return row count info.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @returns {Promise<string>} Row count message
 */
async function mssqlQuery(connectionString, query) {
    let pool;
    try {
        pool = new mssql.ConnectionPool(connectionString);
        await pool.connect();
        const result = await pool.request().query(query);

        if (result.recordset) {
            return `Rows: ${result.recordset.length}`;
        }
        return `No Error, but the result is not an array. Type: ${typeof result.recordset}`;
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Run a SQL Server query expecting a single value result.
 * @param {string} connectionString Connection string
 * @param {string} query Query string
 * @returns {Promise<any>} Single value result
 */
async function mssqlQuerySingleValue(connectionString, query) {
    let pool;
    try {
        pool = new mssql.ConnectionPool(connectionString);
        await pool.connect();
        const result = await pool.request().query(query);

        if (!result.recordset || result.recordset.length === 0) {
            throw new Error("Query returned no results");
        }

        if (result.recordset.length > 1) {
            throw new Error("Multiple values were found, expected only one value");
        }

        const firstRow = result.recordset[0];
        const columnNames = Object.keys(firstRow);

        if (columnNames.length > 1) {
            throw new Error("Multiple columns were found, expected only one value");
        }

        return firstRow[columnNames[0]];
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Execute a SQL Server check assignment.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs:number}>} Result payload
 */
async function checkMssql(assignment) {
    const { config } = assignment;
    if (!config.databaseConnectionString) {
        throw new Error("Database connection string is required");
    }
    const start = Date.now();
    const query = normalizeDbQuery(config.databaseQuery);
    const conditions = buildConditions(config);

    try {
        if (hasConditions(conditions)) {
            const result = await mssqlQuerySingleValue(config.databaseConnectionString, query);
            const latencyMs = Date.now() - start;

            const conditionsResult = evaluateExpressionGroup(conditions, { result: String(result) });
            if (!conditionsResult) {
                throw new Error(`Query result did not meet the specified conditions (${result})`);
            }

            return {
                status: UP,
                msg: "Query did meet specified conditions",
                latencyMs,
            };
        }

        const result = await mssqlQuery(config.databaseConnectionString, query);
        return {
            status: UP,
            msg: result,
            latencyMs: Date.now() - start,
        };
    } catch (error) {
        if (error.message.includes("did not meet the specified conditions")) {
            throw error;
        }
        throw new Error(`Database connection/query failed: ${error.message}`);
    }
}

/**
 * Safely parse JSON or return fallback.
 * @param {string} value JSON string
 * @param {any} fallback Fallback value
 * @returns {any} Parsed JSON value
 */
function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * Execute an assignment by type.
 * @param {object} assignment Assignment payload
 * @returns {Promise<{status:number,msg:string,latencyMs?:number,body?:any}>} Result payload
 */
async function executeAssignment(assignment) {
    switch (assignment.type) {
        case "http":
            return await checkHttp(assignment);
        case "keyword":
            return await checkKeyword(assignment);
        case "json-query":
            return await checkJsonQuery(assignment);
        case "ping":
            return await checkPing(assignment);
        case "port":
            return await checkTcp(assignment);
        case "dns":
            return await checkDns(assignment);
        case "mqtt":
            return await checkMqtt(assignment);
        case "snmp":
            return await checkSnmp(assignment);
        case "mysql":
            return await checkMysql(assignment);
        case "postgres":
            return await checkPostgres(assignment);
        case "sqlserver":
            return await checkMssql(assignment);
        default:
            return {
                status: DOWN,
                msg: `Unsupported monitor type: ${assignment.type}`,
            };
    }
}

module.exports = {
    executeAssignment,
};
