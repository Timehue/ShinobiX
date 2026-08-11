import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CLAN_BOSS_FLOOR_BASE,
    TOWER_CATALOG_VERSION,
    getFloor,
    type TowerFloor,
} from './_floor-catalog.js';
import { SPIRE_CATALOG_VERSION, getSpireFloor } from './_spire-catalog.js';
import {
    floorForSession,
    sealTowerCatalogFloor,
    sealedSpireFloorForSession,
    sealedStoryFloorForSession,
} from './_session-floor.js';
import { isPublicTowerRun, isSpireRun } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

function session(input: {
    towerId: string;
    floor: number;
    ascensionTier?: number;
    encounterFloor?: TowerFloor;
}): TowerSession {
    return {
        towerId: input.towerId,
        floor: input.floor,
        ascensionTier: input.ascensionTier,
        encounterFloor: input.encounterFloor,
    } as TowerSession;
}

describe('Tower floor identity and deploy-stable rule seals', () => {
    it('versions Story and Spire catalogs with safe authored identifiers', () => {
        assert.equal(TOWER_CATALOG_VERSION, 'story-tower-v1');
        assert.equal(SPIRE_CATALOG_VERSION, 'endless-spire-v1');
        assert.match(TOWER_CATALOG_VERSION, /^[A-Za-z0-9_.-]{1,80}$/);
        assert.match(SPIRE_CATALOG_VERSION, /^[A-Za-z0-9_.-]{1,80}$/);
        assert.notEqual(TOWER_CATALOG_VERSION, SPIRE_CATALOG_VERSION);
    });

    for (const tier of [1, 10, 11, 20]) {
        it(`resolves Spire tier ${tier} from its exact generated seal, never the Story catalog`, () => {
            const floor = getSpireFloor(tier)!;
            const active = session({ towerId: 'endless-spire', floor: tier, ascensionTier: tier });
            sealTowerCatalogFloor(active, floor, 'spire');
            assert.deepEqual(floorForSession(active), floor);
            assert.deepEqual(sealedSpireFloorForSession(active), floor);
            assert.equal(sealedStoryFloorForSession(active), undefined);
            assert.equal(isSpireRun(active), true);
            assert.equal(isPublicTowerRun(active), false);
            assert.equal(active.floorProvenance?.kind, 'spire-generated');
            assert.equal(active.floorProvenance?.contentVersion, SPIRE_CATALOG_VERSION);
            if (tier <= 10) assert.notDeepEqual(floorForSession(active), getFloor(tier), 'numeric overlap cannot select Story rules');
            else assert.equal(getFloor(tier), undefined, 'high Spire tiers have no Story fallback');
        });
    }

    it('seals an immutable Story rules/reward snapshot with public provenance', () => {
        const source = structuredClone(getFloor(5)!);
        const active = session({ towerId: 'celestial', floor: 5 });
        sealTowerCatalogFloor(active, source, 'story');
        source.name = 'edited after mint';
        source.firstClearReward.ryo = 999_999;

        const sealed = floorForSession(active)!;
        assert.equal(sealed.name, getFloor(5)!.name);
        assert.equal(sealed.firstClearReward.ryo, getFloor(5)!.firstClearReward.ryo);
        assert.notEqual(sealed, getFloor(5), 'active run resolves its own exact snapshot');
        assert.equal(active.floorProvenance?.kind, 'story-catalog');
        assert.equal(active.floorProvenance?.contentVersion, TOWER_CATALOG_VERSION);
        assert.equal(isPublicTowerRun(active), true);
        assert.equal(isSpireRun(active), false);
    });

    it('fails closed on mismatched new provenance instead of falling through by number', () => {
        const active = session({ towerId: 'celestial', floor: 5 });
        sealTowerCatalogFloor(active, getFloor(5)!, 'story');
        active.floorProvenance = { ...active.floorProvenance!, floorId: 4 } as typeof active.floorProvenance;
        assert.equal(floorForSession(active), undefined);
        assert.equal(isPublicTowerRun(active), false);

        const halfSeal = session({ towerId: 'celestial', floor: 5 });
        halfSeal.sealedCatalogFloor = structuredClone(getFloor(5)!);
        assert.equal(floorForSession(halfSeal), undefined);
        assert.equal(isPublicTowerRun(halfSeal), false);
    });

    it('preserves safe legacy Story, Spire, embedded, and reserved Clan Boss resolution', () => {
        const legacyStory = session({ towerId: 'celestial', floor: 2 });
        assert.equal(floorForSession(legacyStory)?.id, 2);
        assert.equal(isPublicTowerRun(legacyStory), true);

        for (const tier of [1, 10, 11, 20]) {
            const legacySpire = session({ towerId: 'endless-spire', floor: tier, ascensionTier: tier });
            assert.deepEqual(floorForSession(legacySpire), getSpireFloor(tier));
            assert.equal(isSpireRun(legacySpire), true);
        }

        const embeddedFloor = { ...getFloor(1)!, name: 'Embedded Mission', firstClearReward: {} };
        const embedded = session({ towerId: 'solo-pve', floor: 1, encounterFloor: embeddedFloor });
        assert.equal(floorForSession(embedded), embeddedFloor);
        assert.equal(isPublicTowerRun(embedded), false);

        const clan = session({ towerId: 'celestial', floor: CLAN_BOSS_FLOOR_BASE });
        assert.equal(floorForSession(clan)?.id, CLAN_BOSS_FLOOR_BASE);
        assert.equal(isPublicTowerRun(clan), false);
    });

    it('wires the start seal before engine execution and every action through floorForSession', () => {
        const start = readFileSync(resolve(process.cwd(), 'api/towers/start.ts'), 'utf8');
        const action = readFileSync(resolve(process.cwd(), 'api/towers/action.ts'), 'utf8');
        const seal = start.indexOf('sealTowerCatalogFloor(session, floor, mode)');
        const round = start.indexOf('startRound(session)');
        const publish = start.indexOf('await writeSession(session)');
        assert.ok(seal > 0 && round > seal && publish > round);
        assert.match(action, /const floor = floorForSession\(session\)/);
        assert.ok(action.indexOf('const floor = floorForSession(session)') < action.indexOf('applyAction(session, floor'));
    });
});
