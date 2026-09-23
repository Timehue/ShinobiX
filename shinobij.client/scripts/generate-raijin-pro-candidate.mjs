// One guarded, project-local Raijin Hound image-to-3D attempt.
// Submit only after an explicit user spend approval:
//   node scripts/generate-raijin-pro-candidate.mjs submit --confirm-spend=0.75
// Check an existing job without another charge:
//   node scripts/generate-raijin-pro-candidate.mjs poll
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadArtifactBytes } from './_trusted-tool-io.mjs';

const root = path.resolve('');
const requestFile = path.join(root, 'art-source', 'raijin-hound', 'pro-generation-request.json');
const attemptFile = path.join(root, 'art-source', 'raijin-hound', 'pro-generation-attempt.json');
const jobFile = path.join(root, 'art-source', 'raijin-hound', 'pro-generation-job.json');
const mode = process.argv[2];

function insideProject(relative) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new Error('Path outside project');
  return absolute;
}

function readKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) return '';
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*FAL_KEY\s*=\s*(.+)$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
const endpoint = 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d';
if (request.endpoint !== endpoint || request.maxSubmissions !== 1) {
  throw new Error('Unexpected provider request');
}

async function submit() {
  const ceilingFlag = process.argv.find(arg => arg.startsWith('--confirm-spend='));
  const ceiling = Number(ceilingFlag?.split('=')[1]);
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling !== request.requestedSpendCeilingUsd ||
      request.estimatedCostUsd > ceiling) {
    throw new Error('Explicit spend ceiling does not match the prepared request');
  }
  if (fs.existsSync(attemptFile) || fs.existsSync(jobFile)) {
    throw new Error('An attempt is already recorded; refusing a second submission');
  }
  const key = readKey();
  if (!key) throw new Error('Provider credential is not configured');
  const inputs = {};
  const imageProof = {};
  for (const [field, relative] of Object.entries(request.inputs)) {
    const filename = insideProject(relative);
    const bytes = fs.readFileSync(filename);
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 1024 || path.extname(filename).toLowerCase() !== '.png') {
      throw new Error(`Invalid source image: ${relative}`);
    }
    inputs[field] = `data:image/png;base64,${bytes.toString('base64')}`;
    imageProof[field] = { path: relative, bytes: bytes.length, sha256: digest(bytes) };
  }
  const attempt = {
    endpoint,
    createdAt: new Date().toISOString(),
    estimatedCostUsd: request.estimatedCostUsd,
    spendCeilingUsd: ceiling,
    inputProof: imageProof,
    settings: request.settings,
    state: 'submission_attempted'
  };
  fs.writeFileSync(attemptFile, JSON.stringify(attempt, null, 2) + '\n', { flag: 'wx' });
  const response = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...inputs, ...request.settings }),
  });
  if (!response.ok) throw new Error(`Provider submission failed: HTTP ${response.status}`);
  const ticket = await response.json();
  if (!ticket.request_id || !ticket.status_url || !ticket.response_url) {
    throw new Error('Provider response omitted the job identity');
  }
  writeJson(jobFile, {
    endpoint,
    requestId: ticket.request_id,
    statusUrl: ticket.status_url,
    responseUrl: ticket.response_url,
    state: 'submitted',
    submittedAt: new Date().toISOString(),
  });
  console.log(`Submitted one Raijin candidate job: ${ticket.request_id}`);
}

async function poll() {
  if (!fs.existsSync(jobFile)) throw new Error('No submitted job is recorded');
  const key = readKey();
  if (!key) throw new Error('Provider credential is not configured');
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const statusResponse = await fetch(job.statusUrl, { headers: { Authorization: `Key ${key}` } });
  if (!statusResponse.ok) throw new Error(`Provider status failed: HTTP ${statusResponse.status}`);
  const status = await statusResponse.json();
  job.state = status.status;
  job.checkedAt = new Date().toISOString();
  writeJson(jobFile, job);
  if (status.status !== 'COMPLETED') {
    console.log(`Raijin candidate job ${job.requestId}: ${status.status}`);
    return;
  }
  const output = insideProject(request.output);
  if (fs.existsSync(output)) {
    console.log(`Candidate already downloaded: ${request.output}`);
    return;
  }
  const resultResponse = await fetch(job.responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!resultResponse.ok) throw new Error(`Provider result failed: HTTP ${resultResponse.status}`);
  const result = await resultResponse.json();
  const url = result?.model_glb?.url;
  if (!url) throw new Error('Completed job omitted GLB');
  const bytes = await downloadArtifactBytes(url, { maxBytes: 120 * 1024 * 1024 });
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Downloaded bytes are not a GLB');
  fs.writeFileSync(output, bytes, { flag: 'wx' });
  job.state = 'downloaded';
  job.output = { path: request.output, bytes: bytes.length, sha256: digest(bytes) };
  writeJson(jobFile, job);
  console.log(`Candidate downloaded: ${request.output} (${bytes.length} bytes)`);
}

function preview() {
  const images = {};
  for (const [field, relative] of Object.entries(request.inputs)) {
    const bytes = fs.readFileSync(insideProject(relative));
    images[field] = { path: relative, bytes: bytes.length, sha256: digest(bytes) };
  }
  console.log(JSON.stringify({ endpoint, images, settings: request.settings,
    estimatedCostUsd: request.estimatedCostUsd,
    spendCeilingUsd: request.requestedSpendCeilingUsd,
    output: request.output,
    attempted: fs.existsSync(attemptFile) }, null, 2));
}

if (mode === 'preview') preview();
else if (mode === 'submit') await submit();
else if (mode === 'poll') await poll();
else throw new Error('Use preview, submit, or poll');
