/*
 * Claim (and release) the engagement on a live sector target.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `/api/player/attack` is the world path's admission gate. It runs `attackBlock`
 * — offline (404), **Academy protection for sub-Genin (403)**, and traveling /
 * already-engaged / already-in-battle (409) — and then stamps `pendingAttacker`
 * on the target.
 *
 * The client stopped calling it in commit 416757ce0 ("Implement true PvP: shared
 * KV battle session"), which REPLACED the `/api/player/attack` POST with the new
 * `/api/player/challenge` notification instead of keeping both. Nothing noticed,
 * because the challenge is what routes the defender into the fight — so the flow
 * still worked and only the gate was lost. Two things quietly stopped meaning
 * anything for open-world raids:
 *   • Academy protection. `challenge.ts` skips its own `challengeBlock` once a
 *     `battleId` is present, so the ONLY floor left on a sector attack was
 *     `ATTACKABLE_MIN_LEVEL` (10) at session creation — never the level 15 that
 *     `ACADEMY_MIN_LEVEL` advertises.
 *   • `pendingAttacker`, which is what makes `sessionOpponentBlock`'s "already
 *     engaged in combat" branch real for a THIRD player, and what raises the
 *     defender's incoming-attack banner a beat before the challenge lands.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * Claim BEFORE creating the session. That is the order the server was built for:
 * `sessionOpponentBlock` deliberately exempts an engagement whose `byName` is the
 * caller ("the legit attack→create-session flow, where the caller's own
 * /api/player/attack just stamped the target's pendingAttacker"), and rejects
 * everyone else's. Claiming afterwards would gate nothing and would race.
 *
 * This adds no NEW failure mode to a legitimate attack: `worldInteractionBlock`
 * (co-location, actor traveling / in battle, safe zones) already runs again at
 * session creation, so every rejection here is one the flow would have taken a
 * few hundred milliseconds later anyway — just without having built a session
 * first. Academy is the one genuinely new refusal.
 */

/** `error` is already player-facing — it is the server's own refusal text. */
export type WorldAttackClaim = { ok: true } | { ok: false; error: string };

const GENERIC_REFUSAL = "They cannot be attacked right now.";

/**
 * Stamp the engagement, or explain why the fight may not start. Never throws:
 * a transport failure reads as a refusal, because a claim we cannot confirm
 * must not be treated as granted.
 */
export async function claimWorldAttack(
    targetName: string,
    attackerName: string,
    signal?: AbortSignal,
): Promise<WorldAttackClaim> {
    try {
        const res = await fetch("/api/player/attack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Only the NAME. The server stores this verbatim on the presence row
            // and ships it back to the defender, whose banner reads nothing else
            // — sending the whole character would push a multi-KB blob (avatar
            // data URL included) through the per-second heartbeat for one string.
            body: JSON.stringify({ targetName, attacker: { name: attackerName } }),
            ...(signal ? { signal } : {}),
        });
        if (res.ok) return { ok: true };
        const body = await res.json().catch(() => null) as { error?: string } | null;
        return { ok: false, error: body?.error || GENERIC_REFUSAL };
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { ok: false, error: "Could not reach the server. Try again." };
    }
}

/**
 * Release a claim whose fight never started (the session was refused, or its
 * sector registration could not be confirmed). Without this the target keeps a
 * `pendingAttacker` for an attack that never happened: they see a phantom
 * "X is attacking you!" banner, and until their next heartbeat drains it every
 * OTHER player is told they are "already engaged in combat".
 *
 * Fire-and-forget by design — the heartbeat's read-and-clear is the backstop, so
 * the worst case without this is a stale flag for one beat, never a stuck state.
 * Nothing to await and nothing to report.
 */
export function releaseWorldAttack(targetName: string): void {
    void fetch("/api/player/clear-attack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: targetName }),
    }).catch(() => { /* the next heartbeat clears it anyway */ });
}
