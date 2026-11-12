import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { sectorModelDisplayEnabled } from '../_release-flags.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { endedModelJob } from './_ended-job.js';
import { canCreatePlayerModel, modelCreationPolicy } from './_admission.js';
import { isPlayerModel, type PlayerModel } from '../../shared/player-model-ref.js';
import { isPendingModelJob, modelJobIdPattern, modelMonthPattern as monthPattern } from '../../shared/avatar-model-job.js';
import { modelOwnerProof, modelResetKey, type ModelReset } from './_owner.js';

type Row = Record<string, unknown>;
const pageSize = 12;

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).json({ error: 'Authentication required.' });
        if (!(await enforceRateLimitKv(req, res, 'avatar-model-library', 30, 60_000, owner))) return;
        const before = req.query.before;
        const recent = req.query.recent;
        if (recent !== undefined && (typeof recent !== 'string' || !modelJobIdPattern.test(recent)))
            return res.status(400).json({ error: 'Invalid model request.' });
        if (before !== undefined && (typeof before !== 'string' || !monthPattern.test(before)))
            return res.status(400).json({ error: 'Invalid month.' });
        if (!sectorModelDisplayEnabled()) return res.status(200).json({ models: [], before: null });
        const save=await kv.get<{character?:{playerModelOwnerId?:string}}>('save:'+owner);
        const accountId=save?.character?.playerModelOwnerId;
        const owned=(row:Row|null|undefined)=>!!accountId && row?.accountId===accountId;
        if(accountId && !await modelOwnerProof(owner,accountId))
            return res.status(200).json({models:[],before:null});

        // An account earns at most one slot per month. List its own small set of keys,
        // then fetch one page of receipts. Never enumerate the global asset registry.
        const prefix = 'avatar-model:slot:' + owner + ':';
        const months = (await kv.keys(prefix + '*')).filter(key => key.startsWith(prefix))
            .map(key => key.slice(prefix.length)).filter(month => monthPattern.test(month) && (!before || month < before))
            .sort().reverse();
        const page = months.slice(0, pageSize);
        const slots = await kv.mget<Row[]>(...page.map(month => prefix + month));
        const receipts = slots.flatMap((slot, i) => typeof slot?.jobId === 'string' && modelJobIdPattern.test(slot.jobId)
            ? [{ month: page[i], jobId: slot.jobId }] : []);
        const jobs = await kv.mget<Row[]>(...receipts.map(r => 'avatar-model:job:' + r.jobId));
        const pending = jobs.flatMap((job, i) => {
            const { month, jobId } = receipts[i];
            const status = { id: jobId, month, state: job?.state };
            return owned(job) && job?.slug === owner && job.monthKey === month && isPendingModelJob(status) ? [status] : [];
        });
        const completed = jobs.flatMap((job, i) =>
            owned(job) && job?.slug === owner && job.monthKey === receipts[i].month && job.state === 'ready' && typeof job.assetId === 'string' && /^[a-f0-9]{32}$/.test(job.assetId)
                ? [{ ...receipts[i], assetId: job.assetId }] : []);
        const assets = await kv.mget<Row[]>(...completed.map(r => 'avatar-model:asset:' + r.assetId));
        const models: (PlayerModel & { month: string })[] = [];
        for (const [i, asset] of assets.entries()) {
            const receipt = completed[i];
            const ref = { assetId: receipt.assetId, version: asset?.version };
            if (owned(asset) && asset?.owner === owner && asset.status === 'ready' && asset.jobId === receipt.jobId && isPlayerModel(ref))
                models.push({ ...ref, month: receipt.month });
        }
        let ended = null;
        if (!before && !pending.length) {
            const latest = receipts[0];
            const latestJob = jobs[0];
            if (latest && owned(latestJob) && latestJob?.monthKey === latest.month) ended = await endedModelJob(latest.jobId, owner, latestJob);
            // New devices can discover a refund after the quota slot has been released.
            // Older job records may only have the device's remembered request ID.
            const refunded = await kv.get<string>('avatar-model:last-refund:' + owner) ?? recent;
            if (typeof refunded === 'string' && modelJobIdPattern.test(refunded) && refunded !== latest?.jobId) {
                const job = await kv.get<Row>('avatar-model:job:' + refunded);
                if (owned(job) && job?.slug === owner && typeof job.monthKey === 'string' && (!latest || job.monthKey > latest.month)) {
                    const remembered = await endedModelJob(refunded, owner, job);
                    if (remembered) ended = remembered;
                }
            }
        }
        let creationAvailable = false;
        if (!before && canCreatePlayerModel(save?.character) && modelCreationPolicy().enabled &&
            !months.includes(new Date().toISOString().slice(0, 7))) {
            const [active, reset] = await Promise.all([
                kv.get('avatar-model:active:' + owner), kv.get<ModelReset>(modelResetKey),
            ]);
            creationAvailable = !active && !reset?.active;
        }
        return res.status(200).json({ models, ...(creationAvailable ? { creationAvailable } : {}), ...(pending.length ? { pending: pending[0] } : {}), ...(ended ? { ended } : {}),
            before: months.length > pageSize ? page[page.length - 1] : null });
    } catch (error) {
        console.error('[avatar-model/models]', safeLogValue(error));
        return res.status(500).json({ error: 'Unable to load your world models.' });
    }
}
