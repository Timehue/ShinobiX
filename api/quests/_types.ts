/*
 * Quest lines: long, hand-authored, one-time quests with prerequisites.
 *
 * A quest line differs from a Quest Book epic (api/sector/_questbook.ts) in
 * four ways: it is done once and never repeats; several can be active at a
 * time; it may require other quest lines and a number of marks; and its stages
 * are proven by what the player made, gathered and broke, not only by counters.
 *
 * Types only. No KV, auth or locks, so the narrative audit and the story PDF
 * can import the catalogue that uses them.
 */
import type { StageChoiceOptionLike } from './_stage-core.js';

/** Which map a quest line is set on. Coast quests carry the length rules. */
export type QuestLineWorld = 'home' | 'coast';

/** Length tier. Sets the minimum number of stages a coast quest must have. */
export type QuestLineTier = 1 | 2 | 3 | 4;

export const QUEST_LINE_MIN_STAGES: Readonly<Record<QuestLineTier, number>> = { 1: 5, 2: 6, 3: 8, 4: 10 };

/** How many quest lines one player may have under way at once. */
export const MAX_ACTIVE_QUEST_LINES = 3;

/** A spot the player must stand at. `tile` omitted means anywhere in the sector. */
export interface QuestLinePlace {
    sector: number;
    tile?: number;
    /** How many tiles away still counts. Defaults to 2. */
    radius?: number;
}

export interface QuestLineChoiceOption extends StageChoiceOptionLike {
    label: string;
    blurb: string;
    /** Item ids this option adds to the quest's reward at claim, one of each. */
    items?: readonly string[];
    /** The journal picture for what this option gives (see QuestLineRewards.artKeys). */
    artKey?: string;
}

/**
 * When a spoken line is shown. Every condition given must hold. This is how a
 * quest answers what the player did earlier: a choice sealed in this quest
 * (`chose`), a standing an earlier quest left on their record (`standing`), or
 * a quest they have finished (`finished`).
 */
export interface QuestSayWhen {
    /** The player's record carries this standing (stamped by a choice at a claim). */
    standing?: string;
    /** The player's record does not carry this standing. */
    without?: string;
    /** In this same quest, the choice stage `[key]` was sealed as `[option]`. */
    chose?: readonly [stage: string, option: string];
    /** This quest line is finished. */
    finished?: string;
    /** This quest line is not finished. */
    unfinished?: string;
}

/**
 * One box of speech. `speaker` is a cast id (shared/coast-cast.ts), `you` for
 * what the player's own shinobi notices or thinks, or `narrator` for plain
 * description. Text follows the story's rules: an actor could say it, whole
 * sentences, 55 words or fewer, no dash used as a pause.
 */
export interface QuestSay {
    speaker: string;
    text: string;
    when?: QuestSayWhen;
}

interface StageBase {
    key: string;
    /** What the player must do, in plain words. Player-facing. */
    text: string;
    /**
     * What is said when the player comes to this step: the keeper's words, a
     * foe's, or what the shinobi sees. A step's goal should be heard here in
     * someone's own words; `text` stays the plain instruction beneath it.
     */
    say?: readonly QuestSay[];
}

/** Stand near a named member of the cast and hear them out. */
export interface SpeakStage extends StageBase { kind: 'speak'; castId: string; place: QuestLinePlace }
/** Stand at a place: scout it, plant a mark, shadow someone to it. */
export interface ReachStage extends StageBase { kind: 'reach'; place: QuestLinePlace }
/** Do this step inside a named building, at its counter. */
export interface EnterStage extends StageBase {
    kind: 'enter';
    buildingId: string;
    /**
     * A clan quest only: the player's clan must hold a Landing of at least this
     * tier (api/coast/_landing-rules.ts; 0 is the staked plot) and it must be
     * active, not dormant. It is read from the Landing's own row.
     */
    landing?: { tier: number };
    /**
     * Things to find inside the building before the step passes, in order: each
     * is a station on one floor of the site's rooms (shared/coast-world.json,
     * `floors[floor].stations`, by name). The player examines them one at a time
     * (examineQuestLineClue); what is found is kept on the quest record, so it
     * survives leaving and coming back, and the step passes on the last one.
     * Standing at the door is never enough.
     */
    clues?: readonly QuestClue[];
}

