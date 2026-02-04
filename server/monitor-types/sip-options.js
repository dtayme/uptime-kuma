const { MonitorType } = require("./monitor-type");
const { UP } = require("../../src/util");
const crypto = require("crypto");
const dgram = require("dgram");

class SIPMonitorType extends MonitorType {
    name = "sip-options";
    supportsConditions = false;

    /**
     * Run the monitoring check on the given monitor
     * @param {Monitor} monitor Monitor to check
     * @param {Heartbeat} heartbeat Monitor heartbeat to update
     * @param {UptimeKumaServer} _server Uptime Kuma server
     * @returns {Promise<void>}
     * @throws Will throw an error if the command execution encounters any error.
     */
    async check(monitor, heartbeat, _server) {
        // Placeholder for future TCP support
        if (monitor.sipProtocol && monitor.sipProtocol !== "udp") {
            throw new Error(`SIP protocol '${monitor.sipProtocol}' is not supported yet`);
        }

        const response = await this.sendSipOptionsUdp(monitor, 3000);
        heartbeat.ping = response.responseTime;
        this.parseSipResponse(response.response, heartbeat);
    }

    /**
     * Send SIP OPTIONS over UDP
     * @param {Monitor} monitor Monitor object
     * @param {number} timeout timeout of options reply in ms
     * @returns {Promise<{response: string, responseTime: number}>} SIP response info
     */
    sendSipOptionsUdp(monitor, timeout) {
        return new Promise((resolve, reject) => {
            const hostname = monitor.hostname;
            const port = monitor.port || 5060;
            const socket = dgram.createSocket("udp4");

            const startTime = Date.now();
            const message = this.buildSipOptionsMessage(monitor, hostname, port);
            const messageBuffer = Buffer.from(message, "utf8");

            const timeoutId = setTimeout(() => {
                socket.close();
                reject(new Error("SIP OPTIONS timed out"));
            }, timeout);

            socket.on("error", (error) => {
                clearTimeout(timeoutId);
                socket.close();
                reject(error);
            });

            socket.on("message", (data) => {
                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;
                socket.close();
                resolve({
                    response: data.toString("utf8"),
                    responseTime,
                });
            });

            socket.send(messageBuffer, 0, messageBuffer.length, port, hostname, (error) => {
                if (error) {
                    clearTimeout(timeoutId);
                    socket.close();
                    reject(error);
                }
            });
        });
    }

    /**
     * @param {string} res response to be parsed
     * @param {object} heartbeat heartbeat object to update
     * @returns {void} returns nothing
     * @throws {Error} Throws when the SIP response is invalid or non-success.
     */
    parseSipResponse(res, heartbeat) {
        const lines = res.split(/\r?\n/);
        const statusLine = lines.find((line) => line.startsWith("SIP/2.0"));

        if (!statusLine) {
            throw new Error("Invalid SIP response");
        }

        const match = statusLine.trimEnd().match(/^SIP\/2\.0\s+(\d{3})\s+(.*)$/);
        if (!match) {
            throw new Error(`Invalid SIP status line: ${statusLine}`);
        }

        const statusCode = parseInt(match[1], 10);
        if (statusCode >= 200 && statusCode < 300) {
            heartbeat.status = UP;
            heartbeat.msg = statusLine.trim();
            return;
        }

        throw new Error(`SIP response status: ${statusLine.trim()}`);
    }

    /**
     * Build SIP OPTIONS request message
     * @param {Monitor} monitor Monitor object
     * @param {string} hostname SIP server hostname
     * @param {number} port SIP server port
     * @returns {string} SIP OPTIONS message
     */
    buildSipOptionsMessage(monitor, hostname, port) {
        const branch = `z9hG4bK${crypto.randomBytes(8).toString("hex")}`;
        const callId = crypto.randomBytes(12).toString("hex");
        const fromTag = crypto.randomBytes(6).toString("hex");

        const defaultUser = "uptime-kuma";
        const sipFrom = monitor.sipFrom ?? monitor.sip_from;
        const sipContact = monitor.sipContact ?? monitor.sip_contact;
        const sipUserAgent = monitor.sipUserAgent ?? monitor.sip_user_agent;
        const sipRport = monitor.sipRport ?? monitor.sip_rport;

        const fromUri = this.normalizeSipUri(sipFrom, defaultUser, hostname, port);
        const contactUri = this.normalizeSipUri(sipContact, defaultUser, hostname, port);
        const userAgent = (sipUserAgent || "Uptime Kuma Distributed").trim();

        const requestUri = `sip:${hostname}:${port}`;

        const enableRport = sipRport === undefined || sipRport === null ? true : Boolean(sipRport);
        const viaParams = [];
        if (enableRport) {
            viaParams.push("rport");
        }
        viaParams.push(`branch=${branch}`);
        const viaParamString = viaParams.join(";");

        return [
            `OPTIONS ${requestUri} SIP/2.0`,
            `Via: SIP/2.0/UDP ${hostname}:${port};${viaParamString}`,
            "Max-Forwards: 70",
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: <${requestUri}>`,
            `Call-ID: ${callId}@${hostname}`,
            "CSeq: 1 OPTIONS",
            `Contact: <${contactUri}>`,
            `User-Agent: ${userAgent}`,
            "Content-Length: 0",
            "",
            "",
        ].join("\r\n");
    }

    /**
     * Normalize SIP URI
     * @param {string} rawValue Raw input value
     * @param {string} defaultUser Default user part if missing
     * @param {string} hostname Hostname for default
     * @param {number} port Port for default
     * @returns {string} SIP URI
     */
    normalizeSipUri(rawValue, defaultUser, hostname, port) {
        const trimmed = (rawValue || "").trim();
        if (!trimmed) {
            return `sip:${defaultUser}@${hostname}:${port}`;
        }
        if (trimmed.startsWith("sip:") || trimmed.startsWith("sips:")) {
            return trimmed;
        }
        if (trimmed.includes("@")) {
            return `sip:${trimmed}`;
        }
        return `sip:${trimmed}@${hostname}:${port}`;
    }
}

module.exports = {
    SIPMonitorType,
};
