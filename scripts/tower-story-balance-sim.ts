/** Real-engine Story balance model. Fixtures are explicit training/gear assumptions,
 * not a claim about live cohorts. Run: node --import tsx scripts/tower-story-balance-sim.ts
 */
import { pathToFileURL } from 'node:url';
import { aiStatsForLevel } from '../api/_ai-level-curves.js';
import { maxHpForLevel, maxChakraForLevel, maxStaminaForLevel, earnedForLevel, rankFromLevel, STAT_KEYS, type Stats } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import { FLOOR_CATALOG, getFloor } from '../api/towers/_floor-catalog.js';
import { makeRng } from '../api/towers/_sim.js';
import { runFloorSmart } from './spire-balance-sim.js';
import { sealPveDifficultyBand } from '../api/_pve-band-seal.js';
import { sealPveAiMastery } from '../api/_pve-ai-mastery.js';
import { applyTowerRouteChoice, TOWER_ROUTE_CHOICES } from '../api/towers/_route-choice.js';
import type { TowerRouteChoiceId } from '../api/towers/_route-choice.js';
import { sealTowerFighter } from '../api/towers/_seal.js';
import { createCharacter } from '../shinobij.client/src/lib/create-character.js';
import { starterJutsus, starterSavedBloodlines } from '../shinobij.client/src/data/jutsu.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { buildNamedItem } from '../api/craft/_named.js';

export const STORY_BALANCE_FIXTURE = 'progression-gear-v5';
export const STORY_COMPOSITIONS = ['mixed', 'ninjutsu', 'bukijutsu', 'taijutsu', 'genjutsu'] as const;
export type StoryComposition = typeof STORY_COMPOSITIONS[number];
/** Retained lower-power control, never the expected equipment of a level-70 player. */
export const STORY_SQUAD_GEAR = {
    head: 'iron-kabuto', body: 'rare-chest-plate', waist: 'chain-obi',
    legs: 'rare-greaves', feet: 'rare-tabi',
} as const;
export type StoryGearProfile = 'progression' | 'catalog-control' | 'high-roll' | 'sustain' | 'shield';

/** Actual purchasable/dropped tiers and legal, mid-roll forged equipment. These
 * are explicit preparation assumptions, not measurements of the live population.
 * No client-injected multipliers; ownership and passives go through the hydrator. */
export function storyGear(level: number, profile: StoryGearProfile = 'progression', specialty = 'Ninjutsu') {
    const equipment: Record<string, string> = { ...STORY_SQUAD_GEAR };
    const creatorItems: Array<Record<string, unknown>> = [];
    if (profile !== 'catalog-control') {
        if (level >= 35) for (const slot of Object.keys(equipment)) equipment[slot] += '-s3';
        const weapons = ({ Ninjutsu: ['mistfang-tanto', 'frostbite-cleaver', 'elderbranch-katana', 'ashen-dragon-katana'],
            Bukijutsu: ['ashen-leaf-saber', 'ashglass-katana', 'tempest-fang-blade', 'void-leech-nodachi'],
            Taijutsu: ['riverbone-spear', 'stormcoil-kusarigama', 'embercoil-scythe', 'glacier-king-cleaver'],
            Genjutsu: ['iron-fang-knuckles', 'moonshadow-needleblade', 'black-lotus-dagger', 'eclipse-fang-dagger'],
        } as Record<string, string[]>)[specialty]!;
        equipment.hand = level >= 80 ? weapons[3]! : level >= 65 ? weapons[2]!
            : level >= 50 ? `${weapons[1]}-s3` : level >= 35 ? `${weapons[0]}-s3` : weapons[0]!;
        if (level >= 65) Object.assign(equipment, {
            head: 'legendary-crown', body: 'legendary-chest', waist: 'legendary-waist',
            legs: 'legendary-legs', feet: 'legendary-feet', gloves: 'legendary-gloves',
        });
        if (level >= 65 && (profile === 'sustain' || profile === 'shield')) {
            const set = profile === 'sustain' ? 'crimson' : 'ironwall';
            for (const slot of ['head', 'body', 'waist', 'legs', 'feet', 'gloves']) {
                equipment[slot] = `${set}-${slot === 'head' ? 'crown' : slot === 'body' ? 'chest' : slot}`;
            }
        }
        if (level >= 90) {
            const high = profile === 'high-roll';
            const weapon = buildNamedItem({ kind: 'weapon', ep: high ? 27 : 25.5, range: high ? 5 : 4,
                offenseVal: high ? 180 : 174, tags: [{ name: 'Increase Damage Given', percent: high ? 40 : 35 }] }, 'Audit Blade', '');
            // Deterministic legal minted identities keep sealed fixture results reproducible.
            weapon.id = 'named-weapon-00000000000040008000000000000001';
            creatorItems.push(weapon); equipment.hand = weapon.id;
            for (const [index, slot] of ['head', 'body', 'waist', 'legs', 'feet', 'hand'].entries()) {
                const armor = buildNamedItem({ kind: 'armor', slot: slot as 'head' | 'body' | 'waist' | 'legs' | 'feet' | 'hand',
                    armorQuality: high ? 'Mythic' : 'Legendary', offenseVal: slot === 'hand' ? (high ? 85 : 75) : (high ? 35 : 30),
                    defenseVal: high ? 35 : 30, special: profile === 'sustain'
                        ? { kind: 'Life Steal', bonusKey: 'lifeStealPercent', value: 1.04 }
                        : profile === 'shield' ? { kind: 'Shield', bonusKey: 'shield', value: 113 }
                        : { kind: 'Increase Damage', bonusKey: 'damagePercent', value: high ? 1.5 : 1.13 } }, `Audit ${slot}`, '');
                armor.id = `named-armor-0000000000004000800000000000000${index + 1}`;
                creatorItems.push(armor); equipment[slot === 'hand' ? 'gloves' : slot] = armor.id;
            }
        }
    }
    for (const id of Object.values(equipment)) {
        const item = ITEM_CATALOG[id] ?? creatorItems.find(candidate => candidate.id === id);
        if (!item || effectiveItemLevelReq(item) > level) throw new Error(`Illegal Story fixture gear ${id} at level ${level}`);
    }
    return { equipment, creatorItems };
}

