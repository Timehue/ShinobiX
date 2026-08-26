/*
 * Pure helpers for the Tactical Arena player-vs-player challenge. Both clients
 * resolve the SAME embedded teams + seed so runPetArenaMatch stays
 * deterministic. Kept out of App.tsx (line-budget ratchet) — App holds only the
 * React glue (state, notify, screen routing); PetArena drives the pickers.
 */
import type { Pet } from "../types/pet";

export type WarfrontChallengePlan = Readonly<{
    buyPolicy: "balanced" | "offense" | "defense";
    stance: "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
    doctrine: "vanguard" | "bulwark" | "zealot" | "warden-pact";
}>;

export type WarfrontChallengePlans = Readonly<{
    blue: WarfrontChallengePlan;
    red: WarfrontChallengePlan;
}>;

export type ArenaChallengeLike = {
    arenaSize?: 2 | 4;
    challengerTeamIds?: string[];
    challenger: { pets: Pet[] };
    responderTeam?: Pet[];
    petBattleSeed?: number;
    challengerWarfrontPlan?: WarfrontChallengePlan;
    responderWarfrontPlan?: WarfrontChallengePlan;
};
export type ArenaMatchPayload = {
    blue: Pet[];
    red: Pet[];
    size: 2 | 4;
    seed: number;
    plans: WarfrontChallengePlans;
};

export const arenaSizeOf = (c: { arenaSize?: 2 | 4 }): 2 | 4 => (c.arenaSize === 2 ? 2 : 4);

export function parseWarfrontChallengePlan(value: unknown): WarfrontChallengePlan | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const plan = value as Record<string, unknown>;
    if (!(plan.buyPolicy === "balanced" || plan.buyPolicy === "offense" || plan.buyPolicy === "defense")) return null;
    if (!(plan.stance === "balanced" || plan.stance === "siege" || plan.stance === "jungle" || plan.stance === "headhunt" || plan.stance === "turtle")) return null;
    if (!(plan.doctrine === "vanguard" || plan.doctrine === "bulwark" || plan.doctrine === "zealot" || plan.doctrine === "warden-pact")) return null;
    return { buyPolicy: plan.buyPolicy, stance: plan.stance, doctrine: plan.doctrine };
}

// Drop inline data: sprites before a team rides the anon-readable challenge
// inbox — art rehydrates from the shared-image cache by pet id on the peer.
export function stripInlinePetImages(pets: Pet[]): Pet[] {
    const inline = (v: unknown) => typeof v === "string" && v.startsWith("data:");
    return pets.map((p) => {
        const rec = p as Record<string, unknown>;
        if (!inline(rec.image) && !inline(rec.bodyImage)) return p;
        const out = { ...rec };
        if (inline(out.image)) delete out.image;
        if (inline(out.bodyImage)) delete out.bodyImage;
        return out as unknown as Pet;
    });
}

// The challenger's roster, resolved by id (in pick order) against the challenger
// snapshot — the same source on both clients, so the match stays in sync.
export const resolveChallengerTeam = (c: ArenaChallengeLike): Pet[] =>
    (c.challengerTeamIds ?? [])
        .map((id) => c.challenger.pets.find((p) => p.id === id))
        .filter((p): p is Pet => !!p);

// Challenger side: resolve my roster + the responder's echoed roster from the
// accepted notice. Null when either roster is missing.
export function buildAcceptedArenaMatch(c: ArenaChallengeLike): ArenaMatchPayload | null {
    const blue = resolveChallengerTeam(c);
    const red = c.responderTeam ?? [];
    const bluePlan = parseWarfrontChallengePlan(c.challengerWarfrontPlan);
    const redPlan = parseWarfrontChallengePlan(c.responderWarfrontPlan);
    if (!blue.length || !red.length || !bluePlan || !redPlan) return null;
    return { blue, red, size: arenaSizeOf(c), seed: c.petBattleSeed ?? 1, plans: { blue: bluePlan, red: redPlan } };
}
