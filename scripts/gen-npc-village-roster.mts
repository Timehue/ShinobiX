/*
 * Generator for shared/npc-village-roster.ts — the persistent roster of the 30
 * NPC shinobi who run Cinderhold Village.
 *
 *   node --import tsx scripts/gen-npc-village-roster.mts
 *
 * Deterministic: every choice comes from a seeded PRNG keyed by the NPC's
 * slug, so a re-run with unchanged catalogs writes a byte-identical file. It
 * reads the REAL server catalogs (jutsu, items, pets, Chronicle cards) and the
 * real server validators, and refuses to write a roster any of them rejects:
 *   - each bloodline is the server's own normalized projection
 *     (normalizePlayerBloodlineJutsus) and spends exactly its rank budget;
 *   - jutsu, gear and elements are banded by level so they are legal at 1-100;
 *   - 120 distinct pet species, all wild-obtainable with an approved 3D model;
 *   - 30 distinct legal 40-card Chronicle decks with a summonable curve;
 *   - names, slugs and pet nicknames pass the server name filters.
 *
 * The output module embeds the resolved data, so shared/ never imports api/.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePlayerBloodlineJutsus } from '../api/bloodlines/_jutsu-schema.js';
import { bloodlinePoints, jutsuPoints, pointBudgetForRank } from '../api/_jutsu-points.js';
import { CAPPED_AMP_TAGS, FIXED_EFFECT_POWER_TAGS, OPPONENT_AFFECTING_TAGS } from '../api/pvp/_tags.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { safeName } from '../api/_utils.js';
import { hasStaffImpersonationName, isCleanPlayerName, isCleanText } from '../api/_text-moderation.js';
import {
    CHRONICLE_CARD_CATALOG,
    CHRONICLE_STARTER_GRANT_IDS,
    MAIN_DECK_SIZE,
    countChronicleCards,
    deckLimitForCard,
    tributeCountForLevel,
    validateDeckIds,
} from '../shared/chronicle-duel.js';
import { APPROVED_ROSTER_MODEL_IDS } from '../shinobij.client/src/lib/pet-3d-roster.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shared/npc-village-roster.ts');

// ─── Seeded randomness ───────────────────────────────────────────────────────

function hashString(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

type Rng = { next(): number; int(n: number): number; pick<T>(list: readonly T[]): T; shuffle<T>(list: readonly T[]): T[] };

function makeRng(seedText: string): Rng {
    let a = hashString(`cinderhold-roster-v1:${seedText}`);
    const next = () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number) => Math.floor(next() * n);
    return {
        next,
        int,
        pick: <T,>(list: readonly T[]) => {
            if (list.length === 0) throw new Error('rng.pick on empty list');
            return list[int(list.length)]!;
        },
        shuffle: <T,>(list: readonly T[]) => {
            const out = [...list];
            for (let i = out.length - 1; i > 0; i--) {
                const j = int(i + 1);
                [out[i], out[j]] = [out[j]!, out[i]!];
            }
            return out;
        },
    };
}

// ─── The authored roster table ───────────────────────────────────────────────

type Rank = 'kage' | 'commander' | 'elite' | 'jonin' | 'chunin' | 'genin';
type Personality = 'aggressive' | 'guardian' | 'medic' | 'trickster';
type School = 'Ninjutsu' | 'Taijutsu' | 'Genjutsu' | 'Bukijutsu';
type BaseElement = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Lightning';

type Authored = {
    name: string;
    rank: Rank;
    personality: Personality;
    specialty: School;
    elements: [BaseElement, BaseElement];
    bloodline: string;
    special: string;
    /**
     * True for an A-rank line that stacks its 10 points into 4 jutsu instead of
     * spreading them over 5. Owner, 2026-11-11: every commander and elite
     * stacks, no jonin does.
     */
    stacked?: boolean;
    deckName: string;
    lore: string;
};

