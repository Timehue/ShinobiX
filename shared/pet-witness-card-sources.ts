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
        lore: 'Scribes recorded this fire-aligned companion after it earned arena renown. The record belongs to the beast as well as its handler.',
    },
    {
        id: 'pet-witness-water', name: 'Tidebound Witness', element: 'Water',
        image: '/pet-evos/starter-water-r.webp', attack: 1_500, defense: 1_900,
        lore: 'The Chronicle keeps this water-aligned companion’s chosen name beside its arena record.',
    },
    {
        id: 'pet-witness-wind', name: 'Galebound Witness', element: 'Wind',
        image: '/pet-evos/starter-wind-r.webp', attack: 1_800, defense: 1_600,
        lore: 'This wind-aligned companion earned a Chronicle card through its own arena performance.',
    },
    {
        id: 'pet-witness-lightning', name: 'Stormbound Witness', element: 'Lightning',
        image: '/pet-evos/starter-lightning-r.webp', attack: 2_000, defense: 1_400,
        lore: 'The match ended, but the Chronicle kept this lightning-aligned companion’s name and deeds.',
    },
    {
        id: 'pet-witness-earth', name: 'Stonebound Witness', element: 'Earth',
        image: '/pet-evos/starter-earth-r.webp', attack: 1_400, defense: 2_000,
        lore: 'The Chronicle records this earth-aligned companion’s arena victories under its own name.',
    },
] as const satisfies readonly ChroniclePetWitnessSource[]);
