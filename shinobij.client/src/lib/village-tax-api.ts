/*
 * Client wrapper for the daily village tax (§6.4).
 *
 * The tax is a personal ryo sink charged only when a village occupies territory
 * beyond its original eight home sectors. The Treasury Vault can soften the rate.
 * The server owns the whole calculation; this only settles it and adopts the
 * resulting balances.
 *
 * Ryo is client-owned in the save ledger, so the debit MUST be adopted here or
 * the next autosave would simply re-assert the pre-tax balance. Idempotent
 * server-side per UTC day, so calling it on every session start is free.
 *
 * Auth rides the global authFetch interceptor, so a bare /api fetch is signed.
 */

export interface VillageTaxResult {
    ok: boolean;
    enabled: boolean;
    /** true only when ryo was actually debited. */
    applied: boolean;
    taxed: number;
    toBurn: number;
    toTreasury: number;
    /** Sectors the village held — what set the tier. */
    rateSectors: number;
    ryo: number;
    bankRyo: number;
    _saveVersion?: number;
}

export async function settleVillageTax(playerName: string): Promise<VillageTaxResult | null> {
    try {
        const r = await fetch("/api/village/tax", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        if (!r.ok) return null;
        const data = (await r.json()) as VillageTaxResult;
        return data && data.ok ? data : null;
    } catch {
        return null;
    }
}
