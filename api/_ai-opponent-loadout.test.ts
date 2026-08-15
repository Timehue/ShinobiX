import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveAiProfileJutsu, MAX_AI_LOADOUT_JUTSU } from './_ai-opponent-loadout.js';
import { JUTSU_CATALOG } from './pvp/_jutsu-catalog.js';
import type { AdminCombatContent } from './_admin-content.js';
import { AI_PROFILE_CATALOG } from './_ai-profile-catalog.js';

/*
 * Step 2 of the generic AI-fight migration: resolving an AI profile's jutsuIds
 * into the objects the sealed opponent actually casts.
 *
 * What these pin down is FAITHFULNESS. A server fight is only a fair
 * replacement for the local one if the AI casts the same kit — an opponent
 * silently reduced to a generic signature (or stripped of its tags) is a
 * different, easier fight than the player was shown.
 */

const BUILTIN_ID = 'starter-universal-flicker';
const noAdmin: AdminCombatContent | null = null;

describe('resolveAiProfileJutsu', () => {
    it('resolves built-in ids to the server catalog jutsu, in order', () => {
        const ids = Object.keys(JUTSU_CATALOG).slice(0, 3);
        const resolved = resolveAiProfileJutsu(ids, noAdmin);
        assert.deepEqual(resolved.map((j) => j.id), ids);
    });

    it('carries the combat fields the tower engine reads', () => {
        const [jutsu] = resolveAiProfileJutsu([BUILTIN_ID], noAdmin);
        const source = JUTSU_CATALOG[BUILTIN_ID];
        assert.ok(jutsu, `${BUILTIN_ID} should resolve`);
        assert.equal(jutsu.id, source.id);
        assert.equal(jutsu.name, source.name);
        assert.equal(jutsu.type, source.type);
        assert.equal(jutsu.element, source.element);
        assert.equal(jutsu.ap, source.ap);
        assert.equal(jutsu.range, source.range);
        assert.equal(jutsu.effectPower, source.effectPower);
        assert.equal(jutsu.cooldown, source.cooldown);
        assert.equal(jutsu.chakraCost, source.chakraCost);
        assert.equal(jutsu.staminaCost, source.staminaCost);
        assert.equal(jutsu.method, source.method);
        assert.equal(jutsu.target, source.target);
    });

    it('keeps the tag list — the engine reads tags for every status effect', () => {
        // Find a built-in with tags; without them the AI's kit is disarmed.
        const tagged = Object.values(JUTSU_CATALOG).find((j) => (j.tags?.length ?? 0) > 0);
        assert.ok(tagged, 'expected at least one tagged jutsu in the catalog');
        const [resolved] = resolveAiProfileJutsu([tagged.id], noAdmin);
        assert.ok(Array.isArray(resolved.tags) && resolved.tags.length > 0, 'tags must survive resolution');
    });

    it('drops unknown ids instead of fabricating a jutsu', () => {
        assert.deepEqual(resolveAiProfileJutsu(['no-such-jutsu'], noAdmin), []);
        assert.deepEqual(
            resolveAiProfileJutsu([BUILTIN_ID, 'no-such-jutsu'], noAdmin).map((j) => j.id),
            [BUILTIN_ID],
        );
    });

    it('resolves admin-authored ids the built-in catalog does not carry', () => {
        const authored = { id: 'creator-shadow-lance', name: 'Shadow Lance', type: 'Ninjutsu', element: 'Dark', ap: 60, range: 4, effectPower: 30, cooldown: 2, chakraCost: 40, staminaCost: 0, method: 'SINGLE' };
        const admin: AdminCombatContent = { jutsu: new Map([[authored.id, authored]]), items: new Map() };
        const [resolved] = resolveAiProfileJutsu([authored.id], admin);
        assert.ok(resolved, 'an authored AI jutsu must resolve');
        assert.equal(resolved.id, authored.id);
        assert.equal(resolved.effectPower, 30);
    });

    it('lets the BUILT-IN catalog win an id collision, like resolveEquippedLoadout', () => {
        const impostor = { id: BUILTIN_ID, name: 'Impostor', effectPower: 59, ap: 10 };
        const admin: AdminCombatContent = { jutsu: new Map([[impostor.id, impostor]]), items: new Map() };
        const [resolved] = resolveAiProfileJutsu([BUILTIN_ID], admin);
        assert.equal(resolved.name, JUTSU_CATALOG[BUILTIN_ID].name, 'built-in must win the collision');
        assert.notEqual(resolved.name, 'Impostor');
    });

    it('sanitizes authored values — no instant-kill AI jutsu', () => {
        const cheat = { id: 'creator-nuke', name: 'Nuke', type: 'Ninjutsu', effectPower: 999_999, ap: 0 };
        const admin: AdminCombatContent = { jutsu: new Map([[cheat.id, cheat]]), items: new Map() };
        const [resolved] = resolveAiProfileJutsu([cheat.id], admin);
        assert.ok((resolved.effectPower ?? 0) <= 60, `effectPower must be clamped, got ${resolved.effectPower}`);
    });

    it('dedupes ids and caps the loadout size', () => {
        assert.equal(resolveAiProfileJutsu([BUILTIN_ID, BUILTIN_ID, BUILTIN_ID], noAdmin).length, 1);
        const many = Object.keys(JUTSU_CATALOG).slice(0, MAX_AI_LOADOUT_JUTSU + 5);
        assert.equal(resolveAiProfileJutsu(many, noAdmin).length, MAX_AI_LOADOUT_JUTSU);
    });

    it('returns [] for junk input so the Solo-PvE builder falls back to a signature', () => {
        for (const junk of [undefined, null, 'not-an-array', 42, {}, [], [null, 7, {}]]) {
            assert.deepEqual(resolveAiProfileJutsu(junk, noAdmin), [], `junk input: ${JSON.stringify(junk)}`);
        }
    });

    it('resolves a real built-in AI to its full authored kit', () => {
        // The end-to-end point of this module: the Arena practice opponent must
        // arrive with every jutsu it is authored to cast, not a stub.
        const profile = AI_PROFILE_CATALOG['builtin-ai-academy-sparring'];
        assert.ok(profile, 'expected the academy sparring profile in the mirror');
        const resolved = resolveAiProfileJutsu(profile.jutsuIds, noAdmin);
        assert.equal(resolved.length, profile.jutsuIds.length, 'every authored jutsu must resolve');
        assert.deepEqual(resolved.map((j) => j.id), profile.jutsuIds);
    });
});
