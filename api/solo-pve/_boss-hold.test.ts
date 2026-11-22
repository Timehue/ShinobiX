import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter } from '../pvp/session.js';
import { applySoloPveAction } from './_engine.js';
import { bossHoldStands, isBossHoldBreaker, sealBossHold } from './_boss-hold.js';
import { questToolEquipmentKey, sealQuestFightKit } from './_quest-kit.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';

/*
 * The Hold: a quest boss cannot fall until the player uses the one quest tool
 * that breaks it. These run the real engine, so they also prove the rule is
 * reached by every path a fight can end on.
 */

const NOW = 1_800_000_000_000;
const TOOL = { id: 'quest-signal-shard', name: 'Stormglass Signal Shard', slot: 'thrown', weaponEp: 15 };
const KUNAI = { id: 'test-kunai', name: 'Test Kunai', slot: 'thrown', weaponEp: 15 };

function makeFighter(name: string, pos: number, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 1_000, maxHp: 1_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        shield: 0, statuses: [], pos,
        character: {
            level: 100, specialty: 'Taijutsu',
            stats: { taijutsuOffense: 1_200, taijutsuDefense: 600 },
            jutsu: [],
            pvpItems: [TOOL, KUNAI],
            equipment: { thrown: KUNAI.id, questTool: TOOL.id },
        },
        ...over,
    };
}

/** A fight against a boss one blow from falling. */
function fight(options: { hold?: boolean; charges?: Record<string, number>; enemyHp?: number } = {}): SoloPveSession {
    const session = createSoloPveSession({
        sessionId: 'hold-test', ownerSlug: 'alice',
        encounter: { kind: 'generic-ai', id: 'quest-boss', level: 20 },
        player: makeFighter('Alice', 62),
        enemy: makeFighter('The Runner', 63, {
            hp: options.enemyHp ?? 5, maxHp: 2_000,
            character: { level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 100, taijutsuDefense: 100 }, jutsu: [], pvpItems: [], equipment: {} },
        }),
        now: NOW,
        difficultyEnemyLevel: 20,
        itemCharges: options.charges ?? { [TOOL.id]: 2, [KUNAI.id]: 2 },
    });
    if (options.hold !== false) sealBossHold(session, { breakerItemId: TOOL.id, name: 'Smoke Hold' });
    return session;
}

describe('the Hold', () => {
    it('leaves every other fight exactly as it was: a killing blow ends it', () => {
        const done = applySoloPveAction(fight({ hold: false }), { type: 'basicAttack' }).session;
        assert.deepEqual([done.status, done.winner, done.outcome], ['done', 'player', 'win']);
    });

    it('keeps the boss on 1 HP when a blow would end the fight', () => {
        const held = applySoloPveAction(fight(), { type: 'basicAttack' }).session;
        assert.equal(held.status, 'active');
        assert.equal(held.enemy.hp, 1);
        assert.equal(bossHoldStands(held), true);
        assert.ok(held.log.some(line => line === 'The Runner will not fall while the Smoke Hold stands.'), held.log.join(' | '));
    });

    it('is not broken by any other item', () => {
        const thrown = applySoloPveAction(fight(), { type: 'weapon', itemId: KUNAI.id });
        assert.equal(thrown.applied, true, String(thrown.reason));
        assert.equal(thrown.session.status, 'active');
        assert.equal(thrown.session.enemy.hp, 1);
        assert.equal(bossHoldStands(thrown.session), true);
    });

    it('breaks when the tool is used, and that same hit can end the fight', () => {
        const thrown = applySoloPveAction(fight(), { type: 'weapon', itemId: TOOL.id });
        assert.equal(thrown.applied, true, String(thrown.reason));
        const { session } = thrown;
        assert.equal(bossHoldStands(session), false);
        assert.deepEqual([session.status, session.winner], ['done', 'player']);
        const broke = session.log.indexOf('The Smoke Hold breaks.');
        const won = session.log.indexOf('Alice wins.');
        assert.ok(broke >= 0 && won > broke, `the Hold must break before the win is called: ${session.log.join(' | ')}`);
        assert.equal(session.itemCharges[TOOL.id], 1, 'one charge spent');
        assert.equal(session.itemsUsed[TOOL.id], 1, 'and recorded for settlement to debit');
    });

    it('stays broken: after the tool, ordinary blows finish the boss', () => {
        const opened = applySoloPveAction(fight({ enemyHp: 1_900 }), { type: 'weapon', itemId: TOOL.id }).session;
        assert.equal(bossHoldStands(opened), false);
        assert.equal(opened.status, 'active', 'the boss had too much health for one hit');
        const low = { ...opened, enemy: { ...opened.enemy, hp: 3 }, ap: { ...opened.ap, player: 100 } };
        const done = applySoloPveAction(low, { type: 'basicAttack' }).session;
        assert.deepEqual([done.status, done.winner], ['done', 'player']);
    });

    it('refuses the tool when no charge was sealed for it, where any other item would be unlimited', () => {
        const unsealed = fight({ charges: {} });
        const tool = applySoloPveAction(unsealed, { type: 'weapon', itemId: TOOL.id });
        assert.deepEqual([tool.applied, tool.reason], [false, 'out-of-item']);
        assert.equal(bossHoldStands(tool.session), true);
        assert.equal(applySoloPveAction(unsealed, { type: 'weapon', itemId: KUNAI.id }).applied, true, 'the long-standing rule for other items is untouched');
    });

    it('refuses the tool once its charges are spent', () => {
        const empty = fight({ charges: { [TOOL.id]: 0 } });
        assert.deepEqual([applySoloPveAction(empty, { type: 'weapon', itemId: TOOL.id }).reason], ['out-of-item']);
    });

    it('lets a double knockout stand as a draw, as the boss-form guard does', () => {
        const session = fight();
        session.player = { ...session.player, hp: 0 };
        session.enemy = { ...session.enemy, hp: 0 };
        const done = applySoloPveAction(session, { type: 'wait' }).session;
        assert.equal(done.status, 'done');
        assert.notEqual(done.winner, 'player', 'an unbroken Hold is never a win');
    });
});