const AUTHORED: readonly Authored[] = [
    // Kage
    // Owner, 2026-11-08: Cinderhold's Kage and elder seats start EMPTY and are
    // filled by the four villages' story Kages as players defeat them
    // (api/_npc-village-leaders.ts). No roster NPC is the Kage; Kuroto leads the
    // commanders.
    // Owner, 2026-11-11: the thirty names and portraits below are the owner's.
    { name: 'Kuroto', rank: 'commander', personality: 'aggressive', specialty: 'Ninjutsu', elements: ['Fire', 'Wind'], bloodline: 'Crown of Cinders', special: 'Cinderflame', stacked: true, deckName: 'Throne of Embers', lore: 'The Crown of Cinders passes only to the shinobi who can stand inside the caldera at the height of an eruption. Its bearer commands a fire that never fully goes out.' },
    // Commanders
    { name: 'Renji', rank: 'commander', personality: 'guardian', specialty: 'Taijutsu', elements: ['Earth', 'Fire'], bloodline: 'Basalt Bulwark', special: 'Basalt', stacked: true, deckName: 'Caldera Wall', lore: 'Basalt Bulwark shinobi grow a second skin of cooled lava when they are struck. The outer gate of Cinderhold was built in their image.' },
    { name: 'Virath', rank: 'commander', personality: 'trickster', specialty: 'Genjutsu', elements: ['Fire', 'Lightning'], bloodline: 'Smokeglass Mirage', special: 'Smokeglass', stacked: true, deckName: 'Hall of Smoke', lore: 'The Smokeglass Mirage bends light through drifting soot until an enemy cannot trust their own eyes. Cinderhold sends its users first and lets the battlefield doubt itself.' },
    // Elites
    { name: 'Kat', rank: 'elite', personality: 'aggressive', specialty: 'Taijutsu', elements: ['Fire', 'Earth'], bloodline: 'Magma Fang', special: 'Magma', stacked: true, deckName: 'Molten Maw', lore: 'A Magma Fang strike leaves rock glowing for an hour after the fight is over. The line was born in the deep vents beneath the village.' },
    { name: 'Raku', rank: 'elite', personality: 'medic', specialty: 'Ninjutsu', elements: ['Water', 'Fire'], bloodline: 'Scalding Mist', special: 'Steam', stacked: true, deckName: 'Hot Springs Rite', lore: 'Scalding Mist healers learned their craft in the hot springs that ring the volcano. The same steam that mends an ally can boil an enemy where they stand.' },
    { name: 'Nozomi', rank: 'elite', personality: 'trickster', specialty: 'Genjutsu', elements: ['Wind', 'Fire'], bloodline: 'Ashwind Illusion', special: 'Ashwind', stacked: true, deckName: 'Drifting Ash', lore: 'An Ashwind Illusion rides the grey dust that falls on Cinderhold every evening. Those who breathe it see whatever the caster wishes them to see.' },
    { name: 'Nyra', rank: 'elite', personality: 'guardian', specialty: 'Bukijutsu', elements: ['Earth', 'Lightning'], bloodline: 'Obsidian Mantle', special: 'Obsidian', stacked: true, deckName: 'Black Glass Bastion', lore: 'The Obsidian Mantle hardens chakra into volcanic glass that is sharp on one side and unbreakable on the other. Its keepers guard the caldera stairs.' },
    { name: 'Roy', rank: 'elite', personality: 'aggressive', specialty: 'Taijutsu', elements: ['Fire', 'Lightning'], bloodline: 'Ember Howl', special: 'Emberblood', stacked: true, deckName: 'Pack of the Pyre', lore: 'Ember Howl shinobi fight like a wildfire chasing the wind. Their blood runs hot enough to light dry grass when it is spilled.' },
    // Jonin
    { name: 'Mizuki', rank: 'jonin', personality: 'aggressive', specialty: 'Bukijutsu', elements: ['Wind', 'Fire'], bloodline: 'Searing Gale', special: 'Searwind', deckName: 'Firestorm Front', lore: 'The Searing Gale turns a thrown blade into a streak of burning wind. Its users were once the border hunters of the village.' },
    { name: 'Sly', rank: 'jonin', personality: 'guardian', specialty: 'Taijutsu', elements: ['Earth', 'Water'], bloodline: 'Pumice Shell', special: 'Pumice', deckName: 'Stoneskin Vigil', lore: 'Pumice Shell chakra is light and porous, and it swallows the force of a blow before it reaches the bone. The line has never lost a gate it was ordered to hold.' },
    { name: 'Seiran', rank: 'jonin', personality: 'medic', specialty: 'Genjutsu', elements: ['Water', 'Wind'], bloodline: 'Censer Smoke', special: 'Incense', deckName: 'Temple Censer', lore: 'Censer Smoke began as a temple rite for calming the dying. In battle the same incense soothes allies and drags enemies into a heavy sleep.' },
    { name: 'Akari', rank: 'jonin', personality: 'trickster', specialty: 'Ninjutsu', elements: ['Lightning', 'Earth'], bloodline: 'Struck Glass', special: 'Fulgurite', deckName: 'Glassfall Storm', lore: 'Where lightning meets the volcanic sand it leaves tubes of glass behind. The Struck Glass line reads those tubes like scripture and strikes in the same crooked paths.' },
    { name: 'Kaien', rank: 'jonin', personality: 'aggressive', specialty: 'Ninjutsu', elements: ['Fire', 'Water'], bloodline: 'Pyroclast Surge', special: 'Pyroclast', deckName: 'Eruption Line', lore: 'A Pyroclast Surge is the moment a mountain decides to fall on its enemies. Its users carry that moment folded inside their chakra.' },
    { name: 'Kairo', rank: 'jonin', personality: 'guardian', specialty: 'Bukijutsu', elements: ['Water', 'Earth'], bloodline: 'Ashen Tide', special: 'Ashwater', deckName: 'Grey Tide Guard', lore: 'The Ashen Tide rolls grey water thick with cinders across the field. It stops arrows, blades and jutsu with the same patient weight.' },
    { name: 'Suiren', rank: 'jonin', personality: 'trickster', specialty: 'Taijutsu', elements: ['Lightning', 'Fire'], bloodline: 'Arc Ember', special: 'Arcflame', deckName: 'Live Wire', lore: 'Arc Ember fighters jump between sparks faster than the eye can follow. They are rarely where the enemy last saw them.' },
    // Chunin
    { name: 'Tavi', rank: 'chunin', personality: 'aggressive', specialty: 'Ninjutsu', elements: ['Fire', 'Earth'], bloodline: 'Kindled Vein', special: 'Kindling', deckName: 'Spark and Tinder', lore: 'The Kindled Vein catches slowly and then all at once. Young Cinderhold shinobi with this blood are told to count to three before they let it burn.' },
    { name: 'Sayo', rank: 'chunin', personality: 'medic', specialty: 'Ninjutsu', elements: ['Water', 'Fire'], bloodline: 'Hearthwater', special: 'Hearth', deckName: 'Warm Hearth', lore: 'Hearthwater carries the warmth of a home fire in a cupped palm. Its healers keep the wounded of the village alive through the cold nights on the mountain.' },
    { name: 'Hayate', rank: 'chunin', personality: 'guardian', specialty: 'Taijutsu', elements: ['Earth', 'Fire'], bloodline: 'Slagplate', special: 'Slag', deckName: 'Forge Wall', lore: 'Slagplate shinobi wear the waste of the village forges as armor. What the smiths throw away, they turn into a wall.' },
    { name: 'Kohaku', rank: 'chunin', personality: 'trickster', specialty: 'Genjutsu', elements: ['Wind', 'Water'], bloodline: 'Haze Dancer', special: 'Haze', deckName: 'Heat Shimmer', lore: 'A Haze Dancer moves inside the shimmer that rises from hot stone. Enemies strike at where she seems to be and find only warm air.' },
    { name: 'Alisia', rank: 'chunin', personality: 'aggressive', specialty: 'Bukijutsu', elements: ['Fire', 'Wind'], bloodline: 'Lantern Blade', special: 'Lanternfire', deckName: 'Lantern Parade', lore: 'Lantern Blade wielders light their weapons from the festival lanterns of Cinderhold. The flame stays on the steel until the fight is won.' },
    { name: 'Ayame', rank: 'chunin', personality: 'medic', specialty: 'Taijutsu', elements: ['Earth', 'Water'], bloodline: 'Hot Stone', special: 'Geotherm', deckName: 'Stone Bath', lore: 'Hot Stone medics press heated rock to a wound and draw the poison out with it. The technique is older than the village itself.' },
    { name: 'Shion', rank: 'chunin', personality: 'trickster', specialty: 'Genjutsu', elements: ['Lightning', 'Wind'], bloodline: 'Soot Spark', special: 'Sootlight', deckName: 'Night Sparks', lore: 'Soot Spark chakra glows only in darkness. Its users fight at night, when every spark looks like a star.' },
    // Genin
    { name: 'Veyl', rank: 'genin', personality: 'aggressive', specialty: 'Taijutsu', elements: ['Fire', 'Lightning'], bloodline: 'Spark Knuckle', special: 'Sparkfire', deckName: 'First Flame', lore: 'Spark Knuckle is the first bloodline many Cinderhold children awaken. It throws sparks with every punch and teaches them to keep their hands moving.' },
    { name: 'Riven', rank: 'genin', personality: 'guardian', specialty: 'Bukijutsu', elements: ['Earth', 'Fire'], bloodline: 'Brick Kiln', special: 'Kiln', deckName: 'Kiln Keeper', lore: 'Brick Kiln chakra bakes the ground into a low wall around its user. It is slow and plain, and it holds.' },
    { name: 'Vesper', rank: 'genin', personality: 'medic', specialty: 'Ninjutsu', elements: ['Water', 'Earth'], bloodline: 'Mineral Spring', special: 'Mineral', deckName: 'Spring Water', lore: 'Mineral Spring water rises bitter and warm from the mountain. Those who carry its blood can make an ally drink strength back into their body.' },
    { name: 'Reika', rank: 'genin', personality: 'trickster', specialty: 'Genjutsu', elements: ['Wind', 'Fire'], bloodline: 'Sootwing', special: 'Soot', deckName: 'Smudged Ink', lore: 'Sootwing illusions flutter like black moths at the edge of sight. Young users practice by hiding in the chimney smoke above the market.' },
    { name: 'Jiro', rank: 'genin', personality: 'aggressive', specialty: 'Bukijutsu', elements: ['Earth', 'Fire'], bloodline: 'Flintspark', special: 'Flint', deckName: 'Strike Anywhere', lore: 'Flintspark shinobi strike stone against stone to start a fight. Every clash of their blades throws a spray of sparks.' },
    { name: 'Daigo', rank: 'genin', personality: 'guardian', specialty: 'Taijutsu', elements: ['Lightning', 'Earth'], bloodline: 'Charcoal Guard', special: 'Charcoal', deckName: 'Banked Coals', lore: 'Charcoal Guard chakra smolders under the skin like a banked fire. It burns low and lasts through the longest siege.' },
    { name: 'Isamu', rank: 'genin', personality: 'medic', specialty: 'Ninjutsu', elements: ['Wind', 'Water'], bloodline: 'Ember Breath', special: 'Warmwind', deckName: 'Gentle Updraft', lore: 'Ember Breath carries warm air into tired lungs and stiff limbs. Its users are the first sent to a fallen comrade.' },
    { name: 'Lumen', rank: 'genin', personality: 'trickster', specialty: 'Genjutsu', elements: ['Water', 'Lightning'], bloodline: 'Marsh Lantern', special: 'Marshlight', deckName: 'Marsh Glow', lore: 'Marsh Lantern lights float over the wet ground at the foot of the volcano. Travelers who follow them rarely find the road again.' },
];

const RANK_ORDER: readonly Rank[] = ['kage', 'commander', 'elite', 'jonin', 'chunin', 'genin'];
const A_RANKS = new Set<Rank>(['kage', 'commander', 'elite', 'jonin']);

// ─── Bloodline recipes ───────────────────────────────────────────────────────

const IDG = 'Increase Damage Given';
const DDG = 'Decrease Damage Given';
const IDT = 'Increase Damage Taken';
const DDT = 'Decrease Damage Taken';

type TagSlot = { names: string[]; optional?: boolean };
type JutsuSpec = { role: string; ap: 40 | 60; method?: 'SINGLE' | 'AOE_BURST'; nuke?: boolean; tags: TagSlot[] };
type RecipeKind = 'A5' | 'A4' | 'B4';

