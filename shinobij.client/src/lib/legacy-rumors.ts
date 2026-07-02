/*
 * Pre-Level-50 Legacy rumors (docs/legacy-system-plan.md §6) — vague, mystical
 * hints that the player's actions are shaping which paths will open. Fired at
 * level milestones from the world map; the strongest-category tier comes from
 * GET /api/legacy/stats (bucketed server-side, never raw formulas — the
 * mystery rule). Seen-markers live in localStorage: rumors are pure flavor,
 * so per-device dedupe is enough.
 *
 * Depth: each (category, milestone) has TWO authored variants in the same voice
 * and at the same point in the arc; the shown line is picked deterministically
 * from (player, category, milestone, tier), so two different players — and a
 * replayed character — never hear the identical sequence, while a given player's
 * own arc stays stable if they revisit. The arc still escalates 10→45 (faint
 * stirring → "the Sage is at the door"), and a rumor fires for the highest
 * unseen milestone the player has reached (leveling past 20 offline doesn't eat
 * the beat). Heard rumors accumulate in a local log the LegacyPanel shows.
 */

export const RUMOR_MILESTONE_LEVELS: readonly number[] = [10, 20, 30, 40, 45];

const SEEN_KEY = "legacyRumors.seen.v1";
const LOG_KEY = "legacyRumors.log.v1";

