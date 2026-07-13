"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_WILD_ENCOUNTER_ATTEMPTS = void 0;
exports.rollWildPet = rollWildPet;
exports.grantWildPet = grantWildPet;
const _catalog_js_1 = require("./_catalog.js");
const TRAITS = ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'];
exports.DAILY_WILD_ENCOUNTER_ATTEMPTS = 150;
function rollWildPet(random, now = Date.now()) {
    const roll = random();
    const rarity = roll <= 0.002 ? 'mythic' : roll <= 0.007 ? 'legendary' : roll <= 0.01 ? 'rare' : roll <= 0.05 ? 'standard' : null;
    if (!rarity)
        return null;
    const pool = Object.values(_catalog_js_1.PET_CATALOG).filter((pet) => pet.rarity === rarity);
    const template = pool[Math.floor(Math.max(0, Math.min(0.999999, random())) * pool.length)];
    return template ? { ...structuredClone(template), id: `${template.id}-${now}` } : null;
}
function grantWildPet(character, pet, random) {
    const pets = Array.isArray(character.pets) ? character.pets : [];
    if (pets.length >= 5)
        return { ok: false, reason: 'pet-yard-full' };
    const pool = pet.rarity === 'mythic' ? TRAITS : TRAITS.filter((trait) => trait !== 'Guardian');
    const trait = pool[Math.floor(Math.max(0, Math.min(0.999999, random())) * pool.length)];
    const n = (key) => Number(pet[key]) || 0;
    let granted = { ...structuredClone(pet), trait };
    if (trait === 'Aggressive')
        granted = { ...granted, attack: Math.round(n('attack') * 1.15) };
    else if (trait === 'Battleborn')
        granted = { ...granted, attack: Math.round(n('attack') * 1.1), hp: Math.round(n('hp') * 1.1), defense: Math.round(n('defense') * 1.1), speed: Math.round(n('speed') * 1.1) };
    else if (trait === 'Guardian')
        granted = { ...granted, hp: Math.round(n('hp') * 1.2), defense: Math.round(n('defense') * 1.2) };
    else if (trait === 'Swift')
        granted = { ...granted, speed: Math.round(n('speed') * 1.2) };
    return { ok: true, trait, character: { ...character, pets: [...pets, granted] } };
}