/** Preserve the reference archetype's priorities, but spend the PLAYER's earned
 * points and obey its rank caps. The frozen linear AI budget is not a player
 * progression curve and overstates ordinary mid-level preparation. */
export function storyPlayerStats(level: number, jutsu: Array<{ type?: string }> = []): Stats {
    const reference = aiStatsForLevel(level, jutsu);
    const stats = Object.fromEntries(STAT_KEYS.map(key => [key, 10])) as Stats;
    const cap = statCapForLevel(level);
    let remaining = earnedForLevel(level);
    while (remaining > 0) {
        const active = STAT_KEYS.filter(key => stats[key] < cap);
        if (!active.length) throw new Error('Player fixture cannot allocate its earned points within rank caps');
        const totalWeight = active.reduce((sum, key) => sum + Math.max(1, reference[key] - 10), 0);
        const budget = remaining;
        let spent = 0;
        for (const key of active) {
            const points = Math.min(cap - stats[key], Math.floor(budget * Math.max(1, reference[key] - 10) / totalWeight));
            stats[key] += points; spent += points;
        }
        if (!spent) for (const key of active) { if (spent >= remaining) break; stats[key]++; spent++; }
        remaining -= spent;
    }
    return stats;
}

export function storySquad(level: number, size = 4, composition: StoryComposition = 'mixed', prepared = true,
    gearProfile: StoryGearProfile = 'progression'): SquadMemberInput[] {
    return Array.from({ length: size }, (_, index) => {
        const bloodlineIndex = composition === 'mixed' ? [1, 2, 3, 0][index % 4]!
            : { ninjutsu: 1, bukijutsu: 2, taijutsu: 3, genjutsu: 0 }[composition];
        const bloodline = starterSavedBloodlines[bloodlineIndex]!;
        const specialty = bloodline.jutsus[0]!.type;
        const learned = starterJutsus.filter(jutsu => jutsu.type === specialty
            && Number(jutsu.effectPower) > 0 && jutsu.method !== 'AOE_BURST').slice(0, 2);
        const jutsu = [...bloodline.jutsus, ...learned];
        const raw = createCharacter(`Hero ${index}`, 'Ashen Leaf', specialty, bloodline.name);
        const gear = storyGear(level, gearProfile, specialty);
        Object.assign(raw, {
            level, rankTitle: rankFromLevel(level), stats: storyPlayerStats(level, bloodline.jutsus),
            earnedStatPoints: earnedForLevel(level), unspentStats: 0, examsPassed: ['genin', 'chunin', 'jonin'],
            maxHp: maxHpForLevel(level), maxChakra: maxChakraForLevel(level), maxStamina: maxStaminaForLevel(level),
            equippedBloodlineId: bloodline.id,
            equippedJutsuIds: jutsu.map(technique => technique.id),
            jutsuMastery: jutsu.map(technique => ({ jutsuId: technique.id, level: jutsuLevelCapForLevel(level), xp: 0 })),
            elements: [...new Set(learned.map(technique => technique.element).filter(Boolean))],
            equipment: prepared ? gear.equipment : {},
            inventory: prepared ? [...raw.inventory, ...Object.values(gear.equipment)] : raw.inventory,
        });
        const saveCharacter = raw as unknown as Record<string, unknown>;
        return {
            id: `sq-${index}`, name: `Hero ${index}`, ownerSlug: `hero-${index}`, ai: false,
            character: sealTowerFighter(saveCharacter, { character: saveCharacter, savedBloodlines: starterSavedBloodlines,
                creatorItems: prepared ? gear.creatorItems : [] }, {}, null),
        };
    });
}

