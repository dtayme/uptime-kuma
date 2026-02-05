const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

/**
 * Open (and create if needed) the poller SQLite database.
 * @param {string} dbPath Database file path
 * @returns {import("better-sqlite3").Database} Open database instance
 */
function openDatabase(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma("journal_mode = wal");
    db.pragma("synchronous = normal");
    return db;
}

module.exports = {
    openDatabase,
};
