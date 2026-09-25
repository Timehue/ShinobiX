import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { rollWildPet, grantWildPet } from '../api/pet/_encounter.ts';
import { activeTrainingPetIds } from '../api/_entitlements.ts';
import { settleFinishedTraining, settleServerPetExpedition } from '../api/pet/_progress.ts';
import { createShowdownSession, showdownStateView } from '../api/_pet-showdown/engine.ts';
import { petCombatModel } from '../shinobij.client/src/lib/pet-3d-models.ts';
import { alternateSpeciesPool, selectOffspringTemplate } from '../api/pet/_breeding.ts';
import { isBreedableTemplate, migrateOwnedPet, resolvePetTemplateId } from '../api/pet/_owned-pet.ts';

test('Celestial Lion can be captured, bred, trained, sent on expedition, and fielded in the Colosseum', () => {
    const now = Date.UTC(2026, 8, 24);
    const rolls = [0.001, 0.999, 0.25];
    const wild = rollWildPet(() => rolls.shift() ?? 0.25, now);
    assert.equal(wild?.name, 'Celestial Lion');
    assert.equal(wild?.element, 'Wind');
    assert.equal(wild?.id, `mythic-15-${now}`);

    const captured = grantWildPet({ pets: [] }, wild, () => 0.5);
    assert.equal(captured.ok, true);
    const pet = captured.pet;
    assert.equal(pet.templateId, 'mythic-15');
    assert.equal(pet.origin, 'wild');
    assert.equal(pet.breedable, true);
    assert.equal(resolvePetTemplateId(pet), 'mythic-15');
    assert.equal(isBreedableTemplate(resolvePetTemplateId(pet)), true);
    const reloaded = migrateOwnedPet('Tester', JSON.parse(JSON.stringify(pet))).pet;
    assert.equal(reloaded.templateId, 'mythic-15');
    assert.equal(reloaded.breedable, true);
    assert.equal(selectOffspringTemplate(pet, PET_CATALOG['mythic-7'], 0).templateId, 'mythic-15');
    assert.ok(alternateSpeciesPool(PET_CATALOG['mythic-0'], PET_CATALOG['mythic-7'], 'mythic').includes('mythic-15'));
    assert.equal(captured.character.pets[0].id, pet.id);
    assert.deepEqual(activeTrainingPetIds(captured.character), [pet.id]);

    const trained = settleFinishedTraining({ ...pet, training: {
        type: 'bond', startedAt: now, endsAt: now + 900_000, durationMs: 900_000, sealedXp: 110,
    } }, now + 900_000);
    assert.equal(trained.settledFocus, 'bond');
    assert.equal(trained.pet.training, undefined);
    assert.equal(trained.pet.level, 2);
    assert.equal(trained.pet.xp, 10);

    const expedition = settleServerPetExpedition({ ...trained.pet, level: 20, expedition: { type: 'scout' } }, 'scout', 45, 1);
    assert.equal(expedition.pet.expedition, undefined);
    assert.ok(expedition.xp > 0);
    assert.equal(resolvePetTemplateId(expedition.pet), 'mythic-15');

    const model = petCombatModel(trained.pet);
    assert.match(model?.url ?? '', /mythic-15\.glb/);
    const session = createShowdownSession({
        sessionId: 'celestial-lion-test', playerName: 'Tester', format: '1v1', tier: 'warrior', seed: 7,
        playerPets: [trained.pet], enemyPets: [{ ...PET_CATALOG['rare-24'], templateId: 'rare-24', id: 'enemy-direwolf' }],
        enemyTeamName: 'Practice', rewardEligible: false,
    });
    const fighter = showdownStateView(session).player[0];
    assert.equal(fighter.templateId, 'mythic-15');
    assert.equal(fighter.element, 'Wind');
    assert.ok(fighter.moves.some((move) => move.name === 'Tempest Roar'));
});
