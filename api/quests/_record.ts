/*
 * The player's quest-line record: the top-level `questLines` field on a save.
 *
 * It is server-owned (`ledger-toplevel` in api/save/_state-ownership.ts), so
 * the stored copy always wins over anything a generic save sends. Only
 * api/quests/lines.ts and the fight settlement write it.
 *
 * Marks are stored on each finished quest at claim. A later edit to the
 * catalogue therefore never changes a player's total, and never closes a
 * region they already opened. Unknown ids are kept: content removed from the
 * catalogue must not erase what a player earned.
 *
 * Pure: no KV, auth or locks.
 */
import { MAX_ACTIVE_QUEST_LINES, type QuestLine } from './_types.js';

export const QUEST_LINES_VERSION = 1;

/** One quest line under way. */
export interface ActiveQuestLine {
    /** Index of the stage the player is on. */
    stage: number;
    /** When this stage was sealed. Part of a fight proof's identity. */
    at: number;
    /** Sealed branch choices, by stage key. */
    choices?: Record<string, string>;
    /** Units already handed in at a deliver stage, by stage key. */
    delivered?: Record<string, number>;
    /** Quest-site attempts used, by site id, with the refill clock. */
    sites?: Record<string, { used: number; refillAt: number }>;
    /** The clan generation this clan quest was accepted under. */
    clanGeneration?: string;
    /** Set once a stage has taken items for good. The quest can no longer be abandoned. */
    took?: boolean;
    /** Clues found inside buildings (EnterStage.clues), by key, in the order they were found. */
    found?: string[];
}

/** One finished quest line. Never trimmed. */
export interface DoneQuestLine {
    /** This claim completed the ten coast side tales. */
    completedTales?: boolean;
    at: number;
    marks: number;
    choices?: Record<string, string>;
    /** Coast region the quest opened, copied from the catalogue at claim. */
    opensRegion?: number;
    /** Named unlocks, copied from the catalogue at claim. */
    unlocks?: string[];
    /** The gear piece the quest's drop chance gave at claim, when it gave one. */
    gear?: string;
}

export interface QuestLinesRecord {
    v: number;
    active: Record<string, ActiveQuestLine>;
    done: Record<string, DoneQuestLine>;
}

