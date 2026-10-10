import type { TacticsAllocation, TacticsBuild, TacticsElement, TacticsMove, TacticsSpecies } from './pet-tactics-contract.js';

const move = (id: string, name: string, kind: TacticsMove['kind'], target: TacticsMove['target'], cost: number,
    effect: string, options: Partial<TacticsMove> = {}): TacticsMove => ({
    id, name, kind, target, cost, effect, element: 'None', cls: 'status', power: 0,
    priority: 1, hold: 0, cooldown: 0, ...options,
});
const elements: TacticsElement[] = ['Fire', 'Water', 'Wind', 'Lightning', 'Earth'];
const techniques = elements.flatMap(element => {
    const key = element.toLowerCase();
    return [
        move(`${key}-strike`, `${element} Strike`, 'damage', 'foe', 20, 'Efficient physical pressure.', { element, cls: 'physical', power: 85, priority: 1.1 }),
        move(`${key}-pulse`, `${element} Pulse`, 'damage', 'foe', 26, 'Special pressure against physical defenses.', { element, cls: 'special', power: 100 }),
        move(`${key}-breaker`, `${element} Breaker`, 'damage', 'foe', 46, 'Heavy impact. Slow, expensive, needs one field round.', { element, cls: 'physical', power: 150, priority: .8, hold: 1 }),
        move(`${key}-sky`, `${element} Sky`, 'weather', 'self', 28, `For three rounds, ${element} attacks gain 15%. An opposing sky replaces it.`, { element, cooldown: 3 }),
    ];
});
const utility = [
    move('ember-scar', 'Ember Scar', 'burn', 'foe', 30, 'Light special hit; burns for 4% maximum HP on the next two rounds.', { element: 'Fire', cls: 'special', power: 60 }),
    move('open-wound', 'Open Wound', 'wound', 'foe', 28, 'Physical hit; halves healing for this round and the next two.', { cls: 'physical', power: 75 }),
    move('expose', 'Expose', 'mark', 'foe', 20, 'For this round and the next, this slot occupant takes 30% more damage. Cleanse removes it.', { priority: 1.25 }),
    move('undertow', 'Undertow', 'slow', 'foe', 26, 'Special hit; lowers speed by 25% for the next two rounds.', { element: 'Water', cls: 'special', power: 65 }),
    move('bind', 'Thunder Bind', 'stun', 'foe', 42, 'Denies one action. Shared control immunity prevents another bind for three rounds.', { element: 'Lightning', cooldown: 3, hold: 1, priority: .9 }),
    move('mend', 'Mend', 'heal', 'ally', 36, 'Restore 18% of an active ally’s maximum HP. Two-round cooldown.', { cooldown: 2 }),
    move('aegis', 'Aegis', 'shield', 'ally', 28, 'Absorb 18% of an active ally’s maximum HP until next round ends.', { priority: 1.2 }),
    move('purify', 'Purify', 'cleanse', 'ally', 22, 'Remove burn, wound, mark, slow and bind. Control immunity remains.', { priority: 1.3 }),
    move('protect', 'Perfect Guard', 'protect', 'self', 32, 'Block direct hits this round. Burn and attrition still apply. Three-round cooldown.', { cooldown: 3 }),
    move('intercept', 'Intercept', 'redirect', 'self', 26, 'Before attacks, take single-target attacks aimed at your partner this round, at 70% damage. Spread effects bypass it.'),
    move('rally', 'Rally', 'buff', 'ally', 26, 'Raise an ally’s physical and special power by 20% for this round and the next two.', { priority: 1.2 }),
];
export const TACTICS_MOVES: Readonly<Record<string, TacticsMove>> = Object.freeze(Object.fromEntries([...techniques, ...utility].map(m => [m.id, m])));
export const TACTICS_BASIC: TacticsMove = move('basic', 'Quick Jab', 'damage', 'foe', 6, 'Weak neutral fallback. Uses physical power.', { cls: 'physical', power: 50, priority: 1.15 });
export const TACTICS_ITEMS = [
    { id: 'reserve-cell', name: 'Reserve Cell', effect: 'Recover 4 extra stamina per round on the bench.' },
    { id: 'ward-charm', name: 'Ward Charm', effect: 'Start with a shield worth 8% of maximum HP. It expires after round two.' },
    { id: 'focus-lens', name: 'Focus Lens', effect: 'Neutral attacks gain 10% damage; elemental attacks gain nothing.' },
] as const;

const profiles: Record<string, TacticsSpecies['stats']> = {
    striker: { hp: 850, attack: 105, spAttack: 70, defense: 75, spDefense: 70, speed: 85 },
    caster: { hp: 820, attack: 60, spAttack: 110, defense: 70, spDefense: 80, speed: 85 },
    sentinel: { hp: 1050, attack: 70, spAttack: 60, defense: 100, spDefense: 105, speed: 45 },
    medic: { hp: 920, attack: 60, spAttack: 80, defense: 80, spDefense: 90, speed: 70 },
    scout: { hp: 800, attack: 90, spAttack: 80, defense: 70, spDefense: 70, speed: 105 },
    balanced: { hp: 900, attack: 85, spAttack: 85, defense: 80, spDefense: 80, speed: 80 },
};
const offense: TacticsAllocation = { vitality: 12, power: 25, guard: 6, agility: 6 };
const support: TacticsAllocation = { vitality: 18, power: 6, guard: 19, agility: 6 };
const tempo: TacticsAllocation = { vitality: 12, power: 12, guard: 0, agility: 25 };

