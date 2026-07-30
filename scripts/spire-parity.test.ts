import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPIRE_MAX_TIER as serverMaxTier,
    SPIRE_MILESTONE_FLOORS as serverMilestones,
    spireBossForFloor as serverBossForFloor,
    getSpireFloor,
} from '../api/towers/_spire-catalog';
import { resolveAscensionModifiers, type TowerModifierKind } from '../api/towers/_modifiers';
import {
    SPIRE_MAX_TIER as clientMaxTier,
    SPIRE_MILESTONE_FLOORS as clientMilestones,
    SPIRE_BOSS_BY_FLOOR as clientBossByFloor,
    SPIRE_BOSS_META as clientBossMeta,
    SPIRE_KEYSTONE_UNLOCKS as clientKeystones,
} from '../shinobij.client/src/lib/spire-catalog';

/*
 * Guards the server Spire catalog against its display-only client mirror
 * (shinobij.client/src/lib/spire-catalog.ts) — same drift class the clan
 * exchange suffered when a merge reverted only the client half (see
 * api/clan/_exchange-parity.test.ts). The client hardcodes the boss ladder,
 * milestones, and keystone tiers so the lobby renders the climb without a
 * round-trip; any drift shows players the wrong boss, wrong unlock floor, or
 * wrong modifier preview. Lives in scripts/ (like the other cross-tree parity
 * tests) because the server tsc build cannot compile client imports.
 */
describe('endless spire client mirror', () => {
    it('agrees on the ladder shape (max tier + milestone floors)', () => {
        assert.equal(clientMaxTier, serverMaxTier);
        assert.deepEqual(new Set(clientMilestones), serverMilestones);
    });

    it('assigns the same boss to every floor, with matching name and mechanic', () => {
        assert.equal(clientBossByFloor.length, serverMaxTier);
        for (let tier = 1; tier <= serverMaxTier; tier++) {
            const serverKey = serverBossForFloor(tier);
            assert.ok(serverKey, `server has no boss for floor ${tier}`);
            assert.equal(clientBossByFloor[tier - 1], serverKey, `floor ${tier} boss drifted`);
            const floor = getSpireFloor(tier);
            assert.ok(floor?.boss, `server builds no boss encounter for floor ${tier}`);
            const meta = clientBossMeta[serverKey];
            assert.equal(floor.boss.mechanic, meta.mechanic, `floor ${tier} mechanic drifted`);
            assert.ok(floor.name.endsWith(meta.name), `floor ${tier} name "${floor.name}" does not end with client "${meta.name}"`);
        }
    });

    it('previews keystone unlocks at the exact server gate tiers', () => {
        // The base seal always carries hp/dmg/roundCap/enrageCap; anything else
        // in the stack is a keystone. Diffing consecutive tiers yields the kind
        // that unlocks AT each tier — which must match the client preview list.
        const BASE_KINDS = new Set<TowerModifierKind>(['hp', 'dmg', 'roundCap', 'enrageCap']);
        const keystoneCounts = (tier: number): Map<string, number> => {
            const counts = new Map<string, number>();
            if (tier < 1) return counts;
            for (const mod of resolveAscensionModifiers(tier, 'parity-probe', 12).modifierStack) {
                if (BASE_KINDS.has(mod.kind)) continue;
                counts.set(mod.kind, (counts.get(mod.kind) ?? 0) + 1);
            }
            return counts;
        };
        for (let tier = 1; tier <= serverMaxTier; tier++) {
            const prev = keystoneCounts(tier - 1);
            const added: string[] = [];
            for (const [kind, count] of keystoneCounts(tier)) {
                for (let i = (prev.get(kind) ?? 0); i < count; i++) added.push(kind);
            }
            const expected = clientKeystones.filter((k) => k.tier === tier).map((k) => k.kind).sort();
            assert.deepEqual(added.sort(), expected, `keystones unlocking at tier ${tier} drifted`);
        }
        // No client preview points past the ladder.
        for (const k of clientKeystones) {
            assert.ok(k.tier >= 1 && k.tier <= serverMaxTier, `client keystone "${k.name}" at out-of-range tier ${k.tier}`);
        }
    });
});
