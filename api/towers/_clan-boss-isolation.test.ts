import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { activeClanBossConflictMembers } from './_clan-boss-conflict.js';
import type { TowerSession } from './_tower-session.js';

describe('Tower and Clan Boss shared-engine isolation', () => {
    it('recognizes only a live human member of an active cboss recovery session', async () => {
        const base = {
            runId: 'cboss-live', status: 'active',
            actors: [{ side: 'squad', ownerSlug: 'alice', ai: false }],
        } as unknown as TowerSession;
        const busy = await activeClanBossConflictMembers(['alice', 'bob'], {
            invite: async slug => slug === 'alice' ? 'cboss-live' : null,
            session: async () => base,
        });
        assert.deepEqual(busy, ['alice']);
        base.status = 'done';
        assert.deepEqual(await activeClanBossConflictMembers(['alice'], {
            invite: async () => 'cboss-live', session: async () => base,
        }), []);
    });

    it('pins atomic marker claim, publication confirmation, refresh, and terminal release wiring', () => {
        const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
        const start = source('api/clan-boss/assault-start.ts');
        const claim = start.indexOf('const marker = await claimClanBossBattleMarkers');
        const reserve = start.indexOf('const reserved = await withKvLock', claim);
        const publish = start.indexOf('await writeSession(session)');
        const confirm = start.indexOf('published = await readSession(runId)', publish);
        const bind = start.indexOf('await bindClanBossBattleMarkers', publish);
        assert.ok(claim > 0 && claim < reserve && reserve < publish,
            'shared account markers win before attempt/session publication');
        assert.ok(confirm > publish && bind > confirm,
            'ambiguous publication is confirmed before markers become a bound run');
        assert.match(start, /clanMarker\.published = true;[\s\S]{0,120}throw publishError/);

        for (const file of ['api/towers/action.ts', 'api/towers/state.ts']) {
            assert.match(source(file), /refreshClanBossBattleMarkers\(runId, towerBattleLeaseMembers\(session\)\)/, file);
        }
        const settle = source('api/clan-boss/assault-settle.ts');
        const committed = settle.indexOf("if (outcome.status !== 200)");
        const release = settle.indexOf('await releaseClanBossBattleMarkers(runId, party)');
        assert.ok(committed > 0 && release > committed, 'only an authoritatively settled operation releases its markers');
    });
});
