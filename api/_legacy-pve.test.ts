import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSoloPveLegacyDeltas, extractTowerLegacyDeltas } from './_legacy-pve.js';
import { projectAuthoritativeCombatEvent, type CombatProjectionSnapshot } from './combat-core/events.js';
import { extractPvpLegacyDeltas } from './_legacy-pvp.js';
import { applyJutsu } from './pvp/move.js';
import type { PvpFighter } from './pvp/session.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import type { TowerSession } from './towers/_tower-session.js';

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
