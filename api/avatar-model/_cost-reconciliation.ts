import { createHash } from 'node:crypto';
import { modelJobIdPattern } from '../../shared/avatar-model-job.js';
import { withKvLock } from '../_lock.js';
import { kv, type KvCasOp } from '../_storage.js';

type Provider = 'modal' | 'openai';
type Charge = { eventId: string; cycle: string; micros: number; callId?: string; responseId?:string; billedMilliseconds?:number };
type Statement = {
    final: true; currency: 'USD'; provider: Provider; jobId: string; assetId: string;
    charges: Charge[];
};
type Reservation = { provider: Provider; cycle: string; micros: number };
type Job = {
    assetId: string; state: string; reserved: Reservation[]; providerCalls?: Record<string,string>;
    completed?: Record<string,string>; finishedCall?: string; callId?: string;
    recognitionReceipt?:{responseId:string};
    settledCosts?: Partial<Record<Provider, { digest: string; releasedMicros: number; spentMicros: number; billedMilliseconds?:number }>>;
};
type Budget = { reservedMicros: number; spentMicros: number };
const prefix = 'avatar-model:';
const cyclePattern = /^[A-Za-z0-9_-]{1,64}$/;
const amountValid = (value: number) => Number.isSafeInteger(value) && value >= 0;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Private accounting input. Charges must include every attempt, including failed or cancelled calls. */
export async function reconcileModelCost(statement: Statement, apply = false) {
    if (statement?.final !== true || statement.currency !== 'USD' ||
        !['modal','openai'].includes(statement.provider) || typeof statement.jobId !== 'string' ||
        !modelJobIdPattern.test(statement.jobId) || !/^[a-f0-9]{32}$/.test(statement.assetId) ||
        !Array.isArray(statement.charges) || !statement.charges.length)
        throw new Error('Expected a final job-specific USD billing statement');

    const { provider, jobId, assetId } = statement;
    const seen = new Set<string>();
    const billed = new Map<string, number>();
    const charges = statement.charges.map(charge => {
        if (!charge || typeof charge.eventId !== 'string' || !charge.eventId.trim() || charge.eventId.length > 256 ||
            seen.has(charge.eventId) || typeof charge.cycle !== 'string' || !cyclePattern.test(charge.cycle) ||
            !amountValid(charge.micros) || (charge.callId !== undefined &&
            (typeof charge.callId !== 'string' || !/^fc-[A-Za-z0-9]{1,100}$/.test(charge.callId))) ||
            (charge.responseId!==undefined && (typeof charge.responseId!=='string' || !/^resp_[A-Za-z0-9_-]{1,200}$/.test(charge.responseId))) ||
            (charge.billedMilliseconds!==undefined && (provider!=='modal' || !amountValid(charge.billedMilliseconds))))
            throw new Error('Invalid or duplicate billing line');
        seen.add(charge.eventId);
        billed.set(charge.cycle, (billed.get(charge.cycle) ?? 0) + charge.micros);
        return { eventId: charge.eventId, cycle: charge.cycle, micros: charge.micros, callId:charge.callId,
            ...(charge.responseId ? {responseId:charge.responseId} : {}),
            ...(charge.billedMilliseconds!==undefined ? {billedMilliseconds:charge.billedMilliseconds} : {}) };
    }).sort((a,b) => a.eventId < b.eventId ? -1 : 1);
    const spentMicros = charges.reduce((sum,line) => sum + line.micros, 0);
    if (!amountValid(spentMicros)) throw new Error('Invalid billing total');
    const billedMilliseconds = provider==='modal' && charges.every(line=>line.billedMilliseconds!==undefined)
        ? charges.reduce((sum,line)=>sum+(line.billedMilliseconds??0),0) : undefined;
    if (billedMilliseconds!==undefined && !amountValid(billedMilliseconds)) throw new Error('Invalid billed duration');
    const digest = hash(JSON.stringify({ provider, jobId, assetId, charges }));
    const processStatement = async () => {
        const key = prefix + 'job:' + jobId;
        const job = await kv.get<Job>(key);
        if (!job || job.assetId !== assetId || !['ready','cancelled','failed'].includes(job.state))
            throw new Error('A matching terminal job is required');
        if (provider === 'modal') {
            const calls = new Set(charges.map(line => line.callId));
            const known = [...Object.values(job.providerCalls ?? {}), ...Object.values(job.completed ?? {}),
                job.finishedCall, job.callId];
            if (known.some(call => call && !calls.has(call))) throw new Error('Statement omits a recorded Modal call');
        }
        if (provider==='openai' && job.recognitionReceipt?.responseId &&
            !charges.some(line=>line.responseId===job.recognitionReceipt!.responseId))
            throw new Error('Statement omits the recorded recognition response');
        const previous = job.settledCosts?.[provider];
        if (previous) {
            if (previous.digest !== digest) throw new Error('Provider already settled with different charges');
            return { status: 'already-settled', ...previous };
        }
        const reservations = job.reserved.filter(item => item.provider === provider);
        const [reservation] = reservations;
        if (reservations.length !== 1 || !cyclePattern.test(reservation.cycle) || !amountValid(reservation.micros))
            throw new Error('Missing or invalid provider reservation');
        const receipt = { digest, releasedMicros: reservation.micros, spentMicros,
            ...(billedMilliseconds!==undefined ? {billedMilliseconds} : {}) };
        const ops: KvCasOp[] = [{op:'cas', key, expected:job, value:{...job,
            reserved:job.reserved.filter(item => item.provider !== provider),
            settledCosts:{...job.settledCosts, [provider]:receipt}}}];
        for (const cycle of new Set([reservation.cycle, ...billed.keys()])) {
            const budgetKey = prefix + 'budget:' + provider + ':' + cycle;
            const previousBudget = await kv.get<Budget>(budgetKey);
            const release = cycle === reservation.cycle ? reservation.micros : 0;
            if (cycle === reservation.cycle && !previousBudget) throw new Error('Reserved budget missing');
            const budget = previousBudget ?? { spentMicros:0, reservedMicros:0 };
            const updated = { ...budget, spentMicros:budget.spentMicros + (billed.get(cycle) ?? 0),
                reservedMicros:budget.reservedMicros - release };
            if (![budget.spentMicros,budget.reservedMicros,updated.spentMicros,updated.reservedMicros].every(amountValid))
                throw new Error('Inconsistent provider budget');
            ops.push({ op:'cas', key:budgetKey, expected:previousBudget, value:updated });
        }
        for (const line of charges) {
            const eventKey = prefix + 'cost:' + provider + ':' + hash(line.eventId);
            if (await kv.get(eventKey) !== null) throw new Error('Usage event already attributed');
            ops.push({ op:'cas', key:eventKey, expected:null, value:{ jobId, assetId, cycle:line.cycle,
                micros:line.micros, eventId:line.eventId, ...(line.callId ? {callId:line.callId} : {}),
                ...(line.responseId ? {responseId:line.responseId} : {}),
                ...(line.billedMilliseconds!==undefined ? {billedMilliseconds:line.billedMilliseconds} : {}) } });
        }
        if (apply && !await kv.compareSetMany?.(ops)) throw new Error('Billing records changed. Retry the same statement.');
        return { status:apply ? 'settled' : 'preview', ...receipt };
    };
    return apply ? withKvLock(prefix+'admit:budgets', processStatement, {failClosed:true}) : processStatement();
}