const RECIPES: Record<Personality, Record<RecipeKind, JutsuSpec[]>> = {
    aggressive: {
        A5: [
            { role: 'nuke', ap: 60, nuke: true, tags: [{ names: [IDG, IDT] }] },
            { role: 'pierce', ap: 60, tags: [{ names: ['Pierce'] }] },
            { role: 'rend', ap: 60, tags: [{ names: ['Ignition', 'Wound'] }, { names: ['Wound', 'Lifesteal', 'Siphon'], optional: true }] },
            { role: 'burst', ap: 60, method: 'AOE_BURST', tags: [{ names: [IDT, 'Recoil', 'Lifesteal'] }] },
            { role: 'trance', ap: 40, tags: [{ names: [IDG] }, { names: ['Overclock'] }] },
        ],
        A4: [
            { role: 'nuke', ap: 60, nuke: true, tags: [{ names: [IDG] }, { names: ['Wound', 'Lifesteal'] }] },
            { role: 'pierce', ap: 60, tags: [{ names: ['Pierce'] }, { names: [IDT, 'Lifesteal'], optional: true }] },
            { role: 'burst', ap: 60, method: 'AOE_BURST', tags: [{ names: ['Ignition', 'Siphon'] }, { names: ['Wound'], optional: true }] },
            { role: 'trance', ap: 40, tags: [{ names: [IDG] }, { names: ['Overclock'] }, { names: [DDT, 'Lifesteal'], optional: true }] },
        ],
        B4: [
            { role: 'nuke', ap: 60, nuke: true, tags: [{ names: [IDG, IDT] }] },
            { role: 'rend', ap: 60, tags: [{ names: ['Wound', 'Ignition'] }, { names: ['Lifesteal', 'Siphon'], optional: true }] },
            { role: 'strike', ap: 60, tags: [{ names: ['Recoil', IDT, 'Siphon'] }] },
            { role: 'trance', ap: 40, tags: [{ names: [IDG] }, { names: [DDT, 'Lifesteal'] }] },
        ],
    },
    guardian: {
        A5: [
            { role: 'bulwark', ap: 60, tags: [{ names: ['Shield'] }, { names: [DDT, 'Absorb'], optional: true }] },
            { role: 'bind', ap: 60, tags: [{ names: ['Stun', 'Bloodline Seal'] }] },
            { role: 'riposte', ap: 60, tags: [{ names: ['Reflect', 'Recoil'] }, { names: ['Wound'], optional: true }] },
            { role: 'sap', ap: 60, tags: [{ names: [DDG, 'Drain'] }] },
            { role: 'stance', ap: 40, tags: [{ names: [DDT] }, { names: ['Debuff Prevent', 'Absorb'] }, { names: ['Increase Heal'], optional: true }] },
        ],
        A4: [
            { role: 'bind', ap: 60, tags: [{ names: ['Stun'] }, { names: [DDG, 'Recoil'] }] },
            { role: 'bulwark', ap: 60, nuke: true, tags: [{ names: ['Shield'] }, { names: [DDT, 'Absorb'] }] },
            { role: 'riposte', ap: 60, tags: [{ names: ['Reflect'] }, { names: ['Wound'] }] },
            { role: 'stance', ap: 40, tags: [{ names: [DDT] }, { names: ['Debuff Prevent'] }, { names: ['Absorb', 'Increase Heal'], optional: true }] },
        ],
        B4: [
            { role: 'bulwark', ap: 60, tags: [{ names: ['Shield'] }, { names: [DDT], optional: true }] },
            { role: 'bind', ap: 60, tags: [{ names: ['Stun', 'Lag'] }] },
            { role: 'riposte', ap: 60, tags: [{ names: ['Recoil', 'Reflect'] }, { names: ['Wound'], optional: true }] },
            { role: 'stance', ap: 40, tags: [{ names: [DDT] }, { names: ['Absorb', 'Increase Heal'], optional: true }] },
        ],
    },
    medic: {
        A5: [
            { role: 'mend', ap: 40, tags: [{ names: ['Heal'] }, { names: [DDT, 'Increase Heal'] }] },
            { role: 'leech', ap: 60, tags: [{ names: ['Drain'] }, { names: [DDG], optional: true }] },
            { role: 'vamp', ap: 60, tags: [{ names: ['Lifesteal'] }, { names: ['Siphon', 'Wound'], optional: true }] },
            { role: 'toxin', ap: 60, tags: [{ names: ['Poison'] }, { names: [IDT, DDG], optional: true }] },
            { role: 'seal', ap: 60, tags: [{ names: ['Cleanse Prevent', 'Elemental Seal'] }] },
        ],
        A4: [
            { role: 'mend', ap: 40, tags: [{ names: ['Heal'] }, { names: ['Increase Heal'] }, { names: [DDT], optional: true }] },
            { role: 'leech', ap: 60, tags: [{ names: ['Drain'] }, { names: [DDG] }] },
            { role: 'vamp', ap: 60, nuke: true, tags: [{ names: ['Lifesteal'] }, { names: ['Siphon', 'Wound'] }] },
            { role: 'seal', ap: 60, tags: [{ names: ['Elemental Seal', 'Cleanse Prevent'] }, { names: ['Poison'] }] },
        ],
        B4: [
            { role: 'mend', ap: 40, tags: [{ names: ['Heal'] }, { names: [DDT, 'Increase Heal'], optional: true }] },
            { role: 'leech', ap: 60, tags: [{ names: ['Drain'] }, { names: [DDG], optional: true }] },
            { role: 'vamp', ap: 60, tags: [{ names: ['Lifesteal'] }, { names: ['Wound'], optional: true }] },
            { role: 'toxin', ap: 60, tags: [{ names: ['Poison'] }, { names: [IDT], optional: true }] },
        ],
    },
    trickster: {
        A5: [
            { role: 'lock', ap: 60, tags: [{ names: ['Stun', 'Lag'] }] },
            { role: 'sever', ap: 60, tags: [{ names: ['Bloodline Seal'] }, { names: [DDG], optional: true }] },
            { role: 'shove', ap: 60, tags: [{ names: ['Pull', 'Push'] }, { names: [IDT], optional: true }] },
            { role: 'venom', ap: 60, tags: [{ names: ['Poison'] }, { names: [DDG, IDT] }] },
            { role: 'fog', ap: 40, tags: [{ names: ['Buff Prevent'] }, { names: [DDG] }] },
        ],
        A4: [
            { role: 'lock', ap: 60, tags: [{ names: ['Stun'] }, { names: [IDT] }] },
            { role: 'sever', ap: 60, tags: [{ names: ['Bloodline Seal'] }, { names: ['Poison'] }] },
            { role: 'burst', ap: 60, method: 'AOE_BURST', tags: [{ names: [DDG, 'Recoil'] }, { names: ['Ignition'] }] },
            { role: 'fog', ap: 40, tags: [{ names: ['Buff Prevent'] }, { names: [DDG] }, { names: [IDT], optional: true }] },
        ],
        B4: [
            { role: 'lock', ap: 60, tags: [{ names: ['Lag', 'Stun'] }] },
            { role: 'shove', ap: 60, tags: [{ names: ['Pull', 'Push'] }, { names: ['Poison'], optional: true }] },
            { role: 'hex', ap: 60, tags: [{ names: [DDG] }, { names: [IDT], optional: true }] },
            { role: 'fog', ap: 40, tags: [{ names: [DDG] }, { names: [IDT], optional: true }] },
        ],
    },
};

const ROLE_SUFFIXES: Record<string, [string, string]> = {
    nuke: ['Cataclysm', 'Ruin'], pierce: ['Lance', 'Needle'], rend: ['Rend', 'Brand'],
    burst: ['Burst', 'Bloom'], trance: ['Frenzy', 'Trance'], strike: ['Strike', 'Crash'],
    bulwark: ['Bulwark', 'Aegis'], bind: ['Shackle', 'Bind'], riposte: ['Riposte', 'Counter'],
    sap: ['Pall', 'Sapping Haze'], stance: ['Stance', 'Skin'], mend: ['Mending', 'Rekindling'],
    leech: ['Leech', 'Draw'], vamp: ['Thirst', 'Feast'], toxin: ['Fumes', 'Blight'],
    seal: ['Seal', 'Smother'], lock: ['Lock', 'Stillness'], sever: ['Severance', 'Cut'],
    shove: ['Gust', 'Heave'], venom: ['Venom', 'Miasma'], fog: ['Fog', 'Veil'], hex: ['Hex', 'Curse'],
};

const ROLE_TEXT: Record<string, string> = {
    nuke: '{m} chakra erupts over %target in one ruinous blast.',
    pierce: 'A {m} lance drives straight through the guard of %target.',
    rend: '{m} claws tear into %target and leave the wound burning.',
    burst: 'A {m} burst detonates around %target.',
    trance: '%user breathes in {m} heat and moves faster than thought.',
    strike: 'A {m} strike crashes into %target.',
    bulwark: 'A {m} shell closes around %user before the blow lands.',
    bind: '{m} chains lock %target where they stand.',
    riposte: '%user turns the force of %target back on them with a {m} counter.',
    sap: '{m} smoke saps the strength from the strikes of %target.',
    stance: '%user plants their feet as {m} hardens over their skin.',
    mend: '{m} warmth closes the wounds of %user.',
    leech: '{m} threads pull life out of %target.',
    vamp: 'A {m} strike feeds %user on the strength of %target.',
    toxin: '{m} fumes seep into the chakra of %target.',
    seal: 'A {m} seal smothers the chakra of %target.',
    lock: '{m} sparks freeze %target in place.',
    sever: 'A {m} seal cuts %target off from their bloodline.',
    shove: 'A {m} gust throws %target across the field.',
    venom: '{m} haze poisons %target and dulls their strikes.',
    fog: '{m} fog clouds the senses of %target.',
    hex: 'A {m} hex weakens %target.',
};

const COST_PERCENT_TAGS = (name: string) => CAPPED_AMP_TAGS.has(name) || name === 'Wound';
// Mirrors api/bloodlines/_jutsu-schema.ts: binary and fixed-magnitude tags
// carry percent 0; every other tag carries a creator percent (25 or 30).
const ZERO_PERCENT_TAGS = new Set([
    'Stun', 'Bloodline Seal', 'Elemental Seal', 'Copy', 'Mirror', 'Move',
    'Buff Prevent', 'Debuff Prevent', 'Cleanse Prevent', 'Clear Prevent',
    'Stun Prevent', 'Lag', 'Overclock', 'Pierce',
    'Heal', 'Shield', 'Drain', 'Push', 'Pull',
]);
const PERCENT_FREE_SCALABLE = { has: (name: string) => !ZERO_PERCENT_TAGS.has(name) && !COST_PERCENT_TAGS(name) };

type BuiltTag = { name: string; percent: number };
type Draft = { spec: JutsuSpec; tags: BuiltTag[]; range: number };

function draftTarget(ap: number, method: string, tags: BuiltTag[]): 'OPPONENT' | 'SELF' {
    const affectsOpponent = ap !== 40 || tags.some((t) => OPPONENT_AFFECTING_TAGS.has(t.name));
    return method === 'AOE_BURST' || affectsOpponent ? 'OPPONENT' : 'SELF';
}

