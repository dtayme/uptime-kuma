<template>
    <div>
        <h4 class="mb-3">Remote Pollers</h4>

        <div class="mb-4">
            <label class="form-label">Registration Token</label>
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <div class="flex-grow-1">
                    <CopyableInput v-model="registrationToken" :disabled="true" />
                </div>
                <button class="btn btn-primary" type="button" :disabled="processing" @click="generateToken">
                    Generate / Rotate
                </button>
                <button class="btn btn-secondary" type="button" @click="refresh">
                    Refresh
                </button>
            </div>
            <div class="form-text mt-2">
                Provide this token in the <code>X-Poller-Registration-Token</code> header when calling
                <code>POST /api/poller/register</code>.
            </div>
        </div>

        <div v-if="rotatedToken" class="alert alert-success">
            New poller token for <strong>{{ rotatedPollerName }}</strong>:
            <CopyableInput v-model="rotatedToken" :disabled="true" class="mt-2" />
        </div>

        <div class="mb-4">
            <label class="form-label">Poller DNS Cache (Max TTL Seconds)</label>
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <div class="flex-grow-1">
                    <input
                        v-model.number="dnsCacheMaxTtlSeconds"
                        type="number"
                        min="0"
                        class="form-control"
                        placeholder="60"
                    />
                </div>
                <button
                    class="btn btn-primary"
                    type="button"
                    :disabled="dnsCacheSaving"
                    @click="saveDnsCacheSettings"
                >
                    Save
                </button>
                <button class="btn btn-secondary" type="button" @click="loadDnsCacheSettings">
                    Refresh
                </button>
            </div>
            <div class="form-text mt-2">
                Set to 0 to disable poller DNS caching. Per-monitor opt-out is available in the monitor editor.
            </div>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="mb-0">Registered Pollers</h5>
        </div>

        <div class="row g-2 align-items-end mb-3">
            <div class="col-md-4">
                <label class="form-label">Search</label>
                <input v-model="searchText" class="form-control" type="text" placeholder="Name or region" />
            </div>
            <div class="col-md-2">
                <label class="form-label">Status</label>
                <select v-model="statusFilter" class="form-select">
                    <option value="">All</option>
                    <option value="online">Online</option>
                    <option value="degraded">Degraded</option>
                    <option value="offline">Offline</option>
                </select>
            </div>
            <div class="col-md-2">
                <label class="form-label">Region</label>
                <select v-model="regionFilter" class="form-select">
                    <option value="">All</option>
                    <option v-for="region in regions" :key="region" :value="region">
                        {{ region }}
                    </option>
                </select>
            </div>
            <div class="col-md-2">
                <label class="form-label">Capability</label>
                <select v-model="capabilityFilter" class="form-select">
                    <option v-for="option in capabilityFilterOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                    </option>
                </select>
            </div>
            <div class="col-md-2">
                <button class="btn btn-outline-secondary w-100" type="button" @click="clearFilters">
                    Clear
                </button>
            </div>
        </div>

        <div v-if="filteredPollers.length === 0" class="text-muted">
            No pollers registered.
        </div>

        <div v-else class="table-responsive">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Region</th>
                        <th>Datacenter</th>
                        <th>Status</th>
                        <th>Queue</th>
                        <th>Weight</th>
                        <th>Version</th>
                        <th>Capabilities</th>
                        <th>Last Heartbeat</th>
                        <th>Last Results</th>
                        <th>Last Assignment Pull</th>
                        <th>Assignment Version</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="poller in filteredPollers" :key="poller.id">
                        <tr>
                            <td>{{ poller.name }}</td>
                            <td>{{ poller.region }}</td>
                            <td>{{ poller.datacenter || "-" }}</td>
                            <td>{{ poller.status }}</td>
                            <td>{{ poller.queueDepth }}</td>
                            <td>{{ poller.weight ?? "-" }}</td>
                            <td>{{ poller.version || "-" }}</td>
                            <td>{{ formatCapabilities(poller.capabilities) }}</td>
                            <td>{{ poller.lastHeartbeatAt || "-" }}</td>
                            <td>{{ poller.lastResultsAt || "-" }}</td>
                            <td>{{ poller.lastAssignmentPullAt || "-" }}</td>
                            <td>{{ poller.assignmentVersion ?? "-" }}</td>
                            <td class="d-flex gap-2">
                                <button class="btn btn-outline-secondary btn-sm" @click="toggleDetails(poller)">
                                    {{ expandedPollerId === poller.id ? "Hide" : "Details" }}
                                </button>
                                <button class="btn btn-outline-primary btn-sm" @click="rotateToken(poller)">
                                    Rotate Token
                                </button>
                                <button class="btn btn-outline-danger btn-sm" @click="revokeTokens(poller)">
                                    Revoke Tokens
                                </button>
                            </td>
                        </tr>
                        <tr v-if="expandedPollerId === poller.id" class="bg-light">
                            <td :colspan="13">
                                <div class="row g-3">
                                    <div class="col-lg-3">
                                        <label class="form-label">Weight</label>
                                        <input
                                            v-model.number="editState[poller.id].weight"
                                            type="number"
                                            min="1"
                                            class="form-control form-control-sm"
                                        />
                                        <div class="form-text">
                                            Higher weights receive more auto assignments.
                                        </div>
                                    </div>
                                    <div class="col-lg-9">
                                        <label class="form-label">Capabilities</label>
                                        <div class="d-flex flex-wrap gap-3">
                                            <label
                                                v-for="option in capabilityOptions"
                                                :key="option.value"
                                                class="form-check form-check-inline"
                                            >
                                                <input
                                                    v-model="editState[poller.id].capabilities[option.value]"
                                                    class="form-check-input"
                                                    type="checkbox"
                                                />
                                                <span class="form-check-label">{{ option.label }}</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div class="col-12 d-flex flex-wrap gap-2">
                                        <button
                                            class="btn btn-primary btn-sm"
                                            type="button"
                                            :disabled="savingPollerId === poller.id"
                                            @click="savePoller(poller)"
                                        >
                                            Save
                                        </button>
                                        <button
                                            class="btn btn-outline-secondary btn-sm"
                                            type="button"
                                            @click="resetEditState(poller)"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            class="btn btn-outline-secondary btn-sm"
                                            type="button"
                                            :disabled="previewLoading[poller.id]"
                                            @click="loadAssignmentPreview(poller)"
                                        >
                                            Preview Assignments
                                        </button>
                                    </div>
                                    <div v-if="previewLoading[poller.id]" class="col-12 text-muted">
                                        Loading assignment preview...
                                    </div>
                                    <div v-else-if="assignmentPreviewError[poller.id]" class="col-12 text-danger">
                                        {{ assignmentPreviewError[poller.id] }}
                                    </div>
                                    <div v-else-if="assignmentPreview[poller.id]" class="col-12">
                                        <div>
                                            <strong>Total Assignments:</strong>
                                            {{ assignmentPreview[poller.id].total }}
                                        </div>
                                        <div v-if="assignmentPreview[poller.id].byTypeText" class="text-muted">
                                            {{ assignmentPreview[poller.id].byTypeText }}
                                        </div>
                                        <ul
                                            v-if="assignmentPreview[poller.id].samples.length"
                                            class="list-unstyled mb-0 mt-2"
                                        >
                                            <li
                                                v-for="sample in assignmentPreview[poller.id].samples"
                                                :key="sample.key"
                                            >
                                                {{ sample.label }}
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script>
import CopyableInput from "../CopyableInput.vue";

