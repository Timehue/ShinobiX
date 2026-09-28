// Guarded single fal Hunyuan3D Pro submission for the Dawnmane Seraph.
// Preview is read-only; submit requires the recorded user spend ceiling.
//   node scripts/generate-dawnmane-candidate.mjs preview
//   node scripts/generate-dawnmane-candidate.mjs submit --confirm-spend=USD
//   node scripts/generate-dawnmane-candidate.mjs poll
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { downloadArtifactBytes } from "./_trusted-tool-io.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, "art-source", "dawnmane-seraph");
const replacement = process.argv.includes('--replacement');
const request = JSON.parse(fs.readFileSync(path.join(work, replacement ? 'fal-replacement-request.json' : 'fal-request.json'), 'utf8'));
const attemptFile = path.join(work, replacement ? 'fal-replacement-attempt.json' : 'fal-attempt.json');
const jobFile = path.join(work, replacement ? 'fal-replacement-job.json' : 'fal-job.json');
const endpoint = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";
const mode = process.argv[2];

if (request.endpoint !== endpoint || request.maxSubmissions !== 1) throw new Error("Unexpected fal request");

function withinClient(relative) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) throw new Error("Path outside client workspace");
    return absolute;
}

function configuredKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const file = path.join(root, ".env");
    if (!fs.existsSync(file)) return "";
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/u).find((entry) => /^\s*FAL_KEY\s*=/u.test(entry));
    return line?.replace(/^\s*FAL_KEY\s*=\s*/u, "").trim().replace(/^['"]|['"]$/gu, "") ?? "";
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writeJson = (file, value, options) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", options);

function falQueueUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "queue.fal.run") throw new Error("Unexpected fal queue URL");
    return url.href;
}

function imageProof() {
    const proof = {};
    const inputs = {};
    for (const [field, relative] of Object.entries(request.inputs)) {
        const bytes = fs.readFileSync(withinClient(relative));
        if (bytes.length < 1024 || bytes.length > 8 * 1024 * 1024 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
            throw new Error(`Invalid PNG input: ${relative}`);
        }
        proof[field] = { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
        inputs[field] = `data:image/png;base64,${bytes.toString("base64")}`;
    }
    return { proof, inputs };
}

async function submit() {
    const flag = process.argv.find((entry) => entry.startsWith("--confirm-spend="));
    const ceiling = Number(flag?.slice("--confirm-spend=".length));
    if (!Number.isFinite(ceiling) || ceiling < request.estimatedCostUsd || ceiling !== request.authorizedSpendCeilingUsd) {
        throw new Error("The confirmed spend ceiling must match the user-authorized ceiling in fal-request.json");
    }
    if (fs.existsSync(attemptFile) || fs.existsSync(jobFile)) throw new Error("One submission has already been attempted");
    if (replacement) {
        const firstAttempt = JSON.parse(fs.readFileSync(path.join(work, 'fal-attempt.json'), 'utf8'));
        if (firstAttempt.endpoint !== endpoint ||
            firstAttempt.estimatedCostUsd + request.estimatedCostUsd > request.authorizedSpendCeilingUsd) {
            throw new Error('Replacement generation exceeds the user authorized total spend ceiling');
        }
    }
    const key = configuredKey();
    if (!key) throw new Error("Fal credential is not configured locally");
    const { proof, inputs } = imageProof();
    writeJson(attemptFile, {
        endpoint, state: "submission_attempted", attemptedAt: new Date().toISOString(),
        estimatedCostUsd: request.estimatedCostUsd, authorizedSpendCeilingUsd: ceiling,
        inputs: proof, settings: request.settings,
    }, { flag: "wx" });
    const response = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...inputs, ...request.settings }),
    });
    if (!response.ok) throw new Error(`Fal submission failed: HTTP ${response.status}`);
    const ticket = await response.json();
    if (!ticket.request_id || !ticket.status_url || !ticket.response_url) throw new Error("Fal submission omitted job identity");
    writeJson(jobFile, {
        endpoint, requestId: ticket.request_id, statusUrl: falQueueUrl(ticket.status_url),
        responseUrl: falQueueUrl(ticket.response_url), state: "submitted", submittedAt: new Date().toISOString(),
    }, { flag: "wx" });
    console.log(`Submitted ${replacement ? 'Celestial Lion replacement' : 'Dawnmane candidate'}: ${ticket.request_id}`);
}

async function poll() {
    if (!fs.existsSync(jobFile)) throw new Error("No submitted fal job is recorded");
    const key = configuredKey();
    if (!key) throw new Error("Fal credential is not configured locally");
    const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    const response = await fetch(falQueueUrl(job.statusUrl), { headers: { Authorization: `Key ${key}` } });
    if (!response.ok) throw new Error(`Fal status failed: HTTP ${response.status}`);
    const status = await response.json();
    job.state = status.status;
    job.checkedAt = new Date().toISOString();
    writeJson(jobFile, job);
    if (status.status !== "COMPLETED") {
        console.log(`${replacement ? 'Celestial Lion replacement' : 'Dawnmane candidate'} ${job.requestId}: ${status.status}`);
        return;
    }
    const output = withinClient(request.output);
    if (fs.existsSync(output)) {
        console.log(`Candidate already downloaded: ${request.output}`);
        return;
    }
    const resultResponse = await fetch(falQueueUrl(job.responseUrl), { headers: { Authorization: `Key ${key}` } });
    if (!resultResponse.ok) throw new Error(`Fal result failed: HTTP ${resultResponse.status}`);
    const result = await resultResponse.json();
    const url = result?.model_glb?.url;
    if (!url) throw new Error("Completed fal job omitted GLB");
    const bytes = await downloadArtifactBytes(url, { maxBytes: 120 * 1024 * 1024 });
    if (bytes.toString("ascii", 0, 4) !== "glTF") throw new Error("Downloaded file is not a GLB");
    fs.writeFileSync(output, bytes, { flag: "wx" });
    job.state = "downloaded";
    job.output = { path: request.output, bytes: bytes.length, sha256: sha256(bytes) };
    writeJson(jobFile, job);
    console.log(`Downloaded candidate: ${request.output} (${bytes.length} bytes)`);
}

if (mode === "preview") {
    const { proof } = imageProof();
    console.log(JSON.stringify({ endpoint, inputs: proof, settings: request.settings,
        estimatedCostUsd: request.estimatedCostUsd, authorizedSpendCeilingUsd: request.authorizedSpendCeilingUsd,
        output: request.output, attempted: fs.existsSync(attemptFile) }, null, 2));
} else if (mode === "submit") await submit();
else if (mode === "poll") await poll();
else throw new Error("Use preview, submit, or poll");