function draftEffectPower(spec: JutsuSpec, tags: BuiltTag[]): number {
    if (spec.ap === 40) return 0;
    if (tags.some((t) => FIXED_EFFECT_POWER_TAGS.has(t.name))) return 40;
    return spec.nuke ? 50 : 40;
}

function draftAsRaw(d: Draft) {
    const method = d.spec.method ?? 'SINGLE';
    const target = draftTarget(d.spec.ap, method, d.tags);
    return {
        ap: d.spec.ap,
        method,
        target,
        range: target === 'SELF' ? 0 : d.range,
        effectPower: draftEffectPower(d.spec, d.tags),
        cooldown: 7,
        tags: d.tags,
    };
}

type BloodlineJutsu = ReturnType<typeof normalizePlayerBloodlineJutsus>[number];

function buildBloodline(a: Authored, slug: string) {
    const rng = makeRng(`bloodline:${slug}`);
    const blRank = A_RANKS.has(a.rank) ? 'A Rank' : 'B Rank';
    const kind: RecipeKind = blRank === 'B Rank' ? 'B4' : a.stacked ? 'A4' : 'A5';
    const budget = pointBudgetForRank(blRank);
    const specs = RECIPES[a.personality][kind];
    // 1. Fix the tag NAMES (flavor) with the seed.
    const chosen = specs.map((spec) => {
        const used = new Set<string>();
        return spec.tags.map((slot) => {
            const options = slot.names.filter((n) => !used.has(n));
            const name = rng.pick(options);
            used.add(name);
            return { name, optional: !!slot.optional };
        });
    });
    // 2. Enumerate every cost-affecting choice: percent tier of amp/Wound tags,
    //    optional tags on/off, and range 4/5 on opponent-targeted jutsu.
    type Var = { kind: 'pct' | 'opt' | 'range'; j: number; t: number };
    const vars: Var[] = [];
    chosen.forEach((tags, j) => {
        tags.forEach((tag, t) => {
            if (tag.optional) vars.push({ kind: 'opt', j, t });
            if (COST_PERCENT_TAGS(tag.name)) vars.push({ kind: 'pct', j, t });
        });
        vars.push({ kind: 'range', j, t: -1 });
    });
    const freePercent = chosen.map((tags) => tags.map((tag) =>
        PERCENT_FREE_SCALABLE.has(tag.name) ? rng.pick([25, 30]) : 0));
    const solutions: Draft[][] = [];
    const total = 1 << vars.length;
    for (let mask = 0; mask < total; mask++) {
        const pct = chosen.map((tags) => tags.map(() => 30));
        const on = chosen.map((tags) => tags.map(() => true));
        const range = chosen.map(() => 4);
        vars.forEach((v, i) => {
            const bit = (mask >> i) & 1;
            if (v.kind === 'pct') pct[v.j]![v.t] = bit ? 30 : 25;
            else if (v.kind === 'opt') on[v.j]![v.t] = !!bit;
            else range[v.j] = bit ? 5 : 4;
        });
        const drafts: Draft[] = specs.map((spec, j) => ({
            spec,
            range: range[j]!,
            tags: chosen[j]!.flatMap((tag, t) => on[j]![t]
                ? [{ name: tag.name, percent: COST_PERCENT_TAGS(tag.name) ? pct[j]![t]! : PERCENT_FREE_SCALABLE.has(tag.name) ? freePercent[j]![t]! : 0 }]
                : []),
        }));
        // A range-5 choice on a SELF jutsu is a duplicate of range 4.
        if (drafts.some((d) => draftAsRaw(d).target === 'SELF' && d.range === 5)) continue;
        const points = drafts.reduce((sum, d) => sum + jutsuPoints(draftAsRaw(d), blRank), 0);
        if (points === budget) solutions.push(drafts);
    }
    if (solutions.length === 0) throw new Error(`${a.name}: no ${kind} ${a.personality} combination spends exactly ${budget}`);
    const drafts = rng.pick(solutions);
    const motif = a.special;
    const idBase = `cinderhold-${slug.replace(/_/g, '-')}`;
    const rawJutsus = drafts.map((d) => {
        const suffix = rng.pick(ROLE_SUFFIXES[d.spec.role]!);
        const raw = draftAsRaw(d);
        const text = ROLE_TEXT[d.spec.role]!.replace('{m}', motif);
        return {
            id: `${idBase}-${d.spec.role}`,
            name: `${motif} ${suffix}`,
            type: d.spec.ap === 40 ? 'Any' : a.specialty,
            element: a.special,
            weatherElement: a.elements[0],
            ap: raw.ap,
            range: raw.range,
            effectPower: raw.effectPower,
            method: raw.method,
            target: raw.target,
            cooldown: 7,
            tags: raw.tags,
            battleDescription: text,
            description: text,
        };
    });
    const jutsus = normalizePlayerBloodlineJutsus(rawJutsus, blRank);
    if (jutsus.length !== rawJutsus.length) throw new Error(`${a.name}: server schema dropped a jutsu`);
    jutsus.forEach((j, i) => {
        const raw = rawJutsus[i]!;
        if (JSON.stringify(j.tags) !== JSON.stringify(raw.tags) || j.range !== raw.range || j.ap !== raw.ap
            || j.effectPower !== raw.effectPower || j.target !== raw.target || j.method !== raw.method) {
            throw new Error(`${a.name}: server schema changed ${raw.id}: ${JSON.stringify(j)} vs ${JSON.stringify(raw)}`);
        }
    });
    const points = bloodlinePoints(jutsus, blRank);
    if (points !== budget) throw new Error(`${a.name}: ${points} points, budget ${budget}`);
    if (JSON.stringify(normalizePlayerBloodlineJutsus(jutsus, blRank)) !== JSON.stringify(jutsus)) {
        throw new Error(`${a.name}: normalized bloodline is not a fixed point`);
    }
    return {
        id: `${idBase}-bloodline`,
        name: a.bloodline,
        rank: blRank as 'A Rank' | 'B Rank',
        specialElement: a.special,
        weatherElement: a.elements[0],
        lore: a.lore,
        jutsus: jutsus as BloodlineJutsu[],
        totalPoints: points,
    };
}

// ─── Catalog jutsu loadouts, banded by awakened elements ──────────────────────

const SCHOOL_PREFIX: Record<School, string> = { Ninjutsu: 'nin', Taijutsu: 'tai', Genjutsu: 'gen', Bukijutsu: 'buki' };
const FLICKER = 'starter-universal-flicker';
const LOADOUT_CAP = 12;

function elementJutsu(school: School, element: BaseElement) {
    const prefix = `starter-${SCHOOL_PREFIX[school]}-${element.toLowerCase()}-`;
    const ids = [...Object.keys(JUTSU_CATALOG).filter((id) => id.startsWith(prefix)), `starter-any-${element.toLowerCase()}-1`];
    for (const id of ids) if (!JUTSU_CATALOG[id]) throw new Error(`missing catalog jutsu ${id}`);
    return {
        forty: ids.filter((id) => JUTSU_CATALOG[id]!.ap === 40).sort(),
        sixty: ids.filter((id) => JUTSU_CATALOG[id]!.ap === 60).sort(),
    };
}

function buildJutsuBands(a: Authored, slug: string, bloodlineIds: string[]) {
    const rng = makeRng(`jutsu:${slug}`);
    const [primary, secondary] = a.elements;
    const p = elementJutsu(a.specialty, primary);
    const s = elementJutsu(a.specialty, secondary);
    const free = LOADOUT_CAP - bloodlineIds.length - 1;
    const p60 = rng.shuffle(p.sixty);
    const p40 = rng.shuffle(p.forty);
    const s60 = rng.shuffle(s.sixty);
    const s40 = rng.shuffle(s.forty);
    // Level 2-19: one awakened element. A loadout that mixes 40 and 60 AP.
    const n60 = Math.ceil(free / 2);
    const n40 = free - n60;
    const band2 = [...p60.slice(0, n60), ...p40.slice(0, n40)];
    // Level 20+: the second element replaces one 60 and one 40 AP pick.
    const band20 = [...p60.slice(0, n60 - 1), s60[0]!, ...p40.slice(0, n40 - 1), s40[0]!];
    const bands = [
        { minLevel: 1, equippedJutsuIds: [...bloodlineIds, FLICKER] },
        { minLevel: 2, equippedJutsuIds: [...bloodlineIds, FLICKER, ...band2] },
        { minLevel: 20, equippedJutsuIds: [...bloodlineIds, FLICKER, ...band20] },
    ];
    for (const band of bands) {
        if (band.equippedJutsuIds.length > LOADOUT_CAP) throw new Error(`${a.name}: loadout over ${LOADOUT_CAP}`);
        if (new Set(band.equippedJutsuIds).size !== band.equippedJutsuIds.length) throw new Error(`${a.name}: duplicate jutsu`);
    }
    return bands;
}

// ─── Stats (allocation weights, 0..1 of the level's stat reach) ──────────────

const STAT_KEYS = ['strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'] as const;
const SCHOOL_GENERALS: Record<School, [string, string]> = {
    Taijutsu: ['strength', 'speed'], Bukijutsu: ['strength', 'intelligence'],
    Genjutsu: ['intelligence', 'willpower'], Ninjutsu: ['willpower', 'speed'],
};
const DEFENSE_WEIGHT: Record<Personality, number> = { aggressive: 0.5, guardian: 0.85, medic: 0.7, trickster: 0.6 };

