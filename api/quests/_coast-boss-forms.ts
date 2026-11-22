/*
 * The forms the coast's quest bosses take (owner, 2026-11-21: "make the bosses
 * have cool mechanics and transformations like the tower bosses").
 *
 * Every boss that ends one of the twenty quests changes once as its health
 * falls; the one the Unmoored answer to changes twice. The rules are the shared
 * ones (shared/boss-transformations.ts, docs/boss-transformations.md): a short
 * cut-scene, then one mechanic the player has to answer. Plans are keyed by the
 * boss's cast id, so a harder variant of the same person (The Uncounted's
 * slower papers) fights the same way.
 *
 * BALANCE. These bosses were already hard by the owner's ruling, and the eight
 * reference builds of the story gate lose to every one of them as they stood
 * (scripts/coast-boss-balance-audit.ts). So a form here is a TRADE, never plain
 * extra power. Each is one of three shapes, and each hands the player an
 * opening in exchange for its threat:
 *
 *   - a STANCE takes less from most attacks, and takes more from two named
 *     kinds of attack (one element, one school, so every build has a way in);
 *   - a CHARGE can be broken by hitting hard or by a stun, and a broken charge
 *     leaves the boss staggered and taking more;
 *   - a BURN hits harder, and costs the boss its own health every turn.
 *
 * None of them heals or changes the boss's kit. The owner's ruling, repeated
 * on 2026-11-21 with the simulator's numbers in front of them, is "Leave them
 * hard", so a form must not make a boss easier either.
 *
 * HOW IT WAS TUNED. Most reference fights end before the boss is low enough
 * to change, so comparing whole fights says nothing about a form. The audit's
 * --from-form mode starts each fight one point above the boss's first form
 * and plays it with and without. The first numbers failed that: a 4% burn
 * turned one boss from no wins into eight of eight, and a 45% weakness made
 * others a third easier. On 2026-11-21 the coast moved from level 50 to level
 * 75, and at the new levels a charge made six bosses harder (the commander by
 * 15 points of health), because builds there take longer to do 5% of a boss's
 * health. The charge was retuned for that: it hits for 7% where it hit for
 * 10%, breaks at 4% where it broke at 5%, and the boss takes 20% more while
 * it gathers where it took 10%. With the numbers in COAST_FORM_TUNING every boss now
 * ends within about six points of the boss's health of where it ended without
 * its form, some a little harder and some a little easier. The simulator is
 * noisy at that scale (one boss moved thirteen points on a 5% change), so
 * scripts/coast-boss-balance.test.ts holds a band, not an exact figure.
 *
 * A form is not the Hold. The Hold decides whether the boss can fall and is
 * answered by the quest's tool; a form decides how the boss fights and is
 * answered by how the player fights.
 */
import type { BossFormAura, BossPhaseDef, BossTransformationPlan } from '../../shared/boss-transformations.js';
import type { QuestLineFight } from './_types.js';

type Words = { id: string; formName: string; aura: BossFormAura; speaker: string; lines: readonly string[]; summary: string; atHpPct?: number };

/**
 * The three shapes' numbers, in one place. The words below never state a number
 * themselves: they carry a token ({less}, {weak}, {burn} and so on) that the
 * builder fills from here, so what a player is told is always what the engine does.
 * Tuned against scripts/coast-boss-balance-audit.ts --from-form.
 */
export const COAST_FORM_TUNING = {
    /** Takes less and deals less, except from its two named weaknesses. */
    stance: { taken: 0.85, dealt: 1, weak: 1.3 },
    /** Gathers a strike every third round; a share of the boss's health, or a stun, breaks it and staggers the boss. */
    charge: { taken: 1.2, damagePct: 7, breakPct: 4, everyRounds: 3, stagger: 1.3 },
    /** Hits harder and takes more, and loses a share of its own health at the end of each of its turns. */
    burn: { dealt: 1.15, taken: 1, burnPct: 2 },
} as const;

const share = (multiplier: number) => `${Math.round(Math.abs(multiplier - 1) * 100)}%`;
/** Fill the number tokens in a form's words. An unknown token is left in place, where the test finds it. */
const filled = (text: string, numbers: Readonly<Record<string, string>>) => text.replace(/\{(\w+)\}/g, (token, key: string) => numbers[key] ?? token);

