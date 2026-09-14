import type { CircuitDiscipline, CircuitResponse } from '../../../../shared/dojo-circuit';
export async function fetchCircuit(action?: Record<string, unknown>, credential?: string, eventId?: string, signal?: AbortSignal): Promise<CircuitResponse> {
    const response = await fetch(`/api/dojo-circuit/event${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, {
        method: action ? 'POST' : 'GET', signal: signal ?? AbortSignal.timeout(20_000),
        headers: { ...(action ? { 'Content-Type': 'application/json' } : {}), ...(credential ? { 'x-admin-password': credential } : {}) },
        ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The Circuit could not be reached. Please try again.');
    if (typeof body.enabled !== 'boolean' || !Array.isArray(body.history) || !Number.isFinite(body.serverNow)) throw new Error('The event board returned an incomplete response. Please refresh.');
    return body;
}
const trialKey = (name: string) => `dojo-trial:${name.toLowerCase()}`;
export function rememberCircuitTrial(name: string, discipline: CircuitDiscipline | null) {
    try { if (discipline) sessionStorage.setItem(trialKey(name), discipline); else sessionStorage.removeItem(trialKey(name)); } catch { /* Server state remains authoritative. */ }
    window.dispatchEvent(new Event('dojo-trial-change'));
}
export function rememberedCircuitTrial(name: string): CircuitDiscipline | null {
    try { const value = sessionStorage.getItem(trialKey(name)); return value === 'combat' || value === 'cards' || value === 'pets' ? value : null; } catch { return null; }
}
