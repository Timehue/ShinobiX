/**
 * Small runtime contract for the Hollow Warfront UI. Keep simulation code out
 * of this module: the authoritative engine is bundled only in the Web Worker.
 * These values mirror the deterministic engine's exported public contract.
 */
export const WARFRONT_TPS = 30;
export const WF_MAX_SECONDS = 420;
export const WF_PHASE_SKIRMISH = 60;
export const WF_PHASE_WAR = 180;
export const WF_PHASE_SUDDEN = 300;

export type WfStance = "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
export type WfDoctrine = "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";

export const WF_DOCTRINES: ReadonlyArray<{ id: WfDoctrine; icon: string; label: string; desc: string }> = [
    { id: "vanguard", icon: "\u2694", label: "Vanguard", desc: "+8% attack — claim the first duel" },
    { id: "bulwark", icon: "\ud83d\udee1", label: "Bulwark", desc: "+12% HP — hold an outnumbered causeway" },
    { id: "zealot", icon: "\ud83d\udca8", label: "Zealot", desc: "+10% speed — reach pets and towers sooner" },
    { id: "warden-pact", icon: "\ud83e\udd1d", label: "Warden’s Pact", desc: "summon at 85 Favor; Warden lasts longer and sieges harder" },
];

export const WF_STANCES: ReadonlyArray<{ id: WfStance; icon: string; label: string; desc: string }> = [
    { id: "balanced", icon: "△", label: "Triune Formation", desc: "No modifier — repair the lane that needs you." },
    { id: "siege", icon: "🏰", label: "Siege Line", desc: "+10% tower damage, −5% pet damage." },
    { id: "jungle", icon: "◆", label: "Oathseekers", desc: "+20% Warden Favor generation." },
    { id: "headhunt", icon: "🗡", label: "Blood Hunt", desc: "+8% pet damage, −10% tower damage." },
    { id: "turtle", icon: "⬡", label: "Last Bastion", desc: "Tower-side endurance at the cost of tempo." },
];

export type WfPowerupKind = "strike" | "guard" | "vitality" | "swift" | "mend";
export const WF_POWERUPS: ReadonlyArray<{ kind: WfPowerupKind; label: string; desc: string; icon: string }> = [
    { kind: "strike", label: "Oni Talisman", desc: "+5% attack", icon: "🗡" },
    { kind: "guard", label: "Tortoise Ward", desc: "+5% defense", icon: "🛡" },
    { kind: "vitality", label: "Vitality Pill", desc: "+7% max HP (and heals it)", icon: "🫀" },
    { kind: "swift", label: "Windstep Charm", desc: "+4% move speed", icon: "🌀" },
    { kind: "mend", label: "Sage Salve", desc: "+0.4% max HP regen /s", icon: "🌿" },
];
export const WF_STACK_CAP = 6;

type VerdictSnapshot = { towers: Record<"blue" | "red", Record<"n" | "m" | "s", { alive: boolean }>> };

/** The HUD and timeout verdict intentionally use the exact same score rule. */
export function wfVerdictScore(snapshot: VerdictSnapshot): Record<"blue" | "red", number> {
    const downed = (team: "blue" | "red") => (["n", "m", "s"] as const).filter((lane) => !snapshot.towers[team][lane].alive).length;
    return { blue: downed("red"), red: downed("blue") };
}
