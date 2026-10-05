import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSoloPveLegacyDeltas, extractTowerLegacyDeltas } from './_legacy-pve.js';
import { projectAuthoritativeCombatEvent, type CombatProjectionSnapshot } from './combat-core/events.js';
import { extractPvpLegacyDeltas } from './_legacy-pvp.js';
import { applyJutsu } from './pvp/move.js';
import type { PvpFighter } from './pvp/session.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import type { TowerSession } from './towers/_tower-session.js';
import { createSoloPveSession } from './solo-pve/_session.js';
import { applySoloPveAction } from './solo-pve/_engine.js';
import { appendSoloPveCombatEvent } from './solo-pve/_legacy-totals.js';

test('solo PvE uses applied HP, shield and damage facts, excluding overheal and companion damage', () => {
    const before: CombatProjectionSnapshot = {
        player: { hp: 95, maxHp: 100, chakra: 100, stamina: 100, shield: 0, pos: 1, statuses: [] },
        enemy: { hp: 100, maxHp: 100, chakra: 100, stamina: 100, shield: 10, pos: 2, statuses: [] },
        ap: { player: 100, enemy: 100 }, groundEffects: [], itemCharges: {}, itemsUsed: {},
    };
    const after = structuredClone(before);
    after.player.hp = 100; after.player.shield = 20; after.enemy.hp = 70; after.enemy.shield = 0;
    const combat = projectAuthoritativeCombatEvent({ runtime: 'solo-pve', mode: 'mission', sessionId: 'mission', sequence: 1,
        roundBefore: 1, roundAfter: 1, actor: 'player', target: 'enemy', actionType: 'jutsu', applied: true,
        before, after, resolution: { healing: 50 }, status: 'active', winner: null, outcome: null });
    const companion = { ...combat, actor: 'companion' as const, damage: combat.damage.map((d) => ({ ...d, source: 'companion' as const })), healing: [], shielding: [] };
    const session = { player: { character: { specialty: 'Genjutsu' } }, events: [{ combat }, { combat: companion }] } as unknown as SoloPveSession;
    assert.deepEqual(extractSoloPveLegacyDeltas(session), { genjutsuKills: 1, genjutsuDamage: 40, healingDone: 5, shieldsApplied: 1 });
});

test('real combat healing log and Legacy credit match applied HP, including full-health casts', () => {
    const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, pos: 40, shield: 0, statuses: [], jutsu: [],
        character: { level: 50, specialty: 'Ninjutsu', stats: { ninjutsu: 100, genjutsu: 100, taijutsu: 100, bukijutsu: 100, speed: 100, intelligence: 100, defense: 100 } },
    }) as unknown as PvpFighter;
    const jutsu = { id: 'legacy-applied-heal-test', name: 'Heal Test', type: 'Ninjutsu', element: 'none', method: 'SELF', ap: 40,
        masteryLevel: 50, range: 1, damage: 0, tags: [{ name: 'Heal' }] };
    for (const hp of [1000, 995, 500]) {
        const player = fighter('Healer', hp), enemy = fighter('Enemy', 1000);
        const outcome = applyJutsu(player, enemy, jutsu, 1, 'forest', 1);
        const credit = extractPvpLegacyDeltas({ p1: outcome.self, p2: outcome.opponent, log: outcome.lines }, 'Healer', 'Enemy');
        assert.equal(credit.winnerDeltas.healingDone ?? 0, outcome.self.hp - hp);
    }
});

test('Tower attribution respects multiple human and enemy casters', () => {
    const session = { actors: [
        { name: 'Ally', ownerSlug: 'ally', side: 'squad', ai: false, character: { specialty: 'Taijutsu' } },
        { name: 'Other', ownerSlug: 'other', side: 'squad', ai: false, character: { specialty: 'Ninjutsu' } },
        { name: 'Boss', ownerSlug: null, side: 'enemy', ai: true, character: {} },
    ], log: ['Ally uses Storm → Boss.', '40 damage to Boss.', 'Other uses Lightning → Boss.', '90 damage to Boss.',
        'Boss uses Claw → Ally.', '50 damage to Ally.', 'Ally uses Basic Heal, restoring 5 HP.',
        'Shield: Ally gains 20 shield.', "10 absorbed by Ally's shield."] } as unknown as TowerSession;
    assert.deepEqual(extractTowerLegacyDeltas(session, 'ally'), { taijutsuKills: 1, taijutsuDamage: 40, healingDone: 5, shieldsApplied: 1, damageBlocked: 10 });
    assert.equal(extractTowerLegacyDeltas(session, 'other').ninjutsuDamage, 90);
});

