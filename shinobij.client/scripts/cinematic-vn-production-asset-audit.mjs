import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const baseUrl = (process.argv.find((argument) => argument.startsWith("--base="))?.slice("--base=".length)
    ?? process.env.CINEMATIC_VN_PRODUCTION_URL
    ?? "https://shinobijourney.com").replace(/\/$/, "");
const concurrencyArgument = process.argv.find((argument) => argument.startsWith("--concurrency="));
const concurrency = concurrencyArgument ? Number(concurrencyArgument.slice("--concurrency=".length)) : 6;

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    console.error("--concurrency must be an integer from 1 to 12");
    process.exit(1);
}

const actorRoot = path.resolve("public", "portraits", "cinematic");
const presentationSource = await readFile(path.resolve("src", "lib", "vn-presentation.ts"), "utf8");
const revision = presentationSource.match(/export const CINEMATIC_ACTOR_ASSET_REVISION = "([^"]+)";/)?.[1];
if (!revision) {
    console.error("Could not resolve CINEMATIC_ACTOR_ASSET_REVISION");
    process.exit(1);
}

async function listWebpFiles(root, current = root) {
    const files = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) files.push(...await listWebpFiles(root, absolute));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".webp")) {
            files.push(path.relative(root, absolute).split(path.sep).join("/"));
        }
    }
    return files.sort();
}

function digest(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

const actorAssets = await listWebpFiles(actorRoot);
const failures = [];
const cacheStates = new Map();
let nextIndex = 0;
let verifiedBytes = 0;

async function auditAsset(relativePath) {
    const local = await readFile(path.join(actorRoot, ...relativePath.split("/")));
    const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
    const url = `${baseUrl}/portraits/cinematic/${encodedPath}?v=${encodeURIComponent(revision)}`;
    const response = await fetch(url, { headers: { accept: "image/webp" } });
    const cacheState = response.headers.get("cf-cache-status") ?? "unreported";
    cacheStates.set(cacheState, (cacheStates.get(cacheState) ?? 0) + 1);
    if (!response.ok) {
        failures.push(`${relativePath}: production returned ${response.status}`);
        return;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/webp")) {
        failures.push(`${relativePath}: production returned ${contentType || "no content type"}`);
        return;
    }
    const remote = Buffer.from(await response.arrayBuffer());
    if (remote.length !== local.length || digest(remote) !== digest(local)) {
        failures.push(`${relativePath}: production bytes differ (local ${local.length} B, remote ${remote.length} B)`);
        return;
    }
    verifiedBytes += remote.length;
}

async function worker() {
    while (nextIndex < actorAssets.length) {
        const index = nextIndex;
        nextIndex += 1;
        await auditAsset(actorAssets[index]);
    }
}

await Promise.all(Array.from({ length: Math.min(concurrency, actorAssets.length) }, () => worker()));

if (failures.length) {
    console.error(`Cinematic VN production asset audit failed (${failures.length}/${actorAssets.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

const cacheSummary = [...cacheStates.entries()].map(([state, count]) => `${state} ${count}`).join(", ");
console.log(
    `Verified all ${actorAssets.length} cinematic actor assets at revision ${revision} against ${baseUrl} `
    + `(${(verifiedBytes / 1_048_576).toFixed(2)} MiB exact SHA-256 match; Cloudflare ${cacheSummary}).`,
);
