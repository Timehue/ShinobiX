import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";

/*
 * The rated ranked pet duel, fetched to be WATCHED.
 *
 * The screen used to simulate this fight itself — a different engine over a
 * different seed from the one the server rated — so what a player saw and what
 * their Elo did were unrelated. /api/pet/ranked-watch re-derives the server's
 * own resolution from the sealed match token and hands back its event log, so
 * the fight on screen IS the rated fight.
 *
 * `winnerName` comes back as an ACCOUNT NAME rather than a side, because both
 * participants call this and must never be told different things about who won.
 */

export type RankedPetWatch = { script: ShowdownReplayScript; winnerName: string };

export async function fetchRankedPetDuel(matchToken: string): Promise<RankedPetWatch | null> {
    try {
        const r = await fetch("/api/pet/ranked-watch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchToken }),
        });
        if (!r.ok) return null;
        const data = await r.json().catch(() => null) as Partial<RankedPetWatch> | null;
        if (!data?.script || typeof data.winnerName !== "string") return null;
        return { script: data.script, winnerName: data.winnerName };
    } catch {
        return null;
    }
}
