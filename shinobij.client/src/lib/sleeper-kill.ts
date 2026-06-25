// Client helper for the "sleeping target" KO (see api/player/sleeper-kill.ts).
// A logged-out player standing in a wild sector is struck down via a single
// server-authoritative call — there is no interactive fight. The server grants
// the same capped PvP rewards to the attacker and sends the victim to the
// hospital + back to their village. Lives here (not App.tsx) per the project's
// "new helpers go in their own module" rule.
import type { Dispatch, SetStateAction } from "react";
import type { Character, PlayerRecord } from "../types/character";

type SleeperReward = { ryo: number; xp: number; seals: number; rewardEligible: boolean; target: string };
type SleeperKillResponse = { ok?: boolean; error?: string; character?: Character; reward?: SleeperReward };

// Tombstone: names we just struck down → when to stop suppressing them. After a
// KO the server relocates the victim to the village (sector 0), but the roster
// endpoint is edge-cached for ~60s, so a poll can briefly serve the pre-KO
// snapshot and flicker the victim back into the sector. We suppress them in the
// sleeper list until the cache is guaranteed to have refreshed.
const STRUCK_DOWN_SUPPRESS_MS = 90_000;
const struckDownUntil = new Map<string, number>();

/** Mark a player as just struck down so the stale roster cache can't flicker them back. */
export function markStruckDown(name: string): void {
    struckDownUntil.set(name.toLowerCase(), Date.now() + STRUCK_DOWN_SUPPRESS_MS);
}

/** True while a just-KO'd player should stay hidden from the sleeper list. */
export function isRecentlyStruckDown(name: string): boolean {
    const until = struckDownUntil.get(name.toLowerCase());
    if (!until) return false;
    if (Date.now() > until) { struckDownUntil.delete(name.toLowerCase()); return false; }
    return true;
}

export async function strikeDownSleeper(opts: {
    opponent: PlayerRecord;
    attackerName: string;
    isTraveling: boolean;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    setPlayerRoster: Dispatch<SetStateAction<PlayerRecord[]>>;
}): Promise<void> {
    const { opponent, attackerName, isTraveling, setCharacter, setPlayerRoster } = opts;
    if (isTraveling) { alert("You cannot attack while traveling."); return; }
    if (!window.confirm(`🌙 ${opponent.name} sleeps, defenseless, in this sector.\n\nStrike them down? They'll wake battered in their village's hospital.`)) return;

    try {
        // attackerName lets an admin-authed session (no player identity of its
        // own) act as the character it's playing; the server ignores it for
        // regular players and uses their authed identity instead.
        const res = await fetch('/api/player/sleeper-kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: opponent.name, attackerName }),
        });
        const data = await res.json().catch(() => null) as SleeperKillResponse | null;
        if (!res.ok || !data?.ok) {
            alert(data?.error || "Could not strike them down.");
            return;
        }

        // Apply the server-authoritative reward to our own character — the server
        // already persisted it, so we just mirror the changed fields locally.
        const sc = data.character;
        if (sc) {
            setCharacter(prev => prev ? {
                ...prev,
                ryo: sc.ryo ?? prev.ryo,
                xp: sc.xp ?? prev.xp,
                level: sc.level ?? prev.level,
                rankTitle: sc.rankTitle ?? prev.rankTitle,
                maxHp: sc.maxHp ?? prev.maxHp,
                maxChakra: sc.maxChakra ?? prev.maxChakra,
                maxStamina: sc.maxStamina ?? prev.maxStamina,
                unspentStats: sc.unspentStats ?? prev.unspentStats,
                honorSeals: sc.honorSeals ?? prev.honorSeals,
                professionXp: sc.professionXp ?? prev.professionXp,
                professionRank: sc.professionRank ?? prev.professionRank,
                totalPvpKills: sc.totalPvpKills ?? prev.totalPvpKills,
                monthlyPvpKills: sc.monthlyPvpKills ?? prev.monthlyPvpKills,
                pvpKillMonth: sc.pvpKillMonth ?? prev.pvpKillMonth,
                dailyHonorSealsEarned: sc.dailyHonorSealsEarned ?? prev.dailyHonorSealsEarned,
                dailyHonorSealsByTarget: sc.dailyHonorSealsByTarget ?? prev.dailyHonorSealsByTarget,
                vanguardDailyResetDate: sc.vanguardDailyResetDate ?? prev.vanguardDailyResetDate,
            } : prev);
        }

        // Optimistically drop the KO'd player out of this sector (they're now in
        // the village). The tombstone keeps them hidden even if a stale (edge-
        // cached) roster poll briefly re-reports them at their old sector.
        markStruckDown(opponent.name);
        setPlayerRoster(prev => prev.map(p => p.name.toLowerCase() === opponent.name.toLowerCase() ? { ...p, currentSector: 0 } : p));

        const r = data.reward;
        const gains = r ? [r.ryo ? `+${r.ryo} ryo` : "", r.xp ? `+${r.xp} XP` : "", r.seals ? `+${r.seals} Honor Seals` : ""].filter(Boolean).join(", ") : "";
        alert(`💤 You struck down ${r?.target ?? opponent.name}! They've been sent to the hospital.`
            + (gains ? `\n${gains}` : (r && !r.rewardEligible ? "\n(No rewards — same household/device.)" : "")));
    } catch {
        alert("Could not reach the server. Try again.");
    }
}
