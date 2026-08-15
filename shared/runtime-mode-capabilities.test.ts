import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    PUBLIC_CAPABILITY_IDS,
    type PublicCapabilities,
    type PublicCapability,
    type PublicCapabilityId,
} from './public-capabilities.js';
import {
    runtimeModeAdmissionAllowed,
    runtimeModeCapabilityAvailability,
    runtimeModeCapabilityMatrix,
    runtimeModeRequiredCapabilityIds,
} from './runtime-mode-capabilities.js';
import { RUNTIME_MODE_REGISTRY } from './runtime-mode-registry.js';

function capabilitiesWith(overrides: Partial<Record<PublicCapabilityId, PublicCapability>> = {}): PublicCapabilities {
    return Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
        id,
        overrides[id] ?? { state: 'available', reason: 'available' },
    ])) as PublicCapabilities;
}

describe('runtime-mode public capability availability', () => {
    it('derives mode-specific requirements from the executable registry', () => {
        const available = runtimeModeCapabilityAvailability(capabilitiesWith(), { runtimeModeId: 'clan-boss' });
        assert.equal(available.executable, true);
        assert.equal(available.runtimeModeLabel, 'Clan Boss');
        assert.deepEqual(available.capabilityIds, ['gameplay', 'gameplayMutations', 'clanBoss']);
        assert.equal(available.available, true);

        const disabled = runtimeModeCapabilityAvailability(capabilitiesWith({
            clanBoss: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        }), { runtimeModeId: 'clan-boss' });
        assert.equal(disabled.available, false);
        assert.equal(disabled.blockingCapabilityId, 'clanBoss');
        assert.equal(disabled.reason, 'temporarily-disabled');
    });

    it('gives global maintenance and mutation pauses priority over narrower gates', () => {
        const maintenance = runtimeModeCapabilityAvailability(capabilitiesWith({
            gameplay: { state: 'temporarily-unavailable', reason: 'maintenance' },
            gameplayMutations: { state: 'temporarily-unavailable', reason: 'maintenance' },
            clanBoss: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        }), { runtimeModeId: 'clan-boss' });
        assert.equal(maintenance.blockingCapabilityId, 'gameplay');
        assert.equal(maintenance.reason, 'maintenance');

        const paused = runtimeModeCapabilityAvailability(capabilitiesWith({
            gameplayMutations: { state: 'actions-paused', reason: 'operations-paused' },
        }), { runtimeModeId: 'pet-showdown-practice' });
        assert.equal(paused.available, false);
        assert.equal(paused.blockingCapabilityId, 'gameplayMutations');
        assert.equal(paused.state, 'actions-paused');
    });

    it('combines a mode gate with a narrower admission gate in stable order', () => {
        const partyOnly = runtimeModeCapabilityAvailability(capabilitiesWith({
            clanBossParties: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        }), { runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties' });
        assert.deepEqual(partyOnly.capabilityIds, ['gameplay', 'gameplayMutations', 'clanBoss', 'clanBossParties']);
        assert.equal(partyOnly.blockingCapabilityId, 'clanBossParties');

        const coreFirst = runtimeModeCapabilityAvailability(capabilitiesWith({
            clanBoss: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
            clanBossParties: { state: 'available', reason: 'available' },
        }), { runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties' });
        assert.equal(coreFirst.blockingCapabilityId, 'clanBoss');
    });

    it('does not infer unrelated gates for generic companion modes', () => {
        const result = runtimeModeCapabilityAvailability(capabilitiesWith({
            petBreedingStarts: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        }), { runtimeModeId: 'pet-showdown-practice' });
        assert.equal(result.available, true);
        assert.deepEqual(result.capabilityIds, ['gameplay', 'gameplayMutations']);
    });

    it('fails closed at the live-provider boundary and globally gates generic actions', () => {
        assert.deepEqual(runtimeModeRequiredCapabilityIds({}), ['gameplay', 'gameplayMutations']);
        assert.deepEqual(runtimeModeRequiredCapabilityIds({ requiresMutation: false }), ['gameplay']);
        assert.equal(runtimeModeAdmissionAllowed({}, () => true), true);
        assert.equal(runtimeModeAdmissionAllowed({}, (id) => id !== 'gameplayMutations'), false);
        assert.equal(runtimeModeAdmissionAllowed({ requiresMutation: false }, (id) => id !== 'gameplayMutations'), true);
        assert.equal(runtimeModeAdmissionAllowed({ runtimeModeId: 'clan-boss' }, (id) => id !== 'clanBoss'), false);
        assert.equal(runtimeModeAdmissionAllowed({ runtimeModeId: 'missing-mode' }, () => true), false);
        assert.equal(runtimeModeAdmissionAllowed({ runtimeModeId: '' }, () => true), false);
        assert.equal(runtimeModeAdmissionAllowed({ capabilityId: 'missing-capability' as PublicCapabilityId }, () => true), false);
    });

    it('fails closed for missing or non-executable mode ids and keeps standalone gates explicit', () => {
        for (const runtimeModeId of ['missing-mode', 'tactical-arena']) {
            const result = runtimeModeCapabilityAvailability(capabilitiesWith(), { runtimeModeId });
            assert.equal(result.executable, false);
            assert.equal(result.available, false);
            assert.equal(result.reason, 'configuration-unavailable');
        }
        const legacy = runtimeModeCapabilityAvailability(capabilitiesWith(), { capabilityId: 'legacy' });
        assert.equal(legacy.executable, false);
        assert.equal(legacy.available, true);
        assert.deepEqual(legacy.capabilityIds, ['gameplay', 'gameplayMutations', 'legacy']);
    });

    it('projects every executable registry mode without inventing capability state', () => {
        const capabilities = capabilitiesWith({
            villageWar: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        });
        const matrix = runtimeModeCapabilityMatrix(capabilities);
        const executableCount = RUNTIME_MODE_REGISTRY.filter((mode) => mode.authorityEngine !== null
            && (mode.routes.length > 0 || (mode.transports?.length ?? 0) > 0)).length;
        assert.equal(matrix.length, executableCount);
        assert.ok(matrix.some((row) => row.modeId === 'pet-arena-pvp-1v1'));
        assert.equal(Object.isFrozen(matrix), true);
        const sectorWar = matrix.find((row) => row.modeId === 'sector-war-card');
        assert.equal(sectorWar?.capabilityId, 'villageWar');
        assert.equal(sectorWar?.blockingCapabilityId, 'villageWar');
        assert.equal(sectorWar?.state, capabilities.villageWar.state);
        assert.equal(sectorWar?.reason, capabilities.villageWar.reason);
    });
});
