import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { projectAuthoritativeCombatEvent, type CombatProjectionSnapshot } from './events.js';

function snapshot(): CombatProjectionSnapshot {
    return {
        player: { hp: 100, maxHp: 100, chakra: 50, stamina: 50, shield: 20, pos: 10, statuses: [] },
        enemy: { hp: 100, maxHp: 100, chakra: 50, stamina: 50, shield: 0, pos: 11, statuses: [] },
        ap: { player: 100, enemy: 100 },
        groundEffects: [],
        itemCharges: { kunai: 2 },
        itemsUsed: {},
    };
}

describe('authoritative combat event projection', () => {
    it('projects exact resource, shield, damage, movement, status, zone, and item facts', () => {
        const before = snapshot();
        const after = structuredClone(before);
        after.ap.player = 40;
        after.player.chakra = 35;
        after.player.stamina = 42;
        after.player.pos = 12;
        after.enemy.shield = 0;
        after.enemy.hp = 85;
        after.enemy.statuses.push({ name: 'Wound', kind: 'negative', rounds: 2, amount: 5 });
        after.groundEffects.push({ id: 'zone-1', owner: 'p1', name: 'Flame Zone', tiles: [11, 12], rounds: 2 });
        after.itemCharges.kunai = 1;
        after.itemsUsed.kunai = 1;
        const event = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'mission', sessionId: 'opaque-session', sequence: 7,
            roundBefore: 2, roundAfter: 2, actor: 'player', target: 'enemy', actionType: 'jutsu', actionId: 'flame',
            applied: true, before, after, status: 'active', winner: null, outcome: null,
        });
        assert.deepEqual(event.actorSpend, { ap: 60, hp: 0, chakra: 15, stamina: 8 });
        assert.equal(event.actors.find((actor) => actor.role === 'enemy')?.damageToHp, 15);
        assert.deepEqual(event.damage, [{ source: 'player', target: 'enemy', raw: 15, resolved: 15, toHp: 15, toShield: 0, capped: false }]);
        assert.deepEqual(event.actors.find((actor) => actor.role === 'player')?.movement, { from: 10, to: 12 });
        assert.equal(event.statusChanges[0]?.after[0]?.name, 'Wound');
        assert.equal(event.groundEffects.added[0]?.id, 'zone-1');
        assert.deepEqual(event.items, [{ id: 'kunai', chargeDelta: -1, usedDelta: 1 }]);
    });

    it('preserves resolver raw/final truth plus objective and lifecycle facts', () => {
        const before = snapshot();
        before.enemy.hp = 12;
        const after = structuredClone(before);
        after.enemy.hp = 0;
        const event = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'weekly-boss', sessionId: 'boss', sequence: 9,
            roundBefore: 4, roundAfter: 4, actor: 'player', target: 'enemy', actionType: 'jutsu', actionId: 'finisher',
            applied: true, before, after, resolution: { rawDamage: 70, resolvedDamage: 20 },
            objectives: [{ objectiveId: 'boss-health', kind: 'damage', amount: 12 }],
            status: 'done', winner: 'player', outcome: 'win',
        });
        assert.deepEqual(event.damage, [{ source: 'player', target: 'enemy', raw: 70, resolved: 20, toHp: 12, toShield: 0, capped: true }]);
        assert.deepEqual(event.objectives, [{ objectiveId: 'boss-health', kind: 'damage', amount: 12 }]);
        assert.deepEqual(event.lifecycle, [{ role: 'enemy', event: 'down' }]);
    });

    it('preserves both activation boundaries for gap-free status refreshes', () => {
        const before = snapshot();
        before.player.statuses = [{ name: 'Drain', kind: 'negative', rounds: 2, activeRound: 1 }];
        const after = structuredClone(before);
        after.player.statuses = [
            { name: 'Drain', kind: 'negative', rounds: 2, activeRound: 1, inactiveRound: 3 },
            { name: 'Drain', kind: 'negative', rounds: 2, activeRound: 3 },
        ];

        const event = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'mission', sessionId: 'refresh', sequence: 3,
            roundBefore: 2, roundAfter: 2, actor: 'enemy', target: 'player', actionType: 'jutsu', actionId: 'drain',
            applied: true, before, after, status: 'active', winner: null, outcome: null,
        });

        assert.deepEqual(event.statusChanges[0]?.after, after.player.statuses);
        assert.equal(event.statusChanges[0]?.after[0]?.inactiveRound, 3);
    });

    it('records summon, dismissal, and flee without leaking fighter identity', () => {
        const before = snapshot();
        const summoned = structuredClone(before);
        summoned.companion = { hp: 40, maxHp: 40, chakra: 0, stamina: 0, shield: 0, pos: 9, statuses: [] };
        const summon = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'mission', sessionId: 's', sequence: 1,
            roundBefore: 1, roundAfter: 1, actor: 'player', target: 'companion', actionType: 'summon', actionId: 'pet',
            applied: true, before, after: summoned, status: 'active', winner: null, outcome: null,
        });
        assert.deepEqual(summon.lifecycle, [{ role: 'companion', event: 'summon' }]);

        const dismissed = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'mission', sessionId: 's', sequence: 2,
            roundBefore: 1, roundAfter: 1, actor: 'companion', target: 'companion', actionType: 'companionWait', actionId: 'Phase End',
            applied: true, before: summoned, after: before, status: 'active', winner: null, outcome: null,
        });
        assert.deepEqual(dismissed.lifecycle, [{ role: 'companion', event: 'dismiss' }]);

        const fled = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'mission', sessionId: 's', sequence: 3,
            roundBefore: 1, roundAfter: 1, actor: 'player', target: null, actionType: 'flee',
            applied: true, before, after: before, status: 'done', winner: 'enemy', outcome: 'fled',
        });
        assert.deepEqual(fled.lifecycle, [{ role: 'player', event: 'flee' }]);
    });

    it('is privacy-bounded and sanitizes non-finite or oversized source data', () => {
        const before = snapshot();
        const after = snapshot();
        after.player.hp = Number.POSITIVE_INFINITY;
        after.player.statuses = Array.from({ length: 100 }, (_, index) => ({ name: `status-${index}`, kind: 'positive', rounds: 1 }));
        const event = projectAuthoritativeCombatEvent({
            runtime: 'solo-pve', mode: 'generic-ai', sessionId: 's'.repeat(300), sequence: 1,
            roundBefore: 1, roundAfter: 1, actor: 'player', target: 'enemy', actionType: 'wait',
            applied: false, rejectionReason: 'x'.repeat(200), before, after, status: 'active', winner: null, outcome: null,
        });
        assert.equal(event.sessionId.length, 128);
        assert.equal(event.rejectionReason?.length, 80);
        assert.equal(event.statusChanges[0]?.after.length, 64);
        assert.ok(Number.isFinite(event.actors[0]?.after?.hp));
        const encoded = JSON.stringify(event);
        assert.doesNotMatch(encoded, /ownerSlug|playerName|character|password|token/i);
    });
});
