"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NAMED_FORGE_COST = void 0;
exports.rollNamedForge = rollNamedForge;
exports.debitNamedForge = debitNamedForge;
exports.buildNamedItem = buildNamedItem;
const node_crypto_1 = require("node:crypto");
exports.NAMED_FORGE_COST = 1000;
const CURRENCY_POINTS = { boneCharms: 5, fateShards: 5, auraStones: 25, mythicSeals: 75 };
const WEAPON_TAGS = ['Siphon', 'Absorb', 'Poison', 'Wound', 'Reflect', 'Shield', 'Drain', 'Ignition', 'Heal', 'Increase Damage Given', 'Increase Generals', 'Decrease Damage Taken'];
const ARMOR_SPECIALS = [
    { kind: 'Absorb', bonusKey: 'absorbPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Shield', bonusKey: 'shield', min: 75, max: 150, decimals: 0 },
    { kind: 'Reflect', bonusKey: 'reflectPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Life Steal', bonusKey: 'lifeStealPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Increase Damage', bonusKey: 'damagePercent', min: 0.75, max: 1.5, decimals: 2 },
];
const SLOTS = ['head', 'body', 'waist', 'legs', 'feet', 'hand'];
const pick = (values) => values[(0, node_crypto_1.randomInt)(values.length)];
function rollNamedForge(kind, slotRaw) {
    if (kind === 'weapon') {
        const tags = [...WEAPON_TAGS].sort(() => (0, node_crypto_1.randomInt)(3) - 1);
        const single = (0, node_crypto_1.randomInt)(2) === 0;
        return { kind, ep: (0, node_crypto_1.randomInt)(30, 36), range: pick([3, 4, 5]), offenseVal: (0, node_crypto_1.randomInt)(168, 181), tags: single ? [{ name: tags[0], percent: (0, node_crypto_1.randomInt)(35, 41) }] : [{ name: tags[0], percent: (0, node_crypto_1.randomInt)(15, 21) }, { name: tags[1], percent: (0, node_crypto_1.randomInt)(15, 21) }] };
    }
    const slot = SLOTS.includes(slotRaw) ? slotRaw : 'body';
    const special = pick(ARMOR_SPECIALS);
    const raw = special.decimals === 0 ? (0, node_crypto_1.randomInt)(special.min, special.max + 1) : special.min + ((0, node_crypto_1.randomInt)(1_000_000) / 1_000_000) * (special.max - special.min);
    return { kind, slot, armorQuality: pick(['Elite', 'Legendary', 'Mythic']), offenseVal: (0, node_crypto_1.randomInt)(25, 36), defenseVal: (0, node_crypto_1.randomInt)(25, 36), special: { kind: special.kind, bonusKey: special.bonusKey, value: Number(raw.toFixed(special.decimals)) } };
}
function debitNamedForge(character) {
    const total = Object.entries(CURRENCY_POINTS).reduce((sum, [key, points]) => sum + Math.max(0, Math.floor(Number(character[key]) || 0)) * points, 0);
    if (total < exports.NAMED_FORGE_COST)
        return null;
    const next = { ...character };
    let remaining = exports.NAMED_FORGE_COST;
    for (const [key, points] of Object.entries(CURRENCY_POINTS)) {
        const held = Math.max(0, Math.floor(Number(next[key]) || 0));
        const used = Math.min(held, Math.ceil(remaining / points));
        next[key] = held - used;
        remaining -= used * points;
    }
    return next;
}
function buildNamedItem(roll, nameRaw, flavorRaw) {
    const id = `named-${roll.kind}-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
    if (roll.kind === 'weapon') {
        const name = nameRaw || 'Named Weapon';
        const tagDesc = roll.tags.map((tag) => `${tag.name} ${tag.percent}%`).join(', ');
        return { id, name, slot: 'hand', rarity: 'legendary', cost: 0, description: flavorRaw || `A master-forged weapon. Tags: ${tagDesc}.`, weaponEp: roll.ep, apCost: 40, weaponRange: roll.range, weaponCooldown: 5, weaponTags: roll.tags, flavorText: flavorRaw || undefined, bonuses: { ninjutsuOffense: roll.offenseVal, taijutsuOffense: roll.offenseVal, bukijutsuOffense: roll.offenseVal, genjutsuOffense: roll.offenseVal } };
    }
    const slotLabel = roll.slot === 'hand' ? 'Gloves' : roll.slot[0].toUpperCase() + roll.slot.slice(1);
    let name = nameRaw || `Named ${slotLabel}`;
    if (roll.slot === 'hand' && !/glove|gauntlet/i.test(name))
        name += ' Gauntlets';
    const reduction = roll.armorQuality === 'Elite' ? 6 : roll.armorQuality === 'Legendary' ? 7 : 8;
    return { id, name, slot: roll.slot, rarity: 'legendary', armorQuality: roll.armorQuality, cost: 0, levelReq: 30, description: flavorRaw || `A master-forged ${slotLabel.toLowerCase()} piece. ${reduction}% damage reduction. ${roll.special.kind} ${roll.special.value}.`, flavorText: flavorRaw || undefined, bonuses: { ninjutsuOffense: roll.offenseVal, taijutsuOffense: roll.offenseVal, bukijutsuOffense: roll.offenseVal, genjutsuOffense: roll.offenseVal, ninjutsuDefense: roll.defenseVal, taijutsuDefense: roll.defenseVal, bukijutsuDefense: roll.defenseVal, genjutsuDefense: roll.defenseVal, [roll.special.bonusKey]: roll.special.value } };
}