function stance(words: Words, name: string, weakness: readonly [string, string], tell: string): BossPhaseDef {
    const t = COAST_FORM_TUNING.stance, numbers = { less: share(t.taken), soft: share(t.dealt), weak: share(t.weak) };
    return {
        ...shape(words, numbers), ...(t.dealt !== 1 ? { damageMult: t.dealt } : {}), damageTakenMult: t.taken,
        mechanic: { kind: 'guard-stance', name, weakness, weaknessMult: t.weak, tell: filled(tell, numbers) },
    };
}

function charge(words: Words, name: string, tell: string): BossPhaseDef {
    const t = COAST_FORM_TUNING.charge, numbers = { more: share(t.taken), charge: `${t.damagePct}%`, break: `${t.breakPct}%` };
    return {
        ...shape(words, numbers), damageTakenMult: t.taken,
        mechanic: { kind: 'charged-strike', name, damagePct: t.damagePct, breakPct: t.breakPct, everyRounds: t.everyRounds, staggerDamageTakenMult: t.stagger, tell: filled(tell, numbers) },
    };
}

/**
 * `dealt` is set per boss. The same burn eases a fight a prepared player nearly
 * wins anyway and stiffens one they do not, so one number cannot be fair to
 * both: a boss whose health runs low in the simulator hits harder for its
 * burn, and one that stays high hits less hard.
 */
function burn(words: Words, name: string, tell: string, dealt: number = COAST_FORM_TUNING.burn.dealt): BossPhaseDef {
    const t = COAST_FORM_TUNING.burn, numbers = { hard: share(dealt), burn: `${t.burnPct}%` };
    return {
        ...shape(words, numbers), damageMult: dealt, ...(t.taken !== 1 ? { damageTakenMult: t.taken } : {}),
        mechanic: { kind: 'limit-burn', name, burnPct: t.burnPct, tell: filled(tell, numbers) },
    };
}

function shape(words: Words, numbers: Readonly<Record<string, string>>): BossPhaseDef {
    return {
        id: words.id, atHpPct: words.atHpPct ?? 55, formName: words.formName, aura: words.aura,
        cutscene: { speaker: words.speaker, lines: words.lines }, summary: filled(words.summary, numbers),
    };
}

const plan = (castId: string, ...phases: BossPhaseDef[]): [string, BossTransformationPlan] => [castId, { id: `coast-${castId}`, phases }];

