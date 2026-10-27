import type { TowerFloor } from './_floor-catalog.js';
import type { EnemyTemplate } from './_enemy-templates.js';

/** Authored floor growth, independent of the entering roster or its gear.
 * Applied once before sealing actors, including delayed waves and phase summons.
 * Bosses keep their individually authored HP/mechanics; ordinary enemies need
 * enough durability to execute their kits against a coordinated four-player squad.
 */
export function storyTowerEnemy(template: EnemyTemplate, floor: TowerFloor): EnemyTemplate {
    if (floor.squadBalance !== 'four-player-v1') return template;
    const step = Math.max(0, Math.min(14, floor.id - 1));
    const result = structuredClone(template);
    result.level = Math.max(template.level, floor.recommendedLevel ?? 30);
    if (!template.boss) {
        // Square-root role weight preserves sturdy tanks/fragile ranged units
        // without multiplying Chapter 2's already larger HP into a time wall.
        const roleWeight = Math.max(0.95, Math.sqrt(template.hp / 500));
        // Calibrated against level-appropriate upgraded gear and legal weapon +
        // technique rotations, including legendary kits around level 70.
        result.hp = Math.round((4_400 + step * 300) * roleWeight);
        for (const [key, value] of Object.entries(result.stats)) {
            if (key.endsWith('Offense')) result.stats[key] = Math.max(
                Math.round(value * (1 + step * 0.035)), floor.id >= 5 ? 600 + step * 110 : 0);
        }
        if (floor.id >= 5) {
            // Old Chapter 1 secondaries stayed near level-40 values even at 75.
            // Train the enemy composites with the floor rather than stretching
            // HP alone; this also keeps the 90–100 climb dangerous with forged gear.
            const generalFloor = Math.max(0, (floor.recommendedLevel ?? 30) - 45) * 30;
            for (const key of ['strength', 'speed', 'intelligence', 'willpower']) {
                result.stats[key] = Math.max(result.stats[key] ?? 0, generalFloor);
            }
        }
    }
    // Ordinary enemies and the early bosses omitted off-discipline defenses.
    // Retain stronger authored defenses, while preventing an absent field from
    // becoming an undefended damage lane against a four-discipline squad.
    for (const discipline of ['taijutsu', 'bukijutsu', 'genjutsu', 'ninjutsu']) {
        const key = `${discipline}Defense`;
        result.stats[key] = Math.max(result.stats[key] ?? 0, 450 + step * 65);
    }
    return result;
}
