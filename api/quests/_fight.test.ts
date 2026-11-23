import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import {
    applyWorldAiDurableProgression,
    buildWorldAiFightSpec,
    cleanWorldAiFightRequest,
} from '../missions/_world-ai-fight.js';
import { applyQuestFightWin, questFightSealVersion, questFightStart, questResupplySealVersion } from './_fight.js';
import { parseQuestLines } from './_record.js';
import { countOwned } from '../craft/_forge.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { bossHoldStands } from '../solo-pve/_boss-hold.js';
import { QUEST_TOOL_EQUIPMENT_KEY, sealQuestFightKit } from '../solo-pve/_quest-kit.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import type { PvpFighter } from '../pvp/session.js';

/*
 * A quest line's fights, against the SHIPPED catalogue: the first quest's
 * lookouts (a drop) and its chart runner (a Hold), and the coast's gate captain.
 * These prove the fight is built from the stored quest stage, is refused
 * without its tool, and passes the stage exactly once.
 */

const SHARD = 'quest-signal-shard';

/** A save part-way through The Shuttered Boat. `stage` is the stage index the record sits on. */
function save(stage: number, options: { sector: number; stacks?: Array<{ itemId: string; count: number }>; at?: number } = { sector: 5 }) {
    return {
        currentSector: options.sector,
        questLines: { v: 1, done: {}, active: { 'shuttered-boat': { stage, at: options.at ?? 1_000 } } },
        character: { name: 'Holder', level: 50, village: 'Stormveil Village', inventory: [], itemStacks: options.stacks ?? [] },
    };
}
const request = (sector: number, sourceId = 'shuttered-boat') => cleanWorldAiFightRequest({ kind: 'quest-line', sourceId, sector })!;

// Stage indexes in The Shuttered Boat: 4 is the lookouts (drop), 7 is the runner (boss with a Hold).
// The runner is the ninth step: the tally's knots are read (a question) before he is followed.
const LOOKOUTS = 4, RUNNER = 8;

describe('asking to start a quest fight', () => {
    it('lets a quest fight, and only a quest fight, name a coast sector', () => {
        assert.equal(cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: 'first-footing', sector: 107 })?.sector, 107);
        assert.equal(cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: 'shuttered-boat', sector: 5 })?.sector, 5);
        assert.equal(cleanWorldAiFightRequest({ kind: 'wanderer', sourceId: 'w-1', sector: 107 }), null, 'no home encounter can start on the coast');
        assert.equal(cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: 'shuttered-boat', sector: 151 }), null);
        assert.equal(cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: 'shuttered-boat', sector: 5, stage: 7 }), null, 'the stage is never the client\'s to name');
    });

    it('builds the fight from the stored stage, wherever the client points', async () => {
        const spec = await buildWorldAiFightSpec({ playerName: 'holder', request: request(5), save: save(LOOKOUTS, { sector: 5 }) });
        assert.equal(spec.context.kind, 'quest-line');
        assert.deepEqual([spec.context.sourceId, spec.context.stage, spec.context.displayName], ['shuttered-boat', LOOKOUTS, "Runner's Lookout"]);
        assert.equal(spec.context.sealVersion, questFightSealVersion('shuttered-boat', LOOKOUTS, 1_000));
        assert.equal(spec.context.questHold, undefined, 'rank and file carry no Hold');
        assert.equal(spec.profile.level, 50, 'the lookouts fight at the player\'s level');
    });

    it('refuses a fight that is not the stage the record is on, or not where the player stands', async () => {
        const start = (stage: number, sector: number, requested = sector) =>
            buildWorldAiFightSpec({ playerName: 'holder', request: request(requested), save: save(stage, { sector }) });
        await assert.rejects(start(0, 5), /not a fight/, 'stage 0 is a visit to the boatwright');
        await assert.rejects(start(LOOKOUTS, 3), /not here/, 'the lookouts are in sector 5');
        await assert.rejects(start(LOOKOUTS, 5, 3), /world-sector-mismatch/, 'the save decides where the player is');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'holder', request: request(5, 'first-footing'), save: save(LOOKOUTS, { sector: 5 }) }), /not under way/);
    });

    it('will not start a Hold fight without the tool, and says what to make', async () => {
        const empty = save(RUNNER, { sector: 3 });
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'holder', request: request(3), save: empty }),
            /You need a Stormglass Signal Shard to break the Smoke Hold\. Make one first\./);
        const armed = save(RUNNER, { sector: 3, stacks: [{ itemId: SHARD, count: 3 }] });
        const spec = await buildWorldAiFightSpec({ playerName: 'holder', request: request(3), save: armed });
        assert.deepEqual(spec.context.questHold, { breakerItemId: SHARD, name: 'Smoke Hold', charges: 3 });
        assert.deepEqual([spec.context.displayName, spec.profile.level], ['Shiokaze', 51]);
    });
});

