"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENEMY_TEMPLATE_IDS = void 0;
exports.getEnemyTemplate = getEnemyTemplate;
exports.hasEnemyTemplate = hasEnemyTemplate;
const TEMPLATES = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', hp: 500, visual: 'bandit',
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', hp: 450, visual: 'archer',
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
    },
    'grunt-blocker': {
        name: 'Shieldman', specialty: 'Taijutsu', hp: 850, visual: 'blocker',
        stats: { taijutsuOffense: 400, taijutsuDefense: 850, strength: 300, speed: 100 },
    },
    'grunt-brute': {
        name: 'Brute', specialty: 'Taijutsu', hp: 950, visual: 'brute',
        stats: { taijutsuOffense: 800, taijutsuDefense: 600, strength: 400, speed: 120 },
    },
    'grunt-acolyte': {
        name: 'Acolyte', specialty: 'Ninjutsu', hp: 420, visual: 'acolyte',
        stats: { ninjutsuOffense: 750, ninjutsuDefense: 350, willpower: 250, intelligence: 200 },
    },
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', hp: 4200, visual: 'warden', boss: true,
        stats: { ninjutsuOffense: 1200, ninjutsuDefense: 950, willpower: 450, speed: 300 },
    },
    'boss-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', hp: 4800, visual: 'ravager', boss: true,
        stats: { taijutsuOffense: 1300, taijutsuDefense: 1000, strength: 500, speed: 260 },
    },
    'npc-genin': {
        name: 'Allied Genin', specialty: 'Taijutsu', hp: 600, visual: 'genin',
        stats: { taijutsuOffense: 350, taijutsuDefense: 350 },
    },
};
// Defensive fallback so a misconfigured aiId yields a weak grunt rather than crashing
// the encounter build (the catalog validator + test are the real guard).
const FALLBACK = {
    name: 'Shade', specialty: 'Taijutsu', hp: 300, visual: 'bandit',
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};
function getEnemyTemplate(aiId) {
    return TEMPLATES[aiId] ?? FALLBACK;
}
function hasEnemyTemplate(aiId) {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}
exports.ENEMY_TEMPLATE_IDS = Object.keys(TEMPLATES);