test('expired shield pools never count as damage dealt or damage blocked', () => {
    const combat = { applied: true, healing: [], shielding: [], damage: [
        { source: 'player', target: 'player', toHp: 0, toShield: 50 },
        { source: 'player', target: 'enemy', toHp: 0, toShield: 50 },
    ] };
    const session = { player: { name: 'Ally', character: { specialty: 'Genjutsu' } }, enemy: { name: 'Boss' },
        events: [{ combat, log: ["Ally's shield expires.", "Boss's shield expires."] }] } as unknown as SoloPveSession;
    assert.deepEqual(extractSoloPveLegacyDeltas(session), { genjutsuKills: 1 });
});

test('long solo fights retain lifetime applied credit after the 80-event window', () => {
    const fighter = (name: string, pos: number, hp: number) => ({ name, pos, hp, maxHp: 1_000_000,
        chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [],
        character: { level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 100, taijutsuDefense: 100 },
            jutsu: [], pvpItems: [], equipment: {} },
    }) as unknown as PvpFighter;
    let session = createSoloPveSession({ sessionId: 'legacy-long-fight', ownerSlug: 'alice',
        encounter: { kind: 'generic-ai', id: 'rival', level: 20 }, now: 1_800_000_000_000,
        player: fighter('Alice', 62, 500_000), enemy: fighter('Rival', 63, 1_000_000), difficultyEnemyLevel: 20 });
    session = applySoloPveAction(session, { type: 'basicHeal' }).session;
    const allEvents = new Map(session.events.map(event => [event.seq, event]));
    for (let i = 0; session.eventSeq < 95 && session.status === 'active' && i < 100; i++) {
        for (const action of [{ type: 'basicAttack' }, { type: 'wait' }] as const) {
            const result = applySoloPveAction(session, action);
            assert.equal(result.applied, true);
            session = result.session;
            for (const event of session.events) allEvents.set(event.seq, event);
        }
    }
    assert.equal(session.events.length, 80);
    assert.ok(session.eventSeq >= 95);
    const expected = extractSoloPveLegacyDeltas({ ...session, legacyTotals: undefined, events: [...allEvents.values()] }, 0);
    assert.equal(expected.healingDone, 100_000);
    assert.ok((expected.taijutsuDamage ?? 0) > 0);
    assert.deepEqual(extractSoloPveLegacyDeltas(session, 0), expected);
    assert.deepEqual(extractSoloPveLegacyDeltas(JSON.parse(JSON.stringify(session)), 0), expected, 'reconnect retains totals');
    const rejected = applySoloPveAction(session, { type: 'move', tile: -1 });
    assert.equal(rejected.applied, false);
    assert.deepEqual(rejected.session.legacyTotals, session.legacyTotals, 'rejected intents cannot add credit');
});

test('old sessions seed healing, shielding, blocked and dealt damage before eviction', () => {
    const combat = { applied: true,
        healing: [{ role: 'player', applied: 5 }], shielding: [{ role: 'player', applied: 20 }],
        damage: [{ source: 'enemy', target: 'player', toHp: 7, toShield: 10 },
            { source: 'player', target: 'enemy', toHp: 30, toShield: 4 }],
    };
    const event = { seq: 1, combat, log: ["10 absorbed by Alice's shield.", "4 absorbed by Rival's shield."] };
    const session = { player: { name: 'Alice', character: { specialty: 'Genjutsu' } }, enemy: { name: 'Rival' },
        events: [event], eventSeq: 1 } as unknown as SoloPveSession;
    const expected = extractSoloPveLegacyDeltas(session);
    const empty = { ...event, combat: { applied: true, healing: [], shielding: [], damage: [] }, log: [] };
    for (let seq = 2; seq <= 100; seq++) appendSoloPveCombatEvent(session, { ...empty, seq } as unknown as import('./solo-pve/_session.js').SoloPveCombatEvent);
    assert.equal(session.events.length, 80);
    assert.deepEqual(expected, { genjutsuKills: 1, genjutsuDamage: 34, healingDone: 5, shieldsApplied: 1, damageBlocked: 10 });
    assert.deepEqual(extractSoloPveLegacyDeltas(session), expected);
});
