// Boot the compiled game with completed model receipts in its disposable account store.
import { readFile } from 'node:fs/promises';

if (process.env.NODE_ENV !== 'test' || process.env.SHINOBIX_QA_MEMORY_KV !== '1' || process.env.DISABLE_SCHEDULED_JOBS !== '1') {
    throw new Error('Model account QA requires isolated memory storage and disabled scheduled jobs.');
}
const { assetId, version } = JSON.parse(await readFile(process.env.SECTOR_MODEL_LIVE_RECEIPT, 'utf8'));
process.env.ENABLE_PLAYER_GAIT_PILOT = '1';
process.env.ENABLE_SECTOR_MODEL_DISPLAY = '1';
process.env.R2_PUBLIC_BASE = 'https://art.example.invalid';
if (!/^[a-f0-9]{32}$/.test(assetId) || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid local model receipt');
const { kv } = await import('../dist/api/_storage.js');
const owner = 'sectormodelqa';
const month = '2026-10';
const jobId = 'local-model-qa';
await kv.set('avatar-model:slot:' + owner + ':' + month, { jobId });
await kv.set('avatar-model:job:' + jobId, { slug: owner, state: 'ready', monthKey: month, assetId });
await kv.set('avatar-model:asset:' + assetId, { owner, jobId, status: 'ready', version });
await kv.set('avatar-model:slot:' + owner + ':2026-11', { jobId: 'local-pending-qa' });
await kv.set('avatar-model:job:local-pending-qa', { slug: owner, monthKey: '2026-11', state: 'render' });
const outcomeOwner = 'sectoroutcomeqa';
await kv.set('avatar-model:slot:' + outcomeOwner + ':2026-10', { jobId: 'retained-outcome-qa' });
await kv.set('avatar-model:job:retained-outcome-qa', { slug: outcomeOwner, monthKey: '2026-10', state: 'cancelled' });
await kv.set('avatar-model:job:returned-outcome-qa', { slug: outcomeOwner, monthKey: '2026-11', state: 'failed' });
await import('../dist/server.js');
