/**
 * Lightweight Hollow Warfront setup contracts.
 *
 * Keep this module dependency-free: pre-match screens render these choices
 * before the simulator is lazy-loaded for an actual match.
 */
export type WfStance = "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
export type WfDoctrine = "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";

export const WF_DOCTRINES: ReadonlyArray<{ id: WfDoctrine; icon: string; label: string; desc: string }> = [
    { id: "vanguard", icon: "\u2694", label: "Vanguard", desc: "+4% attack; reads and breaks Zealot openings" },
    { id: "bulwark", icon: "\ud83d\udee1", label: "Bulwark", desc: "+9% HP; absorbs and counters Vanguard openings" },
    { id: "zealot", icon: "\ud83d\udca8", label: "Zealot", desc: "+6% speed; out-rotates Bulwark openings" },
    { id: "warden-pact", icon: "\ud83e\udd1d", label: "Warden\u2019s Pact", desc: "neutral opener; recruited bosses fight 50% longer" },
];

export const WF_STANCES: ReadonlyArray<{ id: WfStance; icon: string; label: string; desc: string }> = [
    { id: "balanced", icon: "\u2696\ufe0f", label: "Balanced War", desc: "Standard lanes \u2014 take what the map gives." },
    { id: "siege", icon: "\ud83c\udff0", label: "Siege March", desc: "March with the waves and break structures; fight only at the gates." },
    { id: "jungle", icon: "\ud83c\udf3f", label: "Jungle Reign", desc: "Own the camps and the Warden \u2014 win through trophies and ambushes." },
    { id: "headhunt", icon: "\ud83d\udde1\ufe0f", label: "Headhunters", desc: "Force fights and hunt picks \u2014 snowball kills into sieges." },
    { id: "turtle", icon: "\ud83d\udc22", label: "Iron Turtle", desc: "Hold your third, farm safe, counter-punch when the wards drop." },
];

const COMBAT_DOCTRINES = ["vanguard", "bulwark", "zealot"] as const;

/**
 * Return the exact seeded V/B/Z doctrine an unspecified side will declare.
 * This pure hash never consumes the match RNG stream.
 */
export function scoutedWarfrontDoctrine(seed: number, team: "blue" | "red"): WfDoctrine {
    const salt = team === "blue" ? 0x7f4a7c15 : 0x9e3779b9;
    const mixed = Math.imul(((seed >>> 0) ^ salt) >>> 0, 2654435761) >>> 0;
    return COMBAT_DOCTRINES[mixed % COMBAT_DOCTRINES.length];
}
