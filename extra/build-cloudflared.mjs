// Build cloudflared from source with optional module overrides for CVE mitigation.
// Usage:
//   node extra/build-cloudflared.mjs --tag 2026.2.0 --out dist/cloudflared \
//     --module golang.org/x/crypto@v0.43.0 --module golang.org/x/net@v0.40.0
//   node extra/build-cloudflared.mjs --tag 2026.2.0 --goos linux --goarch arm --goarm 7 \
//     --out dist/cloudflared-linux-arm --module golang.org/x/crypto@v0.43.0
//
// Requirements: git, go (>= 1.24), make, capnp

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const DEFAULT_TAG = "2026.2.0";
const DEFAULT_REPO = "https://github.com/cloudflare/cloudflared.git";

if (import.meta.main) {
    await main();
}

/**
 * Main entry point.
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs(process.argv.slice(2));

    const tag = args.tag ?? DEFAULT_TAG;
    const repo = args.repo ?? DEFAULT_REPO;
    const workdir = path.resolve(args.workdir ?? "tmp/cloudflared-src");
    const out = path.resolve(args.out ?? `dist/cloudflared-${tag}`);
    const modules = args.modules ?? [];
    const clean = args.clean ?? false;
    const goToolchain = args.goToolchain ?? "";
    const goos = args.goos ?? "";
    const goarch = args.goarch ?? "";
    const goarm = args.goarm ?? "";
    const cgoEnabled = args.cgoEnabled ?? "";

    ensureDir(path.dirname(out));
    ensureRepo(workdir, repo);

    runCommand("git", ["fetch", "--tags"], { cwd: workdir });
    runCommand("git", ["checkout", "--force", `tags/${tag}`], { cwd: workdir });
    runCommand("git", ["clean", "-fdx"], { cwd: workdir });

    if (modules.length > 0) {
        for (const moduleSpec of modules) {
            runCommand("go", ["get", moduleSpec], {
                cwd: workdir,
                env: withGoEnv(goToolchain, goos, goarch, goarm, cgoEnabled),
            });
        }
        runCommand("go", ["mod", "tidy"], {
            cwd: workdir,
            env: withGoEnv(goToolchain, goos, goarch, goarm, cgoEnabled),
        });
    }

    runCommand("make", ["cloudflared"], {
        cwd: workdir,
        env: withGoEnv(goToolchain, goos, goarch, goarm, cgoEnabled),
    });

    const builtBinary = path.join(workdir, "cloudflared");
    if (!fs.existsSync(builtBinary)) {
        throw new Error(`Expected cloudflared binary at ${builtBinary} but it was not found.`);
    }

    fs.copyFileSync(builtBinary, out);
    console.log(`cloudflared built: ${out}`);

    if (clean) {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

/**
 * Parse CLI args.
 * @param {string[]} argv Args
 * @returns {{tag?: string, repo?: string, workdir?: string, out?: string, modules?: string[], clean?: boolean, goToolchain?: string, goos?: string, goarch?: string, goarm?: string, cgoEnabled?: string}}
 */
function parseArgs(argv) {
    const args = {
        modules: [],
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--tag") {
            args.tag = argv[++i];
        } else if (arg === "--repo") {
            args.repo = argv[++i];
        } else if (arg === "--workdir") {
            args.workdir = argv[++i];
        } else if (arg === "--out") {
            args.out = argv[++i];
        } else if (arg === "--module") {
            args.modules.push(argv[++i]);
        } else if (arg === "--go-toolchain") {
            args.goToolchain = argv[++i];
        } else if (arg === "--goos") {
            args.goos = argv[++i];
        } else if (arg === "--goarch") {
            args.goarch = argv[++i];
        } else if (arg === "--goarm") {
            args.goarm = argv[++i];
        } else if (arg === "--cgo-enabled") {
            args.cgoEnabled = argv[++i];
        } else if (arg === "--clean") {
            args.clean = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

/**
 * Ensure a directory exists.
 * @param {string} dir Directory path
 * @returns {void}
 */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Ensure the cloudflared repo is present.
 * @param {string} repoDir Repo directory
 * @param {string} repoUrl Repo URL
 * @returns {void}
 */
function ensureRepo(repoDir, repoUrl) {
    const gitDir = path.join(repoDir, ".git");
    if (fs.existsSync(gitDir)) {
        return;
    }

    ensureDir(path.dirname(repoDir));
    runCommand("git", ["clone", repoUrl, repoDir]);
}

/**
 * Run a command with stdio inherited.
 * @param {string} command Command
 * @param {string[]} args Args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} options Options
 * @returns {void}
 */
function runCommand(command, args, options = {}) {
    execFileSync(command, args, {
        stdio: "inherit",
        cwd: options.cwd,
        env: options.env ?? process.env,
    });
}

/**
 * Apply a Go toolchain override.
 * @param {string} toolchain Go toolchain, e.g. "go1.24.12"
 * @returns {NodeJS.ProcessEnv}
 */
function withGoEnv(toolchain, goos, goarch, goarm, cgoEnabled) {
    const env = { ...process.env };

    if (toolchain) {
        env.GOTOOLCHAIN = toolchain;
    }

    if (goos) {
        env.GOOS = goos;
    }

    if (goarch) {
        env.GOARCH = goarch;
    }

    if (goarm) {
        env.GOARM = goarm;
    }

    if (cgoEnabled) {
        env.CGO_ENABLED = cgoEnabled;
    }

    return env;
}
