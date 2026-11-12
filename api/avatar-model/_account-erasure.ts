import { kv, type KvCasOp } from '../_storage.js';
import { validModelOwnerId, type ModelOwner } from './_owner.js';

type Row = Record<string, unknown>;
type Indexed<T> = { key: string; value: T };
const prefix = 'avatar-model:';
const assetIdPattern = /^[a-f0-9]{32}$/;
const terminalStates = new Set(['ready', 'failed', 'cancelled']);
const retainedJobFields = ['assetId', 'state', 'createdAt', 'path', 'attempt', 'pipelineVersion',
    'kitVersion', 'retryCauses', 'errorCode', 'settledCosts'] as const;

async function readRows<T>(keys: string[]): Promise<Indexed<T>[]> {
    const rows: Indexed<T>[] = [];
    for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        const values = await kv.mget<T[]>(...batch);
        values.forEach((value, index) => {
            if (value !== null) rows.push({key: batch[index], value});
        });
    }
    return rows;
}

async function accountRecords() {
    const kinds = ['job', 'asset', 'cleanup', 'private-ref'] as const;
    const keys = await Promise.all(kinds.map(kind => kv.keys(prefix + kind + ':*')));
    if (keys.reduce((total, list) => total + list.length, 0) > 40000) {
        throw new Error('Model account erasure census needs maintenance');
    }
    const [jobs, assets, cleanup, privateRefs] = await Promise.all(keys.map(list => readRows<Row>(list)));
    return { jobs, assets, cleanup, privateRefs };
}

async function eraseAccountLinks(owner: Indexed<ModelOwner>, records: Awaited<ReturnType<typeof accountRecords>>) {
    const identity = owner.value;
    const saveKey = 'save:' + identity.owner;
    const save = await kv.get<{ character?: { playerModelOwnerId?: string } }>(saveKey);
    if (save?.character?.playerModelOwnerId === identity.id) return false;
    const owned = ({value}: Indexed<Row>) => value.accountId === identity.id;
    if (records.privateRefs.some(owned)) return false;
    const jobs = records.jobs.filter(owned);
    const assets = records.assets.filter(owned);
    const cleanup = records.cleanup.filter(owned);
    if (cleanup.some(({value}) => value.owner !== identity.owner || value.state !== 'complete' ||
        typeof value.completedAt !== 'number' || !Number.isFinite(value.completedAt))) return false;
    const erasures = new Map(cleanup.map(({value}) => [value.assetId, value]));
    const cancelled = new Set(cleanup.map(({value}) => value.cancelledJobId));
    if (assets.some(({value}) => {
        const erasure = erasures.get(value.assetId);
        return value.owner !== identity.owner || value.status !== 'revoked' || !erasure ||
            typeof value.jobId !== 'string' || erasure.jobId !== value.jobId;
    })) return false;
    for (const {key, value:job} of jobs) {
        if (job.slug !== identity.owner || !terminalStates.has(String(job.state)) ||
            !Array.isArray(job.reserved) || job.reserved.length ||
            typeof job.assetId !== 'string' || !assetIdPattern.test(job.assetId)) return false;
        const jobId = key.slice((prefix + 'job:').length);
        const noPublication = job.attempt === 0 && !job.callId && !job.finishedCall &&
            !job.providerCalls && !job.publishingAt && job.state !== 'ready';
        if (!noPublication && erasures.get(job.assetId)?.jobId !== jobId && !cancelled.has(jobId)) return false;
    }
    const now = Date.now();
    const ops: KvCasOp[] = [
        {op: 'assert', key: saveKey, expected: save},
        {op: 'delete', key: owner.key, expected: identity},
    ];
    if (save === null) {
        const key = prefix + 'revision:' + identity.owner;
        const revision = await kv.get<number>(key);
        if (revision !== null) ops.push({op: 'delete', key, expected: revision});
    }
    for (const {key, value} of jobs) {
        // Keep accounting replay and anonymous activity metrics. All portrait,
        // model fitting, provider identifiers and account links leave this row.
        const retained = Object.fromEntries(retainedJobFields
            .filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
        ops.push({op: 'cas', key, expected: value, value: {...retained, reserved: [], erasedAt: now}});
    }
    for (const {key, value} of assets) {
        ops.push({op: 'delete', key, expected: value});
        if (value.removalReceipt !== undefined) {
            const receiptKey = value.removalReceipt;
            if (typeof receiptKey !== 'string' || !/^avatar-model:removal:[a-f0-9]{64}$/.test(receiptKey)) return false;
            const receipt = await kv.get<Row>(receiptKey);
            if (receipt && (receipt.owner !== identity.owner || receipt.assetId !== value.assetId)) return false;
            if (receipt) ops.push({op: 'delete', key: receiptKey, expected: receipt});
        }
    }
    for (const {key, value} of cleanup) {
        if (typeof value.assetId !== 'string' || !assetIdPattern.test(value.assetId) ||
            key !== prefix + 'cleanup:' + value.assetId) return false;
        ops.push({op: 'cas', key, expected: value,
            value: {assetId: value.assetId, state: 'complete', completedAt: value.completedAt}});
    }
    return Boolean(await kv.compareSetMany?.(ops));
}

/** Remove account links only after deletion, confirmed object erasure and billing settlement. */
export async function sweepDeletedModelOwners() {
    const ownerPrefix = prefix + 'owner:';
    const keys = (await kv.keys(ownerPrefix + '*')).sort();
    if (keys.length > 10000) throw new Error('Model owner erasure census needs maintenance');
    const cursorKey = prefix + 'owner-erasure-cursor';
    const cursor = await kv.get<string>(cursorKey);
    const start = cursor ? keys.findIndex(key => key > cursor) : 0;
    const ordered = start < 0 ? keys : [...keys.slice(start), ...keys.slice(0, start)];
    const batch = ordered.slice(0, 100);
    const candidates: Indexed<ModelOwner>[] = [];
    let last: string | undefined;
    for (const row of await readRows<ModelOwner>(batch)) {
        last = row.key;
        if (row.value.state === 'deleting' && validModelOwnerId(row.value.id) &&
            row.key === ownerPrefix + row.value.id && typeof row.value.owner === 'string') candidates.push(row);
        if (candidates.length === 4) break;
    }
    let erased = 0;
    if (candidates.length) {
        const records = await accountRecords();
        for (const owner of candidates) if (await eraseAccountLinks(owner, records)) erased++;
    }
    if (last) await kv.set(cursorKey, last);
    return erased;
}
