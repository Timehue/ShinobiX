import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PUBLIC_CAPABILITY_IDS } from '../../shared/public-capabilities.js';
import { publicCapabilities } from './_public-capabilities.js';
import handler from './capabilities.js';

function callHandler(method: string, ip: string) {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let body: unknown;
    let ended = false;
    const res = {
        setHeader(name: string, value: string) { headers[name] = value; },
        status(code: number) { statusCode = code; return res; },
        json(value: unknown) { body = value; return res; },
        end() { ended = true; return res; },
    };
    handler({ method, headers: {}, query: {}, ip } as never, res as never);
    return { headers, statusCode, body, ended };
}

describe('public capability projection', () => {
    it('reports repository defaults without revealing configuration names or values', () => {
        const capabilities = publicCapabilities({});
        assert.equal(Object.isFrozen(PUBLIC_CAPABILITY_IDS), true);
        assert.deepEqual(Object.keys(capabilities), [...PUBLIC_CAPABILITY_IDS]);
        assert.equal(capabilities.gameplay.state, 'available');
        assert.equal(capabilities.villageWar.state, 'available');
        assert.equal(capabilities.anbuInfiltration.state, 'available');
        assert.equal(capabilities.clanBoss.state, 'available');
        assert.equal(capabilities.clanBossParties.state, 'available');
        assert.equal(capabilities.legacy.reason, 'configuration-unavailable');
        assert.equal(capabilities.petBreedingStarts.state, 'available');
        assert.equal(capabilities.weeklyBossGuardCycle.state, 'available');
        const publicJson = JSON.stringify(capabilities);
        assert.doesNotMatch(publicJson, /ENABLE_|DISABLE_|MAINTENANCE_MODE|FREEZE_ECONOMY|TOKEN|PASSWORD|SECRET/);
    });

    it('projects emergency and feature switches as bounded public reason codes', () => {
        const capabilities = publicCapabilities({
            MAINTENANCE_MODE: '1',
            FREEZE_ECONOMY_REWARDS: '1',
            DISABLE_NEW_REGISTRATIONS: '1',
            DISABLE_VILLAGE_WAR: '1',
            DISABLE_ANBU_INFILTRATION: '1',
            DISABLE_CLAN_BOSS: '1',
            DISABLE_PET_BREEDING_STARTS: '1',
            DISABLE_WEEKLY_BOSS_GUARD: '1',
            ENABLE_LEGACY: '1',
            DATABASE_URL: 'postgres://secret',
        });
        assert.equal(capabilities.gameplay.reason, 'maintenance');
        assert.equal(capabilities.gameplayMutations.reason, 'maintenance');
        assert.equal(capabilities.villageWar.reason, 'temporarily-disabled');
        assert.equal(capabilities.anbuInfiltration.reason, 'temporarily-disabled');
        assert.equal(capabilities.clanBoss.reason, 'temporarily-disabled');
        assert.equal(capabilities.clanBossParties.reason, 'temporarily-disabled');
        assert.equal(capabilities.legacy.state, 'available');
        assert.equal(capabilities.petBreedingStarts.reason, 'temporarily-disabled');
        assert.equal(capabilities.weeklyBossGuardCycle.reason, 'temporarily-disabled');
        assert.doesNotMatch(JSON.stringify(capabilities), /postgres|secret/);
    });

    it('keeps nested and independent capabilities aligned with canonical server gates', () => {
        const partyOnly = publicCapabilities({ DISABLE_CLAN_BOSS_PARTIES: '1' });
        assert.equal(partyOnly.clanBoss.state, 'available');
        assert.equal(partyOnly.clanBossParties.state, 'temporarily-unavailable');

        const coreOff = publicCapabilities({ DISABLE_CLAN_BOSS: '1', DISABLE_CLAN_BOSS_PARTIES: '0' });
        assert.equal(coreOff.clanBoss.state, 'temporarily-unavailable');
        assert.equal(coreOff.clanBossParties.state, 'temporarily-unavailable');

        const independent = publicCapabilities({ DISABLE_VILLAGE_WAR: '1' });
        assert.equal(independent.villageWar.state, 'temporarily-unavailable');
        assert.equal(independent.anbuInfiltration.state, 'available');
    });

    it('distinguishes an economy pause from general maintenance', () => {
        const capabilities = publicCapabilities({ FREEZE_ECONOMY_REWARDS: '1' });
        assert.equal(capabilities.gameplay.state, 'available');
        assert.deepEqual(capabilities.gameplayMutations, { state: 'actions-paused', reason: 'operations-paused' });
    });

    it('serves a bounded no-store public contract and rejects unsupported methods', () => {
        const get = callHandler('GET', '198.51.100.80');
        assert.equal(get.statusCode, 200);
        assert.equal(get.headers['Cache-Control'], 'no-store');
        assert.equal(get.headers['Access-Control-Allow-Origin'], '*');
        assert.equal((get.body as { ok?: boolean }).ok, true);
        assert.doesNotMatch(JSON.stringify(get.body), /DATABASE_URL|PASSWORD|SECRET|TOKEN/);

        const options = callHandler('OPTIONS', '198.51.100.81');
        assert.equal(options.statusCode, 200);
        assert.equal(options.ended, true);
        assert.equal(callHandler('POST', '198.51.100.82').statusCode, 405);
    });

    it('enforces the public endpoint request budget', () => {
        for (let request = 0; request < 600; request += 1) {
            assert.equal(callHandler('GET', '198.51.100.83').statusCode, 200);
        }
        assert.equal(callHandler('GET', '198.51.100.83').statusCode, 429);
    });
});
