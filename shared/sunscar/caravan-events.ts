import type { CaravanChoice, CaravanEffect, CaravanEvent } from './caravan-types.js';
const choice = (id: string, label: string, hint: string, result: string, effect: CaravanEffect = {}, extra: Partial<CaravanChoice> = {}): CaravanChoice => ({ id, label, hint, result, effect, ...extra });

/** Authored encounter library. Choice costs and consequences are data, shared by
 * the host's resolver and the UI's availability/preview logic. */
export const CARAVAN_EVENTS: readonly CaravanEvent[] = [
    { id: 'broken-axle', kind: 'traveler', title: 'A wheel in the sand', scene: 'A driver has unpacked half her wagon beside a split axle. “The hub is sound. I just need something to bind it.”', excludesFlag: 'helped-driver', choices: [
        choice('kit', 'Bind the axle', 'Spend a repair kit. Gain a contact on the road.', 'She writes an outpost name on your route slip. “Ask for Nera. Tell her I owe you.”', { morale: 8, reputation: 3, addFlags: ['helped-driver', 'helped-traveler'] }, { cost: { tool: 'repair' } }),
        choice('lash', 'Use your spare lashings', 'Spend 2 supplies. The repair holds.', 'Your crew shares its lashings. The driver falls in behind your caravan.', { morale: 6, reputation: 2, addFlags: ['helped-driver', 'helped-traveler'] }, { cost: { supplies: 2 } }),
        choice('leave', 'Mark the wagon for the next patrol', 'Keep your supplies. A small morale loss.', 'You leave a visible trail marker. The driver watches the next ridge.', { morale: -3 }),
    ] },
    { id: 'nera-outpost', kind: 'merchant', title: 'Nera remembers', scene: 'The outpost cook looks at the name on your slip, then pushes two sealed water jars across the counter. “She always breaks that axle.”', requiresFlag: 'helped-driver', choices: [
        choice('water', 'Take water for the crew', 'Recover 3 supplies.', 'The jars are cool from the cellar. Nobody asks what they cost.', { supplies: 3, removeFlags: ['helped-driver'] }),
        choice('repair', 'Ask for a cargo patch instead', 'Recover 15 cargo.', 'Nera sends her apprentice out with a pot of pitch and a roll of canvas.', { cargo: 15, removeFlags: ['helped-driver'] }),
    ] },
    { id: 'abandoned-wagon', kind: 'event', title: 'An empty driver’s seat', scene: 'The wagon is undamaged. Its tea is still warm. Two pairs of boot prints lead toward a shallow gully.', excludesFlag: 'wagon-tracks', choices: [
        choice('track', 'Follow the boot prints', 'Spend 1 supply. Learn who took the shipment.', 'A strip of red binding hangs from a thorn bush. You have seen it on the raiders’ spears.', { addFlags: ['wagon-tracks'], discovery: 'Red binding trail' }, { cost: { supplies: 1 } }),
        choice('take', 'Take the unattended provisions', 'Gain 3 supplies. The owners may find you later.', 'You mark the wagon’s location and load the sealed crates. One bears a village relief stamp.', { supplies: 3, addFlags: ['taken-relief'] }),
        choice('leave', 'Keep to your contract', 'No cost.', 'The wheels behind you creak. The empty wagon shrinks into the heat.', {}),
    ] },
    { id: 'red-binding', kind: 'event', title: 'The red binding', scene: 'A raider beneath the ridge wears the same red strip you found at the wagon. Beyond him, two drivers sit with their hands tied.', requiresFlag: 'wagon-tracks', choices: [
        choice('rescue', 'Cut the drivers loose', 'Fight the raider. The freed drivers can help later.', 'You give the crew a signal and step into the gully.', { combat: 'raider', addFlags: ['rescued-drivers', 'helped-traveler'], removeFlags: ['wagon-tracks'], reputation: 4 }),
        choice('signal', 'Signal the outpost guard', 'Spend 1 supply. Avoid the fight.', 'A flare climbs above the ridge. The raiders scatter before the patrol arrives.', { reputation: 2, removeFlags: ['wagon-tracks'], morale: 4 }, { cost: { supplies: 1 } }),
    ] },
    { id: 'relief-claim', kind: 'traveler', title: 'The stamped crate', scene: 'A medic points at the relief stamp on your borrowed provisions. “We have children waiting for that. Where did you get it?”', requiresFlag: 'taken-relief', choices: [
        choice('return', 'Return the provisions', 'Spend 3 supplies. Repair your standing.', 'The medic checks the seals and helps your crew resecure its load before leaving.', { cargo: 6, morale: 8, reputation: 2, removeFlags: ['taken-relief'] }, { cost: { supplies: 3 } }),
        choice('refuse', 'Keep what the road gave you', 'Keep supplies. Lose morale and reputation.', 'He writes down the caravan’s banner. Your crew avoids his eyes.', { morale: -12, reputation: -4, removeFlags: ['taken-relief'], addFlags: ['relief-dispute'] }),
    ] },
    { id: 'lost-apprentice', kind: 'traveler', title: 'The wrong landmark', scene: 'An apprentice shinobi has circled the same stone twice. Her map is upside down. She notices you noticing.', choices: [
        choice('escort', 'Take her to the next marker', 'Spend 1 supply. Gain morale and a scouting clue.', 'She walks ahead after that, checking each turn twice. Near sunset she spots a route your map missed.', { morale: 6, reputation: 2, scout: 1, addFlags: ['helped-traveler'] }, { cost: { supplies: 1 } }),
        choice('directions', 'Correct the map', 'No cost. A little goodwill.', '“I knew the river looked wrong,” she says, and folds it carefully.', { morale: 2 }),
    ] },
    { id: 'wounded-courier', kind: 'traveler', title: 'A message still sealed', scene: 'The courier has tied his sleeve above the wound. His dispatch case is dry and unbroken. “The message matters. My leg can wait.”', choices: [
        choice('treat', 'Use the medical pack', 'Spend medicine. Gain reputation and a future warning.', 'He gives you a description of the men who hit him. Your guards memorize it.', { reputation: 4, morale: 5, addFlags: ['courier-warning', 'helped-traveler'] }, { cost: { tool: 'medicine' } }),
        choice('carry', 'Give him a place on the wagon', 'Lose 5 cargo capacity. Gain reputation.', 'The crew shifts a crate and makes room. He keeps the dispatch under his good arm.', { cargo: -5, reputation: 3, morale: 3, addFlags: ['helped-traveler'] }),
        choice('water', 'Leave water and a marker', 'Spend 1 supply. Gain a little reputation.', 'He drinks, then gives you the patrol signal to paint on the marker.', { reputation: 1 }, { cost: { supplies: 1 } }),
    ] },
    { id: 'false-patrol', kind: 'event', title: 'An unfamiliar patrol', scene: 'Three guards block the road. Their uniforms are clean; their village seals have been stitched on backward. The leader asks for a transit fee.', choices: [
        choice('warned', 'Name the courier they attacked', 'Use the courier’s warning. They retreat.', 'The leader looks toward the ridge, suddenly unsure how many witnesses you brought.', { morale: 5, reputation: 3, removeFlags: ['courier-warning'] }, { requiresFlag: 'courier-warning' }),
        choice('fight', 'Ask them to show their orders', 'Fight a raider.', 'His hand goes to his weapon before he thinks to answer.', { combat: 'raider' }),
        choice('detour', 'Take the long way around', 'Spend 2 supplies. Protect the cargo.', 'Your scout finds the older road behind the ridge. The guards do not follow.', {}, { cost: { supplies: 2 } }),
    ] },
    { id: 'spice-merchant', kind: 'merchant', title: 'A scale with two pans', scene: 'A spice seller has more water than spices today. “Everyone packed for yesterday’s weather.” She taps the full jars beside her stall.', choices: [
        choice('buy', 'Buy provisions', 'Pay 4% of the contract’s base reward. Gain 3 supplies.', 'The jars are sealed in front of you. The seller wraps them against the heat.', { supplies: 3 }, { cost: { ryoFraction: .04 } }),
        choice('barter', 'Trade spare packing material', 'Lose 7 cargo. Gain 2 supplies.', 'Your crew parts with the extra padding. The water is welcome; the crates ride less softly.', { cargo: -7, supplies: 2 }),
        choice('leave', 'Thank her and move on', 'No cost.', 'She lifts a cup as the last wagon passes.'),
    ] },
    { id: 'wheelwright', kind: 'merchant', title: 'The traveling wheelwright', scene: 'A wheelwright listens to your wagon roll. “Rear left. You can keep going, but you will hear it again.”', choices: [
        choice('service', 'Pay for a proper repair', 'Pay 5% of base reward. Restore 18 cargo.', 'She fits a new pin, then makes your driver roll the wagon past her again.', { cargo: 18 }, { cost: { ryoFraction: .05 } }),
        choice('kit', 'Buy a repair kit', 'Pay 3% of base reward. Gain one repair kit.', 'She adds the right-size pin after checking your axle.', { tools: { repair: 1 } }, { cost: { ryoFraction: .03 } }),
        choice('leave', 'Keep the coin', 'No cost.', '“Your road,” she says, and packs her tools.'),
    ] },
    { id: 'sealed-price', kind: 'merchant', title: 'A price for silence', scene: 'An unmarked trader offers to hide a small black box among your goods. “It stays sealed. The receiver knows the mark.”', excludesFlag: 'black-box', choices: [
        choice('accept', 'Carry the black box', 'A delivery bonus, with a possible inspection later.', 'He ties a black thread around a handle and steps away before you can ask his name.', { bonus: 8, addFlags: ['black-box'] }),
        choice('inspect', 'Open it before agreeing', 'Lose the offer. Discover the trader’s seal.', 'The trader closes the lid with one finger. You catch the impression of a black sun in the wax.', { discovery: 'The black sun seal', addFlags: ['broker-seal'] }),
        choice('decline', 'Decline the extra cargo', 'Gain 2 morale.', 'Your driver lets out a breath once the trader is behind you.', { morale: 2 }),
    ] },
    { id: 'customs-seal', kind: 'event', title: 'The inspection rope', scene: 'A customs officer lifts the rope across the road. “We are looking for unmarked consignments. Leave your seals where I can see them.”', requiresFlag: 'black-box', choices: [
        choice('surrender', 'Declare the black box', 'Lose its bonus. Gain reputation.', 'The officer signs a receipt for the box. “You did the right paperwork, at least.”', { bonus: -8, reputation: 3, removeFlags: ['black-box'] }),
        choice('detour', 'Turn back before the checkpoint', 'Spend 3 supplies. Keep the delivery promise.', 'You take a rough smugglers’ track around the customs post.', { morale: -3 }, { cost: { supplies: 3 } }),
        choice('open', 'Break the seal yourself', 'Lose 8 cargo and the bonus. Discover what was inside.', 'The box holds dry sand and one finger bone. The officer calls for a containment jar.', { cargo: -8, bonus: -8, discovery: 'The bone consignment', removeFlags: ['black-box'] }),
    ] },
    { id: 'water-auction', kind: 'merchant', title: 'The last cool jar', scene: 'Two caravans are bidding over the last jar in a shaded stall. An older driver stands aside with an empty cup.', weather: ['heat', 'festival', 'clear'], choices: [
        choice('share', 'Buy it and share', 'Pay 3% of base reward. Gain 1 supply and goodwill.', 'The seller finds a second cup. The older driver leaves directions to a sheltered well.', { supplies: 1, morale: 7, reputation: 2, addFlags: ['well-directions', 'helped-traveler'] }, { cost: { ryoFraction: .03 } }),
        choice('buy', 'Buy it for your crew', 'Pay 3% of base reward. Gain 3 supplies.', 'The jar goes under your best canvas. Your crew drinks carefully.', { supplies: 3 }, { cost: { ryoFraction: .03 } }),
        choice('leave', 'Leave the bidding to them', 'No cost.', 'The voices follow you for a while, then the wind takes them.'),
    ] },
    { id: 'sheltered-well', kind: 'camp', title: 'The well behind the wall', scene: 'The driver’s directions lead to a well sheltered by an old courtyard. A bucket waits on a sound rope.', requiresFlag: 'well-directions', choices: [
        choice('fill', 'Refill the water skins', 'Gain 4 supplies.', 'The last skin comes up cold. Your crew marks the wall for the next honest caravan.', { supplies: 4, removeFlags: ['well-directions'] }),
        choice('rest', 'Take a quiet hour', 'Recover 12% HP and 15% stamina.', 'Someone keeps watch from the wall while the crew sleeps in its shade.', { hpPercent: 12, staminaPercent: 15, morale: 4, removeFlags: ['well-directions'] }),
    ] },
    { id: 'camp-coals', kind: 'camp', title: 'Coals beneath the ash', scene: 'The last caravan left dry wood and a covered fire pit. Your crew sets the wagons in a half circle.', choices: [
        choice('rest', 'Cook and rest', 'Spend 2 supplies. Recover 14% HP, 12% chakra and stamina.', 'A proper meal changes the conversation. Watches are traded without argument.', { hpPercent: 14, chakraPercent: 12, staminaPercent: 12, morale: 6 }, { cost: { supplies: 2 } }),
        choice('repair', 'Work on the load', 'Spend a repair kit. Restore 20 cargo.', 'You replace the weakest ties before darkness hides them.', { cargo: 20 }, { cost: { tool: 'repair' } }),
        choice('talk', 'Listen to the crew', 'Gain 8 morale. No physical recovery.', 'The youngest driver admits this is his first crossing. The others begin telling him about theirs.', { morale: 8 }),
    ] },
    { id: 'camp-high-ground', kind: 'camp', title: 'Above the sand', scene: 'A flat shelf keeps the wheels clear of drifting sand. From here you can see two routes beyond the next ridge.', choices: [
        choice('scout', 'Study the routes', 'Reveal another row. Spend 1 supply.', 'You sketch the broken bridge and the safer descent while the light holds.', { scout: 1, morale: 3 }, { cost: { supplies: 1 } }),
        choice('medicine', 'Treat lingering wounds', 'Spend medicine. Recover 24% HP.', 'Your bandages are clean this time. The crew takes turns holding the lamp.', { hpPercent: 24 }, { cost: { tool: 'medicine' } }),
        choice('sleep', 'Sleep in shifts', 'Recover 7% stamina and 4 morale.', 'The high air is cool. Nothing approaches the shelf before dawn.', { staminaPercent: 7, morale: 4 }),
    ] },
    { id: 'camp-quarrel', kind: 'camp', title: 'Two drivers, one fire', scene: 'The front driver blames the rear wagon for the slow pace. The rear driver points at the heavier load. Neither is wrong.', choices: [
        choice('rebalance', 'Help them rebalance the load', 'Spend 1 supply. Gain 12 morale and 5 cargo.', 'Once the work is shared, the argument runs out of air.', { morale: 12, cargo: 5 }, { cost: { supplies: 1 } }),
        choice('meal', 'Open the crew’s reserve meal', 'Spend 2 supplies. Recover 10% chakra and gain 15 morale.', 'They are still disagreeing over dinner, but now they pass each other the bread.', { morale: 15, chakraPercent: 10 }, { cost: { supplies: 2 } }),
        choice('order', 'Set the order and move on', 'Lose 4 morale.', 'The wagons keep their places. The conversation stops.', { morale: -4 }),
    ] },
    { id: 'glass-sand', kind: 'hazard', title: 'A field of glass', scene: 'Lightning has fused the surface into brittle sheets. A camel’s first step punches through with a sharp crack.', choices: [
        choice('mats', 'Lay down packing mats', 'Spend 2 supplies. Cross safely.', 'The crew advances one wagon at a time, carrying the mats forward.', {}, { cost: { supplies: 2 } }),
        choice('walk', 'Walk the cargo across', 'Lose 10% stamina. Protect the wagons.', 'You make three trips before the last crate reaches ordinary sand.', { staminaPercent: -10, morale: 2 }),
        choice('drive', 'Keep the wheels moving', 'Lose 12 cargo. Save supplies.', 'Two crates shake loose when a wheel drops through the glass.', { cargo: -12, morale: -3 }),
    ] },
    { id: 'white-heat', kind: 'hazard', title: 'The white hour', scene: 'The horizon disappears into glare. A driver takes a long moment to remember which wagon is his.', choices: [
        choice('water', 'Open the extra water', 'Spend water. Restore 5 morale.', 'Wet cloths go around the crew. The wagons wait until everyone can focus again.', { morale: 5 }, { cost: { tool: 'water' } }),
        choice('shade', 'Rig a shade stop', 'Spend 2 supplies. Cross the hot hour safely.', 'You stretch the spare cloth between the wagons and wait out the worst of it.', {}, { cost: { supplies: 2 } }),
        choice('push', 'Push to the next ridge', 'Lose 8 cargo and 10% stamina.', 'The crew gets through, but haste and shaking hands cost two corner braces.', { cargo: -8, staminaPercent: -10, morale: -5 }),
    ] },
    { id: 'sand-wall', kind: 'hazard', title: 'The moving wall', scene: 'A wall of sand rolls across the road. You have time to anchor the covers, or find shelter beneath the cut bank.', choices: [
        choice('anchor', 'Anchor the covers', 'Spend a repair kit. Keep the load intact.', 'The canvas strains against its ties. Every knot holds.', { morale: 3 }, { cost: { tool: 'repair' } }),
        choice('shelter', 'Shelter beneath the bank', 'Spend 2 supplies. Lose 2 cargo.', 'Sand works into the lower crates, but the bank takes most of the storm.', { cargo: -2 }, { cost: { supplies: 2 } }),
        choice('ride', 'Ride it out on the road', 'Lose 16 cargo and 6 morale.', 'The drivers count each other by touch until the wind clears.', { cargo: -16, morale: -6 }),
    ] },
    { id: 'flash-flood', kind: 'hazard', title: 'Water in the dry channel', scene: 'Brown water appears around a bend in a channel that was dry a moment ago. The rear wheels are still on the low crossing.', choices: [
        choice('haul', 'Haul the rear wagon up', 'Lose 12% stamina. Gain 4 morale.', 'You pull until your heels find stone. The wheel clears the lip just before the surge.', { staminaPercent: -12, morale: 4 }),
        choice('cut', 'Cut loose the bottom crates', 'Lose 14 cargo. Keep the crew safe.', 'The lightened wagon climbs. Its discarded crates turn slowly in the current.', { cargo: -14 }),
        choice('rope', 'Rig a recovery line', 'Spend 2 supplies. Lose 3 cargo.', 'The line holds the wagon steady while the crew unloads its rear axle.', { cargo: -3 }, { cost: { supplies: 2 } }),
    ] },
    { id: 'loose-scree', kind: 'hazard', title: 'Stone under the wheels', scene: 'Loose scree covers the descent. The lead wagon starts sliding sideways before the brake catches.', choices: [
        choice('braces', 'Brace the wheels', 'Spend a repair kit. Safe descent.', 'Wooden shoes drag behind the wheels and keep the wagons straight.', {}, { cost: { tool: 'repair' } }),
        choice('guide', 'Guide each wagon by hand', 'Lose 9% stamina and 3 cargo.', 'The crew eases every axle over the worst patches.', { staminaPercent: -9, cargo: -3 }),
        choice('speed', 'Take the descent quickly', 'Lose 13 cargo.', 'Speed carries you through the scree. The last landing breaks a crate’s corner.', { cargo: -13 }),
    ] },
    { id: 'shifting-marker', kind: 'event', title: 'A marker facing east', scene: 'The road marker points toward a dune with no wheel tracks. Its base has fresh shovel marks.', choices: [
        choice('map', 'Check the scout map', 'Spend a scout map. Reveal another row.', 'The marker has been turned. You correct it and mark the true pass.', { scout: 1, reputation: 2 }, { cost: { tool: 'map' } }),
        choice('scout', 'Send two people to check', 'Spend 1 supply. Avoid the trap.', 'They return with a strip of tripwire and a very firm recommendation.', { addFlags: ['tripwire-warning'] }, { cost: { supplies: 1 } }),
        choice('tracks', 'Follow the older wheel tracks', 'Lose 6 cargo on a rough alternate road.', 'The older road is real, though most of its paving is gone.', { cargo: -6 }),
    ] },
    { id: 'cargo-rattle', kind: 'event', title: 'Something inside the crate', scene: 'One crate rattles after the wagons stop. The manifest describes ceramic bowls. Bowls should not keep rattling.', choices: [
        choice('open', 'Check the crate', 'Spend 1 supply. Save the packing.', 'A desert lizard has nested between the bowls. You lift it out in a folded cloth.', { cargo: 5, discovery: 'A stowaway in the bowls' }, { cost: { supplies: 1 } }),
        choice('feed', 'Lure it out with pet feed', 'Spend pet feed. Gain morale.', 'The lizard follows the feed into the shade. The drivers name it after their employer.', { morale: 8, cargo: 5 }, { cost: { tool: 'feed' } }),
        choice('seal', 'Add another layer of rope', 'Lose 6 cargo to broken ceramics.', 'The rattling stops on the next hill. A fine white dust leaks through the seams.', { cargo: -6 }),
    ] },
    { id: 'leaking-oil', kind: 'event', title: 'A dark line behind the wagon', scene: 'Lamp oil leaves a thin line in the sand. The stopper is sound; a seam has opened near the bottom of the vessel.', choices: [
        choice('patch', 'Patch the vessel', 'Spend a repair kit. Restore 8 cargo.', 'The pitch sets before much more oil escapes.', { cargo: 8 }, { cost: { tool: 'repair' } }),
        choice('decant', 'Use spare water skins', 'Spend 2 supplies. Stop the leak.', 'The crew labels the skins clearly. Nobody wants a mistake at the next rest stop.', {}, { cost: { supplies: 2 } }),
        choice('discard', 'Leave the damaged vessel', 'Lose 10 cargo. Remove the fire risk.', 'You bury the oil well away from the road.', { cargo: -10 }),
    ] },
    { id: 'rope-bridge', kind: 'event', title: 'The bridge keeper', scene: 'The keeper has closed the bridge to heavy wagons. “One at a time used to be enough. Look at the south anchor.”', choices: [
        choice('repair', 'Rebuild the anchor', 'Spend a repair kit. Gain reputation.', 'The keeper tests the new binding himself, then waves the first wagon across.', { reputation: 3, morale: 4 }, { cost: { tool: 'repair' } }),
        choice('unload', 'Unload and carry the cargo', 'Lose 14% stamina. Cross safely.', 'Everyone takes a turn. The keeper brings out water after the final load.', { staminaPercent: -14, supplies: 1 }),
        choice('ford', 'Use the lower ford', 'Spend 1 supply and lose 7 cargo.', 'The ford is passable. Keeping the lowest crates dry is another matter.', { cargo: -7 }, { cost: { supplies: 1 } }),
    ] },
    { id: 'raider-toll', kind: 'combat', title: 'A toll paid in steel', scene: 'A raider plants a spear across the road. “One crate from every wagon. Then we all keep moving.”', choices: [
        choice('fight', 'Hold the line', 'Fight a raider. Protect your cargo.', 'The drivers pull the wagons tight while you step forward.', { combat: 'raider' }),
        choice('smoke', 'Cover a withdrawal', 'Spend smoke bombs. Lose 4 morale.', 'Smoke fills the gap between the wagons. You take a side road before it clears.', { morale: -4 }, { cost: { tool: 'smoke' } }),
        choice('toll', 'Surrender part of the load', 'Lose 18 cargo. Avoid combat.', 'The raider counts the crates twice, then lifts his spear.', { cargo: -18, morale: -5 }),
    ] },
    { id: 'ridge-ambush', kind: 'combat', title: 'Movement on the ridge', scene: 'A glint of metal appears above the road. Your scout drops to one knee and points to a second figure on the opposite slope.', choices: [
        choice('fight', 'Drive them off the ridge', 'Fight a raider. Small cargo exposure.', 'The wagons keep moving while you climb toward the nearest attacker.', { combat: 'raider', cargo: -3 }),
        choice('warned', 'Use the warning to cut their line', 'Tripwire warning required. Avoid combat.', 'You cut the release rope before their signal. The ambush collapses into shouting.', { reputation: 3, removeFlags: ['tripwire-warning'] }, { requiresFlag: 'tripwire-warning' }),
        choice('smoke', 'Hide the convoy’s movement', 'Spend smoke bombs. Cross safely.', 'The attackers throw at shadows while the wagons pass beneath the bank.', {}, { cost: { tool: 'smoke' } }),
    ] },
    { id: 'dry-cistern', kind: 'ruins', title: 'Below the old cistern', scene: 'A stair descends beneath a dry cistern. Along its walls, the water marks rise far above your head.', choices: [
        choice('explore', 'Follow the lower stair', 'Spend 2 supplies. Discover the old flood route.', 'The lower chamber records years when water crossed the whole desert. One line names Sunscar before the festival.', { discovery: 'The flood years', reputation: 3, scout: 1 }, { cost: { supplies: 2 } }),
        choice('salvage', 'Salvage rope from the lift', 'Gain 2 supplies. Lose 4 morale disturbing the site.', 'The old rope is dry but sound. Your scout leaves the lift’s carved counterweight where it stood.', { supplies: 2, morale: -4 }),
        choice('leave', 'Copy the inscription by the door', 'A small discovery, no cost.', 'You rub sand from the letters long enough to copy a name.', { discovery: 'A cistern keeper’s name' }),
    ] },
    { id: 'listening-stones', kind: 'ruins', title: 'The listening stones', scene: 'The stones hum when the wind changes. Beneath one note, your companion raises its head as if hearing a familiar call.', choices: [
        choice('wait', 'Let the companion listen', 'Spend 1 supply. A discovery and better morale.', 'The note settles into a rhythm. Your pet lies down beside the wagon, completely at ease.', { discovery: 'The listening stones', morale: 10 }, { cost: { supplies: 1 } }),
        choice('trace', 'Trace the buried seal', 'Lose 6% chakra. Reveal another row.', 'A narrow line of light follows the old road beneath the sand.', { chakraPercent: -6, scout: 1 }),
        choice('leave', 'Leave the stones undisturbed', 'Gain 2 morale.', 'The sound fades as the wagons turn away.', { morale: 2 }),
    ] },
    { id: 'watchtower-ledger', kind: 'ruins', title: 'The last watch ledger', scene: 'A ledger lies under a collapsed watchtower roof. The final page lists shipments that never reached the next post.', choices: [
        choice('copy', 'Copy the missing shipments', 'Spend 1 supply. Start following the missing shipment trail.', 'Several entries share a receiver’s mark. You copy that mark onto your own manifest.', { discovery: 'The missing shipment ledger', addFlags: ['shipment-evidence'], reputation: 3 }, { cost: { supplies: 1 } }),
        choice('cache', 'Search the watch store', 'Gain 2 supplies; lose 5 cargo to falling rubble.', 'There is still usable canvas below the shelves. Getting it out brings down the last beam.', { supplies: 2, cargo: -5 }),
        choice('mark', 'Mark the tower for the archivists', 'Gain 1 reputation.', 'You leave a clear marker where the ledger can be recovered safely.', { reputation: 1 }),
    ] },
    { id: 'sunken-bell', kind: 'ruins', title: 'A bell under the dunes', scene: 'Only the crown of a bronze bell rises from the sand. Your oldest driver says it once called caravans home before dark.', choices: [
        choice('dig', 'Expose its inscription', 'Spend 2 supplies. Gain a discovery.', 'The bell was paid for by seven drivers. Their names are small and deeply cut.', { discovery: 'The seven drivers’ bell', reputation: 4, morale: 5 }, { cost: { supplies: 2 } }),
        choice('ring', 'Sound it once', 'Gain morale. Alert a nearby raider.', 'The sound carries farther than anyone expected. An answering whistle comes from the ridge.', { morale: 8, combat: 'raider' }),
        choice('leave', 'Leave a ribbon on its crown', 'Gain 3 morale.', 'The ribbon is still visible when the dunes hide the bell itself.', { morale: 3 }),
    ] },
    { id: 'sealed-cache', kind: 'treasure', title: 'A box beneath the cairn', scene: 'A supply box rests under a fresh cairn. Its owner marked it for a caravan due tomorrow.', choices: [
        choice('borrow', 'Borrow and leave a signed receipt', 'Gain 3 supplies; owe part of the delivery bonus.', 'Your name goes into the box with a promise to settle at the outpost.', { supplies: 3, bonus: -4, addFlags: ['cache-debt'] }),
        choice('steal', 'Take it without a note', 'Gain 4 supplies. Lose reputation and morale.', 'One driver turns the marked lid face down before packing it.', { supplies: 4, reputation: -4, morale: -8 }),
        choice('leave', 'Leave it for its owner', 'Gain 2 morale.', 'The cairn goes back exactly as you found it.', { morale: 2 }),
    ] },
    { id: 'buried-coins', kind: 'treasure', title: 'Coins in the wash', scene: 'The last flood exposed a scatter of old coins. Most are green with age. A few still show the Sunscar mint mark.', choices: [
        choice('collect', 'Collect what is visible', 'Gain a 4% delivery bonus.', 'The coins go into a cloth bag for the outpost assessor.', { bonus: 4 }),
        choice('dig', 'Search beneath the bank', 'Spend 2 supplies. Find 8% bonus or a sealed guardian.', 'You work along the seam below the bank.', {}, { cost: { supplies: 2 }, outcomes: [
            { weight: 3, result: 'A broken jar spills more coins into the light.', effect: { bonus: 8, discovery: 'Sunscar’s old mint' } },
            { weight: 1, result: 'A seal brightens beneath the jar. The chamber’s guardian wakes.', effect: { combat: 'sentinel', discovery: 'The mint guardian' } },
        ] }),
        choice('copy', 'Sketch the mint mark', 'Gain a discovery.', 'The mark is older than the festival banners, but its shape is almost unchanged.', { discovery: 'Sunscar’s old mint' }),
    ] },
    { id: 'desert-fox', kind: 'pet', title: 'A fox beside the road', scene: 'A fox keeps pace with the lead wagon, far enough away to bolt. Your companion watches it between glances at your hand.', choices: [
        choice('feed', 'Leave a little feed', 'Spend pet feed. Gain morale and a trail clue.', 'The fox waits until you turn away, then follows a narrow path through the dunes.', { morale: 7, addFlags: ['wild-trail'], discovery: 'Fox trail markers' }, { cost: { tool: 'feed' } }),
        choice('watch', 'Watch where it goes', 'Spend 1 supply. Reveal another row.', 'It takes a sheltered path your wagons can use too.', { scout: 1 }, { cost: { supplies: 1 } }),
        choice('leave', 'Give it room', 'No cost.', 'The fox drops behind when the road turns to stone.'),
    ] },
    { id: 'nesting-flock', kind: 'pet', title: 'The road is a nest', scene: 'Small desert birds have nested in the wheel ruts. The adults stand their ground, wings spread over the eggs.', choices: [
        choice('detour', 'Guide the wagons around', 'Lose 4 cargo on softer sand. Gain reputation.', 'The birds settle as soon as the wheels clear the nests.', { cargo: -4, reputation: 2, morale: 5 }),
        choice('feed', 'Draw the flock to a safer hollow', 'Spend feed. The crew moves the nests carefully.', 'The adults follow the food, then return to find their eggs above the next flood line.', { reputation: 3, morale: 6 }, { cost: { tool: 'feed' } }),
        choice('carry', 'Carry the nests beyond the road', 'Lose 7% stamina. Gain morale.', 'Your companion keeps watch over the last clutch while the rear wagon passes.', { staminaPercent: -7, morale: 4 }),
    ] },
    { id: 'rare-pet-trail', kind: 'pet', title: 'Tracks that shine at dusk', rare: true, weight: .16, scene: 'Pale tracks cross the road without disturbing the dust. The caravan’s tamer kneels beside them. “A wild companion. We still have to earn its trust.”', choices: [
        choice('follow', 'Let the tamer follow the trail', 'Spend feed. Opens the normal wild encounter rules; no guaranteed capture.', 'You keep the wagons quiet while the tamer approaches the hollow.', { petTrail: true, discovery: 'The luminous pet trail', reputation: 3 }, { cost: { tool: 'feed' } }),
        choice('record', 'Record the trail for the Pet Yard', 'Gain a discovery and reputation.', 'The tamer copies the tracks and the hour of their appearance.', { discovery: 'The luminous pet trail', reputation: 2 }),
    ] },
    { id: 'buried-shrine', kind: 'ruins', title: 'The buried shrine', rare: true, weight: .12, scene: 'The storm has uncovered a staircase. At its foot, a stone bowl holds water that has not gathered a grain of sand.', choices: [
        choice('offer', 'Leave water at the threshold', 'Spend extra water. Gain a rare discovery and morale.', 'You pour beside the bowl. For a moment, the floor shows footprints leading farther in.', { discovery: 'The shrine beneath Sunscar', morale: 12, reputation: 6 }, { cost: { tool: 'water' } }),
        choice('enter', 'Follow the dry footprints', 'Fight the shrine sentinel. A larger discovery bonus.', 'The inner door opens without a sound. Something on the other side stands to meet you.', { combat: 'sentinel', discovery: 'The shrine’s inner chamber', bonus: 10, reputation: 5 }),
        choice('seal', 'Mark it for a trained survey team', 'Gain reputation. Preserve the site.', 'You cover the first steps against the returning sand and record the bearing.', { reputation: 4, discovery: 'The shrine survey bearing' }),
    ] },
    { id: 'black-caravan', kind: 'traveler', title: 'The Black Caravan', rare: true, weight: .1, scene: 'An unmarked caravan crosses your road in complete silence. Its rear guard wears a small black sun at the throat.', choices: [
        choice('signal', 'Show that you recognize the seal', 'Requires the trader’s seal. Learn a name.', 'The guard gives you one name: “Vey.” Then he points to the closed ledger under his arm.', { discovery: 'Vey’s black ledger', addFlags: ['black-ledger'], reputation: 4 }, { requiresFlag: 'broker-seal' }),
        choice('distance', 'Keep a respectful distance', 'Discover the route. No confrontation.', 'The black wagons take a road omitted from every public map.', { discovery: 'The Black Caravan road', addFlags: ['broker-seal'] }),
        choice('follow', 'Follow the last wagon', 'Fight a rogue escort. Learn about the missing shipments.', 'The rear guard stops. The rest of the caravan does not.', { combat: 'rogue', discovery: 'The Black Caravan escort', addFlags: ['black-ledger', 'shipment-evidence'] }),
    ] },
    { id: 'lost-shinobi', kind: 'traveler', title: 'A shinobi without a shadow', rare: true, weight: .12, scene: 'A traveler asks which year is written on your manifest. His village badge has not been issued in decades.', choices: [
        choice('answer', 'Show him the date', 'Learn his story. Gain a rare discovery.', 'He sits on a stone for a long time. Before leaving, he gives you the name of a well that no longer appears on maps.', { discovery: 'The shinobi from the old road', addFlags: ['old-road-guide'], reputation: 4 }),
        choice('water', 'Offer him water first', 'Spend 1 supply. He walks with you for a while.', 'He drinks slowly, then begins pointing out safe stones beneath the sand.', { discovery: 'The shinobi from the old road', scout: 2, morale: 8, addFlags: ['helped-traveler'] }, { cost: { supplies: 1 } }),
    ] },
    { id: 'old-road', kind: 'event', title: 'The road he remembered', scene: 'The old traveler’s directions lead to a causeway just below the sand. Its stones still bear the worn grooves of caravan wheels.', requiresFlag: 'old-road-guide', choices: [
        choice('follow', 'Trust the old causeway', 'Recover 2 supplies and 8 morale.', 'The wagons roll cleanly for the first time in hours. At the far end, the traveler’s footprints stop.', { supplies: 2, morale: 8, discovery: 'The remembered causeway', removeFlags: ['old-road-guide'] }),
        choice('record', 'Map it for future caravans', 'Spend 1 supply. Gain 6 reputation.', 'You measure the bearings carefully. A forgotten safe road is worth the extra hour.', { reputation: 6, discovery: 'The remembered causeway', removeFlags: ['old-road-guide'] }, { cost: { supplies: 1 } }),
    ] },
    { id: 'village-pilgrims', kind: 'traveler', title: 'Home sewn on a sleeve', scene: 'A family has sewn its village mark onto every child’s sleeve. Their eldest asks if your banner means the road ahead is safe.', choices: [
        choice('escort', 'Bring them into the convoy', 'Spend 2 supplies. Gain reputation and morale.', 'The children count the wagons until the youngest falls asleep against a crate.', { reputation: 4, morale: 6, addFlags: ['helped-traveler'] }, { cost: { supplies: 2 } }),
        choice('warn', 'Share what your scouts saw', 'Reveal a row together. Spend 1 supply.', 'Their eldest adds a warning to your map that your own scouts missed.', { scout: 1, reputation: 2 }, { cost: { supplies: 1 } }),
        choice('supplies', 'Give them a water skin', 'Spend 1 supply. Gain reputation.', 'The water skin passes straight to the smallest child.', { reputation: 2, addFlags: ['helped-traveler'] }, { cost: { supplies: 1 } }),
    ] },
    { id: 'festival-drummer', kind: 'traveler', title: 'A drum without a strap', scene: 'A drummer carries his instrument in both arms. “I played the finish line yesterday. Today I am walking to the next one.”', choices: [
        choice('ride', 'Give him a ride', 'Lose 3 cargo space. Gain 14 morale.', 'He keeps a quiet marching rhythm against the rim. The tired drivers begin keeping time.', { cargo: -3, morale: 14 }),
        choice('strap', 'Make him a new strap', 'Spend 1 supply. Gain reputation and morale.', 'He plays you to the next ridge before turning toward his own road.', { reputation: 2, morale: 6, addFlags: ['helped-traveler'] }, { cost: { supplies: 1 } }),
        choice('listen', 'Stop for one song', 'Gain 4 morale.', 'Nobody talks during the song. The road sounds different afterward.', { morale: 4 }),
    ] },
    { id: 'captain-line', kind: 'boss', title: 'The Dune Raider Captain', scene: 'The captain has chosen a narrow pass with no room to turn the wagons. “You have made my people work for this shipment.”', choices: [
        choice('fight', 'Open the pass', 'Boss encounter. Defeat the captain to continue.', 'You hand the manifest back to the driver and draw the captain away from the wagons.', { combat: 'captain' }),
    ] },
    { id: 'wyrm-crossing', kind: 'boss', title: 'The Sand Wyrm', scene: 'A moving ridge cuts across the road. The caravan animals freeze before the first armored coil breaks the surface.', choices: [
        choice('fight', 'Draw it away from the convoy', 'Boss encounter. The crew keeps the cargo moving.', 'The lead driver sounds the alarm. You take the open ground beside the road.', { combat: 'wyrm' }),
    ] },
    { id: 'scorpion-den', kind: 'boss', title: 'The Scorpion Queen', scene: 'A dark shape blocks the mouth of the ruins. Smaller scorpions vanish into cracks as their queen unfolds her claws.', choices: [
        choice('fight', 'Hold the ruins entrance', 'Boss encounter. Keep the queen away from the wagons.', 'Your crew backs the animals clear of the broken stone.', { combat: 'scorpion' }),
    ] },
    { id: 'rogue-escort', kind: 'elite', title: 'A better-paid escort', scene: 'A shinobi in a travel-worn cloak steps into the road. “Someone paid me more to stop this shipment than they paid you to move it.”', choices: [
        choice('fight', 'Make him earn it', 'Elite encounter.', 'He leaves his pack on a stone and draws a narrow blade.', { combat: 'rogue' }),
        choice('pay', 'Offer a cancellation fee', 'Pay 12% of base reward. Avoid combat.', 'He counts the payment once. “Tell your employer to hire better next time.”', { morale: -5 }, { cost: { ryoFraction: .12 } }),
    ] },
    { id: 'ruin-guardian', kind: 'elite', title: 'The seal at the arch', scene: 'A stone guardian stands where the map shows an empty arch. Its gaze follows the sealed cargo on your rear wagon.', choices: [
        choice('fight', 'Break the guardian’s watch', 'Elite encounter. A discovery after the fight.', 'The first step beneath the arch wakes the inscription along its arms.', { combat: 'sentinel', discovery: 'The cargo-watching guardian' }),
        choice('detour', 'Take the caravan around the ruins', 'Spend 3 supplies and lose 5 cargo.', 'The old outer road is rough, but nothing watches it now.', { cargo: -5 }, { cost: { supplies: 3 } }),
    ] },
];
export function caravanEvent(id: string): CaravanEvent {
    const event = CARAVAN_EVENTS.find(e => e.id === id);
    if (!event) throw new Error('This encounter is unavailable.');
    return event;
}
