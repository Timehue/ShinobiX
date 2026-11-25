export interface CoastWorkStep {
    sector: number;
    tile: number;
    detail: string;
    action: string;
    alternative?: string;
    hint?: string;
}
export interface CoastJob {
    id: string; worker: string; model: string; title: string; prop: string; resident?: string;
    workerTile: number; working: string; finished: string; result: string; tip: string; steps: readonly CoastWorkStep[];
}

export const COAST_JOBS: readonly CoastJob[] = [
    {
        id: 'mend-the-mesh', worker: 'Net mender', model: 'pilgrim', resident: 'A net mender', title: 'Mend the shoal net', prop: 'net',
        workerTile: 105, working: 'Stretching mesh between two pegs', finished: 'Checking the fisher’s mended net',
        result: 'The fisher hauls in a basket. The knot you tied holds under the weight.',
        tip: 'Cut binding fibre at Wrack Strand in sector 102 with a harvest kama.',
        steps: [
            { sector: 104, tile: 128, detail: 'The mender stretches the net. One diamond sags when she pulls on the headrope.', action: 'Trace the sagging mesh' },
            { sector: 104, tile: 127, detail: 'At the second peg the bottom loop has slipped clean off its knot. The other loops are tight.', action: 'Lace the loose bottom loop', alternative: 'Tighten the headrope', hint: 'The headrope is already tight. Follow the loose loop down.' },
            { sector: 104, tile: 128, detail: 'The mender holds out the repaired end. The fisher is ready to set the net.', action: 'Help the fisher set the net' },
        ],
    }, {
        id: 'sound-the-quay', worker: 'Quay hand', model: 'angler', title: 'Sound the skiff channel', prop: 'line',
        workerTile: 75, working: 'Paying out a sounding line', finished: 'Directing skiffs by the marked chart',
        result: 'Two soundings are inked on the quay chart. The loaded skiffs come in along the deep edge.',
        tip: 'There are fish below this quay and at Sounding Ledge in sector 117.',
        steps: [
            { sector: 116, tile: 63, detail: 'A loaded skiff needs three marks of water. The quay hand lends you a knotted line.', action: 'Take the sounding line' },
            { sector: 117, tile: 88, detail: 'The line hangs over the inner shelf. Lower it until the lead touches bottom.', action: 'Read the inner shelf · two marks' },
            { sector: 117, tile: 89, detail: 'The water darkens at the outer lip. Two knots slip under, then a third and a fourth.', action: 'Record the outer lip · four marks' },
            { sector: 116, tile: 63, detail: 'The skiff draws three marks. Which approach goes on the chart?', action: 'Mark the outer lip', alternative: 'Mark the inner shelf', hint: 'Two marks leaves the loaded hull on the bottom.' },
        ],
    }, {
        id: 'read-the-ford', worker: 'Ford keeper', model: 'tracker', title: 'Read the ford tracks', prop: 'tracks',
        workerTile: 76, working: 'Kneeling over prints at the ford', finished: 'Checking the marked bank',
        result: 'A strip of cord shows the safer crossing. The keeper now watches from that bank.',
        tip: 'Follow the sheltered side of Stillfang Mere in sector 127 to fish.',
        steps: [
            { sector: 121, tile: 64, detail: 'Two sets of prints meet the ford. The keeper asks which animal passed after the water fell.', action: 'Inspect the crossing' },
            { sector: 121, tile: 65, detail: 'One track has sharp walls. Water has rounded the other and left grit in the heel.', action: 'Follow the sharp print', alternative: 'Follow the silted heel', hint: 'The grit settled while water still covered that track.' },
            { sector: 121, tile: 66, detail: 'The fresh prints climb clear of the shallows. Tie the keeper’s marker where the footing holds.', action: 'Mark the firm bank' },
        ],
    }, {
        id: 'sight-the-cairn', worker: 'Pass courier', model: 'courier', title: 'Sight the dispatch cairn', prop: 'cairn',
        workerTile: 54, working: 'Sighting along the cairn stones', finished: 'Reading the restored waymark',
        result: 'A pale capstone is visible from the bend. The courier finds the trail even in low cloud.',
        tip: 'For exposed ore, look along Whitevein Cut in sector 133 and Split Needle in 139.',
        steps: [
            { sector: 140, tile: 52, detail: 'The courier can see the cairn from here but loses it around the bend. Walk the sightline.', action: 'Sight along the cairn' },
            { sector: 140, tile: 65, detail: 'From the bend, a dark slab hides the capstone. A pale stone lies turned face down.', action: 'Turn the pale face toward the bend' },
            { sector: 140, tile: 52, detail: 'Look back from the cairn. The pale face and the next marker line up.', action: 'Confirm the dispatch route' },
        ],
    }, {
        id: 'label-the-sample', worker: 'Remaker sorting grit', model: 'medic', resident: 'A remaker sorting grit', title: 'Label the reference sample', prop: 'sample',
        workerTile: 102, working: 'Sorting grit for the field workshop', finished: 'Comparing fittings with the reference sample',
        result: 'A labeled sample sits beside the second pattern. A trainee uses your streak mark to sort the next tray.',
        tip: 'The bare slab in sector 143 takes a pickaxe. Windroot herbs grow below in sector 142.',
        steps: [
            { sector: 144, tile: 89, detail: 'Two samples have lost their labels. The remaker gives you a streak tile to take to the outcrop.', action: 'Take the streak tile' },
            { sector: 143, tile: 65, detail: 'Draw a loose silver fleck across the tile. It leaves a dark streak. Take the tile back to the bench.', action: 'Record the dark streak' },
            { sector: 144, tile: 89, detail: 'The bright chip leaves a pale scratch. The dull chip matches the dark streak from the ridge.', action: 'Label the dull chip', alternative: 'Label the bright chip', hint: 'Compare the streak on the tile with the mark beside each chip.' },
        ],
    },
];

export const coastJob = (id: unknown) => COAST_JOBS.find(job => job.id === id);