function species(id: string, name: string, element: TacticsElement, rarity: string, role: string,
    trait: TacticsSpecies['trait'], tools: string[], signatureKind: 'damage' | 'heal' | 'shield' | 'buff' = 'damage'): TacticsSpecies {
    const key = element.toLowerCase();
    const coverage = `${({ Fire: 'Earth', Water: 'Wind', Wind: 'Water', Lightning: 'Fire', Earth: 'Lightning', None: 'Earth' } as const)[element].toLowerCase()}-pulse`;
    const base = [`${key}-strike`, `${key}-pulse`, `${key}-breaker`, coverage];
    const pool = [...base, ...tools];
    const traitText = { steady: 'First cast earns 5 extra meter once per battle.', medic: 'Healing you cast is 10% stronger.', sentinel: 'Shields you cast are 10% stronger.', scout: 'Rest restores 5 extra stamina.' }[trait];
    const signature = move(`${id}-signature`, `${name}: ${signatureKind === 'damage' ? 'Final Art' : signatureKind === 'heal' ? 'Renewal' : signatureKind === 'shield' ? 'Sanctuary' : 'Ascendance'}`,
        signatureKind, signatureKind === 'damage' ? 'foe' : 'team', 30,
        signatureKind === 'damage' ? 'Single-target strike: capped at 60% target maximum HP, or 75% with Rally, Expose or matching Sky. Full meter, three field rounds and 30 stamina. One signature per team per round.'
            : signatureKind === 'heal' ? 'Heal both active allies for 20% maximum HP. Wounds reduce it. Full meter and 30 stamina.'
                : signatureKind === 'shield' ? 'Shield both active allies for 22% maximum HP until next round ends. Full meter and 30 stamina.'
                    : 'Raise both active allies’ power by 20% for this round and the next two. Full meter and 30 stamina.',
        { element, cls: signatureKind === 'damage' ? role === 'striker' || role === 'scout' ? 'physical' : 'special' : 'status', power: signatureKind === 'damage' ? 180 : 0, hold: 3, priority: .75 });
    return { id, name, element, rarity, role, stats: profiles[role], trait, traitText, pool, signature, builds: [
        { name: 'Pressure', moves: [base[0], base[1], base[2], tools[0]], allocation: role === 'scout' ? tempo : offense },
        { name: 'Tactics', moves: [base[1], coverage, ...tools.slice(1, 3)], allocation: role === 'scout' ? tempo : support },
    ] };
}

/** Equal-access competitive profiles. Rarity is cosmetic; no save stat is used. */
export const TACTICS_ROSTER: readonly TacticsSpecies[] = [
    species('starter-fire', 'Cinder Cub', 'Fire', 'standard', 'striker', 'steady', ['ember-scar', 'expose', 'rally', 'protect']),
    species('starter-water', 'Ripple Seal', 'Water', 'standard', 'medic', 'medic', ['undertow', 'mend', 'purify', 'aegis'], 'heal'),
    species('starter-wind', 'Gale Chick', 'Wind', 'standard', 'scout', 'scout', ['expose', 'rally', 'protect', 'wind-sky']),
    species('starter-lightning', 'Spark Pup', 'Lightning', 'standard', 'scout', 'steady', ['bind', 'expose', 'rally', 'protect']),
    species('starter-earth', 'Pebble Tortoise', 'Earth', 'standard', 'sentinel', 'sentinel', ['open-wound', 'intercept', 'aegis', 'purify'], 'shield'),
    species('starter-fire-r', 'Ember Wolf', 'Fire', 'rare', 'balanced', 'steady', ['open-wound', 'expose', 'protect', 'fire-sky']),
    species('starter-water-r', 'Tidal Selkie', 'Water', 'rare', 'caster', 'medic', ['undertow', 'aegis', 'purify', 'mend']),
    species('starter-wind-r', 'Storm Hawk', 'Wind', 'rare', 'caster', 'scout', ['expose', 'rally', 'protect', 'wind-sky']),
    species('starter-lightning-r', 'Bolt Fang', 'Lightning', 'rare', 'striker', 'steady', ['bind', 'open-wound', 'protect', 'expose']),
    species('starter-earth-r', 'Granite Tortoise', 'Earth', 'rare', 'balanced', 'sentinel', ['open-wound', 'intercept', 'protect', 'aegis']),
    species('starter-water-l', 'Abyssal Leviathan', 'Water', 'legendary', 'sentinel', 'medic', ['undertow', 'mend', 'intercept', 'purify'], 'heal'),
    species('mythic-0', 'Eclipse Kitsune', 'Wind', 'mythic', 'balanced', 'scout', ['expose', 'purify', 'rally', 'wind-sky'], 'buff'),
];
export const tacticsSpecies = (id: string): TacticsSpecies | undefined => TACTICS_ROSTER.find(p => p.id === id);
export function tacticsPreset(speciesId: string, preset = 0): TacticsBuild {
    const pet = tacticsSpecies(speciesId);
    if (!pet) throw new Error('Unknown competitive species.');
    const build = pet.builds[preset] ?? pet.builds[0];
    return { speciesId, moveIds: [...build.moves], allocation: { ...build.allocation }, item: 'reserve-cell' };
}