export default {
    components: {
        CopyableInput,
    },
    data() {
        return {
            registrationToken: "",
            rotatedToken: "",
            rotatedPollerName: "",
            processing: false,
            dnsCacheMaxTtlSeconds: 60,
            dnsCacheSaving: false,
            searchText: "",
            statusFilter: "",
            regionFilter: "",
            capabilityFilter: "",
            expandedPollerId: null,
            editState: {},
            savingPollerId: null,
            assignmentPreview: {},
            assignmentPreviewError: {},
            previewLoading: {},
        };
    },
    computed: {
        capabilityOptions() {
            return [
                { label: "HTTP", value: "http" },
                { label: "Ping (ICMP)", value: "icmp" },
                { label: "TCP", value: "tcp" },
                { label: "DNS", value: "dns" },
                { label: "SNMP", value: "snmp" },
                { label: "MQTT", value: "mqtt" },
                { label: "MySQL/MariaDB", value: "mysql" },
                { label: "PostgreSQL", value: "postgres" },
                { label: "SQL Server", value: "sqlserver" },
            ];
        },
        capabilityFilterOptions() {
            return [{ label: "All", value: "" }, ...this.capabilityOptions];
        },
        pollers() {
            return this.$root.pollerList || [];
        },
        filteredPollers() {
            return this.pollers.filter((poller) => {
                if (this.statusFilter && poller.status !== this.statusFilter) {
                    return false;
                }
                if (this.regionFilter && poller.region !== this.regionFilter) {
                    return false;
                }
                if (this.capabilityFilter) {
                    if (!poller.capabilities || !poller.capabilities[this.capabilityFilter]) {
                        return false;
                    }
                }
                if (this.searchText) {
                    const term = this.searchText.toLowerCase();
                    const combined = `${poller.name} ${poller.region} ${poller.datacenter || ""}`.toLowerCase();
                    if (!combined.includes(term)) {
                        return false;
                    }
                }
                return true;
            });
        },
        regions() {
            const unique = new Set(this.pollers.map((poller) => poller.region).filter(Boolean));
            return Array.from(unique).sort();
        },
    },
    mounted() {
        this.refresh();
        this.loadToken();
        this.loadDnsCacheSettings();
    },
    methods: {
        refresh() {
            this.$root.getPollerList(() => {});
        },
        loadToken() {
            this.$root.getPollerRegistrationToken((res) => {
                if (res.ok) {
                    this.registrationToken = res.token || "";
                }
            });
        },
        generateToken() {
            this.processing = true;
            this.$root.generatePollerRegistrationToken((res) => {
                this.processing = false;
                if (res.ok) {
                    this.registrationToken = res.token || "";
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        loadDnsCacheSettings() {
            this.$root.getPollerDnsCacheSettings((res) => {
                if (res.ok) {
                    this.dnsCacheMaxTtlSeconds = res.maxTtlSeconds;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        saveDnsCacheSettings() {
            const parsed = Number.parseInt(this.dnsCacheMaxTtlSeconds, 10);
            if (Number.isNaN(parsed) || parsed < 0) {
                this.$root.toastError("Max TTL must be 0 or a positive integer.");
                return;
            }
            this.dnsCacheSaving = true;
            this.$root.setPollerDnsCacheSettings({ maxTtlSeconds: parsed }, (res) => {
                this.dnsCacheSaving = false;
                if (res.ok) {
                    this.$root.toastSuccess("Poller DNS cache settings saved");
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        rotateToken(poller) {
            this.$root.rotatePollerToken(poller.id, (res) => {
                if (res.ok) {
                    this.rotatedToken = res.token;
                    this.rotatedPollerName = poller.name;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        revokeTokens(poller) {
            this.$root.revokePollerTokens(poller.id, (res) => {
                if (res.ok) {
                    this.$root.toastSuccess("Tokens revoked");
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        toggleDetails(poller) {
            if (this.expandedPollerId === poller.id) {
                this.expandedPollerId = null;
                return;
            }
            this.expandedPollerId = poller.id;
            this.ensureEditState(poller);
        },
        ensureEditState(poller) {
            if (this.editState[poller.id]) {
                return;
            }
            const normalizedCapabilities = this.normalizeCapabilities(poller.capabilities);
            this.editState = {
                ...this.editState,
                [poller.id]: {
                    weight: poller.weight ?? 100,
                    capabilities: normalizedCapabilities,
                },
            };
        },
        resetEditState(poller) {
            const normalizedCapabilities = this.normalizeCapabilities(poller.capabilities);
            this.editState = {
                ...this.editState,
                [poller.id]: {
                    weight: poller.weight ?? 100,
                    capabilities: normalizedCapabilities,
                },
            };
        },
        normalizeCapabilities(capabilities) {
            const current =
                capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? { ...capabilities } : {};
            for (const option of this.capabilityOptions) {
                current[option.value] = Boolean(current[option.value]);
            }
            return current;
        },
        savePoller(poller) {
            const state = this.editState[poller.id];
            if (!state) {
                return;
            }
            const parsedWeight = Number.parseInt(state.weight, 10);
            if (Number.isNaN(parsedWeight) || parsedWeight <= 0) {
                this.$root.toastError("Weight must be a positive integer");
                return;
            }
            this.savingPollerId = poller.id;
            this.$root.updatePoller(
                {
                    id: poller.id,
                    weight: parsedWeight,
                    capabilities: state.capabilities,
                },
                (res) => {
                    this.savingPollerId = null;
                    if (res.ok) {
                        this.$root.toastSuccess("Poller updated");
                        this.editState = {
                            ...this.editState,
                            [poller.id]: {
                                weight: parsedWeight,
                                capabilities: { ...state.capabilities },
                            },
                        };
                    } else {
                        this.$root.toastError(res.msg);
                    }
                }
            );
        },
        loadAssignmentPreview(poller) {
            this.previewLoading = { ...this.previewLoading, [poller.id]: true };
            this.assignmentPreviewError = { ...this.assignmentPreviewError, [poller.id]: "" };
            this.$root.getPollerAssignmentPreview(poller.id, (res) => {
                this.previewLoading = { ...this.previewLoading, [poller.id]: false };
                if (res.ok) {
                    const preview = this.buildAssignmentPreview(res.assignments || []);
                    this.assignmentPreview = { ...this.assignmentPreview, [poller.id]: preview };
                } else {
                    this.assignmentPreviewError = { ...this.assignmentPreviewError, [poller.id]: res.msg };
                }
            });
        },
        buildAssignmentPreview(assignments) {
            const byType = {};
            const samples = [];

            for (const assignment of assignments) {
                const type = assignment.type || "unknown";
                byType[type] = (byType[type] || 0) + 1;

                if (samples.length < 12) {
                    const monitor = this.$root.monitorList?.[assignment.monitor_id];
                    const name = monitor?.name || `Monitor ${assignment.monitor_id}`;
                    samples.push({
                        key: `${assignment.monitor_id}-${type}`,
                        label: `${name} (#${assignment.monitor_id}) - ${type}`,
                    });
                }
            }

            const byTypeText = Object.entries(byType)
                .map(([type, count]) => `${type}: ${count}`)
                .join(", ");

            return {
                total: assignments.length,
                byTypeText,
                samples,
            };
        },
        clearFilters() {
            this.searchText = "";
            this.statusFilter = "";
            this.regionFilter = "";
            this.capabilityFilter = "";
        },
        formatCapabilities(capabilities) {
            if (!capabilities || typeof capabilities !== "object") {
                return "-";
            }
            const enabled = Object.entries(capabilities)
                .filter(([, value]) => Boolean(value))
                .map(([key]) => key);
            return enabled.length ? enabled.join(", ") : "-";
        },
    },
};
</script>
