/** Authored directed faults. A charge sends a crack along its branch; each exposed face
 * needs one hit. Overlapping shock waves destroy the core. No timing or speed score. */
export type FractureTemplate = {
    name: string; charges: number; faces: number; sites: { label: string; x: number; y: number; path: number[] }[];
    faults: { x: number; y: number }[];
};
export const FRACTURE_TEMPLATES: readonly FractureTemplate[] = [
    { name: 'Twin seam', charges: 2, faces: 4,
        faults: [{ x: 40, y: 34 }, { x: 60, y: 34 }, { x: 60, y: 66 }, { x: 40, y: 66 }],
        sites: [{ label: 'Northwest seam', x: 15, y: 18, path: [0, 1] }, { label: 'Southeast seam', x: 85, y: 82, path: [2, 3] },
            { label: 'East cross-fault', x: 88, y: 45, path: [1, 2] }, { label: 'West cross-fault', x: 12, y: 55, path: [0, 3, 2] }] },
    { name: 'Split crown', charges: 2, faces: 4,
        faults: [{ x: 40, y: 34 }, { x: 60, y: 34 }, { x: 60, y: 66 }, { x: 40, y: 66 }],
        sites: [{ label: 'Upper crown', x: 50, y: 12, path: [0, 1, 2] }, { label: 'Left base', x: 15, y: 82, path: [3] },
            { label: 'Right base', x: 85, y: 80, path: [2, 3] }, { label: 'Left shelf', x: 12, y: 40, path: [0, 1] }] },
    { name: 'Threefold core', charges: 3, faces: 6,
        faults: [{ x: 40, y: 30 }, { x: 60, y: 30 }, { x: 68, y: 50 }, { x: 60, y: 70 }, { x: 40, y: 70 }, { x: 32, y: 50 }],
        sites: [{ label: 'Crown seam', x: 50, y: 10, path: [0, 1] }, { label: 'East seam', x: 90, y: 64, path: [2, 3] },
            { label: 'West seam', x: 10, y: 64, path: [4, 5] }, { label: 'Diagonal fracture', x: 85, y: 18, path: [1, 2, 3] },
            { label: 'Lower cross-fault', x: 50, y: 90, path: [3, 4] }] },
];
export function solveFractureChain(templateIndex: number, placements: unknown) {
    const template = FRACTURE_TEMPLATES[templateIndex];
    if (!template || !Array.isArray(placements) || placements.length !== template.charges
        || new Set(placements).size !== placements.length || placements.some(i => !Number.isInteger(i) || !template.sites[i])) return null;
    const hits = Array<number>(template.faces).fill(0);
    const waves = (placements as number[]).map(site => template.sites[site].path.map(face => { hits[face]++; return face; }));
    const destroyed = hits.some(hit => hit > 1), exposed = hits.filter(hit => hit === 1).length;
    return { destroyed, exposed, waves, performance: destroyed ? 0 : Math.floor(10 * exposed / template.faces) };
}
