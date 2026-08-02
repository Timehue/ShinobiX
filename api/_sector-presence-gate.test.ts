import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onlineStore } from './_realtime/online-store.js';
import { sectorPresenceBlock } from './_sector-presence-gate.js';

/*
 * The wild-field presence gate.
 *
 * Attackability is decided by PRESENCE sector (0 = a town screen, unreachable
 * by PvP; >= 1 = the wild, attackable live and as a sleeper camp). Wild reward
 * endpoints used to take the sector from the request body without consulting
 * presence at all, so a client could report sector 0 — invisible and
 * unattackable — while farming sector 12. These pin the rule that closes it:
 * take the wild's rewards only while standing in the wild.
 */

const beat = (name: string, sector: number) =>
    onlineStore.upsert({ name, sector, character: { name, hp: 100, maxHp: 100 } });

describe('sector presence gate', () => {
    beforeEach(() => {
        for (const p of onlineStore.list()) onlineStore.remove(p.name);
    });

    it('allows a player standing in the sector they are claiming', () => {
        beat('farmer', 12);
        assert.equal(sectorPresenceBlock('farmer', 12), null);
    });

    it('BLOCKS the town-presence exploit: claiming safe while farming the wild', () => {
        beat('ghost', 0); // "I'm in a village" — unattackable
        const block = sectorPresenceBlock('ghost', 12); // ...while looting sector 12
        assert.ok(block, 'a sector-0 presence must not be able to farm the field');
        assert.equal(block.status, 409);
        assert.equal(block.reason, 'sector-mismatch');
    });

    it('blocks farming a sector other than the one you occupy', () => {
        beat('wanderer', 5);
        assert.equal(sectorPresenceBlock('wanderer', 9)?.reason, 'sector-mismatch');
    });

    it('blocks a player with no live presence at all', () => {
        // Never heartbeating is the same immunity by another route.
        assert.equal(sectorPresenceBlock('phantom', 12)?.reason, 'no-presence');
    });

    it('does not gate town-side actions (sector < 1)', () => {
        assert.equal(sectorPresenceBlock('anyone', 0), null);
        assert.equal(sectorPresenceBlock('anyone', undefined), null);
    });

    it('matches the rule attacking already uses', () => {
        // api/player/sleeper-kill.ts rejects when attacker.sector !== campSector.
        // Farming and fighting must agree on what "being somewhere" means, or the
        // wild pays out to players it cannot punish.
        const src = readFileSync(join(process.cwd(), 'api', 'player', 'sleeper-kill.ts'), 'utf8');
        assert.match(src, /attacker\.sector !== campSector/);
    });
});

describe('wild-field endpoints enforce the gate', () => {
    // Every wild-field earner. Adding a new one that pays out for being in a
    // sector means adding it here too — otherwise it becomes the next hole.
    for (const rel of [
        'world/explore.ts', 'world/open-chest.ts',
        'sector/wanderer-gift.ts', 'sector/wanderer-quest.ts', 'sector/wanderer-service.ts',
    ]) {
        it(`${rel} gates its payout on presence`, () => {
            const src = readFileSync(join(process.cwd(), 'api', rel), 'utf8');
            assert.match(src, /sectorPresenceBlock\(playerName, /);
            // The gate must run BEFORE the payout, not alongside it.
            const gateAt = src.indexOf('sectorPresenceBlock(');
            const payAt = Math.min(
                ...['mutatePlayerSave(', 'withKvLock('].map((m) => (src.indexOf(m) === -1 ? Number.MAX_SAFE_INTEGER : src.indexOf(m))),
            );
            assert.ok(gateAt > 0 && gateAt < payAt, 'the presence gate must precede the reward mutation');
        });
    }
});
