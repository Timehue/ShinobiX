/**
 * Fixed-stat Chronicle records for companions that earn arena renown. The
 * owned pet's nickname and deed live in server-owned provenance metadata; the
 * combat card stays catalog-stable so a renamed or evolved pet cannot mutate a
 * competitive deck.
 */
export type ChroniclePetWitnessSource = {
    id: string;
    name: string;
    element: 'Fire' | 'Water' | 'Earth' | 'Wind' | 'Lightning';
    image: string;
    lore: string;
    attack: number;
    defense: number;
};

export const CHRONICLE_PET_WITNESS_SOURCES = Object.freeze([
    {
        id: 'pet-witness-fire', name: 'Emberbound Witness', element: 'Fire',
        image: '/pet-evos/starter-fire-r.webp', attack: 1_900, defense: 1_500,
        lore: 'A bonded beast remembers the heat of the deed after every written account has gone cold.',
    },
    {
        id: 'pet-witness-water', name: 'Tidebound Witness', element: 'Water',
        image: '/pet-evos/starter-water-r.webp', attack: 1_500, defense: 1_900,
        lore: 'Water carries a true name farther than rumor. The scribes pressed this record from a companion’s memory.',
    },
    {
        id: 'pet-witness-wind', name: 'Galebound Witness', element: 'Wind',
        image: '/pet-evos/starter-wind-r.webp', attack: 1_800, defense: 1_600,
        lore: 'No archive kept the footfalls. A companion heard them in the wind and led the scribes back.',
    },
    {
        id: 'pet-witness-lightning', name: 'Stormbound Witness', element: 'Lightning',
        image: '/pet-evos/starter-lightning-r.webp', attack: 2_000, defense: 1_400,
        lore: 'The flash vanished in an instant. The bond that witnessed it did not.',
    },
    {
        id: 'pet-witness-earth', name: 'Stonebound Witness', element: 'Earth',
        image: '/pet-evos/starter-earth-r.webp', attack: 1_400, defense: 2_000,
        lore: 'Stone keeps pressure, tracks, and promises. This companion kept all three until the Chronicle arrived.',
    },
] as const satisfies readonly ChroniclePetWitnessSource[]);
