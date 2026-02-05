import "dotenv/config";
import {
    ver,
    buildDist,
    buildImage,
    checkDocker,
    checkTagExists,
    checkVersionFormat,
    getRepoNames,
    execSync,
    checkReleaseBranch,
    createDistTarGz,
    createReleasePR,
} from "./lib.mjs";
import semver from "semver";

const repoNames = getRepoNames();
const version = process.env.RELEASE_ALPHA_VERSION;
const dryRun = process.env.DRY_RUN === "true";
const previousVersion = process.env.RELEASE_PREVIOUS_VERSION;
const branchName = `release-${version}`;
const githubRunId = process.env.GITHUB_RUN_ID;

if (dryRun) {
    console.log("Dry run mode enabled. No images will be pushed.");
}

console.log("RELEASE_ALPHA_VERSION:", version);

// Check if the current branch is "release-{version}"
checkReleaseBranch(branchName);

// Check if the version is a valid semver
checkVersionFormat(version);

// Check if the semver identifier is "alpha"
const semverIdentifier = semver.prerelease(version);
console.log("Semver identifier:", semverIdentifier);
if (semverIdentifier[0] !== "alpha") {
    console.error("VERSION should have a semver identifier of 'alpha'");
    process.exit(1);
}

// Check if docker is running
checkDocker();

// Check if the tag exists
await checkTagExists(repoNames, version);

// Update package.json/package-lock.json
process.env.RELEASE_VERSION = version;
execSync("node extra/update-version.js");

// Create Pull Request (gh pr create will handle pushing the branch)
await createReleasePR(version, previousVersion, dryRun, branchName, githubRunId);

// Build frontend dist
buildDist();

if (!dryRun) {
    // Build slim image (rootless)
    buildImage(
        repoNames,
        ["alpha-slim-rootless", ver(version, "slim-rootless")],
        "rootless",
        "BASE_IMAGE=fognetx/uptime-kuma-distributed:base2-slim"
    );

    // Build full image (rootless)
    buildImage(repoNames, ["alpha-rootless", ver(version, "rootless")], "rootless");

    // Build slim image
    buildImage(
        repoNames,
        ["alpha-slim", ver(version, "slim")],
        "release",
        "BASE_IMAGE=fognetx/uptime-kuma-distributed:base2-slim"
    );

    // Build full image
    buildImage(repoNames, ["alpha", version], "release");
} else {
    console.log("Dry run mode - skipping image build and push.");
}

// Create dist.tar.gz
await createDistTarGz();
