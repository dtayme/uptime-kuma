/**
 * Initialize poller queue tables.
 * @param {import("better-sqlite3").Database} db Database instance
 * @returns {void}
 */
function initSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS poller_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            monitor_id INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            status INTEGER NOT NULL,
            latency_ms INTEGER,
            msg TEXT,
            meta TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS poller_assignments (
            assignment_version INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS poller_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
}

/**
 * Get current queue depth.
 * @param {import("better-sqlite3").Database} db Database instance
 * @returns {number} Count of queued rows
 */
function queueDepth(db) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM poller_queue").get();
    return row ? row.count : 0;
}

/**
 * Enqueue a poller result for upload.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {object} record Queue record
 * @returns {void}
 */
function enqueueResult(db, record) {
    const stmt = db.prepare(`
        INSERT INTO poller_queue (monitor_id, ts, status, latency_ms, msg, meta, attempts, next_retry_at)
        VALUES (@monitor_id, @ts, @status, @latency_ms, @msg, @meta, @attempts, @next_retry_at)
    `);

    stmt.run({
        monitor_id: record.monitorId,
        ts: record.ts,
        status: record.status,
        latency_ms: record.latencyMs ?? null,
        msg: record.msg ?? null,
        meta: record.meta ? JSON.stringify(record.meta) : null,
        attempts: record.attempts ?? 0,
        next_retry_at: record.nextRetryAt ?? null,
    });
}

/**
 * Dequeue a batch of pending results.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {number} limit Max batch size
 * @returns {object[]} Queue rows
 */
function dequeueBatch(db, limit) {
    return db
        .prepare(
            `
        SELECT * FROM poller_queue
        WHERE next_retry_at IS NULL OR next_retry_at <= @now
        ORDER BY ts ASC
        LIMIT @limit
    `
        )
        .all({ now: Date.now(), limit });
}

/**
 * Remove delivered results from the queue.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {number[]} ids Queue row IDs
 * @returns {void}
 */
function markDelivered(db, ids) {
    if (!ids.length) {
        return;
    }

    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM poller_queue WHERE id IN (${placeholders})`).run(...ids);
}

/**
 * Update retry metadata for a queued row.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {number} id Queue row ID
 * @param {number} attempts Retry attempts
 * @param {number} nextRetryAt Next retry timestamp (ms)
 * @returns {void}
 */
function updateRetry(db, id, attempts, nextRetryAt) {
    db.prepare("UPDATE poller_queue SET attempts = ?, next_retry_at = ? WHERE id = ?").run(attempts, nextRetryAt, id);
}

/**
 * Prune queue entries older than retention.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {number} retentionSeconds Retention window in seconds
 * @returns {void}
 */
function pruneExpired(db, retentionSeconds) {
    const cutoff = Date.now() - retentionSeconds * 1000;
    db.prepare("DELETE FROM poller_queue WHERE ts <= ?").run(cutoff);
}

/**
 * Load cached assignments snapshot.
 * @param {import("better-sqlite3").Database} db Database instance
 * @returns {{assignmentVersion: number, assignments: object[]} | null} Cached assignments snapshot
 */
function loadAssignments(db) {
    const row = db.prepare("SELECT assignment_version, snapshot_json FROM poller_assignments LIMIT 1").get();
    if (!row) {
        return null;
    }

    try {
        const snapshot = JSON.parse(row.snapshot_json);
        return {
            assignmentVersion: row.assignment_version,
            assignments: snapshot.assignments || [],
        };
    } catch {
        return null;
    }
}

/**
 * Persist assignments snapshot.
 * @param {import("better-sqlite3").Database} db Database instance
 * @param {number} assignmentVersion Assignment version
 * @param {object} snapshot Snapshot payload
 * @returns {void}
 */
function saveAssignments(db, assignmentVersion, snapshot) {
    const now = Date.now();
    const payload = JSON.stringify(snapshot || {});
    const deleteStmt = db.prepare("DELETE FROM poller_assignments");
    const insertStmt = db.prepare(`
        INSERT INTO poller_assignments (assignment_version, snapshot_json, updated_at)
        VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        deleteStmt.run();
        insertStmt.run(assignmentVersion, payload, now);
    });

    transaction();
}

module.exports = {
    initSchema,
    queueDepth,
    enqueueResult,
    dequeueBatch,
    markDelivered,
    updateRetry,
    pruneExpired,
    loadAssignments,
    saveAssignments,
};
