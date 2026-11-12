import assert from 'node:assert/strict';
import test from 'node:test';
import { combatProjection, sanitizeCharacterSave } from './[name].js';
import { PUBLIC_CHAR_FIELDS } from './_state-ownership.js';

test('starter two survives a portrait replacement and an incoming stale choice', () => {
    const first = sanitizeCharacterSave({character:{avatarImage:'/starter-avatar-two.webp',starterWorldModel:'starter-one'}},null);
    assert.equal((first.character as Record<string,unknown>).starterWorldModel,'starter-two');
    const older = {character:{name:'Rill',avatarImage:'/starter-avatar-two.webp'}};
    const update = {character:{name:'Rill',avatarImage:'/api/img?id=avatar:rill',starterWorldModel:'starter-one'}};
    for (const stored of [first,older]) {
        const result = sanitizeCharacterSave(update,stored);
        assert.equal((result.character as Record<string,unknown>).starterWorldModel,'starter-two');
        assert.equal('starterWorldModel' in (combatProjection(result).character as Record<string,unknown>),false);
    }
});

test('a normal save preserves the server equipment choice across first saves, retries and unequip', () => {
    const equipped = { assetId: 'owned-model', version: 2 };
    for (const prior of [null, { character: {} }, { character: { playerModel: equipped } }]) {
        for (const incoming of [{}, { playerModel: null }, { playerModel: { assetId: 'foreign-model', version: 9 } }]) {
            const save = sanitizeCharacterSave({ character: incoming }, prior);
            const character = save.character as Record<string, unknown>;
            assert.deepEqual(character.playerModel, prior?.character.playerModel);
            assert.equal('playerModel' in character, prior?.character.playerModel !== undefined);
            assert.equal('playerModel' in (combatProjection(save).character as Record<string, unknown>), false);
        }
    }
    assert.equal(PUBLIC_CHAR_FIELDS.has('playerModel'), false);
});

test('normal saves cannot set, replace or erase private model ownership',()=>{
    const oldId='30dc2a04-2409-4bf2-9f6a-4a42b597087a';
    for(const existing of [undefined,oldId]) {
        const prior={character:{...(existing ? {playerModelOwnerId:existing} : {})}};
        for(const incoming of [{},{playerModelOwnerId:null},{playerModelOwnerId:'attacker-chosen'}]) {
            const save=sanitizeCharacterSave({character:incoming},prior);
            const character=save.character as Record<string,unknown>;
            assert.equal(character.playerModelOwnerId,existing);
            assert.equal('playerModelOwnerId' in (combatProjection(save).character as Record<string,unknown>),false);
        }
    }
    assert.equal(PUBLIC_CHAR_FIELDS.has('playerModelOwnerId'),false);
});
