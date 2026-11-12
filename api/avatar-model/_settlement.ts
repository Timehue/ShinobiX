import { isPendingModelJob, modelJobIdPattern } from '../../shared/avatar-model-job.js';
import { kv, type KvCasOp } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { isDeepStrictEqual } from 'node:util';
import { modelOwnerProof, validModelOwnerId } from './_owner.js';

type Reservation = { provider: string; cycle: string; micros: number };
type Job = {
    slug: string; monthKey: string; state: string; attempt: number; sourceSha256: string;
    reserved: Reservation[]; errorCode?: string; publishingAt?:number;
    accountId?:string;assetId?:string;masterSha256?:string;delivery?:{version:string};privateRefKey?:string;
};
type Budget = { spentMicros: number; reservedMicros: number };
const prefix = 'avatar-model:';
// The private worker reports these exact codes. Unknown failures return the slot.
const failures = {
    'player-cancelled': 'player',
    'moderator-removed': 'moderation',
    'input-rejected': 'player',
    'worker-crash': 'system',
    'provider-outage': 'system',
    'output-validation': 'system',
    'generation-disabled': 'system',
} as const;

/** Trusted terminal decision. Public callers may supply only the owner cancellation. */
export async function endModelJob(id: string, owner: string, reason: string, expectedJob?:unknown) {
    if (!modelJobIdPattern.test(id)) return 'unavailable';
    return withKvLock(prefix + 'admit:' + owner, () =>
        withKvLock(prefix + 'admit:budgets', () => settle(id, owner, reason, expectedJob), {failClosed:true}),
    {failClosed:true});
}

async function settle(id: string, owner: string, reason: string, expectedJob?:unknown) {
    const code = Object.hasOwn(failures, reason) ? reason as keyof typeof failures : 'unknown-system';
    const refund = code === 'unknown-system' || failures[code] === 'system';
    const key = prefix + 'job:' + id;
    const job = await kv.get<Job>(key);
    if (!job || job.slug !== owner) return 'unavailable';
    const ownerGuards=code==='player-cancelled' ? await modelOwnerProof(owner,job.accountId??'') : [];
    if(!ownerGuards) return 'unavailable';
    const state = code === 'player-cancelled' || code === 'moderator-removed' ? 'cancelled' : 'failed';
    if (job.state === state && job.errorCode === code) return state;
    if (expectedJob && !isDeepStrictEqual(job,expectedJob)) return 'conflict';
    if (code==='player-cancelled' && job.publishingAt) return 'conflict';
    if (!isPendingModelJob({id, month: job.monthKey, state: job.state})) return 'conflict';
    const slotKey = prefix + 'slot:' + owner + ':' + job.monthKey;
    const dispatchKey = prefix + 'dispatch';
    const [slot, dispatch] = await Promise.all([
        kv.get<{jobId: string; reservedAt: number}>(slotKey), kv.get<string[]>(dispatchKey),
    ]);
    if (slot?.jobId !== id) return 'conflict';
    const endedAt = Date.now();
    const ops: KvCasOp[] = [...ownerGuards,{op:'delete', key:prefix + 'active:' + owner, expected:id}];
    if (dispatch?.includes(id)) {
        ops.push({op:'cas', key:dispatchKey, expected:dispatch, value:dispatch.filter(jobId => jobId !== id)});
    }
    if (job.state==='validate') {
        const queueKey=prefix+'publish', queue=await kv.get<string[]>(queueKey);
        if (queue?.includes(id)) ops.push({op:'cas',key:queueKey,expected:queue,value:queue.filter(item=>item!==id)});
    }
    // Only an unclaimed outbox entry proves that no provider could have incurred cost.
    // For a dispatched attempt the ledger keeps its reservation until provider reconciliation.
    const unclaimed = job.attempt === 0 && job.state === 'queued' && dispatch?.includes(id);
    if (unclaimed) {
        for (const reservation of job.reserved) {
            const budgetKey = prefix + 'budget:' + reservation.provider + ':' + reservation.cycle;
            const budget = await kv.get<Budget>(budgetKey);
            if (!budget || !Number.isSafeInteger(reservation.micros) || reservation.micros < 0 ||
                !Number.isSafeInteger(budget.reservedMicros) || budget.reservedMicros < reservation.micros) return 'conflict';
            ops.push({op:'cas', key:budgetKey, expected:budget,
                value:{...budget, reservedMicros:budget.reservedMicros - reservation.micros}});
        }
    }
    if (refund) {
        const holdKey = prefix + 'failures:' + owner + ':' + job.sourceSha256;
        const recentKey = prefix + 'last-refund:' + owner;
        const [held, recent] = await Promise.all([kv.get<{count: number}>(holdKey), kv.get<string>(recentKey)]);
        ops.push({op:'delete', key:slotKey, expected:slot}, {op:'cas', key:holdKey, expected:held,
            value:{count:(held?.count ?? 0) + 1}}, {op:'cas', key:recentKey, expected:recent, value:id});
    } else {
        ops.push({op:'cas', key:slotKey, expected:slot, value:{...slot, usedAt:endedAt}});
    }
    if(!unclaimed) {
        if(!validModelOwnerId(job.accountId) || typeof job.assetId!=='string' || !/^[a-f0-9]{32}$/.test(job.assetId))
            throw new Error('Invalid model cleanup ownership');
        const cleanupKey=prefix+'cleanup:'+job.assetId,queueKey=prefix+'cleanup';
        const [cleanup,queue]=await Promise.all([kv.get<{accountId:string;jobId:string}>(cleanupKey),kv.get<string[]>(queueKey)]);
        if(cleanup && (cleanup.accountId!==job.accountId || cleanup.jobId!==id)) throw new Error('Conflicting model cleanup');
        if(queue!==null && !Array.isArray(queue)) throw new Error('Invalid model cleanup queue');
        if(!cleanup) ops.push({op:'cas',key:cleanupKey,expected:null,value:{owner,accountId:job.accountId,
            assetId:job.assetId,version:job.delivery?.version,jobId:id,privateRefKey:job.privateRefKey,
            sourceSha256:job.sourceSha256,masterSha256:job.masterSha256,state:'pending',createdAt:endedAt,attempt:0,
            nextAttemptAt:job.publishingAt ? endedAt+15*60000 : endedAt}});
        if(!queue?.includes(job.assetId)) ops.push({op:'cas',key:queueKey,expected:queue,value:[...(queue??[]),job.assetId]});
    }
    ops.push({op:'cas', key, expected:job, value:{...job, state, endedAt, errorCode:code,
        reserved:unclaimed ? [] : job.reserved, ...(refund ? {refund:{month:job.monthKey, at:endedAt}} : {})}});
    if (await kv.compareSetMany?.(ops)) return state;
    const latest = await kv.get<Job>(key);
    return latest?.slug === owner && latest.state === state && latest.errorCode === code ? state : 'conflict';
}
