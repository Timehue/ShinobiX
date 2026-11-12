import { modelJobIdPattern, type EndedModelJob } from '../../../shared/avatar-model-job';

function key(player: string) {
    return 'shinobix:latest-model-request:' + player.toLowerCase();
}

export function recentModelRequest(player: string) {
    try {
        const id = localStorage.getItem(key(player));
        return id && modelJobIdPattern.test(id) ? id : null;
    } catch { return null; }
}

export function rememberModelRequest(player: string, id: string | null) {
    try {
        if (id) localStorage.setItem(key(player), id);
        else localStorage.removeItem(key(player));
    } catch { /* The signed-in library can still find retained monthly receipts. */ }
}

export function modelRequestOutcome(job: EndedModelJob, now = Date.now()): string {
    const first = new Date(job.month + '-01T00:00:00Z');
    const month = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const result = job.state === 'cancelled' ? 'Model creation was cancelled.' : 'Model creation failed.';
    if (job.slot === 'available') return result + ' Your ' + month + ' creation was returned.';
    if (job.slot === 'replaced') return result + ' Another request holds your ' + month + ' creation.';
    const next = new Date(first);
    next.setUTCMonth(first.getUTCMonth() + 1);
    const used = result + ' Your ' + month + ' creation was used.';
    if (now >= next.getTime()) return used;
    return used + ' The monthly slot resets ' + next.toLocaleString(undefined, {
        month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }) + '.';
}
