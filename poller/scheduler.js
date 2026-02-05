class Scheduler {
    /**
     * @param {{logger: {info: Function, warn: Function} | null, executeAssignment: Function, enqueueResult: Function}} options Scheduler dependencies
     */
    constructor({ logger, executeAssignment, enqueueResult }) {
        this.logger = logger;
        this.assignments = [];
        this.started = false;
        this.executeAssignment = executeAssignment;
        this.enqueueResult = enqueueResult;
        this.lastRunByMonitor = new Map();
        this.running = false;
    }

    /**
     * Update the assignment list.
     * @param {object[]} assignments Assignment list
     * @returns {void}
     */
    updateAssignments(assignments) {
        this.assignments = Array.isArray(assignments) ? assignments : [];
        const knownIds = new Set(this.assignments.map((assignment) => assignment.monitor_id));
        for (const id of this.lastRunByMonitor.keys()) {
            if (!knownIds.has(id)) {
                this.lastRunByMonitor.delete(id);
            }
        }

        if (this.logger) {
            this.logger.info(`Loaded ${this.assignments.length} assignments`);
        }
    }

    /**
     * Start the scheduler loop.
     * @param {number} intervalMs Tick interval in milliseconds
     * @returns {void}
     */
    start(intervalMs) {
        if (this.started) {
            return;
        }
        this.started = true;
        setInterval(() => this.tick(), intervalMs);
    }

    /**
     * Execute one scheduler tick.
     * @returns {Promise<void>}
     */
    async tick() {
        if (this.running) {
            return;
        }
        this.running = true;

        const now = Date.now();
        const dueAssignments = this.assignments.filter((assignment) => {
            const intervalMs = (assignment.interval || 60) * 1000;
            const lastRun = this.lastRunByMonitor.get(assignment.monitor_id) || 0;
            return now - lastRun >= intervalMs;
        });

        for (const assignment of dueAssignments) {
            try {
                const result = await this.executeAssignment(assignment);
                this.enqueueResult({
                    monitorId: assignment.monitor_id,
                    ts: Date.now(),
                    status: result.status,
                    latencyMs: result.latencyMs,
                    msg: result.msg,
                    meta: result.meta,
                });
            } catch (error) {
                this.enqueueResult({
                    monitorId: assignment.monitor_id,
                    ts: Date.now(),
                    status: 0,
                    latencyMs: null,
                    msg: error.message,
                });
                if (this.logger) {
                    this.logger.warn(`Check failed for ${assignment.monitor_id}: ${error.message}`);
                }
            } finally {
                this.lastRunByMonitor.set(assignment.monitor_id, Date.now());
            }
        }

        this.running = false;
    }
}

module.exports = {
    Scheduler,
};
