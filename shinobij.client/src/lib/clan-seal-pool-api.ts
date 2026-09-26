/*
 * Clan Honor Seal pool calls (api/clan/seal-pool/donate.ts, distribute.ts).
 * Each one carries a retained requestId (see economy-request-intent): pressing
 * again after a lost answer, even after a reload, sends the same id, so the
 * server finishes or replays the first request instead of moving Seals twice.
 * A transport failure throws, and the id stays pending for that retry.
 */
import { economyIntentSettled, pendingEconomyIntent, readPendingEconomyIntent } from "./economy-request-intent";

export type SealPoolAnswer = {
    ok: boolean;
    data: {
        error?: string;
        donated?: number;
        honorSealsRemaining?: number;
        dailyDonatedToday?: number;
        distributed?: number;
        recipient?: string;
        poolBalance?: number;
    };
};

function donationParts(playerName: string, clan: string, amount: number) {
    return [playerName.trim().toLowerCase(), clan.trim().toLowerCase(), amount];
}

function distributionParts(leaderName: string, clan: string, recipientName: string, amount: number) {
    return [leaderName.trim().toLowerCase(), clan.trim().toLowerCase(), recipientName.trim().toLowerCase(), amount];
}

/**
 * True while an earlier identical donation is unconfirmed. The screen skips its
 * local daily-cap refusal then: after a reload the save may already show the
 * debit whose pool credit this retry is about to finish.
 */
export function hasPendingSealDonation(playerName: string, clan: string, amount: number): boolean {
    return readPendingEconomyIntent("seal-donate", donationParts(playerName, clan, amount)) !== null;
}

/** As above, for a founder's gift and the local pool-balance refusal. */
export function hasPendingSealDistribution(leaderName: string, clan: string, recipientName: string, amount: number): boolean {
    return readPendingEconomyIntent("seal-distribute", distributionParts(leaderName, clan, recipientName, amount)) !== null;
}

export async function postSealDonation(playerName: string, clan: string, amount: number): Promise<SealPoolAnswer> {
    const intent = pendingEconomyIntent("seal-donate", donationParts(playerName, clan, amount));
    const res = await fetch("/api/clan/seal-pool/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, amount, requestId: intent.requestId }),
    });
    const data = await res.json().catch(() => ({})) as SealPoolAnswer["data"];
    if (economyIntentSettled(res.status, data)) intent.complete();
    return { ok: res.ok, data };
}

export async function postSealDistribution(leaderName: string, clan: string, recipientName: string, amount: number): Promise<SealPoolAnswer> {
    const intent = pendingEconomyIntent("seal-distribute", distributionParts(leaderName, clan, recipientName, amount));
    const res = await fetch("/api/clan/seal-pool/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaderName, recipientName, amount, requestId: intent.requestId }),
    });
    const data = await res.json().catch(() => ({})) as SealPoolAnswer["data"];
    if (economyIntentSettled(res.status, data)) intent.complete();
    return { ok: res.ok, data };
}
