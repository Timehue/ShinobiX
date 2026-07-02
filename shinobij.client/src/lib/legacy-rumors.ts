/*
 * Pre-Level-50 Legacy rumors (docs/legacy-system-plan.md §6) — vague, mystical
 * hints that the player's actions are shaping which paths will open. Fired at
 * level milestones from the world map; the strongest-category tier comes from
 * GET /api/legacy/stats (bucketed server-side, never raw formulas — the
 * mystery rule). Seen-markers live in localStorage: rumors are pure flavor,
 * so per-device dedupe is enough.
 *
 * Depth-audit fixes: each milestone now has its OWN line per category (the
 * arc escalates 10→45 instead of repeating), a rumor fires for the highest
 * unseen milestone at level >= it (leveling past 20 offline no longer eats
 * the beat), and heard rumors accumulate in a local log the LegacyPanel
 * shows — the arc builds instead of evaporating.
 */

export const RUMOR_MILESTONE_LEVELS: readonly number[] = [10, 20, 30, 40, 45];

const SEEN_KEY = "legacyRumors.seen.v1";
const LOG_KEY = "legacyRumors.log.v1";

function seenSet(): Set<number> {
    try {
        const raw = window.localStorage?.getItem(SEEN_KEY);
        return new Set(raw ? (JSON.parse(raw) as number[]) : []);
    } catch { return new Set(); }
}

/** The next unheard milestone the player has reached, or null. Lowest first,
 *  so a player who leveled past several milestones hears the arc IN ORDER
 *  (one whisper per map visit) instead of the climax before the opening. */
export function nextUnseenRumorMilestone(level: number): number | null {
    const seen = seenSet();
    const due = RUMOR_MILESTONE_LEVELS.filter((m) => level >= m && !seen.has(m));
    return due.length ? due[0] : null;
}

