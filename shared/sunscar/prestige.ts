/** Festival prestige is cosmetic. No milestone changes combat or race stats. */
export const SUNSCAR_PRESTIGE = {
    rally: [
        { at: 60, title: 'Sunscar Sprinter', color: '#c78c65', cosmetic: 'Copper race pennant' },
        { at: 180, title: 'Dune Strider', color: '#c3d8df', cosmetic: 'Silver race pennant' },
        { at: 420, title: 'Golden Paw', color: '#ffe39e', cosmetic: 'Gold race pennant' },
        { at: 850, title: 'Rally Elite', color: '#b8d9c0', cosmetic: 'Jade race pennant' },
        { at: 1500, title: 'Sunscar Champion', color: '#e2c6ff', cosmetic: 'Champion race pennant' },
    ],
    caravan: [
        { at: 40, title: 'Sunscar Trailhand', color: '#c78c65', cosmetic: 'Copper dispatch seal' },
        { at: 120, title: 'Caravan Guard', color: '#c3d8df', cosmetic: 'Silver dispatch seal' },
        { at: 300, title: 'Desert Guide', color: '#ffe39e', cosmetic: 'Gold dispatch seal' },
        { at: 650, title: 'Master Escort', color: '#b8d9c0', cosmetic: 'Jade dispatch seal' },
        { at: 1200, title: 'Sunscar Pathfinder', color: '#e2c6ff', cosmetic: 'Pathfinder dispatch seal' },
    ],
} as const;
export const SUNSCAR_TITLES = Object.values(SUNSCAR_PRESTIGE).flatMap(rows => rows.map(row => row.title));
export function festivalPrestige(mode: keyof typeof SUNSCAR_PRESTIGE, reputation: number) { return [...SUNSCAR_PRESTIGE[mode]].reverse().find(row => reputation >= row.at); }
