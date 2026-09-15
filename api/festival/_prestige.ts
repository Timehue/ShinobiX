import { SUNSCAR_PRESTIGE } from '../../shared/sunscar/prestige.js';
export function grantFestivalTitles(character: Record<string, unknown>, mode: keyof typeof SUNSCAR_PRESTIGE, reputation: number) {
    const existing = Array.isArray(character.serverTitles) ? character.serverTitles.filter((t): t is string => typeof t === 'string') : [];
    return [...new Set([...existing, ...SUNSCAR_PRESTIGE[mode].filter(row => reputation >= row.at).map(row => row.title)])];
}