export function emptyQuestLines(): QuestLinesRecord {
    return { v: QUEST_LINES_VERSION, active: {}, done: {} };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const wholeAtLeastZero = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** Ids are catalogue keys: lowercase letters, digits and hyphens. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function stringMap(raw: unknown): Record<string, string> | undefined {
    if (!isObject(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value;
    return Object.keys(out).length ? out : undefined;
}

function countMap(raw: unknown): Record<string, number> | undefined {
    if (!isObject(raw)) return undefined;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        const n = wholeAtLeastZero(value);
        if (n !== null && n > 0) out[key] = n;
    }
    return Object.keys(out).length ? out : undefined;
}

function parseActive(raw: unknown): ActiveQuestLine | null {
    if (!isObject(raw)) return null;
    const stage = wholeAtLeastZero(raw.stage);
    const at = wholeAtLeastZero(raw.at);
    if (stage === null || at === null) return null;
    const active: ActiveQuestLine = { stage, at };
    const choices = stringMap(raw.choices);
    if (choices) active.choices = choices;
    const delivered = countMap(raw.delivered);
    if (delivered) active.delivered = delivered;
    if (isObject(raw.sites)) {
        const sites: Record<string, { used: number; refillAt: number }> = {};
        for (const [siteId, value] of Object.entries(raw.sites)) {
            if (!isObject(value)) continue;
            const used = wholeAtLeastZero(value.used);
            const refillAt = wholeAtLeastZero(value.refillAt);
            if (used !== null && refillAt !== null) sites[siteId] = { used, refillAt };
        }
        if (Object.keys(sites).length) active.sites = sites;
    }
    if (typeof raw.clanGeneration === 'string' && raw.clanGeneration) active.clanGeneration = raw.clanGeneration;
    if (raw.took === true) active.took = true;
    if (Array.isArray(raw.found)) {
        const found = [...new Set(raw.found.filter((key): key is string => typeof key === 'string' && ID.test(key)))].slice(0, 32);
        if (found.length) active.found = found;
    }
    return active;
}

function parseDone(raw: unknown): DoneQuestLine | null {
    if (!isObject(raw)) return null;
    const at = wholeAtLeastZero(raw.at);
    const marks = wholeAtLeastZero(raw.marks);
    if (at === null || marks === null) return null;
    const done: DoneQuestLine = { at, marks };
    if (raw.completedTales === true) done.completedTales = true;
    const choices = stringMap(raw.choices);
    if (choices) done.choices = choices;
    const region = wholeAtLeastZero(raw.opensRegion);
    if (region !== null && region > 0) done.opensRegion = region;
    if (Array.isArray(raw.unlocks)) {
        const unlocks = raw.unlocks.filter((entry): entry is string => typeof entry === 'string' && !!entry);
        if (unlocks.length) done.unlocks = unlocks;
    }
    if (typeof raw.gear === 'string' && raw.gear) done.gear = raw.gear.slice(0, 80);
    return done;
}

/**
 * Read the record off a save. A missing or malformed field reads as empty, and
 * a malformed entry is dropped without touching its neighbours.
 */
export function parseQuestLines(raw: unknown): QuestLinesRecord {
    const record = emptyQuestLines();
    if (!isObject(raw)) return record;
    if (isObject(raw.done)) {
        for (const [id, value] of Object.entries(raw.done)) {
            const done = ID.test(id) ? parseDone(value) : null;
            if (done) record.done[id] = done;
        }
    }
    if (isObject(raw.active)) {
        for (const [id, value] of Object.entries(raw.active)) {
            // A quest cannot be both finished and under way; finished wins.
            if (!ID.test(id) || record.done[id]) continue;
            const active = parseActive(value);
            if (active) record.active[id] = active;
        }
    }
    return record;
}

/**
 * The shape to hand the save writer.
 *
 * The writer merges every object with the stored copy and keeps any key the
 * new value leaves out (mergePreservingImages in api/_utils.ts, which protects
 * partial payloads). So dropping a quest from `active` would not remove it:
 * the stored entry would come straight back, and a claimed quest would read as
 * both finished and under way. A removed quest is therefore written as an
 * explicit null, which the merge keeps and parseQuestLines drops. The same
 * holds for `done`, which only an admin reset ever removes from.
 */
export function questLinesForStorage(next: QuestLinesRecord, stored: unknown): Record<string, unknown> {
    const withTombstones = <T>(kept: Record<string, T>, before: unknown): Record<string, T | null> => {
        const out: Record<string, T | null> = { ...kept };
        for (const id of Object.keys(isObject(before) ? before : {})) {
            if (!Object.hasOwn(kept, id)) out[id] = null;
        }
        return out;
    };
    const was = isObject(stored) ? stored : {};
    return { v: next.v, active: withTombstones(next.active, was.active), done: withTombstones(next.done, was.done) };
}

/** Marks on the Coast Record: the sum stored on every finished quest. */
export function questLineMarks(record: QuestLinesRecord): number {
    let total = 0;
    for (const done of Object.values(record.done)) total += done.marks;
    return total;
}

/** The highest coast region the player has opened (0 before any). */
export function openedCoastRegion(record: QuestLinesRecord): number {
    let region = 0;
    for (const done of Object.values(record.done)) region = Math.max(region, done.opensRegion ?? 0);
    return region;
}

/** True once any finished quest granted the named unlock. */
export function hasQuestLineUnlock(record: QuestLinesRecord, unlock: string): boolean {
    return Object.values(record.done).some(done => done.unlocks?.includes(unlock));
}

export type QuestLineGateReason =
    | 'ok' | 'done' | 'active' | 'busy' | 'level' | 'quests' | 'marks' | 'region' | 'clan';

/**
 * Whether the player may accept this quest line now. Checked on the server at
 * accept; the client only uses the same answer to decide what to show.
 */
export function questLineGate(
    line: QuestLine,
    record: QuestLinesRecord,
    ctx: { level: number; inClan: boolean },
): QuestLineGateReason {
    if (record.done[line.id]) return 'done';
    if (record.active[line.id]) return 'active';
    if (Object.keys(record.active).length >= MAX_ACTIVE_QUEST_LINES) return 'busy';
    if (Math.floor(Number(ctx.level) || 0) < line.gate.level) return 'level';
    if ((line.gate.quests ?? []).some(id => !record.done[id])) return 'quests';
    if (questLineMarks(record) < (line.gate.marks ?? 0)) return 'marks';
    if (openedCoastRegion(record) < (line.gate.region ?? 0)) return 'region';
    if (line.gate.clan && !ctx.inClan) return 'clan';
    return 'ok';
}