function buildStats(a: Authored, slug: string): Record<string, number> {
    const rng = makeRng(`stats:${slug}`);
    const offense = `${a.specialty.toLowerCase()}Offense`;
    const [g1, g2] = SCHOOL_GENERALS[a.specialty];
    const out: Record<string, number> = {};
    for (const key of STAT_KEYS) {
        let w: number;
        if (key === offense) w = 1;
        else if (key === g1) w = 1;
        else if (key === g2) w = 0.9;
        else if (key.endsWith('Defense')) w = DEFENSE_WEIGHT[a.personality];
        else if (key.endsWith('Offense')) w = 0.15;
        else w = 0.35;
        if (w < 1) w += (rng.next() - 0.5) * 0.1;
        out[key] = Math.round(Math.max(0.1, Math.min(1, w)) * 100) / 100;
    }
    return out;
}

// ─── Gear bands from the real item catalog ───────────────────────────────────

type CatalogItem = (typeof ITEM_CATALOG)[string];
const ARMOR_SLOTS = ['head', 'body', 'waist', 'legs', 'feet'] as const;
const LEGENDARY_SETS: Record<Personality, string[]> = {
    aggressive: ['legendary'], guardian: ['ironwall', 'bulwark'], medic: ['crimson'], trickster: ['mirror'],
};
const isStepId = (id: string) => /-s\d+$/.test(id);

function weaponCandidates(school: School): CatalogItem[] {
    const key = `${school.toLowerCase()}Offense`;
    return Object.values(ITEM_CATALOG).filter((item) => item.slot === 'hand'
        && !isStepId(item.id)
        && typeof item.levelReq === 'number'
        && !item.id.startsWith('ranked-format')
        && Object.keys(item.bonuses ?? {}).length === 1
        && Object.keys(item.bonuses ?? {})[0] === key);
}

function armorCandidates(slot: string, legendaryPrefix: string): CatalogItem[] {
    return Object.values(ITEM_CATALOG).filter((item) => item.slot === slot
        && !isStepId(item.id)
        && typeof item.levelReq === 'number'
        && ((item.armorQuality === 'Standard' && item.rarity === 'common')
            || item.armorQuality === 'Reinforced'
            || (item.armorQuality === 'Rare' && item.rarity === 'rare')
            || (item.armorQuality === 'Legendary' && item.id.startsWith(`${legendaryPrefix}-`))));
}

function buildGearBands(a: Authored, slug: string) {
    const rng = makeRng(`gear:${slug}`);
    const legendaryPrefix = rng.pick(LEGENDARY_SETS[a.personality]);
    const allowMythic = !['genin', 'chunin'].includes(a.rank);
    const weapons = weaponCandidates(a.specialty).filter((w) => allowMythic || w.rarity !== 'mythic');
    const slots: Record<string, CatalogItem[]> = { hand: weapons };
    for (const slot of ARMOR_SLOTS) slots[slot] = armorCandidates(slot, legendaryPrefix);
    // One seeded pick per (slot, levelReq tier), reused by every band.
    const tierPick = new Map<string, string>();
    for (const [slot, items] of Object.entries(slots)) {
        const tiers = [...new Set(items.map((i) => i.levelReq!))].sort((x, y) => x - y);
        for (const tier of tiers) {
            const options = items.filter((i) => i.levelReq === tier).map((i) => i.id).sort();
            tierPick.set(`${slot}:${tier}`, rng.pick(options));
        }
    }
    const thresholds = [...new Set(Object.values(slots).flat().map((i) => i.levelReq!))].filter((l) => l <= 100).sort((x, y) => x - y);
    if (thresholds[0] !== 1) throw new Error(`${a.name}: no level-1 gear`);
    const bands: Array<{ minLevel: number; equipment: Record<string, string> }> = [];
    for (const minLevel of thresholds) {
        const equipment: Record<string, string> = {};
        for (const [slot, items] of Object.entries(slots)) {
            const tier = Math.max(...items.filter((i) => i.levelReq! <= minLevel).map((i) => i.levelReq!));
            if (!Number.isFinite(tier)) throw new Error(`${a.name}: nothing for ${slot} at ${minLevel}`);
            equipment[slot] = tierPick.get(`${slot}:${tier}`)!;
        }
        const previous = bands[bands.length - 1];
        if (previous && JSON.stringify(previous.equipment) === JSON.stringify(equipment)) continue;
        bands.push({ minLevel, equipment });
    }
    return bands;
}

// ─── Pets: 120 distinct species, rarity by rank ──────────────────────────────

type PetRarity = 'mythic' | 'legendary' | 'rare' | 'standard';
const PET_PLAN: Record<Rank, (indexInRank: number) => PetRarity[]> = {
    kage: () => ['mythic', 'mythic', 'mythic', 'mythic'],
    // The lead commander keeps the four mythics the roster's Kage used to hold
    // (only 11 mythic and 30 legendary species are eligible; this spends both exactly).
    commander: (i) => i === 0 ? ['mythic', 'mythic', 'mythic', 'mythic'] : ['mythic', 'mythic', 'legendary', 'legendary'],
    elite: (i) => [i < 3 ? 'mythic' : 'legendary', 'legendary', 'legendary', 'rare'],
    jonin: () => ['legendary', 'legendary', 'rare', 'rare'],
    chunin: () => ['rare', 'rare', 'rare', 'standard'],
    genin: (i) => [i < 4 ? 'rare' : 'standard', 'standard', 'standard', 'standard'],
};
const TRAIT_PREFERENCE: Record<Personality, string[]> = {
    aggressive: ['Aggressive', 'Battleborn'], guardian: ['Guardian', 'Loyal'],
    medic: ['Lucky', 'Loyal'], trickster: ['Swift', 'Lucky'],
};
const NICK_HEAD = ['Ash', 'Ember', 'Cinder', 'Soot', 'Flint', 'Blaze', 'Kindle', 'Char', 'Smolder', 'Pyre',
    'Spark', 'Slag', 'Tinder', 'Glow', 'Haze', 'Smoke', 'Coal', 'Magma', 'Rust', 'Scoria', 'Pumice', 'Lumen'];
const NICK_TAIL = ['paw', 'fang', 'tail', 'wing', 'whisker', 'claw', 'mane', 'horn', 'scale', 'heart',
    'step', 'song', 'bite', 'shade', 'drift', 'flick', 'burr', 'nose', 'tuft', 'ear', 'pip', 'dancer'];

const petPool: Record<PetRarity, string[]> = { mythic: [], legendary: [], rare: [], standard: [] };
for (const [id, pet] of Object.entries(PET_CATALOG) as Array<[string, Record<string, unknown>]>) {
    if (pet.wildSpawnable === false) continue;
    if (!APPROVED_ROSTER_MODEL_IDS.has(id)) continue;
    const rarity = pet.rarity as PetRarity;
    if (petPool[rarity]) petPool[rarity].push(id);
}
for (const list of Object.values(petPool)) list.sort();

const nicknameRng = makeRng('pet-nicknames');
const nicknamePool = nicknameRng.shuffle(NICK_HEAD.flatMap((h) => NICK_TAIL.map((t) => `${h}${t}`)))
    .filter((nick) => isCleanText(nick) && isCleanPlayerName(nick) && !hasStaffImpersonationName(nick) && nick.length <= 24);
let nicknameCursor = 0;

function buildPets(a: Authored, slug: string, indexInRank: number) {
    const rng = makeRng(`pets:${slug}`);
    const plan = PET_PLAN[a.rank](indexInRank);
    return plan.map((rarity, i) => {
        const pool = petPool[rarity];
        const wanted = i === 0 ? [a.elements[0]] : a.elements;
        const matching = pool.filter((id) => wanted.includes(PET_CATALOG[id]!.element as BaseElement));
        const templateId = rng.pick(matching.length ? matching : pool);
        pool.splice(pool.indexOf(templateId), 1);
        const allowed = TRAIT_PREFERENCE[a.personality].filter((t) => t !== 'Guardian' || rarity === 'mythic');
        const trait = rng.pick(allowed.length ? allowed : ['Loyal']);
        const nickname = nicknamePool[nicknameCursor++];
        if (!nickname) throw new Error('ran out of pet nicknames');
        return {
            templateId,
            species: String(PET_CATALOG[templateId]!.name),
            rarity,
            nickname,
            signature: i === 0,
            instanceId: `${templateId}:npc-${slug}-${i + 1}`,
            trait,
        };
    });
}

// ─── Chronicle decks ─────────────────────────────────────────────────────────

type Card = (typeof CHRONICLE_CARD_CATALOG)[number];
const EXCLUDED_FAMILIES = new Set(['Summoned Beast', 'Legacy Pattern', 'Story Combatant']);
const monsters = CHRONICLE_CARD_CATALOG.filter((c): c is Extract<Card, { cardClass: 'monster' }> =>
    c.cardClass === 'monster' && c.id.startsWith('tc-') && !(c as { token?: boolean }).token
    && !EXCLUDED_FAMILIES.has(String((c as { family?: string }).family)));
