import type { OrdinaryPveDifficulty, OrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';

export const ORDINARY_PVE_LABELS: Record<OrdinaryPveDifficulty, string> = {
    weaker: 'Weaker opponent', standard: 'Standard opponent', dangerous: 'Dangerous opponent', elite: 'Elite opponent',
};

export const ORDINARY_PVE_TELLS: Record<OrdinaryPveDifficulty, string> = {
    weaker: 'A less experienced fighter. Their techniques and tactics match their level.',
    standard: 'A trained fighter with techniques suited to their level.',
    dangerous: 'Watch their offensive combinations and specialized counterplay.',
    elite: 'Elite threat: expect planned bursts, positioning and specialized counterplay.',
};

/** This view only describes the server's roll. It never chooses a new enemy. */
export function encounterLabel(encounter: Pick<OrdinaryPveEncounter, 'difficulty' | 'level'>): string {
    return `Lv ${encounter.level} · ${ORDINARY_PVE_LABELS[encounter.difficulty]}`;
}

const PORTRAIT_KEYS = new Set(['bruiser', 'skirmisher', 'assassin', 'elementalist', 'defender', 'bandit', 'nightblade', 'rivalMiner', 'nemesis']);
export function ordinaryPvePortrait(encounter: OrdinaryPveEncounter): string | undefined {
    if (/^Tsukika\b/i.test(encounter.displayName) && encounter.portraitKey === 'nightblade'
        && (!encounter.portraitImage || encounter.portraitImage === '/portraits/pve/nightblade.webp')) return '/portraits/pve/tsukika.webp';
    if (encounter.portraitImage) return encounter.portraitImage;
    return PORTRAIT_KEYS.has(encounter.portraitKey) ? `/portraits/pve/${encounter.portraitKey}.webp` : undefined;
}

export function namedPvePortrait(name: string): string | undefined {
    return /^Kagero\b/i.test(name) ? '/portraits/pve/nemesis.webp' : undefined;
}

