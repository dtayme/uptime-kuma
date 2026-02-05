// Go to http://ftp.debian.org/debian/pool/main/a/apprise/ using curl, where it is a apache directory listing page
// Parse the html and get the latest version of Apprise
// call curl to download the latest version of Apprise
// Target file: the latest version of Apprise, which the format is apprise_{VERSION}_all.deb
import semver from "semver";
import * as childProcess from "child_process";

const baseURL = "http://ftp.debian.org/debian/pool/main/a/apprise/";
let html = "";
try {
    html = childProcess.execSync(`curl -sSL ${baseURL}`, { encoding: "utf8" });
} catch (error) {
    throw new Error("Failed to fetch page of Apprise Debian repository.");
}

// Extract deb filenames from links in the HTML
const links = [];
const pattern = /href="(apprise_([^"]+?)_all\.deb)"/g;

let match;
while ((match = pattern.exec(html)) !== null) {
    const filename = match[1];
    const version = match[2];
    if (!filename.includes("~")) {
        links.push({ filename, version });
    }
}

console.log(links);

if (links.length === 0) {
    throw new Error("No Apprise Debian packages found in repository listing.");
}

// semver compare and download
let latestLink = {
    filename: "",
    version: "0.0.0",
};

for (const link of links) {
    const nextVersion = semver.coerce(link.version);
    const currentVersion = semver.coerce(latestLink.version);
    if (nextVersion && (!currentVersion || semver.gt(nextVersion, currentVersion))) {
        latestLink = link;
    }
}

const downloadURL = baseURL + latestLink.filename;
console.log(`Downloading ${downloadURL}...`);
const result = childProcess.spawnSync("curl", [downloadURL, "--output", "apprise.deb"]);
console.log(result.stdout?.toString());
console.error(result.stderr?.toString());
process.exit(result.status !== null ? result.status : 1);