const spells = CHRONICLE_CARD_CATALOG.filter((c) => c.cardClass !== 'monster' && c.id.startsWith('chronicle-')
    && (c as { effect?: { kind?: string } }).effect?.kind !== 'callSummon');
const FIELD_FOR: Record<BaseElement, string> = {
    Fire: 'chronicle-field-volcano', Water: 'chronicle-field-ocean', Earth: 'chronicle-field-desert',
    Wind: 'chronicle-field-sky', Lightning: 'chronicle-field-lightning-storm',
};
const PERSONALITY_KINDS: Record<Personality, string[]> = {
    aggressive: ['modifyAttackUntilEndTurn', 'modifyAttackAndDefense', 'destroyOneMonster', 'destroyLowDefenseMonster', 'destroyAllOpponentMonsters', 'destroyAttackerAndDamageBoth', 'drawCards', 'destroyOneMagicTrap', 'destroyAllOpponentMagicTraps'],
    guardian: ['modifyDefenseUntilEndTurn', 'battleShieldEquip', 'negateOneAttack', 'borrowAttackerDefense', 'summonDefenderFromHand', 'endBattlePhase', 'defensiveFeint', 'healLifePoints', 'negateAttackAndInflictDamage'],
    medic: ['healLifePoints', 'reviveLevel4OrLowerMonster', 'reviveLevel4OrLowerNormalMonster', 'recoverOneGraveyardCard', 'drawCards', 'negateOneAttack', 'destroyOneMagicTrapAndHeal', 'reviveOneMonster', 'drawThenDiscardRandom'],
    trickster: ['returnOneMonsterToHand', 'changeOneMonsterPosition', 'destroyOneMagicTrap', 'redirectAttackToHighestDefense', 'sealSummonedMonsterFaceDown', 'defensiveFeint', 'weakenSummonedMonster', 'negateMonsterTargetingCard', 'cycleBothHands'],
};
const RARITY_WEIGHT: Record<Rank, Record<string, number>> = {
    kage: { common: 0.5, rare: 1, epic: 2, legendary: 3, mythic: 4 },
    commander: { common: 0.5, rare: 1, epic: 2, legendary: 3, mythic: 3 },
    elite: { common: 0.7, rare: 1.5, epic: 2, legendary: 2, mythic: 1.5 },
    jonin: { common: 1, rare: 2, epic: 2, legendary: 1.5, mythic: 0.5 },
    chunin: { common: 2, rare: 2, epic: 1, legendary: 0.3, mythic: 0 },
    genin: { common: 3, rare: 1.5, epic: 0.4, legendary: 0, mythic: 0 },
};

function weightedPick<T>(rng: Rng, items: T[], weight: (item: T) => number): T | undefined {
    const weights = items.map(weight);
    const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (sum <= 0) return undefined;
    let roll = rng.next() * sum;
    for (let i = 0; i < items.length; i++) {
        roll -= Math.max(0, weights[i]!);
        if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
}

function curveOf(deck: readonly string[]): [number, number, number] {
    const bands: [number, number, number] = [0, 0, 0];
    for (const id of deck) {
        const card = CHRONICLE_CARD_CATALOG.find((c) => c.id === id);
        if (card?.cardClass === 'monster') bands[tributeCountForLevel(card.level) as 0 | 1 | 2]++;
    }
    return bands;
}

function buildDeck(a: Authored, slug: string, attempt: number): string[] {
    const rng = makeRng(`deck:${slug}:${attempt}`);
    const [primary, secondary] = a.elements;
    const rarityWeight = RARITY_WEIGHT[a.rank];
    const counts = new Map<string, number>();
    const add = (id: string, copies: number) => {
        const room = deckLimitForCard(id) - (counts.get(id) ?? 0);
        const n = Math.max(0, Math.min(copies, room));
        if (n > 0) counts.set(id, (counts.get(id) ?? 0) + n);
        return n;
    };
    const total = () => [...counts.values()].reduce((s, n) => s + n, 0);
    // Monster curve: free bodies >= 12 and never fewer than the Tribute Monsters.
    const free = 14 + rng.int(3);          // 14-16
    const one = 4 + rng.int(3);            // 4-6
    const two = 2 + rng.int(3);            // 2-4
    const bandTarget = [free, one, two];
    for (let band = 0; band < 3; band++) {
        let placed = 0;
        const pool = monsters.filter((m) => tributeCountForLevel(m.level) === band);
        let guard = 0;
        while (placed < bandTarget[band]! && guard++ < 500) {
            const pick = weightedPick(rng, pool.filter((m) => (counts.get(m.id) ?? 0) < deckLimitForCard(m.id)), (m) =>
                (m.element === primary ? 12 : m.element === secondary ? 2.5 : 0.1) * (0.2 + (rarityWeight[m.rarity] ?? 0)));
            if (!pick) break;
            const copies = Math.min(bandTarget[band]! - placed, (pick.element === primary ? 2 : 1) + rng.int(2));
            placed += add(pick.id, copies);
        }
        if (placed !== bandTarget[band]) throw new Error(`${a.name}: could not fill monster band ${band}`);
    }
    // Which elements are reliably face-up for element-gated Snares.
    const elementCount = new Map<string, number>();
    for (const [id, n] of counts) {
        const card = monsters.find((m) => m.id === id)!;
        elementCount.set(card.element, (elementCount.get(card.element) ?? 0) + n);
    }
    const supported = (card: Card) => {
        const need = (card as { effect?: { requiresFaceUpElement?: string } }).effect?.requiresFaceUpElement;
        return !need || (elementCount.get(need) ?? 0) >= 8;
    };
    // The home field Magic, then personality-led Magic and Traps.
    add(FIELD_FOR[primary], rng.int(2) + 1);
    const kinds = new Set(PERSONALITY_KINDS[a.personality]);
    let guard = 0;
    while (total() < MAIN_DECK_SIZE && guard++ < 1000) {
        const pool = spells.filter((c) => supported(c) && (counts.get(c.id) ?? 0) < deckLimitForCard(c.id)
            && !(c as { effect?: { kind?: string } }).effect?.kind?.startsWith('setFieldEnvironment'));
        const pick = weightedPick(rng, pool, (c) => {
            const kind = (c as { effect?: { kind?: string } }).effect?.kind ?? '';
            return (kinds.has(kind) ? 4 : 0.6) * (rarityWeight[c.rarity] ?? 0);
        });
        if (!pick) break;
        add(pick.id, Math.min(MAIN_DECK_SIZE - total(), 1 + rng.int(2)));
    }
    if (total() !== MAIN_DECK_SIZE) throw new Error(`${a.name}: deck has ${total()} cards`);
    const order = (id: string) => {
        const card = CHRONICLE_CARD_CATALOG.find((c) => c.id === id)!;
        return card.cardClass === 'monster' ? `0-${String(card.level).padStart(2, '0')}-${id}` : `${card.cardClass === 'magic' ? 1 : 2}-${id}`;
    };
    const deck = [...counts.entries()].sort(([x], [y]) => order(x).localeCompare(order(y))).flatMap(([id, n]) => Array(n).fill(id) as string[]);
    const validation = validateDeckIds(deck);
    if (!validation.valid) throw new Error(`${a.name}: ${validation.errors.join('; ')}`);
    const [f, o, t] = curveOf(deck);
    if (f < 12 || o + t > f) throw new Error(`${a.name}: bad curve ${f}/${o}/${t}`);
    const themed = deck.filter((id) => monsters.find((m) => m.id === id)?.element === primary).length;
    if (themed * 2 < f + o + t) throw new Error(`${a.name}: only ${themed} ${primary} monsters`);
    return deck;
}

function collectionFor(deck: readonly string[]): string[] {
    const need = countChronicleCards(deck);
    for (const [id, n] of countChronicleCards(CHRONICLE_STARTER_GRANT_IDS)) need.set(id, Math.max(need.get(id) ?? 0, n));
    return [...need.entries()].sort(([x], [y]) => x.localeCompare(y)).flatMap(([id, n]) => Array(n).fill(id) as string[]);
}

// ─── Avatars ─────────────────────────────────────────────────────────────────

// Owner, 2026-11-11: each NPC wears its own portrait, shipped with the client
// at shinobij.client/public/npc-portraits/<slug>.avif (256x256). They are not
// presets: a player can never pick one (api/_entitlements.ts PRESET_AVATARS).
const PORTRAIT_DIR = resolve(ROOT, 'shinobij.client/public/npc-portraits');
function portraitFor(slug: string): string {
    if (!existsSync(resolve(PORTRAIT_DIR, `${slug}.avif`))) throw new Error(`no portrait for ${slug} in ${PORTRAIT_DIR}`);
    return `/npc-portraits/${slug}.avif`;
}

// ─── Assemble ────────────────────────────────────────────────────────────────

function validateName(name: string) {
    const slug = safeName(name);
    if (!slug || slug.length > 32 || name.length > 32) throw new Error(`bad name length: ${name}`);
    if (!isCleanPlayerName(name) || !isCleanText(name) || hasStaffImpersonationName(name)) throw new Error(`name refused by moderation: ${name}`);
    return slug;
}

const sorted = [...AUTHORED].sort((x, y) => RANK_ORDER.indexOf(x.rank) - RANK_ORDER.indexOf(y.rank));
const indexInRank = new Map<Rank, number>();
const decksSeen = new Set<string>();
const roster = sorted.map((a) => {
    const slug = validateName(a.name);
    const i = indexInRank.get(a.rank) ?? 0;
    indexInRank.set(a.rank, i + 1);
    const bloodline = buildBloodline(a, slug);
    const jutsuBands = buildJutsuBands(a, slug, bloodline.jutsus.map((j) => String(j.id)));
    const learned = [...new Set(jutsuBands.flatMap((b) => b.equippedJutsuIds))];
    let deck: string[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 40 && !deck; attempt++) {
        try {
            const candidate = buildDeck(a, slug, attempt);
            const key = [...candidate].sort().join(',');
            if (!decksSeen.has(key)) { decksSeen.add(key); deck = candidate; }
        } catch (error) {
            lastError = error;
        }
    }
    if (!deck) throw new Error(`${a.name}: could not build a distinct legal deck (${String(lastError)})`);
    return {
        id: slug,
        name: a.name,
        rank: a.rank,
        personality: a.personality,
        avatar: portraitFor(slug),
        specialty: a.specialty,
        elements: [...a.elements],
        stats: buildStats(a, slug),
        bloodline,
        equippedJutsuIds: jutsuBands[jutsuBands.length - 1]!.equippedJutsuIds,
        jutsuBands,
        jutsuMastery: learned.map((jutsuId) => ({ jutsuId, level: 1, xp: 0 })),
        gearBands: buildGearBands(a, slug),
        pets: buildPets(a, slug, i),
        deck: { name: a.deckName, cards: deck },
        collection: collectionFor(deck),
    };
});

// Global invariants the module must never ship without.
const unique = (label: string, values: string[]) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
};
unique('slug', roster.map((n) => n.id));
unique('bloodline name', roster.map((n) => n.bloodline.name));
unique('bloodline id', roster.map((n) => n.bloodline.id));
unique('jutsu id', roster.flatMap((n) => n.bloodline.jutsus.map((j) => String(j.id))));
unique('jutsu name', roster.flatMap((n) => n.bloodline.jutsus.map((j) => String(j.name))));
unique('pet species', roster.flatMap((n) => n.pets.map((p) => p.templateId)));
unique('pet nickname', roster.flatMap((n) => n.pets.map((p) => p.nickname)));
unique('deck name', roster.map((n) => n.deck.name));
if (roster.length !== 30) throw new Error('roster must hold 30 NPCs');

