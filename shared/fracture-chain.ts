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
    // Append only: the first three indices also identify attempts already in flight.
    { name: 'Forked ledge', charges: 2, faces: 4,
        faults: [{ x: 33, y: 30 }, { x: 59, y: 36 }, { x: 67, y: 62 }, { x: 38, y: 72 }],
        sites: [{ label: 'High ledge', x: 20, y: 10, path: [0, 1] }, { label: 'Low ledge', x: 75, y: 90, path: [2, 3] },
            { label: 'West fork', x: 8, y: 55, path: [0, 3] }, { label: 'East fork', x: 92, y: 43, path: [1, 2] },
            { label: 'Crossing shelf', x: 65, y: 8, path: [0, 1, 2] }] },
    { name: 'Buried crescent', charges: 2, faces: 4,
        faults: [{ x: 36, y: 25 }, { x: 62, y: 43 }, { x: 56, y: 69 }, { x: 30, y: 62 }],
        sites: [{ label: 'Crescent crown', x: 60, y: 8, path: [0, 1] }, { label: 'Crescent root', x: 35, y: 91, path: [2, 3] },
            { label: 'Outer bend', x: 92, y: 68, path: [1, 2] }, { label: 'Inner bend', x: 8, y: 35, path: [0, 3] }] },
    { name: 'Hanging ribs', charges: 3, faces: 6,
        faults: [{ x: 30, y: 30 }, { x: 31, y: 60 }, { x: 51, y: 38 }, { x: 51, y: 73 }, { x: 72, y: 29 }, { x: 73, y: 59 }],
        sites: [{ label: 'Western rib', x: 10, y: 18, path: [0, 1] }, { label: 'Central rib', x: 48, y: 8, path: [2, 3] },
            { label: 'Eastern rib', x: 90, y: 18, path: [4, 5] }, { label: 'Upper cross-fault', x: 8, y: 75, path: [1, 3] },
            { label: 'Crown cross-fault', x: 80, y: 90, path: [0, 2, 4] }] },
    { name: 'Braided basin', charges: 3, faces: 6,
        faults: [{ x: 36, y: 27 }, { x: 63, y: 28 }, { x: 72, y: 52 }, { x: 59, y: 72 }, { x: 35, y: 71 }, { x: 27, y: 49 }],
        sites: [{ label: 'Upper braid', x: 48, y: 7, path: [0, 1] }, { label: 'Eastern braid', x: 92, y: 65, path: [2, 3] },
            { label: 'Western braid', x: 8, y: 65, path: [4, 5] }, { label: 'Left return', x: 10, y: 16, path: [5, 0] },
            { label: 'Right return', x: 90, y: 16, path: [1, 2] }, { label: 'Basin floor', x: 49, y: 92, path: [3, 4] }] },
    { name: 'Broken fan', charges: 3, faces: 6,
        faults: [{ x: 27, y: 33 }, { x: 44, y: 25 }, { x: 64, y: 32 }, { x: 70, y: 58 }, { x: 51, y: 73 }, { x: 30, y: 64 }],
        sites: [{ label: 'Fan crown', x: 20, y: 8, path: [0, 1] }, { label: 'Fan shoulder', x: 90, y: 42, path: [2, 3] },
            { label: 'Fan base', x: 30, y: 92, path: [4, 5] }, { label: 'Broken spoke', x: 8, y: 48, path: [0, 5] },
            { label: 'Inner spoke', x: 65, y: 8, path: [1, 2] }, { label: 'Outer spoke', x: 87, y: 84, path: [3, 4] }] },
];
export const fractureTemplatePool = (difficulty: number): readonly number[] => difficulty === 1 ? [0, 1, 3, 4] : [2, 5, 6, 7];
export function solveFractureChain(templateIndex: number, placements: unknown) {
    const template = FRACTURE_TEMPLATES[templateIndex];
    if (!template || !Array.isArray(placements) || placements.length !== template.charges
        || new Set(placements).size !== placements.length || placements.some(i => !Number.isInteger(i) || !template.sites[i])) return null;
    const hits = Array<number>(template.faces).fill(0);
    const waves = (placements as number[]).map(site => template.sites[site].path.map(face => { hits[face]++; return face; }));
    const destroyed = hits.some(hit => hit > 1), exposed = hits.filter(hit => hit === 1).length;
    return { destroyed, exposed, waves, performance: destroyed ? 0 : Math.floor(10 * exposed / template.faces) };
}