/** One thing to find inside a building. `say` is what the shinobi learns there, joined from the script. */
export interface QuestClue { key: string; floor: number; station: string; say?: readonly QuestSay[] }

/** What a clan quest is told about the player's clan (api/quests/_clan-facts.ts). */
export interface QuestClanFacts {
    /** The clan's generation as the coast knows it. */
    generation: string;
    /** True once the player has been in the clan for the coast's member tenure. */
    tenured: boolean;
    /** The clan's Landing, when one stands. */
    landing?: { tier: number; active: boolean };
}
/** Hold `count` of a material that only the named quest sites yield. */
export interface GatherStage extends StageBase { kind: 'gather'; itemId: string; count: number; siteIds: readonly string[] }
/** Craft a quest recipe at a named building. */
export interface MakeStage extends StageBase { kind: 'make'; buildingId: string; recipeId: string }
/** Hand items over at a named building. They leave the backpack for good. */
export interface DeliverStage extends StageBase { kind: 'deliver'; buildingId: string; itemId: string; count: number }
/** Win a named fight that drops a quest item. Repeatable while the stage is open. */
export interface DropStage extends StageBase { kind: 'drop'; fightId: string; itemId: string; count: number }
/** Win a named fight. If the fight has a Hold, only its tool can end it. */
export interface BossStage extends StageBase {
    kind: 'boss';
    fightId: string;
    /**
     * An earlier choice changes who is fought: `stage` is that choice stage's
     * key and `fights` names a fight for an option. An option left out, and a
     * record with no such choice, get `fightId`. Every variant is fought in the
     * same sector and carries the same Holds (api/quests/_catalog-rules.ts).
     */
    fightByChoice?: { stage: string; fights: Readonly<Record<string, string>> };
}
/**
 * Pick one option. The choice is sealed and its effects apply at claim.
 *
 * With `answer` it is a question, not a decision: only that option passes the
 * step. A wrong pick is refused with `wrong`, a sentence said in the world, and
 * with `backTo` the quest steps back to that earlier stage so the clue has to be
 * read again. The clue is in the step's `say`; the journal never states the answer.
 * `forget` names the found clues (EnterStage.clues) a wrong answer takes away,
 * so the player has to look at those again; every other clue stays found.
 */
export interface ChoiceStage extends StageBase {
    kind: 'choice';
    choice: { prompt: string; options: readonly QuestLineChoiceOption[]; answer?: string; wrong?: string; backTo?: string; forget?: readonly string[] };
}

export type QuestLineStage =
    | SpeakStage | ReachStage | EnterStage | GatherStage | MakeStage
    | DeliverStage | DropStage | BossStage | ChoiceStage;

export type QuestLineStageKind = QuestLineStage['kind'];

export interface QuestLineGate {
    /** "level 75 or higher" */
    level: number;
    /** Quest lines that must be finished first. */
    quests?: readonly string[];
    /** Marks on the Coast Record needed before this can be accepted. */
    marks?: number;
    /** Coast region (1-5) the player must have opened. */
    region?: number;
    /** Needs clan membership. Clan stages pause if the player leaves that clan. */
    clan?: boolean;
}

export interface QuestLineRewards {
    /** Effort weight for the ryo curve (see questLineRyo). */
    weight: number;
    statPoints?: number;
    /** 0 or 1, as the Quest Book does. */
    fateShards?: number;
    boneCharms?: number;
    auraStones?: number;
    /** A server-credited title. */
    title?: string;
    /** Item ids granted once at claim (gear, cosmetics). */
    items?: readonly string[];
    /**
     * Journal pictures for what the quest gives beyond currency: a badge or a
     * named gear piece. The client owns the key-to-picture table
     * (shinobij.client/src/lib/coast-journal-art.ts); an unknown key shows nothing.
     */
    artKeys?: readonly string[];
    /**
     * Achievement ids this quest earns (api/achievements/_catalog.ts). At claim
     * they are written to the character's server-owned `coastBadges`, which is
     * the only thing the achievement rules read, so a client cannot claim one.
     */
    badges?: readonly string[];
    /**
     * A chance, in basis points (2,000 is 20 percent), that the claim also gives
     * one gear piece: a step item of the tier the player has unlocked, as a boss
     * or a clan cache drops (api/_gear-drops.ts). Rolled once, on the server.
     */
    gearChanceBp?: number;
    /** Coast region (1-5) this quest opens for the player. */
    opensRegion?: number;
    /** Named unlocks other systems read, such as 'boat' or 'contest-land'. */
    unlocks?: readonly string[];
}

