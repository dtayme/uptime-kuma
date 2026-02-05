const args = require("args-parser")(process.argv);
const { buildChannelVersion } = require("./versioning");

function getEnv(name, fallback = undefined) {
    return process.env[name] !== undefined ? process.env[name] : fallback;
}

const baseVersion = args.base || getEnv("RELEASE_BASE_VERSION") || getEnv("RELEASE_VERSION");
const channel = args.channel || getEnv("RELEASE_CHANNEL") || "production";
const channelNumber = args.number || getEnv("RELEASE_CHANNEL_NUMBER");
const buildMetadata = args.metadata || getEnv("RELEASE_BUILD_METADATA");
const commitMetadataPrefix = args.prefix || getEnv("RELEASE_BUILD_METADATA_PREFIX") || "distributed";
const includeCommitMetadata =
    args.commitMetadata === true ||
    args["commit-metadata"] === true ||
    getEnv("RELEASE_INCLUDE_COMMIT_METADATA") === "1";

if (!baseVersion) {
    console.error("Missing base version. Use --base or set RELEASE_BASE_VERSION.");
    process.exit(1);
}

const version = buildChannelVersion({
    baseVersion,
    channel,
    channelNumber,
    buildMetadata,
    includeCommitMetadata,
    commitMetadataPrefix,
});

console.log(version);
