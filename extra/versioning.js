const childProcess = require("child_process");
const semver = require("semver");

const CHANNEL_ALIASES = {
    "pre-release": "pre",
    prerelease: "pre",
    pre: "pre",
    alpha: "alpha",
    beta: "beta",
    production: "production",
    prod: "production",
    stable: "production",
};

/**
 * Normalize a release channel name.
 * @param {string} channel Raw channel
 * @returns {string} Normalized channel
 */
function normalizeChannel(channel) {
    if (!channel) {
        return "production";
    }
    const normalized = CHANNEL_ALIASES[String(channel).toLowerCase()];
    return normalized || "production";
}

/**
 * Build commit metadata string using git.
 * @param {string} prefix Metadata prefix
 * @returns {string|null} Metadata string or null if unavailable
 */
function getCommitBuildMetadata(prefix = "distributed") {
    try {
        const count = childProcess
            .spawnSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf-8" })
            .stdout.trim();
        const sha = childProcess
            .spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" })
            .stdout.trim();

        if (!count || !sha) {
            return null;
        }

        return `${prefix}.${count}.${sha}`;
    } catch {
        return null;
    }
}

/**
 * Build a release version string for a channel.
 * @param {object} options Options
 * @param {string} options.baseVersion Base semver (e.g. 2.1.0)
 * @param {string} options.channel Release channel (production|pre|alpha|beta). Optional.
 * @param {number|string} options.channelNumber Channel iteration number. Optional.
 * @param {string} options.buildMetadata Build metadata suffix. Optional.
 * @param {boolean} options.includeCommitMetadata Append git count+sha metadata. Optional.
 * @param {string} options.commitMetadataPrefix Prefix for commit metadata. Optional.
 * @returns {string} Derived version
 * @throws {Error} When baseVersion is missing or invalid
 */
function buildChannelVersion({
    baseVersion,
    channel,
    channelNumber,
    buildMetadata,
    includeCommitMetadata = false,
    commitMetadataPrefix = "distributed",
}) {
    if (!baseVersion) {
        throw new Error("baseVersion is required");
    }

    const parsed = semver.parse(baseVersion);
    if (!parsed) {
        throw new Error("baseVersion must be a valid semver");
    }

    const normalizedChannel = normalizeChannel(channel);
    const numericChannel = Number.parseInt(channelNumber, 10);
    const channelIndex = Number.isFinite(numericChannel) ? numericChannel : 0;

    let version = parsed.version;

    if (normalizedChannel !== "production") {
        version = `${parsed.major}.${parsed.minor}.${parsed.patch}-${normalizedChannel}.${channelIndex}`;
    }

    const metadataParts = [];
    if (buildMetadata) {
        metadataParts.push(buildMetadata);
    }
    if (includeCommitMetadata) {
        const commitMetadata = getCommitBuildMetadata(commitMetadataPrefix);
        if (commitMetadata) {
            metadataParts.push(commitMetadata);
        }
    }

    if (metadataParts.length > 0) {
        version += `+${metadataParts.join(".")}`;
    }

    return version;
}

module.exports = {
    buildChannelVersion,
    getCommitBuildMetadata,
    normalizeChannel,
};
