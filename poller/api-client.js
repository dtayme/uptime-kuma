/**
 * Client for poller API calls.
 */
class PollerApiClient {
    /**
     * @param {{baseUrl: string, accessToken: string | null, pollerId: number | string | null}} options Client options
     */
    constructor({ baseUrl, accessToken, pollerId }) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.accessToken = accessToken;
        this.pollerId = pollerId;
    }

    /**
     * Send a heartbeat payload to the central server.
     * @param {object} payload Heartbeat payload
     * @returns {Promise<object|null>} API response payload
     */
    async heartbeat(payload) {
        return this.request("/api/poller/heartbeat", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /**
     * Fetch assignments from the central server.
     * @param {number|null} sinceVersion Last known assignment version
     * @returns {Promise<object|null>} Assignment response payload
     */
    async fetchAssignments(sinceVersion) {
        const url = new URL(`${this.baseUrl}/api/poller/assignments`);
        if (sinceVersion !== undefined && sinceVersion !== null) {
            url.searchParams.set("since_version", sinceVersion);
        }
        if (this.pollerId) {
            url.searchParams.set("poller_id", this.pollerId);
        }

        return this.request(url.toString(), { method: "GET" }, true);
    }

    /**
     * Submit poller results to the central server.
     * @param {Array<object>} results Results payload
     * @returns {Promise<object|null>} API response payload
     */
    async postResults(results) {
        return this.request("/api/poller/results", {
            method: "POST",
            body: JSON.stringify({ results }),
        });
    }

    /**
     * Register the poller with the central server.
     * @param {object} payload Registration payload
     * @param {string} registrationToken Registration token
     * @returns {Promise<object|null>} Registration response payload
     */
    async registerPoller(payload, registrationToken) {
        return this.request(
            "/api/poller/register",
            {
                method: "POST",
                body: JSON.stringify(payload),
                headers: {
                    "x-poller-registration-token": registrationToken,
                },
            },
            false
        );
    }

    /**
     * Execute an HTTP request against the poller API.
     * @param {string} pathOrUrl Relative path or absolute URL
     * @param {object} options Fetch options
     * @param {boolean} isAbsolute Treat path as absolute URL
     * @returns {Promise<object|null>} Parsed JSON payload (if any)
     */
    async request(pathOrUrl, options, isAbsolute) {
        const url = isAbsolute ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
        const headers = {
            "content-type": "application/json",
        };

        if (this.accessToken) {
            headers.authorization = `Bearer ${this.accessToken}`;
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Poller API request failed (${response.status}): ${text}`);
        }

        if (response.status === 204) {
            return null;
        }

        return response.json().catch(() => null);
    }
}

module.exports = {
    PollerApiClient,
};
