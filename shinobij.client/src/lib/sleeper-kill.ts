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

export async function strikeDownSleeper(opts: {
    opponent: PlayerRecord;
    isTraveling: boolean;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    setPlayerRoster: Dispatch<SetStateAction<PlayerRecord[]>>;
}): Promise<void> {
    const { opponent, isTraveling, setCharacter, setPlayerRoster } = opts;
    if (isTraveling) { alert("You cannot attack while traveling."); return; }
    if (!window.confirm(`Strike down ${opponent.name} while they're logged out? They'll be sent to the hospital and back to their village.`)) return;

    try {
        const res = await fetch('/api/player/sleeper-kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: opponent.name }),
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
        // the village) so they vanish before the next slow roster poll.
        setPlayerRoster(prev => prev.map(p => p.name.toLowerCase() === opponent.name.toLowerCase() ? { ...p, currentSector: 0 } : p));

        const r = data.reward;
        const gains = r ? [r.ryo ? `+${r.ryo} ryo` : "", r.xp ? `+${r.xp} XP` : "", r.seals ? `+${r.seals} Honor Seals` : ""].filter(Boolean).join(", ") : "";
        alert(`💤 You struck down ${r?.target ?? opponent.name}! They've been sent to the hospital.`
            + (gains ? `\n${gains}` : (r && !r.rewardEligible ? "\n(No rewards — same household/device.)" : "")));
    } catch {
        alert("Could not reach the server. Try again.");
    }
}
