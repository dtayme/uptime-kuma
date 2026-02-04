/**
 * Create a scoped logger for the poller runtime.
 * @param {string} scope Log scope label
 * @returns {{info: Function, warn: Function, error: Function, debug: Function}} Logger instance
 */
function createLogger(scope) {
    return {
        info(message) {
            log("INFO", scope, message);
        },
        warn(message) {
            log("WARN", scope, message);
        },
        error(message) {
            log("ERROR", scope, message);
        },
        debug(message) {
            log("DEBUG", scope, message);
        },
    };
}

/**
 * Write a log line to stdout.
 * @param {string} level Log level
 * @param {string} scope Log scope label
 * @param {string} message Log message
 * @returns {void}
 */
function log(level, scope, message) {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} [${scope}] ${level}: ${message}`);
}

module.exports = {
    createLogger,
};
