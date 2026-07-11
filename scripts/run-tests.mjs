// Root test runner. The suite's explicit file list outgrew the Windows cmd.exe
// command-line limit (~8k chars) inside the npm "test" script, so this spawns
// node directly (CreateProcess limit ~32k) with the manifest from
// scripts/test-files.mjs. Behavior is otherwise identical to the old
// `node --import tsx --test <files>` invocation.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_FILES } from "./test-files.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const testFilePattern = /\.test\.(?:ts|tsx|js|mjs|cjs)$/;

function discoverTests(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...discoverTests(absolute));
        else if (entry.isFile() && testFilePattern.test(entry.name)) {
            files.push(relative(root, absolute).replaceAll("\\", "/"));
        }
    }
    return files;
}

const discovered = [...new Set(discoverTests(root))].sort();
const manifest = [...new Set(TEST_FILES.map((file) => file.replaceAll("\\", "/")))].sort();
const omitted = discovered.filter((file) => !manifest.includes(file));
const stale = manifest.filter((file) => !discovered.includes(file));
const duplicateCount = TEST_FILES.length - manifest.length;

if (omitted.length || stale.length || duplicateCount) {
    console.error("[test-manifest] Test discovery does not match scripts/test-files.mjs.");
    if (omitted.length) console.error(`[test-manifest] Missing from manifest:\n  ${omitted.join("\n  ")}`);
    if (stale.length) console.error(`[test-manifest] Missing on disk:\n  ${stale.join("\n  ")}`);
    if (duplicateCount) console.error(`[test-manifest] Duplicate manifest entries: ${duplicateCount}`);
    process.exit(1);
}

console.log(`[test-manifest] ${manifest.length} test files accounted for.`);

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...TEST_FILES], {
    stdio: "inherit",
    cwd: root,
});
child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
});