export function simulateStoryFloor(floorId: number, size = 4, seeds = 12, level?: number, composition: StoryComposition = 'mixed', prepared = true,
    options: { routeChoice?: TowerRouteChoiceId; seedOffset?: number; gearProfile?: StoryGearProfile } = {}) {
    const floor = getFloor(floorId)!;
    let wins = 0, rounds = 0, survivors = 0, remainingHp = 0;
    for (let index = 0; index < seeds; index++) {
        const seed = 101 + (index + (options.seedOffset ?? 0)) * 7919;
        const session = buildTowerEncounter({ floor, squad: storySquad(level ?? floor.recommendedLevel ?? 30, size, composition, prepared, options.gearProfile),
            partySize: size, runId: `story-sim-${floorId}-${index}`, seed, now: 0 });
        // Match /start's deployed setup, including enemy mastery and the PvE
        // damage guard. Omitting either misrepresents real encounter pressure.
        applyTowerRouteChoice(session, options.routeChoice ?? 'rest-shrine');
        sealPveDifficultyBand(session, { mode: 'TOWER', scaleHp: false, scaleStats: false, env: {} });
        sealPveAiMastery(session, { mode: 'TOWER', env: {} });
        runFloorSmart(session, floor, makeRng(seed), { catalogUtility: true });
        if (session.status !== 'done') throw new Error(`Story floor ${floorId} stalled`);
        rounds += session.round;
        const living = session.actors.filter(actor => actor.side === 'squad' && actor.hp > 0);
        survivors += living.length;
        remainingHp += living.reduce((sum, actor) => sum + actor.hp / actor.maxHp, 0) / size;
        if (session.winner === 'squad') wins++;
    }
    return { floor: floorId, level: level ?? floor.recommendedLevel, size, seeds, composition, prepared,
        routeChoice: options.routeChoice ?? 'rest-shrine', seedOffset: options.seedOffset ?? 0,
        gearProfile: options.gearProfile ?? 'progression',
        wins, winRate: wins / seeds, rounds: rounds / seeds, survivors: survivors / seeds, hpFraction: remainingHp / seeds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const seeds = Math.max(1, Number(process.argv[2]) || 12);
    const routes = process.argv.includes('--all-routes')
        ? Object.keys(TOWER_ROUTE_CHOICES) as TowerRouteChoiceId[] : ['rest-shrine'] as const;
    const floors = process.argv.includes('--finale-only') ? [FLOOR_CATALOG[14]!] : FLOOR_CATALOG;
    const seedOffset = Math.max(0, Number(process.argv.find(arg => arg.startsWith('--seed-offset='))?.split('=')[1]) || 0);
    const gearProfile = (process.argv.find(arg => arg.startsWith('--gear='))?.split('=')[1] ?? 'progression') as StoryGearProfile;
    if (!['progression', 'catalog-control', 'high-roll', 'sustain', 'shield'].includes(gearProfile)) throw new Error('Unknown Story gear profile');
    for (const routeChoice of routes) for (const composition of STORY_COMPOSITIONS) {
        console.log(`${routeChoice} / ${composition}`);
        console.table(floors.map(floor => simulateStoryFloor(floor.id, 4, seeds, undefined, composition, true, { routeChoice, seedOffset, gearProfile })));
    }
    if (!process.argv.includes('--finale-only')) console.table([1, 5, 10, 15].map(id => simulateStoryFloor(id, 1, seeds, undefined, 'mixed', true, { gearProfile })));
}
