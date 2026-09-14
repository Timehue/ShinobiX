export type VillageGuard = { name: string; level: number; village: string; defenseBonusPercent?: number };

/** Read-only guard presentation; the caller owns cancellation and late-result checks. */
export async function fetchVillageGuards(village: string, signal: AbortSignal): Promise<VillageGuard[]> {
    const response = await fetch('/api/village-guard/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ village }),
        signal,
    });
    return response.ok ? response.json() : [];
}
