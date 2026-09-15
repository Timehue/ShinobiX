import { clamp } from './random.js';
import type { RallyObstacle, RallySection, RallyTrack } from './rally-types.js';

type Gate = [number, -1 | 0 | 1, RallyObstacle['kind'], number?, number?];
function obstacles(course: string, entries: Gate[]): RallyObstacle[] {
    return entries.map(([at, lane, kind, gain, minSpeed], index) => ({
        id: `${course}-${index}`, at, lane, kind, length: kind === 'shortcut' ? 32 : kind === 'ramp' ? 7 : 2,
        height: kind === 'gate' || kind === 'rock' ? 4 : kind === 'cart' ? 1.6 : kind === 'barrier' ? .9 : 0,
        ...(kind === 'shortcut' ? { gain: gain ?? 12, minSpeed: minSpeed ?? 14 } : {}),
        breakable: kind === 'barrier' || kind === 'cart',
    }));
}
function sections(entries: [number, number, string, RallySection['terrain'], number, number, number][]): RallySection[] {
    return entries.map(([from, to, name, terrain, width, curve, elevation]) => ({ from, to, name, terrain, width, curve, elevation }));
}

export const RALLY_TRACKS: readonly RallyTrack[] = [
    {
        id: 'grand-circuit', name: 'Sunscar Grand Circuit', subtitle: 'Under the golden banners',
        description: 'Through the market, over the dunes, and home to the grandstand. Read the gates before spending your burst.',
        traits: ['Balanced', 'Market gates', 'Two jump routes'], length: 1020, scenery: 'festival', music: 'festival',
        palette: { sky: '#eac69c', sand: '#d5a16c', rock: '#b07451', accent: '#9e3344', fog: '#e7bd8d' },
        checkpoints: [260, 520, 790],
        sections: sections([[0, 180, 'Festival avenue', 'stone', 10, 0, 0], [180, 380, 'Market bend', 'alley', 8, 14, 0], [380, 630, 'Golden dunes', 'sand', 11, -18, 2], [630, 810, 'Banner ridge', 'deep-sand', 9, 10, 1], [810, 1020, 'Grandstand straight', 'stone', 12, 0, 0]]),
        obstacles: obstacles('grand', [[78, 0, 'barrier'], [125, -1, 'cart'], [208, 1, 'gate'], [244, 0, 'cart'], [298, -1, 'barrier'], [336, 1, 'ramp'], [344, 1, 'shortcut', 18, 14], [415, 0, 'rock'], [476, -1, 'barrier'], [548, 1, 'rock'], [587, 0, 'ramp'], [597, 0, 'shortcut', 20, 15], [683, -1, 'cart'], [731, 0, 'barrier'], [785, 1, 'gate'], [862, -1, 'barrier'], [925, 0, 'cart']]),
    },
    {
        id: 'scorpions-spine', name: "Scorpion's Spine", subtitle: 'Every clean line counts',
        description: 'A sandstone channel with little room to recover. High routes save distance, but the takeoffs leave no room for hesitation.',
        traits: ['Technical', 'Narrow canyon', 'Risky ridge cuts'], length: 930, scenery: 'canyon', music: 'festival',
        palette: { sky: '#cba985', sand: '#b77c52', rock: '#714947', accent: '#e8b656', fog: '#c18d68' },
        checkpoints: [240, 470, 710],
        sections: sections([[0, 150, 'Canyon mouth', 'sand', 9, 0, 0], [150, 345, 'Needle passage', 'stone', 7, -21, 1], [345, 555, 'Broken shelf', 'stone', 7, 26, 4], [555, 745, 'Scorpion turn', 'sand', 8, -23, 2], [745, 930, 'Sunlit gap', 'stone', 9, 5, 0]]),
        obstacles: obstacles('spine', [[65, -1, 'rock'], [102, 1, 'barrier'], [159, 0, 'rock'], [204, 1, 'gate'], [235, -1, 'ramp'], [244, -1, 'shortcut', 25, 15], [300, 0, 'barrier'], [347, -1, 'rock'], [391, 1, 'cart'], [438, 0, 'ramp'], [447, 0, 'shortcut', 23, 16], [500, 1, 'rock'], [544, -1, 'barrier'], [588, 0, 'gate'], [623, 1, 'ramp'], [632, 1, 'shortcut', 19, 14], [681, -1, 'rock'], [729, 0, 'barrier'], [783, 1, 'gate'], [848, -1, 'barrier']]),
    },
    {
        id: 'burning-dunes', name: 'Burning Dunes', subtitle: 'Pace the heat',
        description: 'Long open straights give way to soft sand. Keep water in the tank and carry speed over the dune crests.',
        traits: ['High speed', 'Deep sand', 'Long burst windows'], length: 1180, scenery: 'dunes', music: 'festival',
        palette: { sky: '#f2d6a1', sand: '#e8b775', rock: '#c68c59', accent: '#387c86', fog: '#efd19a' },
        checkpoints: [300, 600, 900],
        sections: sections([[0, 255, 'Open desert', 'sand', 13, 0, 0], [255, 450, 'Soft basin', 'deep-sand', 12, 10, -1], [450, 700, 'Crest road', 'sand', 13, -12, 4], [700, 945, 'Heat hollow', 'deep-sand', 12, 15, 0], [945, 1180, 'Evening straight', 'sand', 14, 0, 0]]),
        obstacles: obstacles('dunes', [[130, 0, 'barrier'], [230, -1, 'rock'], [304, 1, 'ramp'], [314, 1, 'shortcut', 23, 15], [397, 0, 'rock'], [493, -1, 'barrier'], [583, 0, 'ramp'], [594, 0, 'shortcut', 28, 16], [682, 1, 'rock'], [777, -1, 'ramp'], [787, -1, 'shortcut', 22, 15], [895, 0, 'barrier'], [1009, 1, 'rock'], [1080, -1, 'barrier']]),
    },
    {
        id: 'caravan-clash', name: 'Caravan Clash', subtitle: 'The market never stops',
        description: 'Carts, barrels and awnings leave a fast line through the market. Jump the low cargo and steer around the tall loads.',
        traits: ['Obstacle heavy', 'Merchant alleys', 'Breakable cargo cuts'], length: 960, scenery: 'market', music: 'festival',
        palette: { sky: '#dfba99', sand: '#c69162', rock: '#986856', accent: '#487e82', fog: '#dcb896' },
        checkpoints: [240, 480, 720],
        sections: sections([[0, 180, 'Caravan yard', 'sand', 11, 0, 0], [180, 375, 'Spice alley', 'alley', 8, -15, 0], [375, 570, 'Merchant crossing', 'stone', 10, 20, 0], [570, 765, 'Covered market', 'alley', 8, -15, 0], [765, 960, 'Lantern quay', 'stone', 11, 0, 0]]),
        obstacles: obstacles('clash', [[68, 0, 'cart'], [108, 1, 'barrier'], [153, -1, 'cart'], [197, 0, 'gate'], [244, 1, 'barrier'], [279, -1, 'ramp'], [287, -1, 'shortcut', 18, 13], [332, 0, 'cart'], [380, 1, 'cart'], [420, -1, 'gate'], [465, 0, 'barrier'], [509, 1, 'ramp'], [517, 1, 'shortcut', 20, 14], [561, -1, 'cart'], [606, 0, 'gate'], [649, 1, 'barrier'], [690, -1, 'cart'], [737, 0, 'ramp'], [745, 0, 'shortcut', 18, 14], [802, 1, 'cart'], [854, -1, 'gate'], [901, 0, 'barrier']]),
    },
];
export function rallyTrack(id: string): RallyTrack {
    const track = RALLY_TRACKS.find(entry => entry.id === id);
    if (!track) throw new Error('Unknown Rally course.');
    return track;
}
export function rallySection(track: RallyTrack, distance: number): RallySection {
    if (distance < track.sections[0].from) return track.sections[0];
    return track.sections.find(section => distance >= section.from && distance < section.to) ?? track.sections[track.sections.length - 1];
}
/** Continuous path; section bends have zero slope at their seams. */
export function rallyPath(track: RallyTrack, distance: number): { x: number; y: number; z: number } {
    let x = 0;
    let y = 0;
    for (const section of track.sections) {
        const t = clamp((distance - section.from) / (section.to - section.from), 0, 1);
        const blend = t * t * (3 - 2 * t);
        x += section.curve * blend;
        y += section.elevation * blend;
    }
    return { x, y, z: -distance };
}
