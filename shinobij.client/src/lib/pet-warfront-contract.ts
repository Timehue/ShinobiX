/**
 * Small runtime contract for the Hollow Warfront UI. Keep simulation code out
 * of this module: the authoritative engine is bundled only in the Web Worker.
 * These values mirror the deterministic engine's exported public contract.
 */
export const WARFRONT_TPS = 30;
export const WF_MAX_SECONDS = 600;
export const WF_PHASE_SKIRMISH = 60;
export const WF_PHASE_WAR = 240;
export const WF_PHASE_SUDDEN = 420;

export type WfStance = "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
export type WfDoctrine = "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";

export const WF_DOCTRINES: ReadonlyArray<{ id: WfDoctrine; icon: string; label: string; desc: string }> = [
    { id: "vanguard", icon: "\u2694", label: "Vanguard", desc: "+10% attack \u2014 win every trade" },
    { id: "bulwark", icon: "\ud83d\udee1", label: "Bulwark", desc: "+12% HP \u2014 outlast and last-stand harder" },
    { id: "zealot", icon: "\ud83d\udca8", label: "Zealot", desc: "+10% speed \u2014 rotate, gank, escape" },
    { id: "warden-pact", icon: "\ud83e\udd1d", label: "Warden\u2019s Pact", desc: "recruited camp bosses fight 50% longer" },
];

export const WF_STANCES: ReadonlyArray<{ id: WfStance; icon: string; label: string; desc: string }> = [
    { id: "balanced", icon: "⚖️", label: "Balanced War", desc: "Standard lanes — take what the map gives." },
    { id: "siege", icon: "🏰", label: "Siege March", desc: "March with the waves and break structures; fight only at the gates." },
    { id: "jungle", icon: "🌿", label: "Jungle Reign", desc: "Own the camps and the Warden — win through trophies and ambushes." },
    { id: "headhunt", icon: "🗡️", label: "Headhunters", desc: "Force fights and hunt picks — snowball kills into sieges." },
    { id: "turtle", icon: "🐢", label: "Iron Turtle", desc: "Hold your third, farm safe, counter-punch when the wards drop." },
];

export type WfPowerupKind = "strike" | "guard" | "vitality" | "swift" | "mend";
export const WF_POWERUPS: ReadonlyArray<{ kind: WfPowerupKind; label: string; desc: string; icon: string }> = [
    { kind: "strike", label: "Oni Talisman", desc: "+4% attack", icon: "🗡" },
    { kind: "guard", label: "Tortoise Ward", desc: "+4% defense", icon: "🛡" },
    { kind: "vitality", label: "Vitality Pill", desc: "+6% max HP (and heals it)", icon: "🫀" },
    { kind: "swift", label: "Windstep Charm", desc: "+3% move speed", icon: "🌀" },
    { kind: "mend", label: "Sage Salve", desc: "+0.3% max HP regen /s", icon: "🌿" },
];
export const WF_STACK_CAP = 6;

type VerdictSnapshot = {
    structures: Record<"blue" | "red", {
        statues: Array<{ alive: boolean }>;
        core: { alive: boolean };
    }>;
};

/** The HUD and timeout verdict intentionally use the exact same score rule. */
export function wfVerdictScore(snapshot: VerdictSnapshot): Record<"blue" | "red", number> {
    const downed = (team: "blue" | "red") => snapshot.structures[team].statues.filter((item) => !item.alive).length
        + (snapshot.structures[team].core.alive ? 0 : 1);
    return { blue: downed("red"), red: downed("blue") };
}
