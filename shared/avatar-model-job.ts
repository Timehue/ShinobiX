export const modelJobStages = {
    queued: 'Queued for creation',
    assemble: 'Fitting your character',
    reference: 'Preparing the reference',
    'reference-check': 'Checking the reference',
    mesh: 'Building the character',
    normalize: 'Setting the character’s scale',
    rig: 'Preparing the joints',
    animate: 'Animating movement',
    render: 'Rendering sprites',
    validate: 'Checking the finished model',
} as const;

export type PendingModelJob = { id: string; month: string; state: keyof typeof modelJobStages };
export type EndedModelJob = { id: string; month: string; state: 'failed' | 'cancelled'; slot: 'available' | 'used' | 'replaced' };
export const modelJobIdPattern = /^[\w-]{1,80}$/;
export const modelMonthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function isPendingModelJob(value: unknown): value is PendingModelJob {
    if (!value || typeof value !== 'object') return false;
    const job = value as Partial<PendingModelJob>;
    return typeof job.id === 'string' && modelJobIdPattern.test(job.id) &&
        typeof job.month === 'string' && modelMonthPattern.test(job.month) &&
        typeof job.state === 'string' && Object.hasOwn(modelJobStages, job.state);
}

export function isEndedModelJob(value: unknown): value is EndedModelJob {
    if (!value || typeof value !== 'object') return false;
    const job = value as Partial<EndedModelJob>;
    return typeof job.id === 'string' && modelJobIdPattern.test(job.id) &&
        typeof job.month === 'string' && modelMonthPattern.test(job.month) &&
        (job.state === 'failed' || job.state === 'cancelled') &&
        (job.slot === 'available' || job.slot === 'used' || job.slot === 'replaced');
}
