/**
 * The four story finales transform once, at half health, and regain a quarter
 * of their health as they do. Each form keeps its Kage's element and fighting
 * style, swaps two utility techniques for stronger signatures that the AI then
 * leads with, hits harder, and adds one mechanic the player has to answer.
 *
 * BALANCE. The finales were already tuned close to the edge
 * (scripts/story-late-balance.test.ts: every prepared reference build must
 * still win). A 25% heal alone made two of them unwinnable for some builds, so
 * every form also has a COST: holding it burns the Kage's own health each turn
 * (a limiter burn or the form's upkeep), and most forms take more damage. The
 * numbers below are the ones that keep all eight reference builds winning in
 * every village. Re-run that test after changing any of them.
 *
 * Plans are sealed into the solo-PvE session when the fight is built
 * (api/solo-pve/_boss-transformation-registry.ts), so editing this file never
 * changes a fight already in progress.
 */
import type { BossTransformationPlan } from '../../shared/boss-transformations.js';
import type { StoryKageVillage } from '../../shared/story-kage.js';

const HALF = 50;
const QUARTER_HEAL = 25;

export const STORY_KAGE_TRANSFORMATIONS: Record<StoryKageVillage, BossTransformationPlan> = {
    'Stormveil Village': {
        id: 'story-kage-stormveil',
        phases: [{
            id: 'thunder-god-shroud',
            atHpPct: HALF,
            formName: 'Thunder God Shroud',
            portrait: '/portraits/cinematic/storywide/kage-raiko-veyr-thunder-shroud.webp',
            sprite: '/combat-actors/forms/raiko-thunder-god-shroud-idle.webp',
            aura: 'storm',
            cutscene: {
                speaker: 'Raiko Veyr',
                lines: [
                    'You cut through the storm. Now you will stand inside it.',
                    'Every bolt in Stormveil answers to me. Kneel, or be struck down.',
                ],
            },
            summary: 'Lightning wraps his body and he recovers a quarter of his health. His techniques hit 5% harder and the shroud turns most attacks aside, but holding it costs him 4% of his health every turn.',
            damageMult: 1.05,
            damageTakenMult: 0.85,
            healPct: QUARTER_HEAL,
            upkeepPct: 4,
            moveset: {
                remove: ['starter-nin-water-1', 'starter-buki-water-1'],
                add: ['starter-nin-lightning-6', 'starter-nin-wind-5'],
                favor: ['starter-nin-lightning-6'],
            },
            mechanic: {
                kind: 'guard-stance',
                name: 'Grounded Shroud',
                weakness: ['Earth'],
                weaknessMult: 1.4,
                tell: 'The shroud takes 15% less damage from most attacks. Earth grounds the lightning: Earth techniques hit it 40% harder.',
            },
        }],
    },
    'Ashen Leaf Village': {
        id: 'story-kage-ashen-leaf',
        phases: [{
            id: 'ember-vessel-cloak',
            atHpPct: HALF,
            formName: 'First Flame Vessel Awakened',
            portrait: '/portraits/cinematic/storywide/kage-hoshina-enju-ember-cloak.webp',
            sprite: '/combat-actors/forms/hoshina-ember-vessel-idle.webp',
            aura: 'flame',
            cutscene: {
                speaker: 'Hoshina Enju',
                lines: [
                    'The flame I carry was never mine to hold back.',
                    'Let it out, then. Let it burn this whole valley clean.',
                ],
            },
            summary: 'A cloak of living fire wraps her and she recovers a quarter of her health. She trades her earth techniques for stronger fire signatures, but the cloak leaves gaps: she takes 25% more damage.',
            damageTakenMult: 1.25,
            healPct: QUARTER_HEAL,
            moveset: {
                remove: ['starter-nin-earth-1', 'starter-tai-earth-1'],
                add: ['starter-nin-fire-5', 'starter-tai-fire-5'],
                favor: ['starter-nin-fire-5'],
            },
            mechanic: {
                kind: 'limit-burn',
                name: 'Vessel Burn',
                burnPct: 6,
                tell: 'The flame consumes its vessel. She loses 6% of her health at the end of each of her turns. Survive the blaze while it wears her down.',
            },
        }],
    },
    'Frostfang Village': {
        id: 'story-kage-frostfang',
        phases: [{
            id: 'oath-gate-release',
            atHpPct: HALF,
            formName: 'Oath-Gate Release',
            portrait: '/portraits/cinematic/storywide/kage-kael-whitefang-oath-gate.webp',
            sprite: '/combat-actors/forms/kael-oath-gate-release-idle.webp',
            aura: 'steam',
            cutscene: {
                speaker: 'Kael Whitefang',
                lines: [
                    'My body has six seals. I am breaking all of them.',
                    'Whatever is left of me afterward does not matter. You will not leave.',
                ],
            },
            summary: 'He tears open his inner seals and recovers a quarter of his health. He fights with stronger taijutsu signatures but takes 20% more damage, and the release burns his own health every turn.',
            damageTakenMult: 1.2,
            healPct: QUARTER_HEAL,
            moveset: {
                remove: ['starter-buki-water-1', 'starter-gen-lightning-3'],
                add: ['starter-tai-lightning-5', 'starter-tai-water-5'],
                favor: ['starter-tai-lightning-5'],
            },
            mechanic: {
                kind: 'limit-burn',
                name: 'Burning Seals',
                burnPct: 6,
                tell: 'He loses 6% of his health at the end of each of his turns. Outlast the burst while the release wears him down.',
            },
        }],
    },
    'Moonshadow Village': {
        id: 'story-kage-moonshadow',
        phases: [{
            id: 'moon-hermit-attunement',
            atHpPct: HALF,
            formName: 'Moon Hermit Attunement',
            portrait: '/portraits/cinematic/storywide/kage-sable-nocturne-moon-hermit.webp',
            sprite: '/combat-actors/forms/sable-moon-hermit-idle.webp',
            aura: 'moon',
            cutscene: {
                speaker: 'Sable Nocturne',
                lines: [
                    'Be still. The moon is speaking through me now.',
                    'When it finishes its verse, you will not remember your own name.',
                ],
            },
            summary: 'Moonlight marks her eyes and she recovers a quarter of her health. She trades two lesser illusions for stronger signatures and gathers a Moonfall Requiem, but the borrowed light leaves her exposed: she takes 20% more damage and loses 6% of her health every turn.',
            damageTakenMult: 1.2,
            healPct: QUARTER_HEAL,
            upkeepPct: 6,
            moveset: {
                remove: ['starter-gen-water-1', 'starter-gen-wind-1'],
                add: ['starter-gen-water-5', 'starter-gen-wind-5'],
                favor: ['starter-gen-water-5'],
            },
            mechanic: {
                kind: 'charged-strike',
                name: 'Moonfall Requiem',
                damagePct: 10,
                breakPct: 6,
                everyRounds: 3,
                staggerDamageTakenMult: 1.25,
                tell: 'She draws the moon down for one turn. Deal 6% of her health or stun her before her next turn to break it and stagger her.',
            },
        }],
    },
};

export function storyKageTransformation(village: string): BossTransformationPlan | undefined {
    return Object.prototype.hasOwnProperty.call(STORY_KAGE_TRANSFORMATIONS, village)
        ? STORY_KAGE_TRANSFORMATIONS[village as StoryKageVillage]
        : undefined;
}
