import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import cinderhold from '../../../shared/cinderhold-world-models.json';
import { bundledFighterSprite, generatedFighterModel } from './battlefield-fighter-art';

test('each Cinderhold fighter uses its bundled combat sprite', () => {
    for (const { id, avatar, assetId, version } of cinderhold) {
        const sprite = `/combat-actors/cinderhold/${id}-idle.webp`;
        assert.equal(bundledFighterSprite(undefined, `${avatar}?v=2`), sprite);
        const appearance = { avatarImage: avatar, playerModel: { assetId, version } };
        assert.equal(bundledFighterSprite(appearance), sprite);
        assert.equal(generatedFighterModel(appearance), undefined);
        assert.ok(existsSync(new URL(`../../public${sprite}`, import.meta.url)), sprite);
    }
});

test('both starter portraits have body art and custom models retain their own revision', () => {
    for (const variant of ['one', 'two']) {
        const sprite = `/combat-actors/starters/starter-${variant}-idle.webp`;
        assert.equal(bundledFighterSprite({ avatarImage: `/starter-avatar-${variant}.webp` }), sprite);
        assert.ok(existsSync(new URL(`../../public${sprite}`, import.meta.url)), sprite);
    }
    const playerModel = { assetId: 'a'.repeat(32), version: 'b'.repeat(64) };
    assert.equal(generatedFighterModel({ playerModel }), playerModel);
    assert.equal(bundledFighterSprite({ avatarImage: '/portraits/player.webp' }), null);
    assert.equal(generatedFighterModel({ playerModel: { ...playerModel, version: '../invalid' } }), undefined);
});
