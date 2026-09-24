export type WandererMerchantOffer = { cost: number; boneCharms: number };
export type WandererMedicOffer = { cost: number; missingHp: number; missingChakra: number; missingStamina: number };
export type WandererFavor = { id: string; originSector: number; targetSector: number; giver: string; expiresAt: number };
export type WandererFavorReward = { ryo: number; boneCharms: number };
export type WandererTrackerTrail = { id: string; requestId: string; giver: string; originSector: number; sectors: [number, number]; step: 0 | 1; expiresAt: number };

export type WandererServiceResult = {
    ok: boolean;
    reason?: string;
    error?: string;
    offer?: WandererMerchantOffer | WandererMedicOffer;
    favor?: WandererFavor;
    trail?: WandererTrackerTrail;
    reward?: WandererFavorReward;
    totals?: Record<string, number>;
    cooldownUntil?: number;
    moveToSector?: number;
    /** The save version the server wrote, when this call changed the save. */
    _saveVersion?: number;
};

export async function postWandererService(body: Record<string, unknown>): Promise<WandererServiceResult> {
    try {
        const res = await fetch("/api/sector/wanderer-service", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({})) as WandererServiceResult;
        if (!res.ok) return { ok: false, error: data.error || "The road service could not be reached." };
        return data;
    } catch {
        return { ok: false, error: "The road service could not be reached." };
    }
}
