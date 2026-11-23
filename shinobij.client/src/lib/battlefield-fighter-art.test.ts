import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import cinderhold from '../../../shared/cinderhold-world-models.json';
import { NPC_VILLAGE } from '../../../shared/npc-village';
import { NPC_VILLAGE_ROSTER } from '../../../shared/npc-village-roster';
import { bundledFighterSprite, generatedFighterModel, playerBattleFallback } from './battlefield-fighter-art';

test('each Cinderhold fighter uses its bundled combat sprite', () => {
    for (const { id, avatar, assetId, version } of cinderhold) {
        const npc = NPC_VILLAGE_ROSTER.find(entry => entry.id === id);
        assert.ok(npc, id);
        const sprite = `/combat-actors/cinderhold/${id}-idle.webp`;
        assert.equal(bundledFighterSprite(undefined, `${avatar}?v=2`), sprite);
        const appearance = { avatarImage: avatar, playerModel: { assetId, version } };
        assert.equal(bundledFighterSprite(appearance), sprite);
        assert.equal(generatedFighterModel(appearance), undefined);
        assert.equal(playerBattleFallback({ playerModel: { assetId, version } }), sprite);
        for (const avatarImage of [undefined, `/api/img?id=avatar:${id}`, `/portraits/${id}.webp`]) {
            const aliased = { ...appearance, avatarImage, name: npc.name, village: NPC_VILLAGE };
            assert.equal(bundledFighterSprite(aliased), sprite);
            assert.equal(generatedFighterModel(aliased), undefined);
        }
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
    assert.equal(generatedFighterModel({ playerModel, avatarImage: cinderhold[0].avatar }), playerModel);
    assert.equal(bundledFighterSprite({ avatarImage: '/portraits/player.webp' }), null);
    assert.equal(bundledFighterSprite({ avatarImage: '/npc-portraits/unknown.avif' }), null);
    assert.equal(generatedFighterModel({ playerModel, avatarImage: '/npc-portraits/unknown.avif' }), playerModel);
    assert.equal(generatedFighterModel({ playerModel: { ...playerModel, version: '../invalid' } }), undefined);
});

test('an explicit choice survives portrait changes and legacy players get a local battle body', () => {
    const two = '/combat-actors/starters/starter-two-idle.webp';
    assert.equal(playerBattleFallback({ starterWorldModel: 'starter-two', avatarImage: '/starter-avatar-one.webp' }), two);
    assert.equal(playerBattleFallback({ starterWorldModel: 'starter-two', avatarImage: cinderhold[0].avatar }), two);
    assert.equal(playerBattleFallback(undefined, '/starter-avatar-two.webp?v=1'), two);
    assert.equal(playerBattleFallback({ avatarImage: '/api/img?id=portrait' }), '/combat-actors/starters/starter-one-idle.webp');
});
