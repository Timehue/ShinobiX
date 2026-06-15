/*
 * Send a STANDARD spar challenge to another player from outside the Arena lobby
 * (e.g. a profile "Challenge to Duel" button). This is the standard-mode subset
 * of Arena's challengePlayer — no pet / ranked / clan-war / token logic — kept
 * here so the profile button doesn't depend on the Arena component. The server
 * (api/player/challenge) does ALL gating (auth, sender identity, the
 * travel/battle/academy block) and returns a specific error string to surface.
 *
 * The challenge is server-stored and pushed to the recipient via their realtime
 * subscription; the accept notice routes BOTH players into the battle, so the
 * sender doesn't need to thread this into App's local duelChallenges state.
 */
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import { getBloodlineMultiplier } from "./combat-math";
import { makeId } from "./utils";
import { getPvpJutsuLoadout, type DuelChallenge } from "../App";

export async function sendStandardDuel(opts: {
    character: Character;
    opponentName: string;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
}): Promise<{ ok: boolean; error?: string }> {
    const { character, opponentName, savedBloodlines, creatorJutsus } = opts;
    const challenge: DuelChallenge = {
        id: makeId(),
        fromName: character.name,
        toName: opponentName,
        challenger: character,
        challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
        challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
        createdAt: Date.now(),
        mode: "standard",
        clanWarPoints: 0,
    };
    try {
        const res = await fetch("/api/player/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetName: opponentName, challenge }),
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            return { ok: false, error: data?.error ?? `${opponentName} is not reachable live right now.` };
        }
        return { ok: true };
    } catch {
        return { ok: false, error: `${opponentName} is not reachable live right now.` };
    }
}
