/*
 * Live ranked pet matchmaking — client transport.
 *
 * The queue only produces a PAIRING. Everything that decides or rates the fight
 * is server-owned and already existed:
 *   /api/pet/ranked-start  mints one sealed match token for the pair
 *   /api/pet/ranked-watch  re-derives the rated fight for both players
 *   /api/pet/battle-result rates that same derivation
 *
 * So nothing here simulates a duel, invents a seed, or reports an outcome it
 * decided locally — that combination is exactly the defect this mode was
 * retired for.
 */

export type PetRankedQueueState =
    | { state: "idle" }
    | { state: "queued"; queuePosition: number; waiting: number }
    | { state: "paired"; opponent: string; opponentElo: number; initiator: boolean; expiresAt: number }
    | { state: "active"; matchToken: string; opponent: string; initiator: boolean };

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch("/api/pvp/pet-ranked-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(data.error ?? "Ranked matchmaking request failed."));
    return data;
}

export async function petRankedQueue(
    action: "join" | "leave" | "poll",
    playerName: string,
): Promise<PetRankedQueueState> {
    // Never trust the body's shape: a proxy, an error page, or a preview build
    // with no API mounted all answer 200 with HTML, which parses to `{}`.
    // Adopting that would blank `state` and throw on the next render.
    const raw = await post({ action, name: playerName });
    return typeof raw.state === "string"
        ? raw as unknown as PetRankedQueueState
        : { state: "idle" };
}

/**
 * Mint the sealed match token. Only the initiator may call this; the other side
 * discovers the same token through the queue's `active` state.
 */
export async function startRankedPetMatch(opponentName: string): Promise<void> {
    const response = await fetch("/api/pet/ranked-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponentName }),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "The ranked match could not be started.");
    }
}

/**
 * Report the SERVER's own verdict so it can rate the match. The server
 * re-derives the outcome from the sealed token rather than trusting this body,
 * so posting it is a nudge to settle, never a claim about who won.
 */
export async function settleRankedPetMatch(input: {
    playerName: string;
    matchToken: string;
    opponentName: string;
    outcome: "win" | "loss" | "draw";
}): Promise<void> {
    await fetch("/api/pet/battle-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playerName: input.playerName,
            outcome: input.outcome,
            ranked: true,
            matchToken: input.matchToken,
            opponentName: input.opponentName,
            reportKey: `${input.matchToken}:ranked`,
        }),
    }).catch(() => undefined);
}
