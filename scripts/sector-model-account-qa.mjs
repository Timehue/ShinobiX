// Boot the compiled game with completed model receipts in its disposable account store.
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

if (process.env.NODE_ENV !== 'test' || process.env.SHINOBIX_QA_MEMORY_KV !== '1' || process.env.DISABLE_SCHEDULED_JOBS !== '1') {
    throw new Error('Model account QA requires isolated memory storage and disabled scheduled jobs.');
}
const { assetId, version } = JSON.parse(await readFile(process.env.SECTOR_MODEL_LIVE_RECEIPT, 'utf8'));
process.env.R2_PUBLIC_BASE = 'https://art.example.invalid';
if (!/^[a-f0-9]{32}$/.test(assetId) || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid local model receipt');
const { kv } = await import('../dist/api/_storage.js');
const { authKey, hashPw } = await import('../dist/api/player-auth.js');
const { modelOwnerKey } = await import('../dist/api/avatar-model/_owner.js');
async function seedOwner(name) {
    const salt = randomBytes(16).toString('hex');
    const id = randomUUID();
    await kv.set(authKey(name), { salt, hash: hashPw('LocalModelQA123!', salt), sessionEpoch: 0 });
    await kv.set('save:' + name, { character: { name, playerModelOwnerId: id } });
    await kv.set(modelOwnerKey(id), { owner: name, id, state: 'active', createdAt: Date.now() });
    return id;
}
const owner = 'sectormodelqa';
const accountId = await seedOwner(owner);
const month = '2026-10';
const jobId = 'local-model-qa';
await kv.set('avatar-model:slot:' + owner + ':' + month, { jobId });
await kv.set('avatar-model:job:' + jobId, { slug: owner, accountId, state: 'ready', monthKey: month, assetId });
await kv.set('avatar-model:asset:' + assetId, { owner, accountId, jobId, status: 'ready', version });
await kv.set('avatar-model:slot:' + owner + ':2026-11', { jobId: 'local-pending-qa' });
await kv.set('avatar-model:job:local-pending-qa', { slug: owner, accountId, monthKey: '2026-11', state: 'render' });
const outcomeOwner = 'sectoroutcomeqa';
const outcomeAccountId = await seedOwner(outcomeOwner);
await kv.set('avatar-model:slot:' + outcomeOwner + ':2026-10', { jobId: 'retained-outcome-qa' });
await kv.set('avatar-model:job:retained-outcome-qa', { slug: outcomeOwner, accountId: outcomeAccountId, monthKey: '2026-10', state: 'cancelled' });
await kv.set('avatar-model:job:returned-outcome-qa', { slug: outcomeOwner, accountId: outcomeAccountId, monthKey: '2026-11', state: 'failed' });
await import('../dist/server.js');