describe('winning a quest fight', () => {
    it('a drop passes the stage and puts the item in the backpack, once', () => {
        const stored = save(LOOKOUTS, { sector: 5 });
        const context = { kind: 'quest-line' as const, sourceId: 'shuttered-boat', sector: 5, stage: LOOKOUTS, displayName: 'x', sealVersion: questFightSealVersion('shuttered-boat', LOOKOUTS, 1_000) };
        const won = applyWorldAiDurableProgression(stored, stored.character, context, 'win', 2_000);
        assert.equal(countOwned(won.character, 'quest-runner-tally'), 1);
        const after = parseQuestLines((won.recordPatch as { questLines: unknown }).questLines);
        assert.deepEqual(after.active['shuttered-boat'], { stage: LOOKOUTS + 1, at: 2_000 });

        // The settlement is retried against the save it already wrote: nothing more happens.
        const next = { ...stored, questLines: (won.recordPatch as { questLines: unknown }).questLines, character: won.character };
        const again = applyWorldAiDurableProgression(next, won.character, context, 'win', 3_000);
        assert.equal(again.recordPatch, undefined);
        assert.equal(countOwned(again.character, 'quest-runner-tally'), 1);
    });

    it('nothing but a win passes a stage', () => {
        const stored = save(LOOKOUTS, { sector: 5 });
        const context = { kind: 'quest-line' as const, sourceId: 'shuttered-boat', sector: 5, stage: LOOKOUTS, displayName: 'x', sealVersion: questFightSealVersion('shuttered-boat', LOOKOUTS, 1_000) };
        for (const outcome of ['loss', 'draw', 'forfeit', 'unknown'] as const) {
            assert.equal(applyWorldAiDurableProgression(stored, stored.character, context, outcome).recordPatch, undefined, outcome);
        }
    });

    it('a win from an earlier attempt at the quest cannot pass a later one', () => {
        // The quest was abandoned and taken again: same stage number, a new seal.
        const retaken = save(LOOKOUTS, { sector: 5, at: 9_000 });
        const stale = applyQuestFightWin(retaken, retaken.character, { questId: 'shuttered-boat', stage: LOOKOUTS, sealVersion: questFightSealVersion('shuttered-boat', LOOKOUTS, 1_000) }, 9_500);
        assert.equal(stale.recordPatch, undefined);
        assert.equal(countOwned(stale.character, 'quest-runner-tally'), 0);
    });

    it('a boss win passes the stage and leaves the rest of the quest to be walked', () => {
        const stored = save(RUNNER, { sector: 3, stacks: [{ itemId: SHARD, count: 2 }] });
        const start = questFightStart(stored, 'shuttered-boat', 3);
        const won = applyQuestFightWin(stored, stored.character, { questId: 'shuttered-boat', stage: RUNNER, sealVersion: start.sealVersion }, 5_000);
        assert.equal(parseQuestLines((won.recordPatch as { questLines: unknown }).questLines).active['shuttered-boat'].stage, RUNNER + 1, 'the charts still have to be brought back');
    });
});