describe('Holds in sequence', () => {
    const VIAL = 'quest-woundroot-vial', INK = 'quest-clouding-ink';
    const ORDER = 'quest-stand-down-order', SNARE = 'quest-pact-cutter-snare', SENBON = 'quest-ember-senbon';
    /** A boss one blow from falling, sealed with the real quest kit. */
    function chained(first: { breakerItemId: string; name: string }, ...next: Array<{ breakerItemId: string; name: string }>): SoloPveSession {
        const session = fight({ hold: false, charges: {} });
        sealQuestFightKit(session, { ...first, charges: 2, next: next.map(link => ({ ...link, charges: 2 })) });
        return session;
    }
    /** Give the player a full turn again: these tests are about the Hold, not the action economy. */
    const rested = (session: SoloPveSession): SoloPveSession => ({ ...session, ap: { ...session.ap, player: 100 } });
    const twin = () => chained({ breakerItemId: VIAL, name: 'Bitter Tide' }, { breakerItemId: INK, name: 'Mirror Hold' });

    it('hands the player every tool of the chain, each under its own key and with its own charges', () => {
        const session = twin();
        const equipment = session.player.character.equipment as Record<string, unknown>;
        assert.deepEqual([equipment.questTool, equipment.questTool2, equipment.questTool3], [VIAL, INK, undefined]);
        assert.deepEqual([questToolEquipmentKey(0), questToolEquipmentKey(1), questToolEquipmentKey(2)], ['questTool', 'questTool2', 'questTool3']);
        assert.deepEqual([session.itemCharges[VIAL], session.itemCharges[INK]], [2, 2]);
        assert.deepEqual(session.bossHold, { breakerItemId: VIAL, name: 'Bitter Tide', broken: false, next: [{ breakerItemId: INK, name: 'Mirror Hold' }] });
        assert.deepEqual([isBossHoldBreaker(session, VIAL), isBossHoldBreaker(session, INK), isBossHoldBreaker(session, KUNAI.id)], [true, true, false]);
    });

    it('raises the second Hold as the first breaks, so the blow that broke the first cannot end the fight', () => {
        const held = applySoloPveAction(twin(), { type: 'basicAttack' }).session;
        assert.equal(held.status, 'active');
        assert.ok(held.log.includes('The Runner will not fall while the Bitter Tide stands.'), held.log.join(' | '));

        const first = applySoloPveAction(rested(held), { type: 'weapon', itemId: VIAL });
        assert.equal(first.applied, true, String(first.reason));
        assert.equal(first.session.status, 'active', 'the vial\'s own hit cannot finish it');
        assert.equal(first.session.enemy.hp, 1);
        assert.deepEqual(first.session.bossHold && [first.session.bossHold.name, first.session.bossHold.breakerItemId, first.session.bossHold.broken, first.session.bossHold.next], ['Mirror Hold', INK, false, undefined]);
        assert.ok(first.session.log.includes('The Bitter Tide breaks. The Mirror Hold rises.'), first.session.log.join(' | '));
        assert.equal(bossHoldStands(first.session), true);

        // An ordinary blow still cannot end it, and says which Hold stands now.
        const stillHeld = applySoloPveAction(rested(first.session), { type: 'basicAttack' }).session;
        assert.equal(stillHeld.status, 'active');
        assert.ok(stillHeld.log.includes('The Runner will not fall while the Mirror Hold stands.'), stillHeld.log.join(' | '));

        const second = applySoloPveAction(rested(stillHeld), { type: 'weapon', itemId: INK });
        assert.equal(second.applied, true, String(second.reason));
        assert.deepEqual([second.session.status, second.session.winner, bossHoldStands(second.session)], ['done', 'player', false]);
        assert.deepEqual([second.session.itemsUsed[VIAL], second.session.itemsUsed[INK]], [1, 1], 'both tools are recorded for the backpack debit');
    });

    it('is broken in order: the second tool does nothing to the first Hold', () => {
        const wrong = applySoloPveAction(twin(), { type: 'weapon', itemId: INK });
        assert.equal(wrong.applied, true, String(wrong.reason));
        assert.deepEqual([wrong.session.status, wrong.session.bossHold?.name, wrong.session.bossHold?.next?.length], ['active', 'Bitter Tide', 1]);
        assert.equal(wrong.session.itemCharges[INK], 1, 'and the charge is spent all the same');
    });

    it('refuses a later Hold\'s tool when no charge was sealed for it', () => {
        const session = twin();
        delete session.itemCharges[INK];
        assert.deepEqual([applySoloPveAction(session, { type: 'weapon', itemId: INK }).reason], ['out-of-item']);
    });

    it('a tool that is shown breaks its Hold and does nothing else: it does not heal the one who shows it', () => {
        for (const start of [
            chained({ breakerItemId: ORDER, name: 'Oath Guard' }),
            chained({ breakerItemId: ORDER, name: 'Oath Guard' }, { breakerItemId: SNARE, name: 'Beast Bond' }),
        ]) {
            const hurt = { ...start, player: { ...start.player, hp: 400 } };
            const shown = applySoloPveAction(hurt, { type: 'item', itemId: ORDER });
            assert.equal(shown.applied, true, String(shown.reason));
            assert.equal(shown.session.player.hp, 400, 'a forged order closes no wounds');
            assert.ok(shown.session.log.includes('Alice uses Forged Stand-Down Order.'), shown.session.log.join(' | '));
            assert.equal(shown.session.itemCharges[ORDER], 1);
            assert.ok(shown.session.log.some(line => line.startsWith('The Oath Guard breaks.')));
        }
    });

    it('runs three deep: an order shown, a snare thrown, a senbon thrown', () => {
        const start = chained({ breakerItemId: ORDER, name: 'Oath Guard' }, { breakerItemId: SNARE, name: 'Beast Bond' }, { breakerItemId: SENBON, name: 'Rime Lock' });
        const shown = applySoloPveAction(start, { type: 'item', itemId: ORDER });
        assert.equal(shown.applied, true, String(shown.reason));
        assert.deepEqual([shown.session.status, shown.session.bossHold?.name, shown.session.bossHold?.next], ['active', 'Beast Bond', [{ breakerItemId: SENBON, name: 'Rime Lock' }]]);
        const snared = applySoloPveAction(rested(shown.session), { type: 'weapon', itemId: SNARE });
        assert.equal(snared.applied, true, String(snared.reason));
        assert.deepEqual([snared.session.status, snared.session.bossHold?.name, snared.session.bossHold?.next], ['active', 'Rime Lock', undefined]);
        const split = applySoloPveAction(rested(snared.session), { type: 'weapon', itemId: SENBON });
        assert.equal(split.applied, true, String(split.reason));
        assert.deepEqual([split.session.status, split.session.winner], ['done', 'player']);
        assert.deepEqual(split.session.log.filter(line => / breaks/.test(line)), [
            'The Oath Guard breaks. The Beast Bond rises.', 'The Beast Bond breaks. The Rime Lock rises.', 'The Rime Lock breaks.',
        ]);
    });
});
