import type { ApiRequest, ApiResponse } from '../../_vercel.js';
import { authedPlayer } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { sectorModelDisplayEnabled } from '../../_release-flags.js';
import { safeLogValue } from '../../_safe-log.js';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { isPlayerModel } from '../../../shared/player-model-ref.js';
import { endedModelJob } from '../_ended-job.js';
import { isPendingModelJob, modelJobIdPattern, modelMonthPattern } from '../../../shared/avatar-model-job.js';
import { modelBelongsToAccount } from '../_owner.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).json({ error: 'Authentication required.' });
        if (!(await enforceRateLimitKv(req, res, 'avatar-model-status', 30, 60_000, owner))) return;
        const { id } = req.query;
        const unavailable = () => res.status(404).json({ error: 'Model request unavailable.' });
        if (!sectorModelDisplayEnabled() || typeof id !== 'string' || !modelJobIdPattern.test(id))
            return unavailable();
        const job = await kv.get<Record<string, unknown>>('avatar-model:job:' + id);
        if (!job || job.slug !== owner || !await modelBelongsToAccount(owner,job.accountId) ||
            typeof job.monthKey !== 'string' || !modelMonthPattern.test(job.monthKey))
            return unavailable();
        const status = { id, month: job.monthKey, state: job.state };
        if (isPendingModelJob(status)) return res.status(200).json(status);
        const ended = await endedModelJob(id, owner, job);
        if (ended) return res.status(200).json(ended);
        if (status.state !== 'ready' || typeof job.assetId !== 'string' || !/^[a-f0-9]{32}$/.test(job.assetId))
            return unavailable();
        const asset = await kv.get<Record<string, unknown>>('avatar-model:asset:' + job.assetId);
        const model = { assetId: job.assetId, version: asset?.version };
        if (asset?.owner !== owner || asset.accountId!==job.accountId || asset.jobId !== id || asset.status !== 'ready' || !isPlayerModel(model))
            return unavailable();
        return res.status(200).json({ ...status, model });
    } catch (error) {
        console.error('[avatar-model/status]', safeLogValue(error));
        return res.status(500).json({ error: 'Unable to check your model request.' });
    }
}
