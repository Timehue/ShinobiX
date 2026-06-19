"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENEMY_TEMPLATE_IDS = void 0;
exports.getEnemyTemplate = getEnemyTemplate;
exports.hasEnemyTemplate = hasEnemyTemplate;
const TEMPLATES = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', hp: 500,
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', hp: 450,
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
    },
    'grunt-blocker': {
        name: 'Blocker', specialty: 'Taijutsu', hp: 800,
        stats: { taijutsuOffense: 400, taijutsuDefense: 800, strength: 300, speed: 100 },
    },
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', hp: 3000,
        stats: { ninjutsuOffense: 1200, ninjutsuDefense: 900, willpower: 400, speed: 300 },
    },
    'npc-genin': {
        name: 'Allied Genin', specialty: 'Taijutsu', hp: 400,
        stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
    },
};
// Defensive fallback so a misconfigured aiId yields a weak grunt rather than crashing
// the encounter build (the catalog validator + test are the real guard).
const FALLBACK = {
    name: 'Shade', specialty: 'Taijutsu', hp: 300,
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};
function getEnemyTemplate(aiId) {
    return TEMPLATES[aiId] ?? FALLBACK;
}
function hasEnemyTemplate(aiId) {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}
exports.ENEMY_TEMPLATE_IDS = Object.keys(TEMPLATES);
