import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';

export const GLOBAL_JUTSU_VARIANTS = ['baseline', 'attack-5', 'attack-6', 'utility', 'expanded'] as const;
export type GlobalJutsuVariant = typeof GLOBAL_JUTSU_VARIANTS[number];

/** Explicit historical selections keep roster additions out of the baseline. */
export function globalJutsuLoadoutIds(
    discipline: string, element: string, slots: number, utilityRotation: number,
    variant: GlobalJutsuVariant = 'baseline',
): string[] {
    const styles = ['nin', 'gen', 'tai', 'buki'];
    const baseElement = element.toLowerCase();
    if (!styles.includes(discipline)) throw new Error(`Unknown discipline: ${discipline}`);
    if (!['earth', 'wind', 'lightning', 'fire', 'water'].includes(baseElement)) throw new Error(`Unknown element: ${element}`);
    if (![6, 12, 15].includes(slots)) throw new Error('--slots must be 6, 12 or 15');
    if (![0, 1, 2].includes(utilityRotation)) throw new Error('--utility-rotation must be 0, 1 or 2');
    if (!GLOBAL_JUTSU_VARIANTS.includes(variant)) throw new Error(`Unknown variant: ${variant}`);
    const prefix = `starter-${discipline}-${baseElement}-`;
    const ids = ['1', '2', '3', '4', 'aoe'].map(suffix => prefix + suffix);
    ids.push('starter-universal-flicker');
    const otherStyles = styles.filter(style => style !== discipline);
    if (slots > 6) {
        for (const style of otherStyles) {
            if (slots === 12 && style === otherStyles[utilityRotation]) continue;
            for (const suffix of ['1', '3', '4']) ids.push(`starter-${style}-${baseElement}-${suffix}`);
        }
    }
    const replacements: Record<string, string> = {};
    if (variant === 'attack-5' || variant === 'attack-6') replacements[prefix + '2'] = prefix + variant.slice(-1);
    if (variant === 'utility') replacements[prefix + '1'] = `starter-any-${baseElement}-1`;
    // A legal attack-heavy alternative: all four attacks, the new utility, Flicker.
    if (variant === 'expanded') {
        replacements[prefix + '1'] = prefix + '5';
        replacements[prefix + '3'] = prefix + '6';
        replacements[prefix + '4'] = `starter-any-${baseElement}-1`;
    }
    const selected = ids.map(id => replacements[id] ?? id).sort();
    if (selected.length !== slots || new Set(selected).size !== slots || selected.some(id => !JUTSU_CATALOG[id])) {
        throw new Error(`Invalid ${slots}-slot ${discipline}/${element}/${variant} loadout`);
    }
    return selected;
}
