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
// [milestone 10, 20, 30, 40, 45] × 2 variants each, escalating from "somebody
// noticed" to "the Sage is close". Voice rule (2026-07 humanization pass, v2):
// every rumor is SPOKEN TO THE PLAYER by an ordinary person — first/second
// person, contractions, plain words, one concrete fact plus a human reaction
// ("weird, right?", "I didn't like that part"). No narrator voice, no clever
// compression, no scene-jargon, and no personified abstractions (no horizons
// learning names, no shadows taking notes). If a line needs a second read, it
// fails. The mystery rule still holds: never stats, never mechanics.
// Beats 3–5 deliberately sight the Legacy Emissaries (the ledger man, the
// moth-veiled woman, the bead disciple, the blank-map man...) and finally the
// Sage himself, so the arc foreshadows NPCs the player will actually meet.
const RUMORS: Record<string, string[][]> = {
    ninjutsu: [
        ["Did you hear? That storm last week tore up half the training yard and didn't touch your posts. The groundskeeper won't stop telling people.",
         "The seal-paper lady says your tags burn cleaner than anybody's. She asked me if you buy a special batch. You don't, right?"],
        ["One of the academy instructors watches you run hand-seals now. Just you. The students noticed before he did.",
         "A caravan guard told me lightning hit your road twice and didn't touch a thing. He swears it was waiting for you to look up."],
        ["The shrine keeper says the weather picks a favorite every generation. I asked her who. She just looked down your street and smiled.",
         "Two chunin spent half the night arguing whether anyone can really call a storm. Somebody said your name and they both went quiet."],
        ["Some monk came through asking who trains in the valley when it thunders out of a clear sky. Wrote the answer down and left without his change.",
         "The gate guard told me an old man stood in the rain for an hour asking about a storm-handed shinobi. Says the rain never touched him. I'd have run."],
        ["There's an old man with a staff going village to village asking about you. By name now. He's not lost, and it's not a bounty.",
         "A courier told me he gets paid to report where the big storms land. Says lately he just reports wherever you are. Same thing, apparently."],
    ],
    genjutsu: [
        ["A patrol came back saying the road felt longer walking behind you. They laughed about it at first. They've stopped laughing.",
         "The lamplighter says the shadows sit wrong in that alley where you train. He lights that one first now. Won't say why out loud."],
        ["The last three people you beat can't agree on what you look like. The bounty clerk showed me the reports. Three different faces.",
         "A medic told me your opponents wake up too calm. She asks them what they saw. They say 'nothing' and stop talking."],
        ["Some woman with half a porcelain mask bought the whole tavern a round, then asked who does the quiet work around here. Everyone stared at their drinks.",
         "They found moths circling the yard where you trained. Hours after you left. The old-timers walked around them. Around, not through."],
        ["A veiled traveler sat in the corner all night watching the door. Left a big tip and your name on a napkin. Spelled wrong, but still.",
         "One of the academy teachers pulled your old file. Said someone important asked for it. Then she went pale and pretended she hadn't said that."],
        ["There's an old man with violet eyes on the roads, asking about a shinobi nobody can describe right. Everyone he asks ends up describing you.",
         "That veiled woman told the barkeep her master's coming himself soon. He asked who her master was. She just paid and walked out."],
    ],
    taijutsu: [
        ["The quartermaster says you've broken more training posts than the last three classes put together. He's stopped writing it up as vandalism.",
         "An old porter watched you spar the other day and put his pipe out. Said he hadn't done that since the war. I don't know what it means either."],
        ["The carpenter who fixes the training posts keeps asking who does that with bare hands. Nobody's had the heart to tell him it's one person.",
         "Two old fighters were comparing bruises at the bathhouse. Both agreed they'd rather not take your sparring slot. These are men who fought in the war."],
        ["A stone-bead disciple put his hand on a post you broke and nodded, like it told him something. Then he asked which road you take home. Didn't love that part.",
         "The bone-setter says she can tell your opponents by the bruises now. She keeps a chart behind the counter. I've seen it. It's a long chart."],
        ["That bead disciple's been back twice. He doesn't pray at the shrine. He just watches the training yard and counts on his string.",
         "An old soldier told me the mountain schools send someone down when a real one shows up. Then he kept glancing at the door like he expected a knock."],
        ["The old man with the staff asked the gatekeeper who has the strongest hands in the village. The gatekeeper didn't even have to think. He said your name.",
         "The bead disciple finally spoke. One sentence: 'Tell them to keep their hands ready.' He didn't say who. He didn't have to."],
    ],
    bukijutsu: [
        ["The smith says your blades come back barely needing work. Wear in all the right places, she says. She doesn't say that about anyone else.",
         "A weapons dealer tried to buy your practice sword right off the rack. Wouldn't say who it was for. Offered real money, too."],
        ["The whetstone seller sets one aside on your training days. Says it's coincidence. It has your name on the wrapper, so you tell me.",
         "An old duelist watched you draw once and walked out mid-drink. Paid for three rounds on his way out. Nobody knows what that means, but it means something."],
        ["A woman came through carrying more swords than sense, asking about local blade-work. The smith said your name before she'd finished the question.",
         "The armory guard swears one of the sealed racks rattled the night of your last match. He asked to switch to day shift. They let him."],
        ["That sword-carrier came back. Stood outside the smithy listening to your blade getting worked. Didn't say a word. Then she left.",
         "Somebody sent your smith a whetstone. Paid up front, no name, wrapped in old shrine paper. She won't use it and she won't throw it out."],
        ["The old man with the staff was at the forge, asking about the hand that wears its blades even. The smith pointed at your street.",
         "The sword-carrier told the smith her blades have been restless since your last match. She sounded happy about it. The smith wasn't."],
    ],
    pvp: [
        ["The arena bookies opened a line on you. Small money for now. But the smart money always shows up early — that's what makes it smart.",
         "Somebody asked around about who trained you. Got three names, all different, all wrong. I checked."],
        ["Challengers ask who else is on the card before they'll sign against you now. The clerk thinks it's hilarious. The challengers don't.",
         "The odds board shortens your line before you even post. I asked the bookie why. He said it saves everybody time."],
        ["There was a man with a ledger chained to his wrist at your last three matches. Didn't bet once. Just wrote things down. Creepy, honestly.",
         "The arena medic says your opponents all ask the same thing when they wake up: when's the rematch. Then they remember the fight and go quiet."],
        ["That ledger man bought your whole fight record off the clerk. Paid in old coin. Tipped like a man closing an account.",
         "Nobody local will bet against you anymore. Out-of-towners still do. Once."],
        ["The old man with the staff watched your last bout from the cheap seats. The bookie let him in free. Even bookies hedge their bets.",
         "The ledger man told the clerk his employer settles up at fifty. Fifty what? He wouldn't say. He looked pleased about it, though."],
    ],
    pve: [
        ["The mission clerk pins the ugly contracts where you'll see them now. I asked him about it. He said it saves paperwork.",
         "A trapper told me the wolves moved two valleys over. He said it like a complaint. It was not a complaint."],
        ["The bounty office doesn't double-check your kill reports anymore. The clerk says the ink costs more than the doubt is worth.",
         "Two hunters have started working the trails you skip. They call it the leftovers route. They're not even embarrassed about it."],
        ["A masked warden came up from the deep country for salt. Asked exactly one question: does that one range far? They meant you.",
         "The old hunters call the worst contracts yours now. As in, 'leave it, that one's theirs.' You're a category."],
        ["That masked warden came back. More salt. Nobody needs that much salt. And they asked about your habits again.",
         "The trapper says something big has gone quiet in the deep country. Not dead. Waiting. He moved his snares closer to town, if that tells you anything."],
        ["The old man with the staff and that masked warden shared a table for an hour. The barkeep says your name was the only word he caught.",
         "The trapper says the deep country's gone quiet edge to edge. And that an old wanderer walked straight into it. Whistling."],
    ],
    village: [
        ["Your name keeps showing up on duty rosters nobody remembers writing. The clerk just shrugs and stamps them now.",
         "One of the elders asked the gate guard how often you take the wall shift. Then asked why not more often. Poor guard."],
        ["Council fire ran late twice this month. Both times people walked out saying your name — and not complaining. That's new for the council.",
         "The gate guards nod at you the way they nod at the wall. From a gate guard, there is no higher compliment."],
        ["The lantern-warden marks doors on her rounds. The lamp-boy says yours gets marked first every night. He asked her why once. Just once.",
         "The oldest oath-keeper set an extra chair at the long table. Won't say who it's for. It faces your street. We all noticed."],
        ["The lantern-warden asked the elders for your service record and they just handed it over. No questions. Elders always have questions.",
         "A stranger with a staff asked the gate guard what this village would do without you. The guard didn't have an answer. It's been eating at him all week."],
        ["The elders met with some old traveler yesterday. They came out looking like men who'd finally settled a very old bet.",
         "An old man with a staff signed the gate ledger. Under 'business' he wrote one word: overdue. The guard copied it out to show me."],
    ],
    support: [
        ["The night nurse keeps a list of who brings wounded in and leaves before the thank-yous. Your column is the long one.",
         "There's a genin going around saying somebody took a hit meant for him and walked off before he could turn around. He's still asking who. Should I tell him?"],
        ["The medic corps moved you up their call-first list. Officially, that list doesn't exist. Unofficially, it's laminated.",
         "The armorer says your gear wears on the outside edges. Shield wear, she calls it. Says maybe three people in the village wear that pattern."],
        ["The shrine keeper trims one lamp longer than the rest. Says it's for the ones who stand in front. Then she asked me if you've been eating enough.",
         "A woman with a lantern and a shield came through the hospital reading the intake log. Didn't say a word. Your name's in there twice."],
        ["That lantern-woman asked the nurse who stands between trouble and everyone else around here. The nurse laughed and pointed at your name on the duty board.",
         "Somebody's been paying the hospital tabs for the people you carried in. Not you. Some old man. Exact change, every time."],
        ["The old man with the staff sat with the night nurse and read her whole list, name by name. Got to yours and stopped reading.",
         "The lantern-woman told the shrine keeper her master 'collects the quiet ones.' The keeper said 'about time' and went back to her lamps."],
    ],
    explorer: [
        ["The mapmaker charges you double for blank paper now. Says you burn through more of it than the survey corps. The whole survey corps.",
         "A courier swears he saw your tracks past the last waymarker. There's nothing past the last waymarker. That's why it's the last one."],
        ["The survey office copies your route notes before they hand them back. Badly. They know you know. It's awkward for everybody.",
         "The border post logged you out four times last month and back in three. The sergeant decided not to ask. Smart sergeant."],
        ["There's an old man with a blank map at the crossroads, asking travelers one thing: which way did the young one go? That's you. You're the young one.",
         "The mapmaker's apprentice found a trail-mark past the edge of the newest chart. Recognized the knife-work. He's keeping it quiet. Well — mostly."],
        ["That blank-map man was back at the crossroads. He wasn't asking for directions this time. He was leaving them.",
         "The last surveyor who walked your routes came home and quit. Said the maps had been the wrong shape all along. Honestly, he seemed relieved."],
        ["The old man with the staff bought the mapmaker's last blank sheet. Said it's for a shinobi who's earned an empty page. Guess who.",
         "The blank-map man told the border sergeant to expect one more departure soon. Whose? He tapped the blank map and smiled. Sergeants hate that."],
    ],
    pets: [
        ["The kennel master says the wild ones settle down when your beast walks past. He's stopped trying to explain it. He just points now.",
         "A tamer at the coliseum asked me what you feed yours. Wouldn't believe it's the same feed as everyone else. It is, right?"],
        ["The neighbors keep count of the strays that follow you home. Three last week. One of them, nobody could even name the breed.",
         "The coliseum sand crew says the other beasts line up at the fence when yours fights. They don't pace or growl. They just watch."],
        ["That old wanderer with the blank map watched your beast fight, then said something to it on the way out. Just to the beast. It's been smug ever since.",
         "A pack came down from the hills and stopped at the tree line by your camp. The trapper says that's not hunting. That's an escort."],
        ["The blank-map man asked the kennel master which beast around here chose its person instead of the other way around. He walked out with your pet's name.",
         "The coliseum's oldest handler says the beasts fight cleaner when yours is watching. Like they're auditioning. His word, not mine."],
        ["The old man with the staff stood at the coliseum fence for all three of your beast's fights. Your beast watched him right back. Neither one blinked.",
         "The blank-map man left trail feed at the kennel with your pet's name on it. The kennel master can't find that feed in any catalog. He's tried."],
    ],
    cards: [
        ["The dealers shuffle twice when you sit down now. One of them asked me, real quiet, where you learned to play. I said I'd ask. So — where?",
         "There's a guy copying your discards into a notebook. Every game. He still loses to you. The notebook is not helping."],
        ["The card hall stopped raising the table limit when you sit. The floor manager calls it policy. That policy is a week old.",
         "A regular swears he's finally figured out your tell. He's lost forty hands to you. At this point people just feel bad for him."],
        ["A man with a ledger chained to his wrist watched you play three hands and wrote one line. The dealer peeked. It was odds. Long ones, in your favor.",
         "The hall's oldest player asked to sit at your table just to watch. Didn't play a single hand. Tipped the dealer for the chair."],
        ["That ledger man asked who owns the empty seat at the oldest table. The floor manager said nobody's earned it in a generation. He said: check again.",
         "Your matches pull the back-room crowd out front now. The floor manager hates it. The bar has never done better."],
        ["The old man with the staff played one hand at your hall last night. Won it, tipped big, and asked when you usually come in.",
         "The ledger man says his employer is holding one last card for you. The dealer asked which one. He said: the one that isn't printed yet."],
    ],
    war: [
        ["An old sergeant says the line holds different when you're on it. He's not the sentimental type. He's just tired of replacing sections.",
         "The quartermaster noticed the banners come back less shredded from your postings. He wrote it down. Quartermasters write everything down."],
        ["Enemy scouts report your position like weather now. We intercepted one report. It just said: them again.",
         "Two captains argued over which front gets you next. It got loud enough that the Kage's office sent somebody down to break it up."],
        ["That ledger man walked the whole line at the war camp. Stopped at your section, measured something with a string, and left. Nobody stopped him. Nobody wanted to.",
         "Old soldiers stand near you on purpose now. Ask them why and they suddenly have a lot of gear to check."],
        ["Command plans around where you'll be now, instead of telling you where to go. The clerks say the paperwork's a nightmare. They say it proudly.",
         "A captured scout asked his interrogator one question back: will you be at the next engagement. Nobody answered him. He assumed."],
        ["They say the old man with the staff walked the entire front last week and stopped at every position you ever held. Made a little mark at each one.",
         "The ledger man closed a book at the war camp and said the account was ready. The quartermaster asked whose. He just tapped the cover."],
    ],
    mythic: [
        ["The old-timers talk about you differently now. They don't say 'promising' anymore. They just go quiet and nod at each other. It's strange to watch.",
         "The shrine keeper asked your name twice, then wrote it down somewhere in the back room. Nobody's seen her write anything down in years."],
        ["The examiners stopped comparing you to people. The last one who tried trailed off mid-sentence and never finished it. We waited. Nothing.",
         "A traveler paid his tab, pointed at you, and told the barkeep: that one's being watched. He was gone before anyone could ask by who."],
        ["Word is a few of the old orders sent people to look at you. Word is they all came back with the same one-word report: yes.",
         "The oldest man in the village says he's seen this once before. I asked what happened to that one. He just pointed at the mountain shrine."],
        ["Taverns two villages over argue about you like you're already a story. Nobody argues that hard about a person who's still around.",
         "The shrine keeper's been dusting the old altar nobody uses. Wants it presentable, she says. Won't say for what. It faces the road."],
        ["A courier saw the old man's page himself. Every name crossed out except one. Yours. Folk are saying the Fiftieth Rank isn't a milestone for you anymore — it's an appointment.",
         "The Sage is asking for you by name now. Not a description — your name. The barkeep's advice: reach the Fiftieth Rank before he knocks, or be embarrassed."],
    ],
};

