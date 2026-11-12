import { modelMonthPattern, type EndedModelJob } from '../../shared/avatar-model-job.js';
import { kv } from '../_storage.js';

/** A terminal result and its current quota disposition are separate facts. */
export async function endedModelJob(id: string, owner: string, job: Record<string, unknown> | null): Promise<EndedModelJob | null> {
    if (job?.slug !== owner || typeof job.monthKey !== 'string' || !modelMonthPattern.test(job.monthKey) ||
        (job.state !== 'failed' && job.state !== 'cancelled')) return null;
    const slot = await kv.get<{ jobId: string }>('avatar-model:slot:' + owner + ':' + job.monthKey);
    return { id, month: job.monthKey, state: job.state,
        slot: slot == null ? 'available' : slot.jobId === id ? 'used' : 'replaced' };
}