// ─── Emit ────────────────────────────────────────────────────────────────────

const j = (value: unknown) => JSON.stringify(value);
function emitNpc(npc: (typeof roster)[number]): string {
    const lines: string[] = [];
    lines.push('    {');
    for (const key of ['id', 'name', 'rank', 'personality', 'avatar', 'specialty', 'elements', 'stats'] as const) {
        lines.push(`        ${key}: ${j(npc[key])},`);
    }
    const { jutsus, ...bloodlineHead } = npc.bloodline;
    lines.push(`        bloodline: { ...${j(bloodlineHead)}, jutsus: [`);
    for (const jutsu of jutsus) lines.push(`            ${j(jutsu)},`);
    lines.push('        ] },');
    lines.push(`        equippedJutsuIds: ${j(npc.equippedJutsuIds)},`);
    lines.push('        jutsuBands: [');
    for (const band of npc.jutsuBands) lines.push(`            ${j(band)},`);
    lines.push('        ],');
    lines.push(`        jutsuMastery: ${j(npc.jutsuMastery)},`);
    lines.push('        gearBands: [');
    for (const band of npc.gearBands) lines.push(`            ${j(band)},`);
    lines.push('        ],');
    lines.push('        pets: [');
    for (const pet of npc.pets) lines.push(`            ${j(pet)},`);
    lines.push('        ],');
    lines.push(`        deck: { name: ${j(npc.deck.name)}, cards: ${j(npc.deck.cards)} },`);
    lines.push(`        collection: ${j(npc.collection)},`);
    lines.push('    },');
    return lines.join('\n');
}

