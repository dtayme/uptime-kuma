/*
 * ⚠️ ⚠️ ⚠️ ⚠️ Due to the weird issue in Portainer that the healthcheck script is still pointing to this script for unknown reason.
 * IT CANNOT BE DROPPED, even though it looks like it is not used.
 * See more: https://github.com/louislam/uptime-kuma/issues/2774#issuecomment-1429092359 (Last evaluated applicability: 2026-02-05.)
 *
 * ⚠️ Deprecated: Changed to healthcheck.go, it will be deleted in the future.
 * This script should be run after a period of time (180s), because the server may need some time to prepare.
 */
const fs = require("fs");
const FBSD = /^freebsd/.test(process.platform);
const healthcheckInsecure = process.env.UPTIME_KUMA_HEALTHCHECK_INSECURE === "1";

let client;

const sslKey = process.env.UPTIME_KUMA_SSL_KEY || process.env.SSL_KEY || undefined;
const sslCert = process.env.UPTIME_KUMA_SSL_CERT || process.env.SSL_CERT || undefined;
const useHttps = !!(sslKey && sslCert);

if (useHttps) {
    client = require("https");
} else {
    client = require("http");
}

// If host is omitted, the server will accept connections on the unspecified IPv6 address (::) when IPv6 is available and the unspecified IPv4 address (0.0.0.0) otherwise.
// Dual-stack support for (::)
let hostname = process.env.UPTIME_KUMA_HOST;

// Also read HOST if not *BSD, as HOST is a system environment variable in FreeBSD
if (!hostname && !FBSD) {
    hostname = process.env.HOST;
}

const port = parseInt(process.env.UPTIME_KUMA_PORT || process.env.PORT || 3001);

let options = {
    host: hostname || "127.0.0.1",
    port: port,
    timeout: 28 * 1000,
};

if (useHttps) {
    if (healthcheckInsecure) {
        console.warn("Healthcheck TLS verification is disabled via UPTIME_KUMA_HEALTHCHECK_INSECURE=1");
        // Opt-in local/dev override only. lgtm [js/disabling-certificate-validation]
        options.rejectUnauthorized = false;
    } else if (sslCert) {
        let ca = sslCert;
        if (fs.existsSync(sslCert)) {
            ca = fs.readFileSync(sslCert);
        }
        options.ca = ca;
    }
}

let request = client.request(options, (res) => {
    console.log(`Health Check OK [Res Code: ${res.statusCode}]`);
    if (res.statusCode === 302) {
        process.exit(0);
    } else {
        process.exit(1);
    }
});

request.on("error", function (err) {
    console.error("Health Check ERROR");
    process.exit(1);
});

request.end();