// Generic arc for a player with no dominant category yet (score < 0.25) — same
// milestone shape, so leveling never yields a dead "no rumors" beat.
const FALLBACK: string[][] = [
    ["People remember your name on the first try now. The barkeep says that's rarer than it sounds in this line of work.",
     "Somebody asked what your specialty is and the whole table started arguing. Still going, far as I know. Nobody could pick one."],
    ["A quiet traveler asked about you at the gate. Not your rank — what you're like. The guard's still chewing on that one.",
     "Word about you keeps reaching towns a day before you do. The couriers swear nobody's paying them for it."],
    ["The same stranger's been at the gate three visits running, asking after promising shinobi. Never stays the night. It's in the log, I checked.",
     "Some old wanderer keeps asking the roads about someone. The description's vague. It keeps fitting you anyway."],
    ["Whoever's been asking about you got the elders talking. They won't say who it was. They keep glancing at the road, though.",
     "That stranger with the staff asked the barkeep how close you are to fifty. Odd thing to ask. The barkeep answered before he thought better of it."],
    ["The old man with the violet eyes is one village over and still asking. Your field record is nearing its Fiftieth Rank. Honestly, he seems to know it better than you do.",
     "There's a staff-carrying old man asking the roads about someone, and the description keeps fitting you. Your Fiftieth Rank is close. Just saying."],
];

