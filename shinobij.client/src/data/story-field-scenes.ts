import type { StoryReckoningPage } from "./story-reckonings";

export type StoryFieldScenePoint = {
    name: string;
    greeting: string;
    objective: string;
    pages: StoryReckoningPage[];
};

export type StoryFieldSceneJourney = {
    points: Record<string, StoryFieldScenePoint>;
    aftermath: StoryReckoningPage[];
    legacyAftermath?: StoryReckoningPage[];
};

const choice = (id: string, text: string, conclusion?: string) => ({ id, text, conclusion });

export const storyFieldScenes: Record<string, StoryFieldSceneJourney> = {
    "story-reckoning-mira-marker": {
        points: {
            "sv-ridge-gate": {
                name: "Ridge Gate",
                greeting: "Mira waits under the ridge gate with two coils over one shoulder and the weather slate under her arm.",
                objective: "Choose the high cable line or the lower flower-picker road.",
                pages: [{
                    title: "Two Ways Up",
                    scene: "The ridge gate, rain ticking against Mira's weather slate",
                    speaker: "Mira Volt",
                    dialogue: [
                        "The resale marks split here. High line reaches the signal cairn before the rain gets serious. The cable span is broken, and I brought one dry coil to cross it. If we use that coil, the west mast waits until tomorrow.",
                        "The picker road stays below the lightning shelf. Safer, except its storm rail pulled loose last week. I brought the second coil for that. Fixing it costs daylight, and we'll have to ask the flower crews what they carried in public.",
                        "Fast and exposed, or slow where people can hear my mother's name. I dislike both. Pick one before the cloud does.",
                    ],
                    choices: [
                        choice("sv-take-high-line", "Take the high line. Trust the cable and reach the signal cairn before the rain."),
                        choice("sv-follow-picker-road", "Take the picker road. Reset the public storm rail and ask where the pieces went."),
                    ],
                }],
            },
            "sv-broken-cable-span": {
                name: "Broken Cable Span",
                greeting: "The old span hangs in two wet lengths above a narrow cut in the ridge.",
                objective: "Rig the crossing with Mira's dry coil.",
                pages: [{
                    title: "One Sound Line",
                    scene: "The broken cable span, wind pushing rain sideways through the cut",
                    speaker: "Mira Volt",
                    dialogue: [
                        "Anchor's sound. Old cable isn't. I can splice my coil to the far eye, but somebody has to cross while the other holds the brake.",
                        "Don't volunteer bravely. Decide usefully. You cross first, I learn whether my knot holds. I cross first, you learn whether you can hold my full weight without trying to help the line.",
                        "You take the shelf. I'll take the brake. If I say slack, give me slack. And don't make me say it twice.",
                    ],
                    choices: [choice("sv-broken-cable-span-continue", "Cross on Mira's line while she holds the brake.", "The cable drops under your weight, catches, and hums. Mira does not breathe again until both your boots reach rock.")],
                }],
            },
            "sv-signal-cairn": {
                name: "Signal Cairn",
                greeting: "A fallen signal stone has split the high cairn, exposing a packet under its base.",
                objective: "Recover Kesa's marker pieces and pressed flower.",
                pages: [{
                    title: "Under the Signal Stone",
                    scene: "The high signal cairn, Mira kneeling beside a rain-dark packet",
                    speaker: "Mira Volt",
                    dialogue: [
                        "Picker's wrap. Waxed twice. The broad marker piece is here, and the corner, and the little split near the V. All of it.",
                        "Wait. There's a pressed flower between the pieces. She put those in every book and tool roll, then denied it when they fell out.",
                        "Wrap it where it was. We spent the west mast's coil getting here. We are not letting the rain take the last inch.",
                    ],
                    choices: [choice("sv-signal-cairn-recover", "Wrap the marker pieces and flower. Carry them back across the line.")],
                }],
            },
            "sv-flower-pickers-shelter": {
                name: "Flower-Pickers' Shelter",
                greeting: "The lower shelter leans into the ridge, its storm rail dragging loose in the wash.",
                objective: "Repair the rail, then ask the picker crews about Kesa's marker.",
                pages: [{
                    title: "The Rail Before the Trail",
                    scene: "The flower-pickers' shelter, three crews waiting behind a loose storm rail",
                    speaker: "Mira Volt",
                    dialogue: [
                        "The trail can wait ten minutes. This rail cannot wait for the next gust. Hold the post square while I take the loose turn out.",
                        "Yes, the rain is erasing the resale marks. People use this path tomorrow. I won't step over their bad anchor to save my own errand.",
                        "There. Sound enough. Now I get to ask a shelter full of strangers who bought pieces of Kesa Volt's name. Stay beside me and let me finish the question.",
                    ],
                    choices: [choice("sv-flower-pickers-shelter-continue", "Hold the repaired post while Mira asks about the marker.", "Nobody answers at first. Then a picker points up the rain road and says the last packet went to the split cairn.")],
                }],
            },
            "sv-rain-split-cairn": {
                name: "Rain-Split Cairn",
                greeting: "Fresh runoff has opened the low cairn and left a waxed packet caught between its stones.",
                objective: "Recover Kesa's marker pieces and pressed flower.",
                pages: [{
                    title: "What Wasn't Sold",
                    scene: "The rain-split cairn, picker crews visible below through the weather",
                    speaker: "Mira Volt",
                    dialogue: [
                        "Pieces first. Broad base, corner, the split beside the V. They kept the set together after all.",
                        "The flower is still inside the wrap. One of the pickers said nobody could agree what it was worth, so they stopped trying to price it.",
                        "I had a speech ready for whoever sold it back. Apparently I only needed to ask. Help me keep it dry.",
                    ],
                    choices: [choice("sv-rain-split-cairn-recover", "Rewrap the marker pieces and flower. Take the repaired road home.")],
                }],
            },
        },
        aftermath: [
            {
                title: "The High Line, Rechecked",
                scene: "Kesa's marker above the ridge gate, Mira testing the high-line brake",
                speaker: "Mira Volt",
                requireTrait: "sf-sv-high-line",
                dialogue: [
                    "The west mast is still waiting for the coil on this span. I told the crew where it went. They were polite enough to save their opinion for my face.",
                    "Take the brake. I want to check the span under my own weight this time. If I say slack, you know what slack means now.",
                    "Then we lower the coil, carry it to the mast, and find out whether the soup survived the weather.",
                ],
            },
            {
                title: "The Low Rail",
                scene: "The flower-pickers' road, Mira tightening the public rail below Kesa's marker",
                speaker: "Mira Volt",
                requireTrait: "sf-sv-picker-road",
                dialogue: [
                    "The rail moved half a thumb. I told you it would. Hold the post while I reset it.",
                    "One picker waved when we passed on the way back. You made me say my mother's name to strangers. I hated that. Then they handed me the flower without asking what it was worth.",
                    "I hated that less. Brace your boot there.",
                ],
            },
        ],
        legacyAftermath: [{
            title: "Weather at the Marker",
            scene: "Kesa's marker above the ridge gate, Mira checking the fitted stone after rain",
            speaker: "Mira Volt",
            dialogue: [
                "Marker's square. The flower took the rain. Good. That was the point.",
                "Hold the level while I tighten the base. Then soup, if the coast road is still attached to the coast.",
            ],
        }],
    },

    "story-reckoning-toma-cinders": {
        points: {
            "al-ash-line": {
                name: "Ash Line",
                greeting: "Toma stands where the ash carts leave the village, a clamp bag in one hand and a folded oilcloth in the other.",
                objective: "Choose whether to repair the footbridge first or follow the fresh cart trail.",
                pages: [{
                    title: "The Bridge or the Trail",
                    scene: "The ash line, cart ruts crossing a footpath toward the east channel",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Fresh ruts go toward the charcoal yard. If we follow now, we may catch the cedar before the rain pushes it into the sluice.",
                        "The footbridge on the other road has a split stringer. Families still use it because the longer path adds an hour. I brought clamps and two sound offcuts. We can fix it first and risk the trail moving.",
                        "I know which job has my family's name on it. I also know whose feet use that bridge. Tell me which mistake we're making.",
                    ],
                    choices: [
                        choice("al-repair-first", "Repair the footbridge first. Let the cedar travel while the crossing is made sound."),
                        choice("al-follow-cart-first", "Follow the fresh cart ruts. Recover the cedar, then come back for the bridge."),
                    ],
                }],
            },
            "al-collapsed-footbridge": {
                name: "Collapsed Footbridge",
                greeting: "The center plank has dropped below the handrail, and footprints still cross it in both directions.",
                objective: "Fit Toma's offcuts and clamp the stringer before continuing.",
                pages: [{
                    title: "Sound Before Pretty",
                    scene: "The collapsed footbridge, Toma lying on one shoulder beneath the split stringer",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Pass the short offcut. No, the ugly one. Pretty grain splits clean; ugly grain argues with the break.",
                        "I can hear the carts from here. I am trying not to count how far the plates have gone while we help a bridge nobody thanked us for noticing.",
                        "Clamp. Wait. Load it before the grain settles and it splits again. I learned that one the loud way.",
                    ],
                    choices: [choice("al-collapsed-footbridge-continue", "Wait for the joint to take, then test the bridge together.", "The repaired span settles without a groan. Toma crosses twice before he trusts it once.")],
                }],
            },
            "al-east-channel-catch": {
                name: "East Channel Catch",
                greeting: "Rainwater combs the channel reeds, and pale cedar edges show where the current has gathered them.",
                objective: "Recover the scattered cedar plates without tearing their burned names.",
                pages: [{
                    title: "Let the Water Loosen Them",
                    scene: "The east channel catch, Toma kneeling wrist-deep in brown water",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Don't pull. The wet ash has the letters by the throat. Let the current loosen each plate and lift from underneath.",
                        "There. Reed. The chamfer is wrong in exactly the family way. Next one slowly.",
                        "The cart trail is gone. The reeds kept the whole column together. Next one slowly.",
                    ],
                    choices: [choice("al-east-channel-catch-recover", "Lift the cedar plates one at a time and carry them over the repaired bridge.")],
                }],
            },
            "al-charcoal-yard": {
                name: "Charcoal Yard",
                greeting: "Fresh cart ruts vanish among charcoal sledges, each runner black with the same ash.",
                objective: "Find which cart carried the cedar plates toward the sluice.",
                pages: [{
                    title: "Ask the Person, Read the Wheel",
                    scene: "The charcoal yard, workers unloading sacks while Toma studies six identical tracks",
                    speaker: "Toma Reed",
                    dialogue: [
                        "I can spend an hour pretending wheel scars confess. Or I can ask the people standing beside the wheels.",
                        "The yard hand says one cart rattled because cedar was caught under its rear board. It took the sluice road. She also says the footbridge dropped again this morning.",
                        "We chose the plates first. We still owe the bridge. Help me remember that after we find what I came for.",
                    ],
                    choices: [choice("al-charcoal-yard-continue", "Follow the rattling cart's rut to the silted sluice.")],
                }],
            },
            "al-silted-sluice": {
                name: "Silted Sluice",
                greeting: "The stopped sluice has caught a fan of black silt, bark, and pale cedar fragments.",
                objective: "Recover and wrap the cedar plates, then return to the footbridge.",
                pages: [{
                    title: "Cedar in the Silt",
                    scene: "The silted sluice, Toma sorting each pale edge onto the folded oilcloth",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Reed. And the next name. And the next. The cart got here before the rain; the sluice kept what fell out.",
                        "Two plates cracked at old nail holes. I brought clamps for a bridge, so tonight they belong to the names first.",
                        "Wrap them. Then we go back. If I carry my family home over a broken crossing and call the day finished, the clerks have taught me too well.",
                    ],
                    choices: [choice("al-silted-sluice-continue", "Wrap the recovered plates and carry them back to the footbridge.")],
                }],
            },
            "al-bridge-after-dark": {
                name: "Footbridge After Dark",
                greeting: "The recovered plates rest above the flood line while Toma sets a lamp beneath the failed span.",
                objective: "Finish the bridge repair before returning the cedar plates.",
                pages: [{
                    title: "The Job Still Owed",
                    scene: "The footbridge after dark, one lamp, four clamps, and rain in the leaves",
                    speaker: "Toma Reed",
                    dialogue: [
                        "Ugly offcut first. It argues with the split. Hold it while I set the clamp.",
                        "I was angry when you chose the cart. I am still a little angry. We found the plates before the rain, and now we're here doing the other job. Both things get to be true.",
                        "Put your weight on the center plank. If it holds you, it will hold the morning baskets. Then we take the names home.",
                    ],
                    choices: [choice("al-bridge-after-dark-finish", "Test the repaired span, then carry the cedar plates back to Toma's post.")],
                }],
            },
        },
        aftermath: [
            {
                title: "The Bridge Takes Weight",
                scene: "The east footbridge, Toma replacing a wedge while morning baskets cross",
                speaker: "Toma Reed",
                requireTrait: "sf-al-repaired-first",
                dialogue: [
                    "Third board moved in the rain. I nearly called the repair a failure. Then I remembered wood moves and brought a wider wedge.",
                    "We waited while the plates drifted farther. I was angry about that too. The bridge was carrying people when we found them.",
                    "You waited when it cost us the trail. Hold this flush.",
                ],
            },
            {
                title: "One More Lamp",
                scene: "The footbridge under two lamps, Toma checking the clamps while rain ticks through the leaves",
                speaker: "Toma Reed",
                requireTrait: "sf-al-followed-cart",
                dialogue: [
                    "I still think we chose the jobs in the wrong order. I brought a second lamp this time, so apparently I learned something while disapproving.",
                    "The plates are home. This bridge is sound. My hands remember both jobs when I touch the clamps.",
                    "Take the far side. It only needs half a turn, and you always give it three quarters.",
                ],
            },
        ],
        legacyAftermath: [{
            title: "Names on the Post",
            scene: "The outskirts register post, Toma cleaning rain grit from the returned cedar",
            speaker: "Toma Reed",
            dialogue: [
                "Use the soft brush. The burned letters are part of the name now; we don't scrub them into looking untouched.",
                "When this side is clean, we'll do the bridge rail. It has started wobbling out of spite.",
            ],
        }],
    },

    "story-reckoning-sova-true-roll": {
        points: {
            "ff-gate-stones": {
                name: "Gate Stones",
                greeting: "Sova has set one lamp-oil jar between the wall watch and the lower-road cooks.",
                objective: "Negotiate whether to divide the oil or keep the lower stove lit until dawn.",
                pages: [{
                    title: "One Jar, Two Needs",
                    scene: "The gate stones, a wall corporal and a cook waiting on opposite sides of one oil jar",
                    speaker: "Elder Sova",
                    dialogue: [
                        "The south watch wants the oil to search the blue-ice gully tonight. The lower kitchen wants it under the broth pot until dawn. Both are asking for people who are cold now.",
                        "Split it, and the search lamps burn low while the stove goes thin. Leave it whole, and the kitchen stays warm while we wait for daylight and trust the drift not to bury the roll deeper.",
                        "I kept two books because one answer was never enough. Today we only have one jar. Say who waits, then say it where both crews can hear.",
                    ],
                    choices: [
                        choice("ff-split-lantern-oil", "Split the oil. Search tonight with low lamps and keep a smaller fire under the broth."),
                        choice("ff-keep-lower-stove", "Keep the lower stove lit. Organize the search at first light without lamps."),
                    ],
                }],
            },
            "ff-south-watch-post": {
                name: "South Watch Post",
                greeting: "Three ridge lamps burn at half wick while the lower-road chimney gives one thin line of smoke.",
                objective: "Pair the watch and kitchen crews for a low-light search.",
                pages: [{
                    title: "Half Light",
                    scene: "The south watch post, Sova measuring the last oil into three lamp cups",
                    speaker: "Elder Sova",
                    dialogue: [
                        "Half a cup each. No heroics beyond the light. A cook goes with every watcher because the cooks know where the wind drops flour sacks and the watch knows where people fall.",
                        "The corporal says the lamps are too low. The cook says the broth is too thin. Let them complain. It means neither has forgotten what the other gave up.",
                        "Blue ice next. Call every page edge before you touch it. Wax looks like frost in this light.",
                    ],
                    choices: [choice("ff-south-watch-post-continue", "Take a half-wick lamp and join the paired crews at the blue-ice gully.")],
                }],
            },
            "ff-blue-ice-gully": {
                name: "Blue-Ice Gully",
                greeting: "Low lamps pick out waxed page edges where the gully folds toward the ridge.",
                objective: "Recover the true roll pages with the paired crews.",
                pages: [{
                    title: "Names at Half Wick",
                    scene: "The blue-ice gully, wall watch and kitchen crews passing pages hand to hand",
                    speaker: "Elder Sova",
                    dialogue: [
                        "That edge. Do not pry it; warm the ice with your glove and wait. The name has waited longer than your fingers can complain.",
                        "The kitchen crew found the lower sheets by following where loose flour settled. The watch found the upper ones because they knew which shelf breaks first. Keep both facts in the report.",
                        "Last page. All here. Take the lamp with the steadier wick and put the roll inside my coat for the road back.",
                    ],
                    choices: [choice("ff-blue-ice-gully-recover", "Count the recovered pages aloud with both crews, then return them to Sova.")],
                }],
            },
            "ff-lower-road-kitchen": {
                name: "Lower-Road Kitchen",
                greeting: "The broth stove burns steadily while watchers, cooks, and families crowd around a map on the kneading table.",
                objective: "Mark the storm's drift and organize a daylight search.",
                pages: [{
                    title: "Wait Without Standing Still",
                    scene: "The lower-road kitchen before dawn, route marks pressed into flour on the table",
                    speaker: "Elder Sova",
                    dialogue: [
                        "The stove keeps its jar. That does not mean the search sleeps. Each person marks where the wind took cloth, ash, or roof snow after midnight.",
                        "The wall watch knows the gullies. The cooks know every lee where a delivery sack stays dry. The families know who has boots and who needs a pair before dawn.",
                        "We leave when the ridge turns grey. Until then, eat. Waiting hungry only makes people call impatience courage.",
                    ],
                    choices: [choice("ff-lower-road-kitchen-continue", "Finish the drift map, share the broth, and leave with the first light.")],
                }],
            },
            "ff-sunlit-drift": {
                name: "Sunlit Drift",
                greeting: "Morning throws thin shadows from waxed pages buried edge-up along the mapped lee.",
                objective: "Recover the true roll pages in daylight.",
                pages: [{
                    title: "The Road Comes With You",
                    scene: "The sunlit drift, searchers spreading from every mark made on the kitchen table",
                    speaker: "Elder Sova",
                    dialogue: [
                        "There. Page edge beside the black rock, exactly where the flour mark said the wind would lay it. Call the name before you lift.",
                        "I thought daylight would cost us the roll. Instead half the lower road came because they were warm enough to walk. Put that in the account too.",
                        "Last page. All here. Nobody gets to say the stove delayed this without also naming who the stove sent up the road.",
                    ],
                    choices: [choice("ff-sunlit-drift-recover", "Pass the recovered pages down the line and carry the true roll back to the gate.")],
                }],
            },
        },
        aftermath: [
            {
                title: "Two Half Measures",
                scene: "The gate stones, Sova checking a new oil ledger with the wall corporal and lower-road cook",
                speaker: "Elder Sova",
                requireTrait: "sf-ff-split-lanterns",
                dialogue: [
                    "The wall calls it the half-ration search. The kitchen calls it the thin-broth night. Neither means the name kindly.",
                    "Both crews signed the recovery page. They still argue about who gave up more oil, which is better than letting my book decide for them.",
                    "Check my addition. The corporal says I favor the stove by half a cup.",
                ],
            },
            {
                title: "The First-Light Table",
                scene: "The lower-road kitchen, Sova updating the drift map while the broth pot works",
                speaker: "Elder Sova",
                requireTrait: "sf-ff-kept-stove",
                dialogue: [
                    "The kneading table is a search map now. The cooks objected until the wall watch started bringing flour.",
                    "I thought waiting meant surrendering the pages. You made me wait long enough to see the lower road join the search.",
                    "Move that ridge mark a finger east. The cook remembers where the snow piled better than I do.",
                ],
            },
        ],
        legacyAftermath: [{
            title: "The Next Name",
            scene: "The gate stones, the rebound true roll open beside the Count",
            speaker: "Elder Sova",
            dialogue: [
                "The binding held through last night's snow. My fingers did not, so you turn the page.",
                "There. Read the next name and give me time to answer. We are not racing the Count anymore.",
            ],
        }],
    },

    "story-reckoning-nyx-ledger": {
        points: {
            "ms-canal-gate": {
                name: "Canal Gate",
                greeting: "Nyx waits beside a blank public notice while an unseen booth clerk watches from behind a shutter.",
                objective: "Choose a protected source route or an open call for the ledger pages.",
                pages: [{
                    title: "The Name That Stays Off",
                    scene: "The canal gate before courier bell, one shutter open the width of two fingers",
                    speaker: "Nyx",
                    dialogue: [
                        "The clerk from the raided booth saw who took my ledger. They will guide us to the cache if their name stays off every page. I verified the account. You do not get the name.",
                        "Other route: post this wax pattern at the ferry and ask every holder to bring pages into the open. More witnesses, cleaner custody, and every buyer knows what we're building before night ends.",
                        "The clerk said if that notice goes up, they walk away before the paste dries. Their choice, not mine. Protect one source or build a public chain without them. Decide where they can hear you.",
                    ],
                    choices: [
                        choice("ms-shield-booth-clerk", "Keep the clerk unnamed. Use Nyx's decoy parcel and follow their private signal."),
                        choice("ms-post-open-call", "Post the wax pattern. Let the clerk withdraw and ask the canal to witness every return."),
                    ],
                }],
            },
            "ms-dyers-footbridge": {
                name: "Dyers' Footbridge",
                greeting: "A decoy parcel waits on the east rail while one fresh wax thumbprint points west.",
                objective: "Draw the buyer's watcher toward the decoy and follow the source's private mark.",
                pages: [{
                    title: "Look East, Walk West",
                    scene: "The dyers' footbridge, colored water passing under two opposite routes",
                    speaker: "Nyx",
                    dialogue: [
                        "Our watcher took the east bait. Don't look. People always look when told not to; be rarer.",
                        "The clerk pressed one thumb here and dragged it west. That is the whole instruction. No signature, no voice, no helpful silhouette under a lamp.",
                        "That drag is all they chose to give us. A fuller answer would make our case easier. We don't take it. West bank. Casually.",
                    ],
                    choices: [choice("ms-dyers-footbridge-continue", "Leave the decoy untouched and follow the wax drag toward the shuttered boathouse.")],
                }],
            },
            "ms-shuttered-boathouse": {
                name: "Shuttered Boathouse",
                greeting: "A tarred parcel rests above the tide line, sealed with the booth clerk's witnessed mark.",
                objective: "Recover the ledger pages and preserve the clerk's sealed account.",
                pages: [{
                    title: "Witness, Name Withheld",
                    scene: "The shuttered boathouse, Nyx checking torn edges against her ledger binding",
                    speaker: "Nyx",
                    dialogue: [
                        "All the torn edges meet. Buyers, prices, delivery marks. My ugly little book lives.",
                        "Under it: the clerk's account of the raid, sealed in front of me and signed with the private mark we agreed would stand for them. I can verify who spoke. I cannot spend their name to make the statement louder.",
                        "Carry the pages. I carry the account. If anyone asks who helped, the answer is someone who said no to being named.",
                    ],
                    choices: [choice("ms-shuttered-boathouse-recover", "Wrap the ledger pages separately from the protected statement and return to the canal gate.")],
                }],
            },
            "ms-night-ferry-landing": {
                name: "Night Ferry Landing",
                greeting: "Nyx's wax-pattern notice hangs under the ferry lamp, surrounded by people pretending they stopped for the tide.",
                objective: "Receive public page returns without claiming the protected clerk's testimony.",
                pages: [{
                    title: "Hands in the Light",
                    scene: "The night ferry landing, torn pages arriving from sleeves, baskets, and one fish crate",
                    speaker: "Nyx",
                    dialogue: [
                        "The clerk's shutter closed before our paste dried. Good. They said what they would do and did it.",
                        "First holder says a buyer paid to move three pages through the old toll booth. Second says they found hers under a ferry bench and kept it because buyers were asking. Both will sign in public.",
                        "The clerk's account walked away. What we have instead are several people willing to say where one page rested. Keep the returns separate; strangers do not need matching stories to tell the truth.",
                    ],
                    choices: [choice("ms-night-ferry-landing-continue", "Record each holder separately, then follow their routes to the old toll booth.")],
                }],
            },
            "ms-old-toll-booth": {
                name: "Old Toll Booth",
                greeting: "The abandoned booth is open on all sides, its counter covered in ledger pages and waiting witnesses.",
                objective: "Reassemble the ledger under the public chain of custody.",
                pages: [{
                    title: "No Single Story",
                    scene: "The old toll booth, Nyx matching page tears while holders give separate accounts",
                    speaker: "Nyx",
                    dialogue: [
                        "Every edge meets. Every buyer's name is here. The route does not agree with itself, which means nobody rehearsed it for us.",
                        "One page came by ferry, two through a fish cart, the rest through hands that will only name the person before them. We write each account as given and leave the gaps visible.",
                        "The booth clerk owes us nothing. These witnesses chose the lamp. Let the ledger show the difference.",
                    ],
                    choices: [choice("ms-old-toll-booth-recover", "Bind the returned pages in public and carry the witnessed ledger back to the canal gate.")],
                }],
            },
        },
        aftermath: [
            {
                title: "The Back Stool Stays Empty",
                scene: "Nyx's stall, the rear shutter open a finger-width and the front counter busy",
                speaker: "Nyx",
                requireTrait: "sf-ms-source-shielded",
                dialogue: [
                    "The booth clerk can still send corrections through several hands. Sensible person. Their name remains absent, and their account still answers when challenged.",
                    "You cost us easy testimony and bought a source who can keep speaking. I was prepared to resent that longer.",
                    "Watch the front while I check this seal. The back stool stays empty unless they choose it.",
                ],
            },
            {
                title: "Paste Under the Nails",
                scene: "The canal gate, Nyx scraping down an old public notice while a fresh return list dries",
                speaker: "Nyx",
                requireTrait: "sf-ms-open-witnesses",
                dialogue: [
                    "The clerk warned us and left. I was angry when you posted the notice anyway. Then the pages came back in hands the buyers could not all frighten at once.",
                    "I remain angry. The ledger remains complete. Hold the fresh list flat while I scrape this one down; both statements can share a wall.",
                    "Careful with the paste. It costs more than the paper and considerably less than a secret.",
                ],
            },
        ],
        legacyAftermath: [{
            title: "The Open Chain",
            scene: "The canal gate, Nyx oiling the chain that keeps the buyers' ledger open",
            speaker: "Nyx",
            dialogue: [
                "Hold the book against the wind. If it closes on my fingers again, I am billing the weather.",
                "Buyers still stop to read who else bought. None of them enjoys finding their own handwriting. That part stays free.",
            ],
        }],
    },
};

export function storyFieldSceneJourney(questId: string): StoryFieldSceneJourney | null {
    return Object.prototype.hasOwnProperty.call(storyFieldScenes, questId) ? storyFieldScenes[questId] : null;
}
