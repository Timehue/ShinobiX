"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAFETERIA_MEALS = void 0;
exports.cafeteriaMeal = cafeteriaMeal;
exports.applyCafeteriaMeal = applyCafeteriaMeal;
exports.CAFETERIA_MEALS = {
    'small-ramen': { id: 'small-ramen', name: 'Small Ramen', cost: 20, hp: 25, chakra: 10, stamina: 10 },
    'shinobi-meal': { id: 'shinobi-meal', name: 'Shinobi Meal', cost: 50, hp: 75, chakra: 35, stamina: 35 },
    feast: { id: 'feast', name: 'Feast', cost: 100, hp: 9999, chakra: 9999, stamina: 9999 },
};
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function cafeteriaMeal(id) {
    const key = String(id ?? '');
    return exports.CAFETERIA_MEALS[key] ?? null;
}
function applyCafeteriaMeal(character, meal) {
    const ryo = num(character.ryo);
    if (ryo < meal.cost)
        return { ok: false, error: `Not enough ryo. ${meal.name} costs ${meal.cost}.` };
    const maxHp = num(character.maxHp);
    const maxChakra = num(character.maxChakra);
    const maxStamina = num(character.maxStamina);
    return {
        ok: true,
        character: {
            ...character,
            ryo: ryo - meal.cost,
            hp: Math.min(maxHp, num(character.hp) + meal.hp),
            chakra: Math.min(maxChakra, num(character.chakra) + meal.chakra),
            stamina: Math.min(maxStamina, num(character.stamina) + meal.stamina),
        },
    };
}
