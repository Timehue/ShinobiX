"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStarterPet = validateStarterPet;
exports.chooseStarterPet = chooseStarterPet;
const node_crypto_1 = require("node:crypto");
const STARTER_DIGESTS = {
    'starter-fire': 'ebe6d88ae39f1d603161d9c4d41769dd5530e7f0a6f9ed6d5a3fc42b6d99e9af',
    'starter-water': '2d8359c1221bdc6d531c6d69cd8f45af2eeae1b1bfa32c86594529b142cecc17',
    'starter-wind': '770ab6d1e213ea3234b04d734706038d821e21566af2b8c6c37cce62cd3a02f9',
    'starter-lightning': 'cd055ab32c1a58a9777917d2d86ae6ffe5bd078d460adfb7b54828a388d592df',
    'starter-earth': 'e103378d666fc5073f43d27cfde8733dfece745578d4fc45dc7d10a8ff23380c',
};
function withTraitBonus(pet) {
    const n = (key) => Number(pet[key]) || 0;
    if (pet.trait === 'Aggressive')
        return { ...pet, attack: Math.round(n('attack') * 1.15) };
    if (pet.trait === 'Battleborn')
        return { ...pet, attack: Math.round(n('attack') * 1.1), hp: Math.round(n('hp') * 1.1), defense: Math.round(n('defense') * 1.1), speed: Math.round(n('speed') * 1.1) };
    if (pet.trait === 'Guardian')
        return { ...pet, hp: Math.round(n('hp') * 1.2), defense: Math.round(n('defense') * 1.2) };
    if (pet.trait === 'Swift')
        return { ...pet, speed: Math.round(n('speed') * 1.2) };
    return pet;
}
function validateStarterPet(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const pet = raw;
    const id = typeof pet.id === 'string' ? pet.id : '';
    const expected = STARTER_DIGESTS[id];
    if (!expected)
        return null;
    const digest = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(pet)).digest('hex');
    return digest === expected ? withTraitBonus(structuredClone(pet)) : null;
}
function chooseStarterPet(character, rawPet) {
    const pets = Array.isArray(character.pets) ? character.pets : [];
    if (pets.length > 0 || character.starterPetClaimed === true)
        return { ok: false, reason: 'starter-already-chosen' };
    if (character.onboardingStep !== 'starter')
        return { ok: false, reason: 'starter-not-available' };
    const pet = validateStarterPet(rawPet);
    if (!pet)
        return { ok: false, reason: 'invalid-starter' };
    return { ok: true, character: { ...character, pets: [pet], activePetId: pet.id, onboardingStep: 'training', starterPetClaimed: true } };
}
