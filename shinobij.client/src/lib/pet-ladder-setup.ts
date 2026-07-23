// ─────────────────────────────────────────────────────────────────────────────
// pet-ladder-setup.ts — the pre-match setup a ranked TACTICAL defense carries.
//
// A tactical ladder defense is not just four pets. It is the whole set of calls a
// player would make before the bell: the team, the opening FORMATION, and the team
// DOCTRINE. The defense fights those calls while its owner is offline, which is
// the same idea as a pet's standing orders (lib/pet-duel-doctrine.ts) applied one
// level up — to a squad rather than a single pet.
//
// The one thing a defense CANNOT do is answer the War Council, the 30-second
// interactive buy popup between rounds. Nobody is there to answer it, so a ladder
// resolve runs the council on auto for both sides (see resolveTactical).
//
// Labels live here so the ladder screen and any future setup surface describe the
// same choices in the same words.
// ─────────────────────────────────────────────────────────────────────────────
import type { WfStance, WfDoctrine } from "./pet-warfront-sim";

export type { WfStance, WfDoctrine };

export const LADDER_FORMATIONS: ReadonlyArray<{ value: WfStance; label: string; hint: string }> = [
    { value: "balanced", label: "Balanced", hint: "Hold all lanes and answer what the enemy commits to." },
    { value: "siege", label: "Siege", hint: "Press the lanes and grind the towers down." },
    { value: "jungle", label: "Jungle", hint: "Contest the middle and starve their tempo." },
    { value: "headhunt", label: "Headhunt", hint: "Hunt pets over objectives — trade kills, not ground." },
    { value: "turtle", label: "Turtle", hint: "Give ground, hold the core, and win on attrition." },
];

export const LADDER_DOCTRINES: ReadonlyArray<{ value: WfDoctrine; label: string; hint: string }> = [
    { value: "vanguard", label: "Vanguard", hint: "Lead with pressure — reward the team that moves first." },
    { value: "bulwark", label: "Bulwark", hint: "Absorb the opening and punish an overcommit." },
    { value: "zealot", label: "Zealot", hint: "All-in aggression; little held back for a long game." },
    { value: "warden-pact", label: "Warden Pact", hint: "Play the objectives and the map, not the duel." },
];

/** Coerce a stored value, so a defense saved before these existed still resolves. */
export const asFormation = (v: unknown): WfStance =>
    LADDER_FORMATIONS.some((f) => f.value === v) ? v as WfStance : "balanced";
export const asTeamDoctrine = (v: unknown): WfDoctrine =>
    LADDER_DOCTRINES.some((d) => d.value === v) ? v as WfDoctrine : "vanguard";
