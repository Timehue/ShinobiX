/*
 * Pre-Level-50 Legacy rumors (docs/legacy-system-plan.md §6) — vague, mystical
 * hints that the player's actions are shaping which paths will open. Fired at
 * level milestones from the world map; the strongest-category tier comes from
 * GET /api/legacy/stats (bucketed server-side, never raw formulas — the
 * mystery rule). Seen-markers live in localStorage: rumors are pure flavor,
 * so per-device dedupe is enough.
 */

export const RUMOR_MILESTONE_LEVELS: readonly number[] = [10, 20, 30, 40, 45];

const SEEN_KEY = "legacyRumors.seen.v1";

function seenSet(): Set<number> {
    try {
        const raw = window.localStorage?.getItem(SEEN_KEY);
        return new Set(raw ? (JSON.parse(raw) as number[]) : []);
    } catch { return new Set(); }
}

export function shouldShowLevelRumor(level: number): boolean {
    if (!RUMOR_MILESTONE_LEVELS.includes(level)) return false;
    return !seenSet().has(level);
}

export function markLevelRumorSeen(level: number): void {
    try {
        const seen = seenSet();
        seen.add(level);
        window.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch { /* private browsing — the rumor may repeat, harmless */ }
}

/** Category-flavored rumor pools. Tier deepens the certainty of the wording. */
const RUMORS: Record<string, string[]> = {
    ninjutsu: [
        "The air crackles a little longer where you have fought. Something elemental is taking notice.",
        "Your seals are becoming a signature. Somewhere beyond level 50, a storm is learning your name.",
    ],
    genjutsu: [
        "Your path bends toward Genjutsu. The shadows between moments have started keeping notes.",
        "Enemies forget your face but not the fear. A veiled path watches from the dark.",
    ],
    taijutsu: [
        "Stone remembers every strike. Your fists are carving a reputation older words would call a legacy.",
        "The training posts speak of you in cracks and splinters. A harder trial waits past level 50.",
    ],
    bukijutsu: [
        "Your blade has drawn the attention of warborn spirits.",
        "Steel sings differently in your hands lately. Something is listening to the song.",
    ],
    pvp: [
        "Your victories in the circle are carving a dangerous reputation. Bloodier paths are opening.",
        "Duelists whisper your name with a number attached. The number keeps growing.",
    ],
    pve: [
        "The wilds thin out where you walk. The old hunters' paths are opening to you.",
        "Mission boards empty faster when you are in town. Someone important has noticed.",
    ],
    village: [
        "The village has noticed your loyalty. Elders speak of you when they think no one listens.",
        "Your name comes up at council fires. A path of oaths is forming beneath your feet.",
    ],
    support: [
        "The spirits remember how often you stand between danger and the ones behind you.",
        "Every shield you raise is a stone in a wall the world is quietly building around your name.",
    ],
    explorer: [
        "Your footsteps in forgotten sectors have not gone unnoticed.",
        "The horizon has started leaving the door open for you.",
    ],
    pets: [
        "The beasts speak of you in ways their tamers cannot translate. It sounds like respect.",
        "Something wild walks a half-step behind your reputation now.",
    ],
    cards: [
        "The card halls deal you in before you sit down. The table remembers.",
    ],
    war: [
        "War drums change rhythm when your banner arrives. The warborn paths are watching.",
    ],
    mythic: [
        "A future trial waits somewhere beyond level 50. It is not in a hurry. Neither should you be.",
    ],
};

const FALLBACK = "A hidden path watches from the shadows. Keep walking — a future trial waits beyond level 50.";

export function rumorForCategory(category: string | undefined, level: number): string {
    const pool = (category && RUMORS[category]) || null;
    if (!pool) return FALLBACK;
    return pool[level % pool.length] ?? pool[0];
}