export function markLevelRumorSeen(milestone: number): void {
    try {
        const seen = seenSet();
        seen.add(milestone);
        window.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch { /* private browsing — the rumor may repeat, harmless */ }
}

export type HeardRumor = { milestone: number; text: string; ts: number };

/** Rumors already heard on this device, oldest first (the panel's log). */
export function rumorLog(): HeardRumor[] {
    try {
        const raw = window.localStorage?.getItem(LOG_KEY);
        const arr = raw ? (JSON.parse(raw) as HeardRumor[]) : [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

export function recordRumorHeard(milestone: number, text: string): void {
    try {
        const log = rumorLog().filter((r) => r.milestone !== milestone);
        log.push({ milestone, text, ts: Date.now() });
        log.sort((a, b) => a.milestone - b.milestone);
        window.localStorage?.setItem(LOG_KEY, JSON.stringify(log.slice(-10)));
    } catch { /* best-effort */ }
}

// ── The rumor arcs ───────────────────────────────────────────────────────────
// One line per milestone (10 → 20 → 30 → 40 → 45), escalating from a faint
// stirring to "the Sage is close". Indexed by milestone position.
const RUMORS: Record<string, string[]> = {
    ninjutsu: [
        "The air crackles a little longer where you have fought. Probably nothing.",
        "Your seals are starting to leave an accent on the wind. Something elemental has begun taking notes.",
        "Travelers say the weather arrives strangely wherever you train. The storms deny involvement — too quickly.",
        "Somewhere beyond level 50, a storm is learning to pronounce your name. It is getting close.",
        "The elements have stopped watching and started waiting. An old man with a talisman staff was asking about you.",
    ],
    genjutsu: [
        "The shadows between moments have started keeping notes on you.",
        "Enemies forget your face but not the fear. Something veiled finds that promising.",
        "Moths have been seen carrying whispers out of sectors you fought in. Nobody knows to whom.",
        "The dark has begun rehearsing your arrival. A veiled path is nearly ready to introduce itself.",
        "What watches from between moments has made its decision. A wanderer with violet eyes is looking for you.",
    ],
    taijutsu: [
        "Stone remembers every strike. Yours, it has started counting.",
        "The training posts speak of you in cracks and splinters. Word travels through stone slowly, but it travels.",
        "An old pilgrim was seen pressing his palm to a post you broke, nodding like it told him something.",
        "Your fists are carving something older words would call a legacy. It is almost legible now.",
        "The mountain paths have cleared themselves for someone. The beads say it is you. The Sage is near.",
    ],
    bukijutsu: [
        "Your blade has drawn the attention of warborn spirits. They are patient.",
        "Steel sings differently in your hands lately. Something with many swords is listening to the song.",
        "A shrine warden was heard telling her blades to be quiet — one of them keeps saying your name.",
        "The sealed swords have taken a vote. The result travels toward you at walking pace.",
        "Every edge you have ever drawn is holding its breath. An old man watches from the roadside.",
    ],
    pvp: [
        "Your victories in the circle are carving a reputation. Bloodier paths are opening.",
        "Duelists whisper your name with a number attached. The number keeps growing.",
        "A broker with a chained ledger has opened a page with your name at the top. He seems pleased.",
        "The circle's scorched ground remembers every stand you made. It is saving you a place.",
        "The odds on you have stopped being offered — nobody will take the other side. The Sage has noticed.",
    ],
    pve: [
        "The wilds thin out where you walk. The old hunters' paths are noticing.",
        "Mission boards empty faster when you are in town. Someone important keeps score.",
        "A masked warden at the deep places has started leaving the gates a finger-width ajar for you.",
        "The old beasts have begun teaching their young your silhouette. That is not fear. It is respect.",
        "What sleeps below has asked, in its slow way, when you are coming. The Sage carries the answer.",
    ],
    village: [
        "The village has noticed your loyalty. Elders speak of you when they think no one listens.",
        "Your name comes up at council fires now, and no one changes the subject.",
        "The lantern-warden marks your door on her rounds. She marks very few doors.",
        "A path of oaths is forming beneath your feet, one kept promise at a time. It is nearly load-bearing.",
        "The village has already decided what you are to it. It is waiting for a wandering old man to make it official.",
    ],
    support: [
        "The spirits remember how often you stand between danger and the ones behind you.",
        "Every shield you raise is a stone in a wall the world is quietly building around your name.",
        "The wounded you carried out tell the story differently, but the ending is always your name.",
        "Somewhere, a ledger of battles-that-never-happened credits them all to you. It is nearly full.",
        "The ones you saved have been talking. The Sage listens to exactly that kind of talk.",
    ],
    explorer: [
        "Your footsteps in forgotten sectors have not gone unnoticed.",
        "The horizon has started leaving the door open for you.",
        "An old cartographer with a blank map was seen copying your route. He looked satisfied.",
        "Maps end where courage does — and yours keeps not ending. The last drawn line is curious about you.",
        "The horizon has learned your name and begun using it. A sage walks the roads you opened, looking for you.",
    ],
    pets: [
        "The beasts speak of you in ways their tamers cannot translate.",
        "Something wild walks a half-step behind your reputation now.",
        "The wild ones have started bringing their disputes to your companions. That is a kind of crown.",
        "Beasts do not follow strength; they follow the one who bled beside them. They have chosen.",
        "The menagerie's verdict is in, and it travels on four feet toward a certain wandering old man.",
    ],
    cards: [
        "The card halls deal you in before you sit down. The table remembers.",
        "Your discards are being studied by people who lose to you anyway.",
        "The table's shadow has started standing behind YOUR chair. It has good taste.",
        "Games end the same way often enough around you that the hall calls it weather, not luck.",
        "The deck has run out of surprises for you. The Sage holds one last card, and he is close.",
    ],
    war: [
        "War drums change rhythm when your banner arrives. The warborn paths are watching.",
        "Enemy sectors say your name the way one reports weather: with resignation.",
        "Captured banners pile up somewhere with your name chalked above them.",
        "Wars have started planning around you, which is the highest compliment a war can pay.",
        "The next war has already reserved you a page in its story. So has an old man with a staff.",
    ],
    mythic: [
        "A future trial waits somewhere beyond level 50. It is not in a hurry. Neither should you be.",
        "Whatever is watching you has stopped comparing you to others. There stopped being a comparison.",
        "Several paths argued over you. They have settled it the old way — the mountain wins.",
        "The kind of legacy that gets argued about in taverns for a generation has shortlisted you.",
        "The Sage has crossed out every other name on the page. Level 50 is not a milestone anymore. It is an appointment.",
    ],
};

const FALLBACK: string[] = [
    "A hidden path watches from the shadows. Keep walking.",
    "Something patient has begun following your story.",
    "The roads have started remembering you in order.",
    "A future trial waits beyond level 50, and it has started preparing.",
    "An old wanderer with violet eyes has been asking after shinobi like you. Level 50 is close.",
];

/** The rumor for a category at a milestone — escalates with the arc. */
export function rumorForCategory(category: string | undefined, milestone: number): string {
    const idx = Math.max(0, RUMOR_MILESTONE_LEVELS.indexOf(milestone));
    const pool = (category && RUMORS[category]) || FALLBACK;
    return pool[Math.min(idx, pool.length - 1)];
}
