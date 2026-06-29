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

// Server-authoritative clan upgrade purchase (api/clan/upgrade/purchase.ts):
// debits the clan treasury (ryo + warSupply) under a lock and increments the
// building level. Returns the new { upgrades, treasury } on success, or null on
// failure (alerts the player). Only clan leadership may purchase (enforced
// server-side).
export async function postClanUpgradePurchase(
    playerName: string,
    clan: string,
    upgradeKey: string,
): Promise<{ upgrades: Record<string, number>; treasury: Record<string, unknown> } | null> {
    try {
        const res = await fetch("/api/clan/upgrade/purchase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, clan, upgradeKey }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; upgrades?: Record<string, number>; treasury?: Record<string, unknown> };
        if (!res.ok || !data.ok || !data.upgrades || !data.treasury) { alert(data.error || "Upgrade failed. Please try again."); return null; }
        return { upgrades: data.upgrades, treasury: data.treasury };
    } catch {
        alert("Upgrade failed. Please try again.");
        return null;
    }
}

// Clan-mission reward claim (api/clan/mission/claim.ts). The server recomputes
// the mission's progress from the trusted clan record + territory sectors,
// verifies the target, and credits the shared treasury + clan XP under a lock
// with a single-use latch. GET lists already-claimed missions so the UI can
// hide the button.
export async function fetchClaimedClanMissions(clan: string): Promise<string[]> {
    try {
        const res = await fetch(`/api/clan/mission/claim?clan=${encodeURIComponent(clan)}`);
        const data = await res.json().catch(() => ({})) as { claimed?: string[] };
        return Array.isArray(data.claimed) ? data.claimed : [];
    } catch { return []; }
}
export async function postClanMissionClaim(
    playerName: string,
    clan: string,
    missionKey: string,
): Promise<{ treasury: Record<string, unknown>; xp: number; level: number; claimed: string[] } | null> {
    try {
        const res = await fetch("/api/clan/mission/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, clan, missionKey }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; treasury?: Record<string, unknown>; xp?: number; level?: number; claimed?: string[] };
        if (!res.ok || !data.ok || !data.treasury) { alert(data.error || "Claim failed. Please try again."); return null; }
        return { treasury: data.treasury, xp: data.xp ?? 0, level: data.level ?? 1, claimed: Array.isArray(data.claimed) ? data.claimed : [] };
    } catch {
        alert("Claim failed. Please try again.");
        return null;
    }
}

// Server-authoritative clan kick (api/clan/kick.ts): removes the member from the
// shared clan record AND clears their character.clan on their own save (the
// cross-save write the client can't do, which is why a blob-only "kick" doesn't
// stick). Leadership-only, enforced server-side. Returns the updated member
// list on success, or null on failure (alerts the actor).
export async function postClanKick(
    playerName: string,
    clan: string,
    targetName: string,
): Promise<{ members: Array<Record<string, unknown>> } | null> {
    try {
        const res = await fetch("/api/clan/kick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, clan, targetName }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; members?: Array<Record<string, unknown>> };
        if (!res.ok || !data.ok || !data.members) { alert(data.error || "Couldn't remove that member. Please try again."); return null; }
        return { members: data.members };
    } catch {
        alert("Couldn't remove that member. Please try again.");
        return null;
    }
}

type TreasuryDonationBody =
    | { currency: string; amount: number }
    | { itemId: string; count?: number };
