/*
 * Where a quest line meets the fight system.
 *
 * A quest's `drop` and `boss` stages are fights. The client asks to start one by
 * naming the quest and nothing else; everything about the fight comes from the
 * server's own copies:
 *   - which fight it is: the stage the player's STORED quest record is on;
 *   - where: the fight's own sector, which must be where the save says they are;
 *   - whether it may start: a boss with a Hold needs the tool in the backpack;
 *   - how it ends: a win passes the stage inside the fight's own save write.
 *
 * The stage seal (`<quest>:<stage>:<sealed-at>`) rides in the fight token. A
 * win is applied only while the record still carries that exact seal, so a
 * fight started under an earlier attempt at the quest cannot pass a later one,
 * and a settlement that is retried passes the stage once.
 *
 * One fight is not the stage the record is on: a resupply. A boss with a Hold
 * cannot be fought without its tool, and a tool can be spent in a fight that is
 * then lost. If its recipe needs an item only an earlier fight drops, that
 * fight opens again, so no quest can be left unfinishable. It pays the dropped
 * item back and passes nothing.
 *
 * Pure apart from reading the active catalogue: no KV, auth or locks.
 */
import { countOwned } from '../craft/_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { coastCastMember } from '../../shared/coast-cast.js';
import { activeQuestCatalogue } from './_active-catalogue.js';
import { questResupplyDrop, resupplyQuestLineDrop, settleQuestLineFight } from './_engine.js';
import { parseQuestLines, questLinesForStorage } from './_record.js';
import { questFightHolds, questStageFightId, type QuestLineFight } from './_types.js';

type Character = Record<string, unknown>;

export interface QuestFightStart {
    questId: string;
    fight: QuestLineFight;
    /** The stage index the fight belongs to. */
    stage: number;
    /** `<quest>:<stage>:<sealed-at>`: ties the fight to this exact attempt at the stage. */
    sealVersion: string;
    /** Who the player is told they are fighting. */
    displayName: string;
    /** Set when the fight has a Hold: the tool, and how many the player holds. `next` is the rest of a chain. */
    hold?: { breakerItemId: string; name: string; charges: number; next?: Array<{ breakerItemId: string; name: string; charges: number }> };
}

export function questFightSealVersion(questId: string, stage: number, sealedAt: number): string {
    return `${questId}:${stage}:${sealedAt}`;
}

/**
 * The seal of a resupply fight: an earlier drop stage fought again while the
 * quest sits on `activeStage`. It can never equal a stage's own seal, so a
 * resupply win can never pass a stage.
 */
export function questResupplySealVersion(questId: string, dropStage: number, activeStage: number, sealedAt: number): string {
    return `${questId}:${dropStage}:${sealedAt}:resupply:${activeStage}`;
}

/**
 * Work out the fight the player's stored quest stage calls for. Throws a
 * sentence the player can read when the fight cannot start: the route shows a
 * thrown message as it is.
 */
export function questFightStart(save: Record<string, unknown>, questId: string, requestSector: number): QuestFightStart {
    const catalogue = activeQuestCatalogue();
    const line = Object.hasOwn(catalogue.lines, questId) ? catalogue.lines[questId] : undefined;
    const active = parseQuestLines(save.questLines).active[questId];
    if (!line || !active) throw new Error('That quest is not under way.');
    const stage = line.stages[active.stage];
    if (!stage || (stage.kind !== 'drop' && stage.kind !== 'boss')) throw new Error('This part of the quest is not a fight.');
    // An earlier choice can change who is fought; the sealed choices decide.
    const fight = catalogue.fights[questStageFightId(stage, active.choices)];
    if (!fight) throw new Error('That fight could not be found.');
    const character = (save.character ?? {}) as Character;

    // The tool is gone and its recipe needs something only an earlier fight
    // drops: that fight is open again, where it always was. The server picks
    // it; the client still names nothing but the quest.
    const holds = questFightHolds(fight);
    // The first tool of the chain the player holds none of, if any.
    const missing = holds.find(hold => countOwned(character, hold.breakerItemId) < 1);
    if (missing) {
        const supply = questResupplyDrop({ catalogue }, line, active, character, missing.breakerItemId);
        const supplyFight = supply ? catalogue.fights[supply.stage.fightId] : undefined;
        if (supply && supplyFight?.sector === requestSector) {
            return {
                questId,
                fight: supplyFight,
                stage: supply.index,
                sealVersion: questResupplySealVersion(questId, supply.index, active.stage, active.at),
                displayName: coastCastMember(supplyFight.castId)?.name ?? 'Quest foe',
            };
        }
    }
    if (fight.sector !== requestSector) throw new Error('That fight is not here. Travel to where the quest sends you.');

    const start: QuestFightStart = {
        questId,
        fight,
        stage: active.stage,
        sealVersion: questFightSealVersion(questId, active.stage, active.at),
        displayName: coastCastMember(fight.castId)?.name ?? 'Quest foe',
    };
    if (holds.length) {
        // Without a tool its Hold could never be broken and the fight could
        // never be won, so it does not start. The player keeps their vitals.
        // A chain needs every tool in hand before the first blow.
        if (missing) {
            const tool = ITEM_CATALOG[missing.breakerItemId]?.name ?? 'the quest tool';
            throw new Error(`You need a ${tool} to break the ${missing.name}. Make one first.`);
        }
        const [first, ...rest] = holds.map(hold => ({ ...hold, charges: countOwned(character, hold.breakerItemId) }));
        start.hold = { ...first, ...(rest.length ? { next: rest } : {}) };
    }
    return start;
}

/**
 * Apply a quest fight the server has settled as a win. Called inside that
 * settlement's save write. Answers with the character and record patch to
 * commit, or with the character untouched when the win is stale.
 */
export function applyQuestFightWin(
    record: Record<string, unknown>,
    character: Character,
    win: { questId: string; stage: number; sealVersion: string },
    now: number,
): { character: Character; recordPatch?: Record<string, unknown> } {
    const catalogue = activeQuestCatalogue();
    const lines = parseQuestLines(record.questLines);
    const active = lines.active[win.questId];
    const line = Object.hasOwn(catalogue.lines, win.questId) ? catalogue.lines[win.questId] : undefined;
    const stage = line?.stages[win.stage];
    if (!active || !stage || (stage.kind !== 'drop' && stage.kind !== 'boss')) return { character };
    if (questResupplySealVersion(win.questId, win.stage, active.stage, active.at) === win.sealVersion) {
        // An earlier drop fought again for a lost ingredient. No stage passes.
        const resupplied = resupplyQuestLineDrop({ catalogue }, lines, character, { questId: win.questId, dropStage: win.stage, fightId: stage.fightId });
        return { character: resupplied.ok && resupplied.character ? resupplied.character : character };
    }
    if (questFightSealVersion(win.questId, active.stage, active.at) !== win.sealVersion) return { character };
    const decision = settleQuestLineFight({ catalogue }, lines, character, {
        questId: win.questId, stage: win.stage, sealedAt: active.at, fightId: questStageFightId(stage, active.choices), now,
    });
    if (!decision.ok || !decision.record) return { character };
    return {
        character: decision.character ?? character,
        recordPatch: { questLines: questLinesForStorage(decision.record, record.questLines) },
    };
}