// FNV-1a → mulberry32, the same determinism pattern as legacy-emissaries.ts /
// wanderers.ts. The mulberry32 step is load-bearing: FNV-1a's LOW bits barely
// avalanche, so a raw `hash % 2` picks the SAME variant for nearly every input
// (two player names collide on parity across the whole arc). mulberry32 mixes
// properly, giving an evenly-distributed [0,1) that varies per player.
function hash32(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function seededUnit(key: string): number {
    let a = hash32(key) >>> 0;
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
// [milestone 10, 20, 30, 40, 45] × 2 variants each, escalating from a faint
// stirring to "the Sage is close". Both variants of a beat share the category's
// voice and its place in the arc. Voices: ninjutsu=weather/seals/storms,
// genjutsu=shadows/veils/reflections, taijutsu=stone/posts/mountain,
// bukijutsu=steel/blades/edges, pvp=circle/odds/duelists, pve=wilds/hunters/
// gates, village=elders/oaths/lanterns, support=shields/the-saved/ledgers,
// explorer=horizon/maps/roads, pets=wild-things/packs/companions,
// cards=table/deck/hall, war=drums/banners/lines, mythic=trials/the-page.
const RUMORS: Record<string, string[][]> = {
    ninjutsu: [
        ["The air crackles a little longer where you have fought. Probably nothing.",
         "Lightning seems to lean toward the ground you stand on. Coincidence, surely."],
        ["Your seals are starting to leave an accent on the wind. Something elemental has begun taking notes.",
         "The elements answer you a half-beat sooner than they answer anyone. Somewhere, a mark went into a ledger."],
        ["Travelers say the weather arrives strangely wherever you train. The storms deny involvement — too quickly.",
         "Rain has started falling in the shape of your hand-seals, they claim. The clouds refuse to be questioned."],
        ["Somewhere beyond level 50, a storm is learning to pronounce your name. It is getting close.",
         "A tempest with no season has begun circling the road ahead of you. It is waiting for something."],
        ["The elements have stopped watching and started waiting. An old man with a talisman staff was asking about you.",
         "Every element you have ever bent is holding still at once. A staff-bearing wanderer keeps asking the wind where you are."],
    ],
    genjutsu: [
        ["The shadows between moments have started keeping notes on you.",
         "A beat of silence follows you now — one heartbeat too long. Something lives in it."],
        ["Enemies forget your face but not the fear. Something veiled finds that promising.",
         "Those you defeat describe a different opponent each time, and none of them is you. The veil approves."],
        ["Moths have been seen carrying whispers out of sectors you fought in. Nobody knows to whom.",
         "A mirror in an empty sector was found fogged with breath. You were nowhere near it. Something took notes anyway."],
        ["The dark has begun rehearsing your arrival. A veiled path is nearly ready to introduce itself.",
         "An illusion started dreaming of you before you cast it. The veil is almost finished taking your measurements."],
        ["What watches from between moments has made its decision. A wanderer with violet eyes is looking for you.",
         "The space behind every reflection has settled on your name. A violet-eyed old man walks the roads asking after it."],
    ],
    taijutsu: [
        ["Stone remembers every strike. Yours, it has started counting.",
         "The ground gives a little where your heel lands, then thinks better of it. It has begun to keep score."],
        ["The training posts speak of you in cracks and splinters. Word travels through stone slowly, but it travels.",
         "Old fighters measure their calluses against yours by rumor alone, and go quiet."],
        ["An old pilgrim was seen pressing his palm to a post you broke, nodding like it told him something.",
         "A mountain hermit added a bead to his string the day you shattered your hundredth post. He has been counting up."],
        ["Your fists are carving something older words would call a legacy. It is almost legible now.",
         "The mountain has started leaning toward the roads you walk, the way stone leans toward what it will become."],
        ["The mountain paths have cleared themselves for someone. The beads say it is you. The Sage is near.",
         "Every post you ever broke stands at attention in memory. An old man counts his beads at the roadside and waits."],
    ],
    bukijutsu: [
        ["Your blade has drawn the attention of warborn spirits. They are patient.",
         "Your edge holds a note a half-tone truer than it should. Something with a long memory is listening."],
        ["Steel sings differently in your hands lately. Something with many swords is listening to the song.",
         "Whetstones wear faster near you, the smiths swear. A blade nobody forged keeps turning toward your name."],
        ["A shrine warden was heard telling her blades to be quiet — one of them keeps saying your name.",
         "The sealed armory rattled once, on the night of your finest draw. The warden marked the date and said nothing."],
        ["The sealed swords have taken a vote. The result travels toward you at walking pace.",
         "A blade older than your village has begun sharpening itself in the dark, patiently, for a hand it hasn't met."],
        ["Every edge you have ever drawn is holding its breath. An old man watches from the roadside.",
         "The warborn spirits have chosen their carrier. Their verdict rides toward you beside a staff-bearing wanderer."],
    ],
    pvp: [
        ["Your victories in the circle are carving a reputation. Bloodier paths are opening.",
         "The circle's sand settles into your footprints now, and refuses the next fighter's. People noticed."],
        ["Duelists whisper your name with a number attached. The number keeps growing.",
         "Challengers rehearse losing to you before they arrive. Something keeps a tally of the ones who don't."],
        ["A broker with a chained ledger has opened a page with your name at the top. He seems pleased.",
         "The odds-makers stopped writing your losses down — there was no ink being spent on that column anyway."],
        ["The circle's scorched ground remembers every stand you made. It is saving you a place.",
         "A bloodier path has cleared its throne of the last name on it. Yours is the one it keeps almost saying."],
        ["The odds on you have stopped being offered — nobody will take the other side. The Sage has noticed.",
         "The circle has run out of opponents worthy of the word. An old man with a staff has been watching the last few."],
    ],
    pve: [
        ["The wilds thin out where you walk. The old hunters' paths are noticing.",
         "Tracks go quiet a day early in the country you patrol. The old hunters have started asking why."],
        ["Mission boards empty faster when you are in town. Someone important keeps score.",
         "The bounty clerks have stopped double-checking your kills. Someone else is checking them now."],
        ["A masked warden at the deep places has started leaving the gates a finger-width ajar for you.",
         "The deep places have gone strangely courteous when you approach. A masked warden pretends not to notice."],
        ["The old beasts have begun teaching their young your silhouette. That is not fear. It is respect.",
         "The hunting-grounds have started saving their oldest quarry for you, the way one saves a hard question."],
        ["What sleeps below has asked, in its slow way, when you are coming. The Sage carries the answer.",
         "Every wild thing you ever outlasted has gone still at once. An old man on the road knows exactly why."],
    ],
    village: [
        ["The village has noticed your loyalty. Elders speak of you when they think no one listens.",
         "Your name has begun appearing on duty rosters no one is asked to sign. The elders arranged it quietly."],
        ["Your name comes up at council fires now, and no one changes the subject.",
         "The gate guards nod at you the way they nod at the wall — as something the village leans on."],
        ["The lantern-warden marks your door on her rounds. She marks very few doors.",
         "The oldest oath-keeper has started leaving a chair empty at the long table. She won't say for whom."],
        ["A path of oaths is forming beneath your feet, one kept promise at a time. It is nearly load-bearing.",
         "The village has begun building its plans around your presence, the way a house is built around a beam."],
        ["The village has already decided what you are to it. It is waiting for a wandering old man to make it official.",
         "Every promise you kept is a stone in a foundation now, and it is finished. A staff-bearing elder walks to lay the last."],
    ],
    support: [
        ["The spirits remember how often you stand between danger and the ones behind you.",
         "The wounded speak your name before the medic's. Something keeps a quieter record than the medic does."],
        ["Every shield you raise is a stone in a wall the world is quietly building around your name.",
         "The blows you turned aside have started arriving at a ledger you never signed, credited in full."],
        ["The wounded you carried out tell the story differently, but the ending is always your name.",
         "A shrine keeps a lamp for the guardians who never boast. Yours is the wick it trims most often now."],
        ["Somewhere, a ledger of battles-that-never-happened credits them all to you. It is nearly full.",
         "The wall the world has been raising around your name is one course of stone from its capstone."],
        ["The ones you saved have been talking. The Sage listens to exactly that kind of talk.",
         "Every life you stood in front of is standing behind you now. An old man came to town asking who does that."],
    ],
    explorer: [
        ["Your footsteps in forgotten sectors have not gone unnoticed.",
         "The blank places on the map fill in a step ahead of you now, as if expecting the visit."],
        ["The horizon has started leaving the door open for you.",
         "Roads you have never walked bend toward you lately. Someone drew them that way on purpose."],
        ["An old cartographer with a blank map was seen copying your route. He looked satisfied.",
         "A milestone at the edge of the known world was found freshly cleaned, your name half-carved beneath the moss."],
        ["Maps end where courage does — and yours keeps not ending. The last drawn line is curious about you.",
         "The horizon has begun packing a road for you toward somewhere no map admits exists. It is nearly ready."],
        ["The horizon has learned your name and begun using it. A sage walks the roads you opened, looking for you.",
         "Every trail you ever broke leads to one place now, and an old man with a staff is already walking it toward you."],
    ],
    pets: [
        ["The beasts speak of you in ways their tamers cannot translate.",
         "Wild things watch your companions the way apprentices watch a master. Nobody taught them to."],
        ["Something wild walks a half-step behind your reputation now.",
         "Creatures that answer no one have started answering the sound of your voice a beat early."],
        ["The wild ones have started bringing their disputes to your companions. That is a kind of crown.",
         "A beast that bows to nothing was seen lowering its head on a road you had just left. Word spread on four feet."],
        ["Beasts do not follow strength; they follow the one who bled beside them. They have chosen.",
         "The old packs have begun leaving their strongest at the edge of your camp — as offering, or as escort."],
        ["The menagerie's verdict is in, and it travels on four feet toward a certain wandering old man.",
         "Every companion you ever earned is answering one call now. An old man follows the sound of it to you."],
    ],
    cards: [
        ["The card halls deal you in before you sit down. The table remembers.",
         "The dealers shuffle twice when you enter now, then once more, uneasy. The table has opinions."],
        ["Your discards are being studied by people who lose to you anyway.",
         "The house has quietly stopped raising its limits at your table. Someone above the house asked them to."],
        ["The table's shadow has started standing behind YOUR chair. It has good taste.",
         "A marked deck went missing the night you played clean and won anyway. Nobody dares ask you about it."],
        ["Games end the same way often enough around you that the hall calls it weather, not luck.",
         "The oldest game in the hall has cleared a seat no one has earned in a generation. It is holding it."],
        ["The deck has run out of surprises for you. The Sage holds one last card, and he is close.",
         "Every hand you were ever dealt has folded into one. A staff-bearing old man holds the last card, smiling."],
    ],
    war: [
        ["War drums change rhythm when your banner arrives. The warborn paths are watching.",
         "The line steadies where you stand without being told to. Old soldiers have started standing near you on purpose."],
        ["Enemy sectors say your name the way one reports weather: with resignation.",
         "Your banner has begun deciding battles before it is planted. The other banners noticed, and lowered."],
        ["Captured banners pile up somewhere with your name chalked above them.",
         "The war-camps have started assigning you the ground they cannot afford to lose. That is its own kind of medal."],
        ["Wars have started planning around you, which is the highest compliment a war can pay.",
         "A warborn legacy has emptied its hall of every lesser name, and left one nail bare for a banner it hasn't seen."],
        ["The next war has already reserved you a page in its story. So has an old man with a staff.",
         "Every banner you ever took is flying in memory at once. A staff-bearing wanderer walks the front, looking for you."],
    ],
    mythic: [
        ["A future trial waits somewhere beyond level 50. It is not in a hurry. Neither should you be.",
         "Something enormous has taken a quiet interest in you and decided, for now, to simply watch."],
        ["Whatever is watching you has stopped comparing you to others. There stopped being a comparison.",
         "The measuring-stick the world uses for shinobi has started, where you are concerned, coming up short."],
        ["Several paths argued over you. They have settled it the old way — the mountain wins.",
         "The great legacies have stopped competing for your attention and started competing for your name."],
        ["The kind of legacy that gets argued about in taverns for a generation has shortlisted you.",
         "A story the world will tell for a hundred years is missing exactly one detail: which name goes at the center."],
        ["The Sage has crossed out every other name on the page. Level 50 is not a milestone anymore. It is an appointment.",
         "One name is left uncrossed on the old man's page, and it is yours. Level 50 is not a wall. It is a door."],
    ],
};

// Generic arc for a player with no dominant category yet (score < 0.25) — same
// milestone shape, so leveling never yields a dead "no rumors" beat.
const FALLBACK: string[][] = [
    ["A hidden path watches from the shadows. Keep walking.",
     "Something has begun to notice the shape your choices are making. Keep making them."],
    ["Something patient has begun following your story.",
     "A quiet figure has started reading your deeds in the order you did them."],
    ["The roads have started remembering you in order.",
     "Word of you is traveling somewhere ahead of you, taking its time."],
    ["A future trial waits beyond level 50, and it has started preparing.",
     "Beyond level 50, something is clearing a space with your rough shape in mind."],
    ["An old wanderer with violet eyes has been asking after shinobi like you. Level 50 is close.",
     "A staff-bearing old man keeps asking the roads about someone. The description keeps fitting you. Level 50 is close."],
];

/** The categories with an authored arc (test/introspection). */
export const RUMOR_CATEGORIES: readonly string[] = Object.keys(RUMORS);
/** The authored variant arc for a category, or null (test/introspection). */
export function rumorArc(category: string): readonly string[][] | null {
    return RUMORS[category] ?? null;
}

/**
 * The rumor for a category at a milestone. Escalates with the arc; the specific
 * variant is chosen deterministically from (player, category, milestone, tier)
 * so a given player's arc is stable on revisit, but two players — or a replayed
 * character, or the same player on a different path-tier — diverge. `opts.tier`
 * is the server-bucketed strength (stirring/taking shape/strong/dominant); it
 * only varies WHICH in-arc variant shows, never the mystery-rule bucketing.
 */
export function rumorForCategory(
    category: string | undefined,
    milestone: number,
    opts: { playerName?: string; tier?: string } = {},
): string {
    const idx = Math.max(0, RUMOR_MILESTONE_LEVELS.indexOf(milestone));
    const pool = (category && RUMORS[category]) || FALLBACK;
    const variants = pool[Math.min(idx, pool.length - 1)];
    if (variants.length === 1) return variants[0];
    const unit = seededUnit(`${opts.playerName ?? ""}:${category ?? "fallback"}:${milestone}:${opts.tier ?? ""}`);
    return variants[Math.min(variants.length - 1, Math.floor(unit * variants.length))];
}