const MODULE_HEAD = `/*
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *
 *   node --import tsx scripts/gen-npc-village-roster.mts
 *
 * The persistent roster of the 30 NPC shinobi who run Cinderhold Village
 * (shared/npc-village.ts). Each entry is shaped so a seeder can write it as a
 * real, password-less player save: every field maps onto a save field the
 * server already accepts for a human character.
 *
 * The generator resolved everything below from the live server catalogs and
 * validators, and shared/npc-village-roster.test.ts re-proves it:
 *   - bloodline: a top-level savedBloodlines entry, already in the exact
 *     projection api/bloodlines/_jutsu-schema.ts normalizes to, spending its
 *     whole rank budget (A 10 points, B 7);
 *   - jutsu, elements, gear and stats are BANDED by level, because NPC levels
 *     are rescaled daily anywhere from 1 to 100: use the *ForLevel helpers;
 *   - pets: four distinct wild-obtainable species per NPC with approved 3D
 *     models, 120 distinct across the roster (build each with createOwnedPet);
 *   - deck: a legal 40-card Chronicle deck, and collection: the tileCards the
 *     NPC must own for api/card-clash/_deck.ts to accept it.
 *
 * This module has no api/ imports, so the client may import it.
 */

export type NpcRank = 'kage' | 'commander' | 'elite' | 'jonin' | 'chunin' | 'genin';
export type NpcPersonality = 'aggressive' | 'guardian' | 'medic' | 'trickster';
export type NpcAiTier = 'tactical' | 'advanced' | 'master' | 'apex';
export type NpcSpecialty = 'Ninjutsu' | 'Taijutsu' | 'Genjutsu' | 'Bukijutsu';
export type NpcBaseElement = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Lightning';
export type NpcStatKey =
    | 'strength' | 'speed' | 'intelligence' | 'willpower'
    | 'bukijutsuOffense' | 'bukijutsuDefense' | 'taijutsuOffense' | 'taijutsuDefense'
    | 'genjutsuOffense' | 'genjutsuDefense' | 'ninjutsuOffense' | 'ninjutsuDefense';

/** One jutsu exactly as normalizePlayerBloodlineJutsus stores it (character save Jutsu shape). */
export type NpcBloodlineJutsu = {
    id: string;
    name: string;
    type: 'Any' | NpcSpecialty;
    element: string;
    ap: 40 | 60;
    range: number;
    effectPower: number;
    cooldown: number;
    currentCooldown: number;
    chakraCost: number;
    staminaCost: number;
    healthCost: number;
    chakraCostReducePerLvl: number;
    staminaCostReducePerLvl: number;
    healthCostReducePerLvl: number;
    target: 'OPPONENT' | 'SELF';
    method: 'SINGLE' | 'AOE_BURST';
    tags: Array<{ name: string; percent: number }>;
    battleDescription: string;
    description: string;
    isUtility: boolean;
    weatherElement: NpcBaseElement;
};

/** A top-level save \`savedBloodlines\` entry (client SavedBloodline). */
export type NpcSavedBloodline = {
    id: string;
    name: string;
    rank: 'A Rank' | 'B Rank';
    specialElement: string;
    weatherElement: NpcBaseElement;
    lore: string;
    jutsus: NpcBloodlineJutsu[];
    totalPoints: number;
};

/** character.jutsuMastery row. */
export type NpcJutsuMastery = { jutsuId: string; level: number; xp: number };
/** character.equipment (weapon hand + the five armor slots). */
export type NpcEquipment = Partial<Record<'hand' | 'head' | 'body' | 'waist' | 'legs' | 'feet', string>>;
export type NpcGearBand = { minLevel: number; equipment: NpcEquipment };
export type NpcJutsuBand = { minLevel: number; equippedJutsuIds: string[] };
/** What createOwnedPet(templateId, { origin, instanceId, trait }) needs, plus a nickname. */
export type NpcPet = {
    templateId: string;
    species: string;
    rarity: 'mythic' | 'legendary' | 'rare' | 'standard';
    nickname: string;
    signature: boolean;
    instanceId: string;
    trait: string;
};

export type NpcShinobi = {
    /** Account slug: safeName(name), the save key \`save:<id>\`. */
    id: string;
    /** character.name */
    name: string;
    rank: NpcRank;
    personality: NpcPersonality;
    /** character.avatarImage: its own portrait, /npc-portraits/<id>.avif (not a player preset). */
    avatar: string;
    /** character.specialty */
    specialty: NpcSpecialty;
    /** Awakening order: character.elements gains [0] at level 2 and [1] at level 20. */
    elements: NpcBaseElement[];
    /** Stat ALLOCATION weights (0..1). Real stat values come from npcStatsForLevel. */
    stats: Record<NpcStatKey, number>;
    /** Top-level save savedBloodlines[0]; character.equippedBloodlineId = bloodline.id. */
    bloodline: NpcSavedBloodline;
    /** character.equippedJutsuIds at level 20+ (the full 12). Lower levels: jutsuBands. */
    equippedJutsuIds: string[];
    jutsuBands: NpcJutsuBand[];
    /** character.jutsuMastery: one row for every jutsu any band equips (level 1). */
    jutsuMastery: NpcJutsuMastery[];
    gearBands: NpcGearBand[];
    /** character.pets (signature first); activePetId = the signature's instanceId. */
    pets: NpcPet[];
    /** character.cardClashDeck = deck.cards. */
    deck: { name: string; cards: string[] };
    /** character.tileCards (covers the deck and the starter grant, so no top-up runs). */
    collection: string[];
};

/** Level offset from the scaled reference level, per rank. */
export const NPC_RANK_LEVEL_OFFSET: Readonly<Record<NpcRank, number>> = Object.freeze({
    genin: -10, chunin: -7, jonin: -4, elite: 0, commander: 3, kage: 5,
});

/** AI difficulty tier per rank. */
export const NPC_RANK_AI_TIER: Readonly<Record<NpcRank, NpcAiTier>> = Object.freeze({
    genin: 'tactical', chunin: 'tactical', jonin: 'advanced', elite: 'master', commander: 'master', kage: 'apex',
});

/** An NPC's display name from its slug (the slug itself if unknown), for messages players read. */
export function npcDisplayName(slug: string): string {
    return NPC_VILLAGE_ROSTER.find((npc) => npc.id === slug)?.name ?? slug;
}

/** Mirror of api/_utils.ts safeName (the account-slug rule). Parity-tested. */
export function npcCanonicalSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\\-_]/g, '').slice(0, 32);
}

/** Mirror of api/combat-core/formulas.ts jutsuLevelCapForLevel. Parity-tested. */
export function npcJutsuLevelCap(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 50) return 50;
    if (lvl >= 30) return 30;
    if (lvl >= 15) return 20;
    return 10;
}

/** Mirror of the per-rank stat cap (statCapForLevel). Parity-tested. */
export function npcStatCap(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80) return 2500;
    if (lvl >= 50) return 2100;
    if (lvl >= 30) return 1300;
    if (lvl >= 15) return 700;
    return 350;
}

const MAX_STAT = 2500;
const BASE_STAT = 10;

function clampLevel(level: number): number {
    return Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
}

function bandFor<T extends { minLevel: number }>(bands: readonly T[], level: number): T {
    const lvl = clampLevel(level);
    let chosen = bands[0]!;
    for (const band of bands) if (band.minLevel <= lvl) chosen = band;
    return chosen;
}

/** The highest gear band whose minLevel <= level (every item's levelReq <= that minLevel). */
export function npcGearForLevel(npc: NpcShinobi, level: number): NpcEquipment {
    return { ...bandFor(npc.gearBands, level).equipment };
}

/** The jutsu loadout legal at this level (element awakening gates the catalog picks). */
export function npcJutsuIdsForLevel(npc: NpcShinobi, level: number): string[] {
    return [...bandFor(npc.jutsuBands, level).equippedJutsuIds];
}

/** character.elements at this level: none at 1, one from level 2, two from level 20. */
export function npcElementsForLevel(npc: NpcShinobi, level: number): NpcBaseElement[] {
    const lvl = clampLevel(level);
    return npc.elements.slice(0, lvl >= 20 ? 2 : lvl >= 2 ? 1 : 0);
}

/** character.claimedAwakenings matching npcElementsForLevel. */
export function npcClaimedAwakeningsForLevel(level: number): string[] {
    const lvl = clampLevel(level);
    return [...(lvl >= 2 ? ['awakening-free-lv2'] : []), ...(lvl >= 20 ? ['awakening-free-lv20'] : [])];
}

/** character.jutsuMastery at this level: every learned jutsu at the rank's mastery cap. */
export function npcJutsuMasteryForLevel(npc: NpcShinobi, level: number): NpcJutsuMastery[] {
    const cap = npcJutsuLevelCap(clampLevel(level));
    return npc.jutsuMastery.map((row) => ({ jutsuId: row.jutsuId, level: cap, xp: 0 }));
}

/**
 * Mirror of api/_xp-engine.ts earnedForLevel: the stat points a player must have
 * allocated to BE this level (0 at level 1). Parity-tested.
 */
export function npcEarnedForLevel(level: number): number {
    const n = clampLevel(level) - 1;
    return Math.round(191.67876990268087 * n + 1.1074354304268461 * n * n
        - 0.02226330146888855 * n * n * n + 0.00021623956441357866 * n * n * n * n);
}

/**
 * character.stats at this level. FAIRNESS RULE (owner, 2026-11-08): an NPC gets
 * exactly the allocated stat points of the weakest real player at its level
 * (npcEarnedForLevel), never more. They are split by the NPC's build weights,
 * water-filled under the level's per-stat cap, on top of the base 10 per stat.
 */
export function npcStatsForLevel(npc: NpcShinobi, level: number): Record<NpcStatKey, number> {
    const lvl = clampLevel(level);
    const room = Math.min(npcStatCap(lvl), MAX_STAT) - BASE_STAT;
    const entries = Object.entries(npc.stats) as Array<[NpcStatKey, number]>;
    const extra = Object.fromEntries(entries.map(([key]) => [key, 0])) as Record<NpcStatKey, number>;
    let budget = npcEarnedForLevel(lvl);
    let open = entries.filter(([, weight]) => weight > 0).map(([key]) => key);
    // Proportional shares; any stat that hits its cap passes the rest on.
    while (budget > 0 && open.length) {
        const weightSum = open.reduce((sum, key) => sum + npc.stats[key], 0);
        let spent = 0;
        const stillOpen: NpcStatKey[] = [];
        for (const key of open) {
            const share = Math.floor(budget * npc.stats[key] / weightSum);
            const add = Math.min(share, room - extra[key]);
            extra[key] += add; spent += add;
            if (extra[key] < room) stillOpen.push(key);
        }
        if (spent === 0) {
            // Rounding leftovers: one point at a time to the heaviest open stats.
            for (const key of [...stillOpen].sort((a, b) => npc.stats[b] - npc.stats[a])) {
                if (budget - spent <= 0) break;
                extra[key] += 1; spent += 1;
            }
            if (spent === 0) break;
        }
        budget -= spent;
        open = stillOpen.filter((key) => extra[key] < room);
    }
    const out = {} as Record<NpcStatKey, number>;
    for (const [key] of entries) out[key] = BASE_STAT + extra[key];
    return out;
}

/**
 * The combat-relevant character fields for one NPC at one level. A seeder
 * spreads this over a fresh character (with HP/chakra/stamina from the
 * server's *ForLevel helpers and pets built through createOwnedPet).
 */
export function npcLoadoutForLevel(npc: NpcShinobi, level: number) {
    const lvl = clampLevel(level);
    const elements = npcElementsForLevel(npc, lvl);
    return {
        name: npc.name,
        level: lvl,
        specialty: npc.specialty,
        avatarImage: npc.avatar,
        bloodline: npc.bloodline.name,
        equippedBloodlineId: npc.bloodline.id,
        ...(elements[0] ? { element: elements[0] } : {}),
        elements,
        claimedAwakenings: npcClaimedAwakeningsForLevel(lvl),
        stats: npcStatsForLevel(npc, lvl),
        unspentStats: 0,
        equippedJutsuIds: npcJutsuIdsForLevel(npc, lvl),
        jutsuMastery: npcJutsuMasteryForLevel(npc, lvl),
        equipment: npcGearForLevel(npc, lvl),
        cardClashDeck: [...npc.deck.cards],
        tileCards: [...npc.collection],
        starterCardsClaimed: true,
    };
}

/** The top-level savedBloodlines array for an NPC save. */
export function npcSavedBloodlines(npc: NpcShinobi): NpcSavedBloodline[] {
    return [structuredClone(npc.bloodline)];
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
`;

const MODULE_TAIL = `
/** Every NPC account slug, kage first. */
export const NPC_ACCOUNT_SLUGS: readonly string[] = Object.freeze(NPC_VILLAGE_ROSTER.map((npc) => npc.id));
const NPC_SLUG_SET: ReadonlySet<string> = new Set(NPC_ACCOUNT_SLUGS);

/** True when a slug or display name belongs to a Cinderhold NPC (canonicalized like the server). */
export function isNpcAccount(slugOrName: unknown): boolean {
    if (typeof slugOrName !== 'string') return false;
    const slug = npcCanonicalSlug(slugOrName.trim());
    return slug.length > 0 && NPC_SLUG_SET.has(slug);
}

export function npcBySlug(slugOrName: unknown): NpcShinobi | undefined {
    if (typeof slugOrName !== 'string') return undefined;
    const slug = npcCanonicalSlug(slugOrName.trim());
    return NPC_VILLAGE_ROSTER.find((npc) => npc.id === slug);
}
`;

const body = `\nexport const NPC_VILLAGE_ROSTER: readonly NpcShinobi[] = deepFreeze<NpcShinobi[]>([\n${roster.map(emitNpc).join('\n')}\n]);\n`;
writeFileSync(OUT, `${MODULE_HEAD}${body}${MODULE_TAIL}`, 'utf8');
console.log(`wrote ${OUT}: ${roster.length} NPCs`);
for (const npc of roster) {
    console.log([npc.name, npc.id, npc.rank, npc.personality, `${npc.bloodline.name} (${npc.bloodline.rank}, ${npc.bloodline.jutsus.length})`,
        `${npc.pets[0]!.species} [${npc.pets[0]!.rarity}]`, npc.deck.name, curveOf(npc.deck.cards).join('/')].join(' | '));
}
