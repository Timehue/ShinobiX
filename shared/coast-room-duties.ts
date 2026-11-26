import { dutyOrder } from './coast-duty-order.js';
export { dutyOrder };

/** The station names are the painted hotspots in the admitted coast floors. */
export interface DutyCase {
    reading: string;
    action: string;
    answer?: string | number;
    fitting?: readonly [piece: string, placement: string];
    result: string;
}

export interface RoomDuty {
    reward: RoomPay;
    title: string;
    worker: string;
    model: string;
    request: string;
    inspect: string;
    operate: string;
    cases: readonly [DutyCase, DutyCase, DutyCase];
    note: string;
}

type RoomPay = { item: string; quantity: number; label: string; meal?: true };
const cord = { item: 'gather-binding-fiber', quantity: 2, label: '2 Binding Fiber' };
const quill = { item: 'hunt-wild-feather', quantity: 1, label: '1 Wild Feather' };
const metal = { item: 'gather-iron-sand', quantity: 2, label: '2 Iron Sand' };
const leather = { item: 'hunt-torn-hide', quantity: 1, label: '1 Torn Hide' };
const herbs = { item: 'gather-field-herb', quantity: 2, label: '2 Field Herbs' };
const rations = { item: 'ration-pack', quantity: 1, label: '1 Ration Pack' };
const supper: RoomPay = { ...rations, meal: true, label: 'a restorative crew meal and 1 Ration Pack' };

export type WorkSample = string | number;
export type RoomDutyProgress = {
    tick: number; paidTick?: number; order?: number;
    bench?: { tick: number; revision: number; value: WorkSample };
};

export function dutyAnswer(card: DutyCase): WorkSample {
    return card.fitting?.join('|') ?? card.answer ?? card.action;
}

export function validBenchSample(duty: RoomDuty, value: unknown): value is WorkSample {
    const first = duty.cases[0];
    if (first.fitting) {
        if (typeof value !== 'string') return false;
        if (value === '') return true;
        const [piece, place, ...extra] = value.split('|');
        return !extra.length && duty.cases.some(card => card.fitting?.[0] === piece) &&
            (place === undefined || duty.cases.some(card => card.fitting?.[1] === place));
    }
    if (typeof first.answer === 'number') return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 3;
    return first.answer !== undefined && typeof value === 'string' && (value === '' || /^(Flash|Hold)( (Flash|Hold)){0,2}$/.test(value));
}

export function canAdjustBench(duty: RoomDuty, previous: WorkSample, next: WorkSample): boolean {
    if (typeof next === 'number') return typeof previous === 'number' && (next === 0 || Math.abs(next - previous) === 1);
    if (typeof previous !== 'string') return false;
    if (!next) return true;
    if (duty.cases[0].fitting) return next.includes('|') ? next.split('|')[0] === previous : !previous;
    return next === (previous ? previous + ' ' : '') + next.split(' ').at(-1);
}

export function lastDutyOrder(duty: RoomDuty, progress?: RoomDutyProgress): number | undefined {
    if (!progress || progress.tick < 3) return;
    const order = dutyOrder(duty, progress);
    if (progress.tick % 4 === 3) return order;
    const length = progress.order === undefined ? 2 : duty.cases.length;
    return (order + length - 1) % length;
}
export type RoomDutyCommand = 'sync' | 'take' | 'inspect' | 'adjust' | 'deliver';

function shift(reward: RoomPay, title: string, worker: string, model: string, request: string, inspect: string, operate: string,
    first: DutyCase, second: DutyCase, third: DutyCase, note: string): RoomDuty {
    return { reward, title, worker, model, request, inspect, operate, cases: [first, second, third], note };
}

