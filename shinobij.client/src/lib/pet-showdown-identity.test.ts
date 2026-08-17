/*
 * Showdown fighter art identity.
 *
 * One rule, two consumers: PetShowdownBattle's slot map (what gets rendered)
 * and warmShowdownModels (what gets fetched before the fight opens). They must
 * agree exactly. If they drift, the warm-up fetches a model the battle never
 * asks for, the battle's own request is cold, and it suspends against a null
 * fallback — an opponent that is not merely late but absent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { petCombatModel, showdownFighterIdentity } from './pet-3d-models.js';
import { APPROVED_ROSTER_MODEL_IDS } from './pet-3d-roster.js';
import { rawPetPool } from '../data/pet-pool.js';
import type { Pet } from '../types/pet.js';

// The shape an AI opponent actually arrives in: a per-session instance id that
// no allowlist knows, and the catalog species beside it.
const AI_VIEW = {
    id: 'showdown-ai-0-rare-24',
    templateId: 'rare-24',
    name: 'Young Direwolf',
    rarity: 'rare',
    element: 'Earth',
};

describe('showdownFighterIdentity', () => {
    it('keys a server-built opponent off its catalog species, not its session id', () => {
        const identity = showdownFighterIdentity(AI_VIEW);
        assert.equal(identity.id, 'rare-24');
        assert.equal(identity.templateId, 'rare-24');
    });

    it('resolves an actual 3D model for that opponent', () => {
        // The end-to-end point of the templateId hop: an AI opponent gets a body.
        const model = petCombatModel(showdownFighterIdentity(AI_VIEW));
        assert.ok(model, 'an AI opponent must resolve an approved combat model');
        assert.match(model.url, /rare-24\.glb/);
    });

    it('would resolve NOTHING from the raw session id — which is why the hop exists', () => {
        const raw = petCombatModel({ id: AI_VIEW.id, rarity: AI_VIEW.rarity } as unknown as Pet);
        assert.equal(raw, null);
    });

    it('prefers your own save record, so an evolved starter keeps its stage body', () => {
        // Only the save record carries evolutionStage, and each stage resolves a
        // different GLB. Identify from the view alone and a stage-2 starter
        // silently wears its stage-0 body.
        const owned = {
            id: 'starter-fire', name: 'Ember Kit', rarity: 'legendary',
            element: 'Fire', evolutionStage: 2,
        } as unknown as Pet;
        const view = { id: 'starter-fire', name: 'Ember Kit', rarity: 'legendary', element: 'Fire' };
        const identity = showdownFighterIdentity(view, [owned]);
        assert.equal(identity, owned, 'the real pet is returned as-is');
        assert.equal(
            petCombatModel(identity)?.visualId,
            petCombatModel(owned)?.visualId,
            'and resolves the same model the renderer will draw',
        );
    });

    it('falls back to the view when the roster does not hold that pet', () => {
        const identity = showdownFighterIdentity(AI_VIEW, []);
        assert.equal(identity.id, 'rare-24');
    });
});

describe('the AI can only field opponents that have a body', () => {
    it('gives every wild-spawnable species an approved 3D model', () => {
        /*
         * The Showdown AI draws its team from the wild-spawnable pool, by
         * rarity. A species with no approved GLB drops to flat 2D card art on a
         * billboard while your own pet stands there in three dimensions — the
         * exact tell that turns an opponent back into a prop.
         *
         * Asserted from the CLIENT pool because the approved roster is a client
         * module and the server's build cannot import it. The server's own
         * catalog is held equal to this pool by the pet catalog parity test, so
         * covering this list covers what the AI can actually draw.
         *
         * If this ever fails, the fix is roster art or a narrower pool — not a
         * deleted assertion. The fallback is invisible in review and obvious in
         * play.
         */
        const approved: ReadonlySet<string> = APPROVED_ROSTER_MODEL_IDS;
        const drawable = rawPetPool.filter((pet) => pet.wildSpawnable !== false);
        assert.ok(drawable.length > 100, `the AI pool looks wrong: ${drawable.length} species`);

        const bodiless = drawable.filter((pet) => !approved.has(pet.id)).map((pet) => pet.id);
        assert.deepEqual(bodiless, [], `these can be drawn as opponents with no 3D model: ${bodiless.join(', ')}`);
    });
});
