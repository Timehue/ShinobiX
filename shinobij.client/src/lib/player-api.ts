/*
 * Player API POST wrappers — challenge notices + the atomic clan/village
 * treasury donation calls. Plain fetch + alert UX, extracted verbatim from
 * App.tsx (warning paydown: these were App-local helpers exported for the
 * extracted TownHall/ClanHall screens).
 */
import type { DuelChallenge } from "../App";

export async function postPlayerChallengeNotice(targetName: string, challenge: DuelChallenge) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const res = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName, challenge }),
            });
            if (res.ok) return true;
        } catch {
            // retry below
        }
        await new Promise(resolve => setTimeout(resolve, 350 + attempt * 500));
    }
    return false;
}

// Atomic village-treasury donation — village twin of the clan helper above
// (api/village/treasury/donate.ts). Returns the server-credited treasury
// (contributionPoints / notice stay client-side), or null on failure.
export async function postVillageTreasuryDonation(playerName: string, village: string, donation: TreasuryDonationBody): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch("/api/village/treasury/donate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, village, ...donation }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; treasury?: Record<string, unknown> };
        if (!res.ok || !data.ok || !data.treasury) { alert(data.error || "Donation failed. Please try again."); return null; }
        return data.treasury;
    } catch {
        alert("Donation failed. Please try again.");
        return null;
    }
}

// Atomic clan-treasury donation. Debits the donor AND credits the clan
// treasury server-side under dual locks (api/clan/treasury/donate.ts), closing
// the old "credit treasury without a matching debit" gap. Returns the
// server-credited treasury (clan XP / clanEventContrib are still applied
// client-side on top of it), or null on failure (alerts the player).
export async function postClanTreasuryDonation(playerName: string, clan: string, donation: TreasuryDonationBody): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch("/api/clan/treasury/donate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, clan, ...donation }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; treasury?: Record<string, unknown> };
        if (!res.ok || !data.ok || !data.treasury) { alert(data.error || "Donation failed. Please try again."); return null; }
        return data.treasury;
    } catch {
        alert("Donation failed. Please try again.");
        return null;
    }
}

type TreasuryDonationBody =
    | { currency: string; amount: number }
    | { itemId: string; count?: number };