export const roomDuties: Readonly<Partial<Record<string, RoomDuty>>> = {
    'saltstair-dock-101': shift(cord, 'Fit the ferry plank', 'Slip joiner', 'angler',
        'Hold the frame against the light. Tell me where the plank needs work before I drive the pegs.', 'Ferry frame', 'Joiner’s bench',
        { reading: 'The ends sit flush. Two thin shims fit the gap beneath the middle.', action: 'Fit a shim under the middle', answer: 2, result: 'The shims take the daylight out of the joint. The joiner drives the pegs.' },
        { reading: 'The plank rocks on a high spot in the middle. It stands one shaving above the chalk line.', action: 'Plane the high spot', answer: -1, result: 'Both ends drop into their seats. The joiner chalks the plank ready for fitting.' },
        { reading: 'Only the bow end lifts. The gauge slips under it by a single shim; the rest of the seam is tight.', action: 'Pack the bow end', answer: 1, result: 'The bow sits flush on the new packing. The joiner wet-marks the seam for the next tide.' },
        'The slip has a fishing shoal. The net crew takes repair materials at the rack outside.'),
    'saltstair-counter-105': shift(quill, 'Return a loose folio', 'Duty archivist', 'pilgrim',
        'Someone slipped a loose leaf under my blotter. Read the marginal marks and return it to its volume.', 'Writing counter', 'Archive shelves',
        { reading: 'Three cargo weights and a slip number run down the margin. The reverse bears a ferryman’s thumbprint.', action: 'File with the cargo manifests', result: 'The missing weights complete the ferryman’s load record.' },
        { reading: 'The margin lists three names beside a watch change. Each name has a countersign.', action: 'File with the watch rolls', result: 'The relief watch can now account for all three guards.' },
        { reading: 'Each line names a tin of food, its shelf, and the day it was opened. A broth stain covers the last total.', action: 'File with the kitchen stores', result: 'The cook finds the missing tally and puts the oldest tins at the front.' },
        'The Stair Houses share this sector. The street has a provisions shop, a cook house and a Noodle Den.'),
    'saltstair-houses-105': shift(supper, 'Finish the crew’s broth', 'Galley cook', 'medic',
        'Taste the broth before the ferry crew arrives. I keep the finishing ingredients beside the salt.', 'Soup kettle', 'Salt cupboard',
        { reading: 'The kettle has boiled two ladles below its chalk mark. Top it up with plain stock to soften the salt.', action: 'Fold in plain stock', answer: -2, result: 'The sharp edge softens. The cook fills the crew’s bowls.' },
        { reading: 'The fish stock is rich but flat. The cook’s tally shows one spoon of brine still to add.', action: 'Season with a spoonful of brine', answer: 1, result: 'The fish comes through in the next spoonful. The cook calls the crew to table.' },
        { reading: 'The crew has brought in three baskets of unsalted clams. The cook’s tasting cup measures two spoonfuls of brine short.', action: 'Bring up the clam broth', answer: 2, result: 'The last spoon brings out the clams. The deck crew dips its cups before the tide turns.' },
        'The cook shares the crew’s broth after each shift. The Noodle Den across the street also serves meals.'),
    'saltstair-fort-107': shift(leather, 'Outfit the relief watch', 'Quartermaster', 'tracker',
        'Read the relief detail’s assignment. Lay out the kit they will need for that post.', 'Command table', 'Kit rack',
        { reading: 'The relief takes the open quay through a downpour. Their orders are written in loose ink.', action: 'Issue waxed dispatch wraps', fitting: ["Waxed cloth","Wrap the dispatches"], result: 'The relief rolls its orders into dry wraps before heading to the quay.' },
        { reading: 'The relief crosses a loose scree slope after dusk. Its kit slip asks for a way to belay the packs.', action: 'Issue a pack line', fitting: ["Braided rope","Belay the packs"], result: 'The rear guard ties off the packs and tests the line.' },
        { reading: 'The relief is collecting a wounded porter. Two poles are tied to the kit rack; the sling between them is missing.', action: 'Issue a litter sling', fitting: ["Canvas sling","Span the litter poles"], result: 'The watch stretches the sling between its poles and sends the litter down the quay.' },
        'Needle Shoal in sector 104 has a net mender who lends you what you need for the job.'),
    'brackwater-counter-113': shift(quill, 'Seal the next dispatch', 'Relay sorter', 'courier',
        'The runner is waiting. Read the delivery slip before you seal the packet.', 'Dispatch desk', 'Sealing counter',
        { reading: 'The slip names a single recipient. Her copy must reach her unopened.', action: 'Stamp a closed private seal', fitting: ["Sealing wax","Close the flap"], result: 'The runner stows the sealed letter in the inner pouch.' },
        { reading: 'Each relay keeper must add an arrival time to this circulating sheet.', action: 'Fit a reusable cord loop', fitting: ["Braided cord","Loop the cover"], result: 'The runner threads the loop so each keeper can add a time.' },
        { reading: 'The pilot signed the packet in wet ink. Its counterfoil stays at the desk as proof of collection.', action: 'Tie on a tear-off receipt', fitting: ["Numbered stub","Tie it to the packet"], result: 'The sorter keeps the signed stub. The pilot slips the copy into a dry sleeve.' },
        'The quay hand in sector 116 lends a sounding line for the ledge in sector 117.'),
    'brackwater-counter-118': shift(cord, 'Rig the watch signal', 'Signal tender', 'courier',
        'The duty room keeps the order for the next boat. Rig the signal upstairs where the helmsman can see it.', 'Muster ledger', 'Signal reel',
        { reading: 'An inbound skiff has the channel to itself. The key draws one pennant for a clear approach.', action: 'Hoist one pennant', result: 'The single pennant lifts. The skiff noses into the channel.' },
        { reading: 'A timber tow blocks the channel. The key calls for crossed pennants to hold incoming boats.', action: 'Cross the pennants', result: 'The helmsman sees the cross and waits outside the tow.' },
        { reading: 'The skiff has cargo to land at Low Water Quay. The pilot asks for the split-tail berth pennant.', action: 'Hoist the split-tail pennant', result: 'The split tail breaks out over the watch. The pilot brings the baskets alongside the quay.' },
        'The fishing spots at the quay in 116 and the ledge in 117 take a fishing kunai.'),
    'brackwater-tree-120': shift(cord, 'Tune the hollow cedar', 'Cedar listener', 'pilgrim',
        'Listen in the gallery. The crown has two wedges for the hanging line.', 'Sound the hanging clappers', 'Fit the ward into the living knot',
        { reading: 'The clappers knock twice for every pull. The slack line swings back against the timber.', action: 'Take up the slack', result: 'The line settles. One clear knock reaches the root vestibule.' },
        { reading: 'The line is pulled so tight that the clappers barely strike at all.', action: 'Ease the line a notch', result: 'The clappers swing freely. The listener below answers the first knock.' },
        { reading: 'Both clappers swing freely, but their knocks land together. The crown has a spacer cut to stagger them.', action: 'Slip the spacer between the ties', result: 'A second knock follows the first. The listener answers both from below.' },
        'The cedar has three floors. Its gallery connects the root vestibule to the crown.'),
    'briarwood-counter-122': shift(herbs, 'Set a witness tablet', 'Shrine registrar', 'pilgrim',
        'Two tablet stands are empty. Read the testimony and set its tablet beside the right trail.', 'Witness register', 'Witness tablets',
        { reading: 'A drover swore that hoofprints crossed the ford before the water rose.', action: 'Set the ford tablet', result: 'A drover looking for the ford can now find the testimony under its trail mark.' },
        { reading: 'A forager swore that a fallen trunk closed the thorn brake above the bank.', action: 'Set the thorn tablet', result: 'The thorn marker carries the warning for the next foraging party.' },
        { reading: 'A charcoal burner marked three carts at the kiln trail. Their axle ruts turned back at a freshly fallen tree.', action: 'Set the kiln tablet', result: 'The next carter reads the tablet and unhitches before the blocked trail.' },
        'The ford keeper in 121 can show you how to tell fresh tracks from silted ones.'),
    'briarwood-counter-124': shift(quill, 'Catalogue a stone rubbing', 'Rubbing keeper', 'pilgrim',
        'Take a rubbing downstairs. The archive upstairs files by cut marks, even when the lettering is gone.', 'Take the impression', 'Compare the archive folio',
        { reading: 'The rubbing shows a circle divided by spokes, the old wheelwright’s mark.', action: 'Index under wheels', result: 'The rubbing completes a broken wheel seal in the archive.' },
        { reading: 'Two parallel lines meet a hooked end, the old ferryman’s mark for a landing.', action: 'Index under landings', result: 'The rubbing lines up with a quay stone already on file.' },
        { reading: 'The impression has a comb of short teeth beside a loom weight. The archive keeps the weavers’ seals together.', action: 'Index under looms', result: 'The keeper fits the impression beside a length of cloth bearing the same seal.' },
        'The shelves and the fragment share the upper archive. The impression stone is downstairs.'),
    'briarwood-fort-126': shift(leather, 'Balance the feed hoist', 'Stall hand', 'tracker',
        'Read the feed load at the tether block. Set the hoist line before the handlers lift it.', 'Study the tether block', 'Trace the tamer’s knot',
        { reading: 'The block bears two heavy feed bins. The tackle plate calls for a doubled line on a full load.', action: 'Double the lifting line', fitting: ["Lifting line","Double the tackle"], result: 'Both bins rise level. The stall hand opens the feed hatch.' },
        { reading: 'The bin is empty and needs to come back down. The doubled lifting line has jammed the return.', action: 'Rig the single return line', fitting: ["Return line","Rig a single strand"], result: 'The empty bin slides down to the waiting handler.' },
        { reading: 'One bin is full and its partner is half empty. A spare counterweight hangs beside the return drum.', action: 'Balance the lighter bin', fitting: ["Counterweight","Hang on the lighter side"], result: 'The handlers let go. Both bins hold level while the stall hand works the hatch.' },
        'Stillfang Mere in sector 127 has bank fishing. Thorn Brake in 125 supplies binding fibre.'),
    'whitecrown-counter-134': shift(rations, 'Reconcile the toll tags', 'Pass clerk', 'courier',
        'Read the tags at the toll counter. Upstairs, attach the right copy to the sailing docket.', 'Examine the travel tags', 'Match the sailing docket',
        { reading: 'The notched tag names four pack animals going inland. It has no berth number.', action: 'Attach the caravan copy', result: 'The clerk enters the pack train against its inland toll.' },
        { reading: 'The blue tag names a berth and a hull. Its load is waiting for the tide.', action: 'Attach the quay copy', result: 'The clerk clears the hull against the sailing docket.' },
        { reading: 'The notches mark a courier on foot. The tag carries the relay seal and a prepaid toll.', action: 'Attach the relay copy', result: 'The clerk waves the runner through and sends the prepaid stub to the relay.' },
        'Whitevein Cut in sector 133 and Split Needle in 139 both have exposed mining seams.'),
    'whitecrown-counter-136': shift(metal, 'Sort the assay tray', 'Assay hand', 'medic',
        'Lift the cap and inspect the witness chip. Set its tray with the matching reference sample.', 'Lift the assay cap', 'Study the frost samples',
        { reading: 'The chip leaves a rusty red streak on the white scoring tile.', action: 'Set beside the red-streak sample', result: 'The assay hand marks the red-streak batch for the smith.' },
        { reading: 'The chip scratches the tile but leaves a pale grainy powder instead of a red mark.', action: 'Set beside the pale-streak sample', result: 'The pale-streak tray goes back to the mineral shelf.' },
        { reading: 'The chip flakes into thin, shining leaves under the point. The scoring tile stays clean.', action: 'Set beside the flaky sample', result: 'The assay hand separates the mica before the ore goes into the furnace.' },
        'Open water at the Icebell Shelf in sector 135 is a fishing spot in the pass.'),
    'whitecrown-fort-138': shift(metal, 'Set the gate warning', 'Gate lamplighter', 'courier',
        'Check the chain stop in the hall. Set the lantern shutters above it to tell the road crew how to approach.', 'Inspect the chain stop', 'Look through the shutters',
        { reading: 'The catch has seated cleanly and the gate stands raised. A white light means the road is open.', action: 'Show the white light', result: 'The road crew picks up the white lamp and brings its carts forward.' },
        { reading: 'Ice holds the catch halfway down. An amber light tells the road crew to wait.', action: 'Show the amber light', result: 'The amber lamp holds the carts while the chain crew clears the catch.' },
        { reading: 'The road crew is coming up through fog. The gate is clear but the light is too dim; open both shutters for their approach.', action: 'Open both shutters', result: 'A broad beam reaches the road. The lead cart clears the bend and answers with its bell.' },
        'The chain hall and the lantern room are two flights apart, with the wheel chamber between.'),
    'hushcrown-counter-144': shift(herbs, 'Match the workshop pattern', 'Pattern cutter', 'medic',
        'Look at the wear on the provision-room pattern. Pick the matching reinforcement in the loft.', 'Examine the remedy pattern', 'Match the two patterns',
        { reading: 'A split runs along the fold. The corners and edges are still sound.', action: 'Bind the fold', fitting: ["Linen binding","Lay along the fold"], result: 'A narrow binding takes the pull when the pattern is folded.' },
        { reading: 'The fold is sound. Two punched corner holes have torn out under the drying cords.', action: 'Back the corner holes', fitting: ["Leather washers","Back the eyelets"], result: 'The backed holes hold their tension on the drying line.' },
        { reading: 'The centre of the pattern has worn through where the tool bears down. Its fold and eyelets still hold.', action: 'Patch the working face', fitting: ["Canvas patch","Cover the centre"], result: 'A scrap from the cutting table takes the wear on the next pressing.' },
        'The remaker outside keeps a reference sample from the silver outcrop in sector 143.'),
    'hushcrown-fort-148': shift(cord, 'Answer the paired watch', 'Relief signaler', 'tracker',
        'Read the disk on the lower watch. Set its reply in the loft so the other post can acknowledge it.', 'Examine the lower ward disk', 'Read the paired ward case',
        { reading: 'The lower watch scratched its call into the disk. It reads flash, hold, flash. Repeat it from the loft.', action: 'Send the split call', answer: "Flash Hold Flash", result: 'A single flash comes back from the other post.' },
        { reading: 'A fresh call circles the rim of the disk. It reads hold, flash, hold. Repeat it from the loft.', action: 'Send the long call', answer: "Hold Flash Hold", result: 'The far post returns the signal and closes its watch book.' },
        { reading: 'The mist watch taps a new call into the rim. It reads flash, flash, hold. Repeat it from the loft.', action: 'Send the mist call', answer: "Flash Flash Hold", result: 'Two quick lights wink through the mist. The far keeper banks the lamp.' },
        'The paired ward case is upstairs. Both the cedar line and the lower disk are downstairs.'),
    'hushcrown-fort-150': shift(rations, 'Close the watch roll', 'Garrison roll keeper', 'pilgrim',
        'Read the change of watch in the oath gallery. At the crown, hang the banner for the party actually on duty.', 'Match the oath plaques', 'Unfold the command banner',
        { reading: 'The reed-marked plaque records a fresh arrival. The stone-marked watch has signed out.', action: 'Hang the reed banner', result: 'The roll keeper signs off as the reed banner goes up over the gate.' },
        { reading: 'The stone-marked relief has signed in. The reed patrol has handed over its keys.', action: 'Hang the stone banner', result: 'The stone banner tells the lower gate who holds the keys.' },
        { reading: 'Two reliefs share the changeover. The plaques carry both countersigns and call for the spliced banner.', action: 'Hang the spliced banner', result: 'Both watches answer from the lower stair before the keeper closes the roll.' },
        'The oath plaques are in the middle gallery. The command banner hangs one flight higher.'),
};