describe('a tool lost in a failed fight never strands the quest', () => {
    // First Footing: the patrol's seal (stage 2, a drop) goes into the order that breaks the captain's Oath Guard (stage 5).
    const PATROL = 2, CAPTAIN = 5, SEAL = 'quest-garrison-seal', ORDER = 'quest-stand-down-order';
    const footing = (stacks: Array<{ itemId: string; count: number }> = []) => ({
        currentSector: 107,
        questLines: { v: 1, done: {}, active: { 'first-footing': { stage: CAPTAIN, at: 4_000, took: true } } },
        character: { name: 'Holder', level: 50, village: 'Stormveil Village', inventory: [], itemStacks: stacks },
    });

    it('with no order and no seal, the patrol can be fought again where it always was', async () => {
        const spec = await buildWorldAiFightSpec({ playerName: 'holder', request: request(107, 'first-footing'), save: footing() });
        assert.deepEqual([spec.context.stage, spec.context.questHold], [PATROL, undefined], 'the patrol, with no Hold');
        assert.equal(spec.context.sealVersion, questResupplySealVersion('first-footing', PATROL, CAPTAIN, 4_000));
        assert.notEqual(spec.context.sealVersion, questFightSealVersion('first-footing', PATROL, 4_000), 'never a seal that could pass a stage');
    });

    it('that win gives the seal back, once, and the quest stays on the captain', () => {
        const stored = footing();
        const context = { kind: 'quest-line' as const, sourceId: 'first-footing', sector: 107, stage: PATROL, displayName: 'x', sealVersion: questResupplySealVersion('first-footing', PATROL, CAPTAIN, 4_000) };
        const won = applyWorldAiDurableProgression(stored, stored.character, context, 'win', 5_000);
        assert.equal(countOwned(won.character, SEAL), 1);
        assert.equal(won.recordPatch, undefined, 'no stage passes');
        const again = applyWorldAiDurableProgression({ ...stored, character: won.character }, won.character, context, 'win', 6_000);
        assert.equal(countOwned(again.character, SEAL), 1);
    });

    it('holding the seal, the player is told to make the order; holding the order, the captain is fought', async () => {
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'holder', request: request(107, 'first-footing'), save: footing([{ itemId: SEAL, count: 1 }]) }),
            /to break the Oath Guard\. Make one first\./);
        const spec = await buildWorldAiFightSpec({ playerName: 'holder', request: request(107, 'first-footing'), save: footing([{ itemId: ORDER, count: 1 }]) });
        assert.deepEqual([spec.context.stage, spec.context.questHold], [CAPTAIN, { breakerItemId: ORDER, name: 'Oath Guard', charges: 1 }]);
        assert.equal(spec.context.sealVersion, questFightSealVersion('first-footing', CAPTAIN, 4_000));
    });

    it('a resupply seal from an earlier attempt at the quest pays nothing', () => {
        const stored = footing();
        const stale = applyQuestFightWin(stored, stored.character, { questId: 'first-footing', stage: PATROL, sealVersion: questResupplySealVersion('first-footing', PATROL, CAPTAIN, 1) }, 5_000);
        assert.equal(countOwned(stale.character, SEAL), 0);
    });
});

describe('the fight is handed its tool', () => {
    function fighter(name: string, pos: number, over: Partial<PvpFighter> = {}): PvpFighter {
        return {
            name, hp: 1_000, maxHp: 1_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos,
            character: { level: 100, specialty: 'Taijutsu', stats: { taijutsuOffense: 1_200, taijutsuDefense: 600 }, jutsu: [], pvpItems: [], equipment: {} },
            ...over,
        };
    }
    const session = () => createSoloPveSession({
        sessionId: 'quest-kit', ownerSlug: 'holder', encounter: { kind: 'generic-ai', id: 'quest-boss', level: 20 },
        player: fighter('Holder', 62),
        enemy: fighter('Shiokaze', 63, { hp: 5, maxHp: 2_000, character: { level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 100, taijutsuDefense: 100 }, jutsu: [], pvpItems: [], equipment: {} } }),
        now: 1_800_000_000_000, difficultyEnemyLevel: 20,
    });

    it('with the Hold sealed, its own equipment key, and the charges the player really holds', () => {
        const fight = session();
        sealQuestFightKit(fight, { breakerItemId: SHARD, name: 'Smoke Hold', charges: 2 });
        assert.equal((fight.player.character.equipment as Record<string, unknown>)[QUEST_TOOL_EQUIPMENT_KEY], SHARD);
        assert.equal(fight.itemCharges[SHARD], 2);
        assert.equal(bossHoldStands(fight), true);

        // A killing blow does not end it; the tool does, and its use is recorded for the backpack debit.
        const held = applySoloPveAction(fight, { type: 'basicAttack' }).session;
        assert.equal(held.status, 'active');
        const thrown = applySoloPveAction({ ...held, ap: { ...held.ap, player: 100 } }, { type: 'weapon', itemId: SHARD });
        assert.equal(thrown.applied, true, String(thrown.reason));
        assert.deepEqual([thrown.session.status, thrown.session.winner], ['done', 'player']);
        assert.equal(thrown.session.itemsUsed[SHARD], 1);
        assert.equal(thrown.session.itemCharges[SHARD], 1);
    });

    it('never more than the cap, never none, and never an ordinary item', () => {
        const capped = session();
        sealQuestFightKit(capped, { breakerItemId: SHARD, name: 'Smoke Hold', charges: 500 });
        assert.equal(capped.itemCharges[SHARD], 9);
        assert.throws(() => sealQuestFightKit(session(), { breakerItemId: SHARD, name: 'Smoke Hold', charges: 0 }), /without its tool/);
        assert.throws(() => sealQuestFightKit(session(), { breakerItemId: 'shop-shuriken', name: 'Smoke Hold', charges: 3 }), /not a quest item/);
    });
});