// ── Tavern gossip ────────────────────────────────────────────────────────────
// A second discovery surface (plan §6, deferred): overheard talk in the village
// tavern about the wider world — the Wandering Sage and his emissaries, legends
// being made, AND the connective tissue between the game's three pillars: the
// war against the Hollow (story), the beast coliseum (pets), and the Shinobi
// Chronicle (cards). Canon carried here: the Chronicle exists because the
// Hollow burns archives — so the villages press their legends into cards, and
// everything that proves itself (a Kage, a coliseum beast, a Legacy deed) gets
// printed. World-flavored, never this player's stats. Rotating daily strip.
export const TAVERN_GOSSIP: readonly string[] = [
    "The barkeep leans in: “Wandering Sage came through, three villages over. Didn't drink. Watched the door all night and paid for a bed he never slept in.”",
    "Guy at the next table swears the Hall of Legends carved a new name last week. Nobody caught which one, and the stonemason's boy suddenly won't talk about work.",
    "“Legends aren't born,” the old regular says into her cup. “They're noticed. Usually by an old man with a staff, usually before they've noticed themselves.”",
    "A courier drops off a rumor with the ale: somebody bound their legacy last night, two provinces over. Won't say who. He did buy a round on it, though.",
    "“My advice?” the barkeep says, not waiting to be asked. “Listen before you answer. You can send the Sage away, but he comes back. The names he offers may change with what you do before then.”",
    "Two mercenaries are arguing over which legacy path is the strongest. Neither has one. Half the tavern has joined in anyway.",
    "The storyteller says the Chronicle exists because the Hollow burns the archives first. “Cards scatter,” he shrugs. “Can't burn what's in everyone's pockets.”",
    "A dealer from the card hall says the scribes have started printing the Hollow Kage into the Chronicle. “Fought one,” a scarred regular mutters. “The card's friendlier.”",
    "An old soldier watched two kids trade a card of a tyrant he actually fought. He didn't say anything. He just sat down real slow and ordered a double.",
    "The kennel master's celebrating in the corner — his beast took three straight at the coliseum. “The scribes were there,” he keeps saying. “My boy's getting his card.”",
    "A tamer swears the beasts on the Chronicle cards are the same breeds running wild out in the sectors, scars and all. “Where'd you think the scribes find them?” says the dealer.",
    "“The trials travel with the emissaries,” someone whispers. “Eight of them, walking the sectors. Meet the right one and it's your name they came out for.”",
    "The barkeep polishes a glass: “Every legend that ever drank here left one ordinary night and came back different. One of them came back as a card.”",
    "Someone read a Hall notice out loud: another path sealed forever to one shinobi. The whole room raised a glass. The card dealer went and opened a fresh pack.",
    "“The good ones don't chase it,” the old regular says. “They just do the work, and one day the Sage is standing in the road pretending it's a coincidence.”",
    "A traveler says the roads are crowded this season — sages, emissaries, scribes with inked fingers. “Something's stirring,” he says, and orders another.",
    "“Careful who you bleed beside,” the barkeep warns a genin. “That's how legacies start. And the Chronicle scribes are always watching the good ones.”",
    "A drunk insists he almost earned a mythic legacy once. The barkeep has heard it twice tonight. The drunk's own hound looks embarrassed for him.",
];
export const TAVERN_GOSSIP_COUNT = TAVERN_GOSSIP.length;

/** A rotating tavern gossip line — stable for a (player, day) so it reads as
 *  "today's talk", different across players and across days. */
export function tavernGossipLine(playerName: string, dayBucket: number): string {
    const u = seededUnit(`gossip:${playerName}:${dayBucket}`);
    return TAVERN_GOSSIP[Math.min(TAVERN_GOSSIP.length - 1, Math.floor(u * TAVERN_GOSSIP.length))];
}

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
