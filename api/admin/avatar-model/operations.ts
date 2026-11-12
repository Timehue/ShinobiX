import type { ApiRequest, ApiResponse } from '../../_vercel.js';
import { isFullAdmin } from '../../_auth.js';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { safeLogValue } from '../../_safe-log.js';
import { modelCreationPolicy } from '../../avatar-model/_admission.js';
import type { ModelOperations } from '../../../shared/avatar-model-operations.js';

type Job = {
    path?: 'A' | 'B';
    state: string;
    createdAt: number;
    attempt?: number;
    retryCauses?: Partial<ModelOperations['retries']>;
    errorCode?: string;
    pipelineVersion?: string;
    kitVersion?: string;
    reserved?: unknown[];
    settledCosts?: { modal?: { spentMicros: number; billedMilliseconds?: number }; openai?: { spentMicros: number } };
};

const prefix = 'avatar-model:';
const windowDays = 30;
const millisecondsPerDay = 86_400_000;
const retryCauses = ['expired-style', 'worker-failure'] as const;
const knownErrors = new Set(['input-rejected', 'worker-crash', 'provider-outage', 'output-validation',
    'generation-disabled', 'unknown-system']);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const version = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : 'Unknown';
const emptyCounts = () => ({ admitted: 0, ready: 0, failed: 0, cancelled: 0 });

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    try {
        const now = Date.now();
        const [keys, dispatch, publication] = await Promise.all([
            kv.keys(prefix + 'job:*'), kv.get<string[]>(prefix + 'dispatch'), kv.get<string[]>(prefix + 'publish'),
        ]);
        if (keys.length > 10_000 || (dispatch !== null && !Array.isArray(dispatch)) ||
            (publication !== null && !Array.isArray(publication))) throw new Error('Model operations census unavailable');
        const dispatchJobs = new Set(dispatch ?? []);
        const publicationJobs = new Set(publication ?? []);
        const queued = new Set([...dispatchJobs, ...publicationJobs]);
        const totals: ModelOperations = {
            windowDays, creationConfigured: modelCreationPolicy().enabled,
            paths: { A: emptyCounts(), B: emptyCounts(), unknown: emptyCounts() },
            queue: { dispatch: dispatchJobs.size, publication: publicationJobs.size, oldestSeconds: null },
            retries: { 'expired-style': 0, 'worker-failure': 0, unknown: 0 },
            failures: {}, billing: { settledReady: 0, averageReadyMicros: null, timedJobs: 0, workerMilliseconds: null },
            versions: [],
        };
        const versions = new Map<string, ModelOperations['versions'][number]>();
        let oldest = now, datedQueueJobs = 0, readyMicros = 0;
        for (let i = 0; i < keys.length; i += 100) {
            const batch = keys.slice(i, i + 100);
            const jobs = await kv.mget<Array<Job | null>>(...batch);
            for (const [index, job] of jobs.entries()) {
                if (!job || !amount(job.createdAt) || job.createdAt > now) continue;
                if (queued.has(batch[index].slice((prefix + 'job:').length))) {
                    oldest = Math.min(oldest, job.createdAt);
                    datedQueueJobs++;
                }
                if (now - job.createdAt > windowDays * millisecondsPerDay) continue;
                const path = totals.paths[job.path === 'A' || job.path === 'B' ? job.path : 'unknown'];
                path.admitted++;
                if (job.state === 'ready' || job.state === 'failed' || job.state === 'cancelled') path[job.state]++;
                if (job.state === 'failed') {
                    const reason = job.errorCode && knownErrors.has(job.errorCode) ? job.errorCode : 'unknown';
                    totals.failures[reason] = (totals.failures[reason] ?? 0) + 1;
                }
                let tagged = 0;
                for (const cause of retryCauses) {
                    const count = job.retryCauses?.[cause];
                    if (!amount(count)) continue;
                    tagged += count;
                    totals.retries[cause] += count;
                }
                if (amount(job.attempt)) totals.retries.unknown += Math.max(0, job.attempt - 1 - tagged);
                const pipeline = version(job.pipelineVersion), kit = version(job.kitVersion);
                const versionKey = pipeline + '/' + kit;
                const group = versions.get(versionKey) ?? { pipeline, kit, count: 0 };
                group.count++;
                versions.set(versionKey, group);
                const modal = job.settledCosts?.modal, openai = job.settledCosts?.openai;
                if (amount(modal?.billedMilliseconds)) {
                    totals.billing.timedJobs++;
                    totals.billing.workerMilliseconds = (totals.billing.workerMilliseconds ?? 0) + modal.billedMilliseconds;
                }
                if (job.state === 'ready' && Array.isArray(job.reserved) && job.reserved.length === 0 &&
                    amount(modal?.spentMicros) && amount(openai?.spentMicros)) {
                    totals.billing.settledReady++;
                    readyMicros += modal.spentMicros + openai.spentMicros;
                }
            }
        }
        if (queued.size > 0 && datedQueueJobs === queued.size) {
            totals.queue.oldestSeconds = Math.floor((now - oldest) / 1000);
        }
        if (totals.billing.settledReady) totals.billing.averageReadyMicros = Math.round(readyMicros / totals.billing.settledReady);
        totals.versions = [...versions.values()].sort((a, b) => b.count - a.count || a.pipeline.localeCompare(b.pipeline) || a.kit.localeCompare(b.kit));
        return res.status(200).json(totals);
    } catch (error) {
        console.error('[avatar-model/operations]', safeLogValue(error));
        return res.status(503).json({ error: 'World model operations are temporarily unavailable.' });
    }
}