export interface QuestLine {
    id: string;
    /** The series this belongs to, such as 'crossing-war'. */
    series: string;
    /** A 'tale' is a short side story worth no marks. */
    kind: 'quest' | 'tale';
    world: QuestLineWorld;
    tier: QuestLineTier;
    title: string;
    /** Marks added to the Coast Record at claim. */
    marks: number;
    /** The cast member who offers it. */
    giver: string;
    gate: QuestLineGate;
    stages: readonly QuestLineStage[];
    rewards: QuestLineRewards;
    /**
     * The quest's two framing scenes. `offer` is heard before it is taken: who
     * is asking, what they want and why it matters to them. `done` is heard when
     * every step is passed, before the reward is claimed.
     */
    scenes?: { offer: readonly QuestSay[]; done: readonly QuestSay[] };
}

/** A quest recipe. Lives with the quests, never in the Crafter. */
export interface QuestLineRecipe {
    id: string;
    inputs: readonly { itemId: string; count: number }[];
    output: { itemId: string; count: number };
}

/** A sealed fight a quest stage starts. */
export interface QuestLineFight {
    id: string;
    /** The cast member being fought. */
    castId: string;
    /** The sector the fight happens in. The player must be standing there. */
    sector: number;
    /** Added to the player's level for the foe's level. */
    levelOffset: number;
    /** Flat stat bonus on the same scale Quest Book bosses use (2 for a brute, 8 for a capstone). */
    statBonus: number;
    /** AI loadout the foe fights with: one the world fights already build. */
    loadoutId: 'bruiser' | 'boss' | 'burst' | 'defender';
    /**
     * The Hold. While it stands the foe cannot fall; using the named tool in
     * the fight breaks it. The fight will not start unless the player holds one.
     *
     * `next` chains Holds: each rises as the one before it breaks, and each is
     * broken by its own tool. The fight will not start unless the player holds
     * every tool in the chain.
     */
    hold?: { breakerItemId: string; name: string; next?: readonly { breakerItemId: string; name: string }[] };
    /**
     * The forms this foe takes as its health falls (shared/boss-transformations.ts):
     * a cut-scene and one mechanic the player has to answer. Joined on from
     * api/quests/_coast-boss-forms.ts by the foe's cast id, and sealed into the
     * fight when it starts. A form and a Hold are separate rules: the Hold decides
     * whether the foe can fall, a form decides how it fights.
     */
    forms?: import('../../shared/boss-transformations.js').BossTransformationPlan;
}

/**
 * The fight a `drop` or `boss` stage calls for, given the choices sealed so far.
 * Every reader of a stage's fight goes through this, so the journal, the fight
 * start and the settlement always name the same one.
 */
export function questStageFightId(stage: DropStage | BossStage, choices?: Readonly<Record<string, string>> | null): string {
    if (stage.kind !== 'boss' || !stage.fightByChoice) return stage.fightId;
    const picked = choices?.[stage.fightByChoice.stage];
    return picked !== undefined && Object.hasOwn(stage.fightByChoice.fights, picked) ? stage.fightByChoice.fights[picked] : stage.fightId;
}

/** Every fight a stage can call for: its own, then each choice variant. */
export function questStageFightIds(stage: DropStage | BossStage): string[] {
    return stage.kind === 'boss' && stage.fightByChoice ? [...new Set([stage.fightId, ...Object.values(stage.fightByChoice.fights)])] : [stage.fightId];
}

/** Every Hold of a fight, in the order they must be broken. Empty when it has none. */
export function questFightHolds(fight: QuestLineFight | undefined): { breakerItemId: string; name: string }[] {
    return fight?.hold ? [{ breakerItemId: fight.hold.breakerItemId, name: fight.hold.name }, ...(fight.hold.next ?? [])] : [];
}