/** By cast id. */
export const COAST_BOSS_FORMS: Readonly<Record<string, BossTransformationPlan>> = Object.fromEntries([
    // ── The crossing and the Crossing War ───────────────────────────────────
    plan('chart-runner', burn({
        id: 'last-lamp', formName: 'Last Lamp Run', aura: 'steam', speaker: 'Shiokaze',
        lines: [
            'You found me by my own knots. Then I will stop being careful.',
            'I ran these charts across open water with one lamp. I can outrun one shinobi on a pier.',
        ],
        summary: 'Shiokaze throws off the smoke and runs flat out. The strikes land {hard} harder, and the pace costs {burn} health every turn.',
    }, 'Burning Breath', 'Running this hard costs Shiokaze {burn} health at the end of every turn. Stay alive and the pace does part of your work.', 1.1)),

    plan('gate-captain', stance({
        id: 'closed-gate', formName: 'Closed Gate Stance', aura: 'obsidian', speaker: 'Iwao',
        lines: [
            'A paper with the right seal. I will have that looked into.',
            'Until I do, the gate is shut and I am the bar across it.',
        ],
        summary: 'Iwao plants both feet and fights like a barred gate. The captain takes {less} less damage, but Earth techniques and Taijutsu get under the guard.',
    }, 'Barred Gate', ['Earth', 'Taijutsu'], 'The stance turns most attacks aside. Earth techniques and Taijutsu hit it {weak} harder.')),

    plan('garrison-commander', charge({
        id: 'tide-call', formName: 'Tide Call', aura: 'tempest', speaker: 'Nigami',
        lines: [
            'That draught kept me standing through three winters on this stair.',
            'Take it from me and I still have the tide. Brace yourself.',
        ],
        summary: 'Without the draught Nigami fights in the open and takes {more} more damage, and begins gathering the tide for one heavy blow.',
    }, 'Breaking Tide', 'Every third round Nigami gathers a blow worth {charge} of your health. Deal {break} of the commander’s health before the next turn, or land a stun, and it breaks and leaves Nigami staggered.')),

    plan('glasswake-adept', stance({
        id: 'unbroken-mirror', formName: 'Unbroken Mirror', aura: 'moon', speaker: 'Minawa',
        lines: [
            'You clouded the pool. I learned this art before I ever had a pool.',
            'Look closely this time. It is still your own jutsu coming back.',
        ],
        summary: 'Minawa stops reading the pool and becomes the mirror. The adept takes {less} less damage, but Wind techniques and Bukijutsu pass straight through the reflection.',
    }, 'Standing Reflection', ['Wind', 'Bukijutsu'], 'A reflection cannot turn what it cannot catch. Wind techniques and Bukijutsu hit it {weak} harder.')),

    plan('leash-tamer', charge({
        id: 'pack-call', formName: 'Pack Call', aura: 'tempest', speaker: 'Tazuna',
        lines: [
            'You cut one bond. I tied every knot in this garrison myself.',
            'Listen. That is the rest of them coming up the hill.',
        ],
        summary: 'With the bond cut Tazuna has no beast to hide behind and takes {more} more damage, and starts whistling the pack in for a charge.',
    }, 'Run of the Pack', 'Every third round Tazuna calls the pack for a charge worth {charge} of your health. Deal {break} of the tamer’s health first, or land a stun, and the call breaks and leaves Tazuna staggered.')),

    plan('rime-warden', stance({
        id: 'rime-plate', formName: 'Rime Plate', aura: 'steam', speaker: 'Kogarashi',
        lines: [
            'You split the lock. The cold is still mine to wear.',
            'This pass has stood shut for forty winters. One more will not trouble it.',
        ],
        summary: 'Frost closes over Kogarashi like armour. The warden takes {less} less damage, but Fire techniques and Taijutsu crack the plates.',
    }, 'Frost Plates', ['Fire', 'Taijutsu'], 'The plates turn most attacks aside. Fire techniques and Taijutsu hit them {weak} harder.')),

    plan('twin-warden', burn({
        id: 'second-watch', formName: 'The Second Watch', aura: 'eclipse', speaker: 'Futae',
        lines: [
            'Two watches were set on this door so that one could always rest.',
            'You have ended the rest. Now you fight both of us at once.',
        ],
        summary: 'Futae stops holding anything back for the second watch. The strikes land {hard} harder, and fighting for two costs {burn} health every turn.',
    }, 'Double Watch', 'Keeping both watches costs Futae {burn} health at the end of every turn. The longer you last, the less there is left to break.')),

    plan('unmoored-leader',
        stance({
            id: 'uncounted-stand', atHpPct: 66, formName: 'The Uncounted Stand', aura: 'obsidian', speaker: 'Nanashi',
            lines: [
                'Every village that struck us off its roll expected us to scatter.',
                'We stood here together. Come and see what that looks like.',
            ],
            summary: 'Nanashi stops giving ground. She takes {less} less damage, but Lightning techniques and Genjutsu find the gaps in the line.',
        }, 'Held Line', ['Lightning', 'Genjutsu'], 'She gives nothing to most attacks. Lightning techniques and Genjutsu hit her {weak} harder.'),
        charge({
            id: 'closing-the-coast', atHpPct: 33, formName: 'Closing the Coast', aura: 'eclipse', speaker: 'Nanashi',
            lines: [
                'I shut this shore once with nothing but my own two hands.',
                'I can shut it again with you standing on it.',
            ],
            summary: 'Nanashi drops her guard to end it. She takes {more} more damage and begins gathering everything she has left for one blow.',
        }, 'The Shore Shuts', 'Every third round she gathers a blow worth {charge} of your health. Deal {break} of her health before her next turn, or land a stun, and it breaks and leaves her staggered.'),
    ),

    // ── The Boatwright's Tools ──────────────────────────────────────────────
    plan('slip-wrecker', charge({
        id: 'hull-breaker', formName: 'Hull Breaker', aura: 'tempest', speaker: 'Sabiro',
        lines: [
            'I have put forty hulls on this shoal and not one of them saw it coming.',
            'You are narrower than a hull. Stand still for me.',
        ],
        summary: 'Sabiro gives up on finesse and takes {more} more damage, and winds up the swing that opens hulls.',
    }, 'Shoal Swing', 'Every third round Sabiro winds up a swing worth {charge} of your health. Deal {break} of the wrecker’s health first, or land a stun, and it breaks and leaves Sabiro staggered.')),

    plan('pitch-warden', burn({
        id: 'pitch-fire', formName: 'Pitch Fire', aura: 'flame', speaker: 'Yaniko',
        lines: [
            'I burn the drift so that nobody on this strand can build a boat from it.',
            'I have never minded standing close to my own fire.',
        ],
        summary: 'Yaniko lights the pitch on her own sleeves. Her strikes land {hard} harder, and the fire costs her {burn} health every turn.',
    }, 'Burning Sleeves', 'The pitch burns her as well. It costs Yaniko {burn} health at the end of every turn.', 1.25)),

    plan('keel-reaver', stance({
        id: 'timber-wall', formName: 'Standing Timber', aura: 'obsidian', speaker: 'Hazeru',
        lines: [
            'A keel wants a tree that grew slow and straight for sixty years.',
            'I know exactly how hard that wood is to cut. I am made the same way.',
        ],
        summary: 'Hazeru sets himself like an old trunk. He takes {less} less damage, but Fire techniques and Bukijutsu bite into the grain.',
    }, 'Old Growth', ['Fire', 'Bukijutsu'], 'He turns most attacks like seasoned timber. Fire techniques and Bukijutsu hit him {weak} harder.')),

    // ── The Uncounted ───────────────────────────────────────────────────────
    plan('quay-warden', charge({
        id: 'mooring-haul', formName: 'Mooring Haul', aura: 'tempest', speaker: 'Moyai',
        lines: [
            'Nothing leaves this quay unless I let go of the line.',
            'I am not letting go. I am pulling it in.',
        ],
        summary: 'Moyai turns from guarding the quay to hauling you off it. The warden takes {more} more damage and starts taking up the slack for one great pull.',
    }, 'Taking Up Slack', 'Every third round Moyai hauls for {charge} of your health. Deal {break} of the warden’s health first, or land a stun, and the line goes slack and leaves Moyai staggered.')),

    plan('roll-keeper', stance({
        id: 'sealed-roll', formName: 'The Sealed Roll', aura: 'moon', speaker: 'Kazoe',
        lines: [
            'Every name in this room is safe because nobody outside can read it.',
            'You will not be the first to try. Shut the roll.',
        ],
        summary: 'Kazoe seals the record and fights from behind it. The keeper takes {less} less damage, but Lightning techniques and Ninjutsu burn through the seals.',
    }, 'Wax and Cord', ['Lightning', 'Ninjutsu'], 'The seals turn most attacks aside. Lightning techniques and Ninjutsu hit them {weak} harder.')),

    plan('pass-captain', charge({
        id: 'toll-bell', formName: 'Toll Bell', aura: 'storm', speaker: 'Sekimori',
        lines: [
            'Everyone who crosses this traverse pays. That is the whole of the law up here.',
            'You came through on false paper, so I will take it out of you.',
        ],
        summary: 'Sekimori stops checking papers and takes {more} more damage, and raises the hammer that rings the toll bell.',
    }, 'Ringing the Toll', 'Every third round Sekimori swings for {charge} of your health. Deal {break} of the captain’s health first, or land a stun, and the swing breaks and leaves Sekimori staggered.')),

    // ── Raise the Clan Gate ─────────────────────────────────────────────────
    plan('plot-reeve', stance({
        id: 'staked-ground', formName: 'Staked Ground', aura: 'obsidian', speaker: 'Kuiuchi',
        lines: [
            'I drove the first stake on this ground before your clan had a name.',
            'Move me off it, if you think the ground is yours.',
        ],
        summary: 'Kuiuchi digs in on the founding ground. The reeve takes {less} less damage, but Wind techniques and Taijutsu pull the stakes.',
    }, 'Driven Stakes', ['Wind', 'Taijutsu'], 'Dug in, the reeve turns most attacks aside. Wind techniques and Taijutsu hit {weak} harder.')),

    plan('hall-burner', burn({
        id: 'torch-oath', formName: 'Torch Oath', aura: 'flame', speaker: 'Tsuketa',
        lines: [
            'I swore to burn whatever the clans raised on this coast.',
            'I did not swear to walk away from the fire afterwards.',
        ],
        summary: 'Tsuketa stops shielding the torch and fights inside the flames. The strikes land {hard} harder, and the fire costs {burn} health every turn.',
    }, 'Inside the Fire', 'Fighting inside the fire costs Tsuketa {burn} health at the end of every turn.', 1.25)),

    plan('raid-captain', charge({
        id: 'raid-horn', formName: 'Raid Horn', aura: 'tempest', speaker: 'Semeguchi',
        lines: [
            'One horn brings every blade I have down onto this gate.',
            'You have until I finish drawing breath.',
        ],
        summary: 'Semeguchi leaves off fighting to sound the raid. The captain takes {more} more damage and starts drawing breath for the horn.',
    }, 'Sounding the Raid', 'Every third round Semeguchi sounds the horn for {charge} of your health. Deal {break} of the captain’s health first, or land a stun, and the breath is lost and Semeguchi is left staggered.')),

    // ── Untamed Coast. The beasts do not speak, so their scenes are described. ─
    plan('brinejaw', burn({
        id: 'brine-frenzy', formName: 'Brine Frenzy', aura: 'steam', speaker: 'Narrator',
        lines: [
            'The hound shakes the smoke out of its coat and the salt on its jaws begins to steam.',
            'It has stopped hunting you. Now it only wants you gone from its ground.',
        ],
        summary: 'Brinejaw stops circling and comes straight in. Its bites land {hard} harder, and the frenzy costs it {burn} health every turn.',
    }, 'Salt Froth', 'The frenzy wears the hound down. It costs Brinejaw {burn} health at the end of every turn.', 1.4)),

    plan('thornmother', charge({
        id: 'pack-howl', formName: 'Pack Howl', aura: 'tempest', speaker: 'Narrator',
        lines: [
            'The Thornmother lifts her head and the whole briar goes quiet around her.',
            'Somewhere behind you, the rest of the pack answers.',
        ],
        summary: 'The Thornmother stands in the open to call her pack and takes {more} more damage, and the briar begins to move.',
    }, 'The Briar Answers', 'Every third round she howls the pack in for {charge} of your health. Deal {break} of her health first, or land a stun, and the howl breaks and leaves her staggered.')),

    plan('whitemane', stance({
        id: 'rime-coat', formName: 'Rime Coat', aura: 'moon', speaker: 'Narrator',
        lines: [
            'Frost runs along the fox’s back until every hair stands white and hard as glass.',
            'It turns side-on to you and waits, the way the pass itself waits.',
        ],
        summary: 'Whitemane’s coat freezes into plates. It takes {less} less damage, but Fire techniques and Bukijutsu shatter the frost.',
    }, 'Glass Fur', ['Fire', 'Bukijutsu'], 'The frozen coat turns most attacks aside. Fire techniques and Bukijutsu hit it {weak} harder.')),
]);

/** Give each fight the forms of the boss it is against. A fight with no Hold is a lesser one and keeps none. */
export function withCoastBossForms(fights: Readonly<Record<string, QuestLineFight>>): Record<string, QuestLineFight> {
    return Object.fromEntries(Object.entries(fights).map(([id, fight]) => {
        const forms = fight.hold && Object.hasOwn(COAST_BOSS_FORMS, fight.castId) ? COAST_BOSS_FORMS[fight.castId] : undefined;
        return [id, forms ? { ...fight, forms } : fight];
    }));
}
