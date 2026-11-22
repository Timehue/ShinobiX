/*
 * The coast's script: what is said in every quest and side tale.
 *
 * A quest in _catalog.ts says what the player must do. This file says who asks
 * it of them and why, in that person's own words. Each quest has an `offer`
 * (heard before it is taken), lines at its steps (heard on arriving at the
 * step, keyed by the stage's key), and a `done` (heard when every step is
 * passed, before the reward is claimed). api/quests/_catalog.ts joins the two.
 *
 * What the writing is built on:
 *   - Every keeper wants something of their own. Urabe wants to build a boat
 *     that leaves. Orito wants the record to be true. Ukishi wants the people
 *     nobody counted to exist on paper. The player is useful to them, and they
 *     say so.
 *   - The coast is second-age ground, settled by people who walked out of the
 *     villages. The Unmoored are their grandchildren and keep it shut. Every
 *     main-line foe says, in a line, why they think that is right. The finale
 *     asks the player to answer them, so the player has to have heard them.
 *   - One thread runs through all of it: who is written down, and who does the
 *     writing. The villages' rolls sent children to wars. The Unmoored walked
 *     away from those rolls and then started keeping their own.
 *   - What the player chose earlier is said back to them later, by name, where
 *     they can see it (`when`). The Record House keeper reads their record
 *     aloud before the finale, and the one they came to fight has read it too.
 *
 * Rules every line keeps (api/quests/_catalog.test.ts checks them): an actor
 * could say it; whole sentences; 55 words or fewer; no dash used as a pause; no
 * invented compound words; nothing older than the second age. `narrator` is
 * what the shinobi sees. It is never used to explain a rule of the game.
 *
 * People here talk the way the village stories do (owner, 2026-11-21: "make it
 * sound like humans are talking"). They say "don’t" and "I’m" and "it’s". They
 * use the plain word: boil down, not reduce; hidden, not unfound. A speech does
 * not end on a tidy saying. Two voices stay formal on purpose and never
 * contract: the Wandering Sage, and Nanashi. Narration is prose and does not
 * contract either.
 *
 * Server-only. The journal is sent only the lines for the step the player is
 * on, already chosen for what that player did.
 */
import type { QuestSay, QuestSayWhen } from './_types.js';

export interface QuestScript {
    offer: readonly QuestSay[];
    done: readonly QuestSay[];
    /** Lines heard on arriving at a step, by stage key. */
    stages?: Readonly<Record<string, readonly QuestSay[]>>;
    /** What is learned at each clue inside a building (EnterStage.clues), by clue key. */
    clues?: Readonly<Record<string, readonly QuestSay[]>>;
}

const line = (speaker: string) => (text: string, when?: QuestSayWhen): QuestSay => ({ speaker, text, ...(when ? { when } : {}) });

const sage = line('wandering-sage');
const funade = line('home-boatwright');
const shiokaze = line('chart-runner');
const urabe = line('slip-boatwright');
const orito = line('record-keeper');
const iwao = line('gate-captain');
const nigami = line('garrison-commander');
const hagino = line('relay-keeper');
const minawa = line('glasswake-adept');
const kusabi = line('sentinel-warden');
const tazuna = line('leash-tamer');
const haizumi = line('assay-keeper');
const kogarashi = line('rime-warden');
const futae = line('twin-warden');
const nanashi = line('unmoored-leader');
const ukishi = line('quay-defector');
const moyai = line('quay-warden');
const kazoe = line('roll-keeper');
const sekimori = line('pass-captain');
const ashigara = line('trace-keeper');
const sabiro = line('slip-wrecker');
const yaniko = line('pitch-warden');
const hazeru = line('keel-reaver');
const kuiuchi = line('plot-reeve');
const tsuketa = line('hall-burner');
const semeguchi = line('raid-captain');
const seen = line('narrator');

export const COAST_SCRIPT: Readonly<Record<string, QuestScript>> = {
    // ── The way in ───────────────────────────────────────────────────────────
    'shuttered-boat': {
        offer: [
            sage('There is a boat off Stormveil Harbor with its shutters nailed down. I have passed it for a month. Nobody on the piers will say whose it is.'),
            sage('Somebody built that boat to go somewhere. I only notice these things. The boatwright at the Western Piers knows more, and he is tired of not being asked.'),
        ],
        stages: {
            find: [
                funade('So the old man sent you. Yes, it’s my hull. I built it for a crossing that every chart says is open water. I won’t rig it until someone tells me there’s a shore on the other side.'),
                funade('Bring me cord and fittings and I’ll make her ready. You’ll have to find the charts yourself. A runner took the only set off my bench, and he didn’t take them to sell.'),
            ],
            cord: [funade('Binding Fiber first. Eight lengths. She’s sat a year with no rigging and the old cord has gone to dust.')],
            fittings: [funade('Now Iron Sand for the fittings. I can cast them here. I can’t make sand out of nothing.')],
            shadow: [funade('The runner works the Reedmarsh Boardwalk. Don’t stop him there. He has lookouts, and I want to know where he takes my charts, not where he hides.')],
            tally: [seen('Two men lean on the boardwalk rail and watch everyone but each other. One of them wears a knotted cord at his belt and keeps touching it.')],
            shards: [
                funade('He’ll run at night and he’ll run in smoke. Hit stormglass hard and it throws a light that smoke can’t hide. Bind it in cord and you have a Signal Shard.'),
                funade('You’ll have to mine the stormglass yourself. I’m a boatwright. I don’t go down seams.'),
            ],
            knots: [
                seen('The tally is a cord with three knots. The first is wound with marsh reed. The second is stiff with pier tar. The third has pale terrace clay ground into it, still damp.'),
                funade('A runner ties his stops in the order he walks them. He’s been to the first two. Read me the third.'),
            ],
            follow: [seen('The terrace paths climb above the harbor. From up here the shuttered boat is a dark mark on the water, and somebody else is looking down at it too.')],
            runner: [
                shiokaze('You came a long way to rob a thief. Those charts were paid for. The people who paid don’t want a village boat finding their shore, and they have good reasons.'),
                shiokaze('Ask them yourself, if you ever get there. You won’t get there through me.'),
            ],
            return: [seen('The charts are oilcloth, older than the boat. Somebody drew the far shore with care and then scratched out every name on it.')],
        },
        done: [
            funade('These are the ones. Look at that coast. Somebody lives there and has gone to a great deal of trouble to keep it quiet.'),
            funade('She’ll sail now. I built her to leave, and for a year I’ve watched her sit. Whatever you find over there, you’ll have a boat to come back in.'),
        ],
    },

    // ── Saltstair Landing ────────────────────────────────────────────────────
    'first-footing': {
        offer: [
            urabe('That’s Funade’s rigging. I’d know his knots anywhere. He taught my teacher. So the villages across the water have found the crossing again.'),
            urabe('I build boats on a shore where nobody is allowed to leave. I’d like that to change. Help me and I’ll tell you how this coast is run, starting with the gate you can’t walk through.'),
        ],
        stages: {
            slip: [
                urabe('We’re the grandchildren of people who walked out of your villages and sailed here. The ones who keep the gates call themselves the Unmoored. They decided the way to stay free was to stay hidden.'),
                urabe('The garrison up the stair turns back anyone without paper. Put your mark on their gate first. I want them to know a village shinobi stood there and walked away.'),
            ],
            mark: [seen('The gate is cedar banded with iron. Every plank carries a carved mark, one for each family that came ashore here. There is room left at the bottom.')],
            seal: [urabe('The captain at that gate obeys one thing, and it’s paper with the garrison seal on it. His patrols carry the seal. Take one from them.')],
            cord: [urabe('The Record House forges nothing on village paper. They use wrack cord pressed flat. Cut six lengths at the strand.')],
            order: [
                orito('I keep the record for this landing. I write down what is true and I stamp what I’m handed. You’ve handed me a real seal and real cord.'),
                orito('An order to stand down is a real order if the seal is real. What the captain does when he reads it’s his affair. I won’t ask where you got the seal.'),
            ],
            captain: [
                iwao('My grandmother came up this stair with a child on her back. Your village called her a deserter and took her name off its roll. Now you want through the gate she built.'),
                iwao('Show me paper or show me your back.'),
            ],
        },
        done: [
            urabe('He read it twice and stood aside. A man like that will hold a gate against an army and open it for a sheet of cord.'),
            urabe('You have a footing here now. Keep it quiet a while. There are people on this coast who have waited a long time for a door to open, and I’ll send you to them.'),
        ],
    },
    'crossing-war-1': {
        offer: [
            orito('The gate captain filed a report. It says a village shinobi showed him an order and he obeyed it. The commander has read that report, and he isn’t a man who obeys paper.'),
            orito('He means to close the landing. I’d rather he didn’t. If he closes it there’s nothing left to record, and I’m a clerk with a seal and nothing to write.'),
        ],
        stages: {
            ask: [
                orito('Commander Nigami took a blade through the lung nine winters ago. He should have died. He drinks a draught of woundroot every morning, and no wound he takes stays open.'),
                orito('The same root, boiled down another way, turns the draught against him. I have the method written down. I never wrote down why I kept it.'),
            ],
            roots: [orito('Woundroot grows in the wet bank east of here. Take eight. The sap stains, so don’t wipe your hands on anything you mean to keep.')],
            caps: [orito('The vials must be capped in splitstone or the sap eats through. Four pieces from the seam will do.')],
            vial: [orito('Boil it down slowly. If it smokes, you have ruined it and you’ll have to start again. I’ll mind the door.')],
            yard: [seen('The command table is covered in tally sticks, one bundle for each family on the landing. A third of the bundles have been cut in half.')],
            tallies: [seen('Each cut bundle still has its family mark burned into the first stick. They are the same marks that are carved into the garrison gate. Nobody has thrown the halves away.')],
            count: [
                orito('Give them here. Gently. I know these marks. I wrote every one of these families in, and nobody told me they had been cut out.', { chose: ['tallies', 'carry'] }),
                orito('I’ll write them back tonight. He’ll miss them by morning, and he’ll know where they went. Go up before he comes down.', { chose: ['tallies', 'carry'] }),
                orito('Cut in half, and still on his table. Then I know it and can’t show it. That’s the worst way for a man who keeps a record to know anything.', { chose: ['tallies', 'leave'] }),
                orito('It was the careful thing to do, if he’s to be surprised. I won’t pretend I like it. Go, while he still thinks his table is his own.', { chose: ['tallies', 'leave'] }),
            ],
            commander: [
                nigami('You took the cut tallies off my table. I took those families off this landing’s roll, and that was mine to decide. Now a clerk has them, and he’ll write them back in as if I’d decided nothing.', { chose: ['tallies', 'carry'] }),
                nigami('You read my table and left it as it lay. So you know what I cut, and you kept quiet about it. That’s how every roll I ever ran from was kept.', { chose: ['tallies', 'leave'] }),
                nigami('You’re the one with the paper. I had a village once. It counted every child at seven and sent for them at fourteen. I walked out so that mine would never be counted.'),
                nigami('Now you’ve found us, and the counting starts again. I will not have it.'),
            ],
        },
        done: [
            orito('He’s alive. I asked, because I write down deaths and I didn’t want to write his. The landing stays open, and the fields beyond it are yours to walk.'),
            orito('I’ve written the cut families back in, every one. He walked away from being counted, and then he kept a count of his own and cut people out of it. Remember that when you meet the rest of them.', { chose: ['tallies', 'carry'] }),
            orito('Those cut bundles are still on his table. They’re families he took off the roll. He walked away from being counted, and then he kept a count of his own. Remember that when you meet the rest of them.', { chose: ['tallies', 'leave'] }),
        ],
    },

    // ── Brackwater Fields ────────────────────────────────────────────────────
    'crossing-war-2': {
        offer: [
            hagino('You’re the one from the landing. Word came down the relay before you did. I read everything that passes through here, which is how I know that nobody can lay a hand on the adept at Glasswake Shelf.'),
            hagino('The relay also says the landing’s record grew by a third in one night. Orito doesn’t write that fast unless somebody hands him something.', { standing: 'tide-tallies-carried' }),
            hagino('The relay says very little else about you. You were inside the garrison and left nothing behind for someone like me to read.', { standing: 'tide-tallies-left' }),
            hagino('She stops my couriers whenever she likes and opens what they carry. I want my relay to run without her reading it. That’s all I want. I’m not ashamed of how small it is.'),
        ],
        stages: {
            relay: [
                hagino('Three patrols have gone up to Glasswake Shelf to bring her in. Every one of them came back burned by their own jutsu. They say it’s like striking a pool and having the pool strike back.'),
            ],
            steps: [seen('The scorch marks on the Tide-cut Steps fan out from where the patrol stood, not from where she stood. Whatever they threw at her, they were the ones it hit.')],
            seed: [hagino('A mirror can only send back what it can see. Inkseed makes a cloud that hangs in the air. Eight heads from the bed in Sedgeglass Run.')],
            silt: [hagino('And silt from the rim of her own pool, to make the ink cling. Four measures. Go when the light is flat and she can’t see you coming in the water.')],
            ink: [hagino('Grind it at my basin. My clerks will pretend not to notice. They’ve been pretending not to notice things for years.')],
            cache: [seen('The courier leaves a packet behind a loose stone and waits. Nobody comes. She goes back up toward the shelf alone, and for a quarter of an hour the adept has no one near her.')],
            couriers: [
                seen('The loose stone has been set back the wrong way round. When you look up from it, the courier is standing on the track above with two more behind her. None of them is carrying a bag.'),
                seen('She was not waiting for someone to collect the packet. She was waiting to see who came to look at it.'),
            ],
            adept: [
                minawa('My couriers didn’t come back up. I set that packet out for whoever Hagino sent, to see what you’d do when your plan failed. You fought. Your kind always does.'),
                minawa('Another village shinobi. I show your kind their own jutsu, and most of you’ve never once looked at it. You learned it at seven from someone who learned it at seven.'),
                minawa('We kept this shore shut so our children could choose what to learn. Throw whatever you were taught. I’ll hand it back.'),
            ],
        },
        done: [
            hagino('She let a courier through this morning without opening the bag. First time in four years. I sat and looked at the sealed bag for a while before I sent it on.'),
            hagino('The forest road is open to you now. The warden of the Hollow Sentinel has been asking the relay for news of you. She doesn’t ask for much.'),
        ],
    },

    // ── Briarwood Deep ───────────────────────────────────────────────────────
    'crossing-war-3': {
        offer: [
            kusabi('I’ve watched this cedar for forty years. It was already old when the first families came up the road. Sit down. You walk like someone who is always about to leave.'),
            kusabi('The tamer at the Leash Garrison keeps a beast bonded to him. While the bond holds, nothing reaches him. I don’t want him killed. I want the beast free of him, and those are different things.'),
        ],
        stages: {
            sentinel: [
                kusabi('The beast was born under this cedar. Tazuna took it as a cub and tied it to him before it could walk far. It has never once chosen where to go.'),
                kusabi('A tamer’s bond is a real knot, tied in cord. The beast trusts that knot and nothing else. Only the same knot, tied by another hand, will cut the bond. Tazuna learned his from a collar that is still in these woods.'),
                kusabi('Before you go near his garrison, read the ward on the root wall. Somebody split it and hid the other half up in this tree. Find it and fit it back, and you’ll see how a knot like his lets go.'),
            ],
            collar: [
                kusabi('You saw which strand moved. At the garrison, watch that one.'),
                seen('An iron ring has grown into the bark of a yew. A length of old braid hangs from it. Whoever tied this meant it to hold for a lifetime, and something broke it anyway.'),
            ],
            thorn: [kusabi('Binding thorn, eight canes, from Briar Spindle. Strip them green. Dry cane won’t take a knot.')],
            links: [kusabi('And four links from that old tether, to weight the snare. It held a beast for years, so it’s heavy enough.')],
            yard: [seen('The feeding hall is clean and the troughs are full. A braid runs from the tether block up through the boards to the hoist. One strand in it lets the ring go, the way one did in the cedar.')],
            knot: [seen('You had one look at it before the feeders came back. Kusabi said the snare must be his knot and no other. You will be tying it from memory.')],
            snare: [kusabi('Tie it exactly as you saw it. If you improve on his knot, it won’t be his knot, and it’ll cut nothing.')],
            mere: [seen('The beast ranges as far as the water at Stillfang Mere and no farther. It stops there every time, as if the bank were a wall, and looks back toward the garrison.')],
            tamer: [
                tazuna('Your villages bred beasts for war and buried them in rows when the wars ended. Mine eats from my hand and sleeps at my door. You’ve come to take it from me and call that kindness.'),
                tazuna('It won’t leave me. Try.'),
            ],
        },
        // What each thing found inside the cedar and the garrison teaches. Found in order, and kept.
        clues: {
            ward: [seen('The ward is a plank of cedar, cut cleanly in half. Three notches cross it. Below them a shallow groove climbs the trunk toward the sound of wood knocking on wood somewhere above.')],
            clappers: [seen('Three clappers hang on cords in the gallery. You strike them in the order of the notches. The first two ring dull. The third answers hollow, and inside it, wrapped in oilcloth, is the other half of the ward.')],
            crown: [seen('The two halves meet in the living knot of the crown. One strand slides back through a wooden eye, and every cord around it goes slack at once. That is the strand that lets the ring go.')],
            block: [seen('The braid bends back under its own eye, the way the strand did in the cedar. That is the return strand. It runs up through a hole in the boards toward the hoist gallery.')],
            hoist: [seen('You follow the return strand onto the drum. It goes over the ring, under itself and back through the first turn, and the tail is left long. This is his knot.')],
        },
        done: [
            kusabi('The beast went as far as the mere and then kept going. He stood at the gate and watched it. I’m told he didn’t call it back.'),
            kusabi('He was right about your villages. He was wrong to think the beast was safe just because it couldn’t leave. The passes above us are open to you now. They’re cold, and so are the people.'),
        ],
    },

    // ── Whitecrown Passes ────────────────────────────────────────────────────
    'crossing-war-4': {
        offer: [
            haizumi('You’re the reason my ore carts are late. The Rime Gate has been shut since you crossed the fields, and nothing comes up from the forest. I test what comes out of this mountain. I can’t test what doesn’t arrive.'),
            haizumi('The warden froze the gate himself. I can tell you what his frost stands up to and what it doesn’t. Measuring things is what I’m good at.'),
        ],
        stages: {
            assay: [
                haizumi('Frost plate isn’t armor. It’s ice that he holds in place. Hit the flat of it and the blow spreads out. Put heat into a seam and the whole plate drops off.'),
                haizumi('I keep one ember sealed in a stone cup, and I have a register of how the frost answered it. Read the register if you doubt me. Most people do, and then they read it.'),
            ],
            gate: [seen('The warden’s plates overlap like scales. Each one meets the next along a thin dark line. From the gallery you can count the seams. There are not many.')],
            glass: [haizumi('Emberglass holds its heat for an hour once it’s struck. Eight pieces from the seam at Whitevein Cut. Don’t carry them against your skin.')],
            splinter: [haizumi('And six splinters from the Frost Witness for the shafts. That stone splits to a point and keeps it. Nothing else up here does.')],
            senbon: [haizumi('Tip them under the assay cap. I’ll time the heat. You have less than an hour from the strike, so don’t stop to admire the view.')],
            saddle: [seen('The relief watch crosses the Listening Saddle in single file, heads down against the wind. For the length of that crossing, the gate below has half its guard.')],
            sentry: [seen('One of the watch has been left in the rock hollow to wait for the relief. He is a boy, fourteen at most, and he has stopped shivering. The pack beside him is bigger than he is.')],
            chain: [seen('A chain knocks somewhere in the lower hall. Above it, the gate wheel is furred white. The warden stands beside it with one hand on the rim.')],
            warden: [
                kogarashi('The boy from the saddle came down an hour ago with warm hands and a story about a stranger. I should have doubled the gate. I sat and listened to him instead.', { chose: ['sentry', 'warm'] }),
                kogarashi('My watch found the boy in the hollow, late. He’ll keep his fingers. Someone walked past him to reach this gate, and I know that walk. I’ve seen an army do it.', { chose: ['sentry', 'pass'] }),
                kogarashi('I shut the passes myself. An empty road carries no army. I learned that from yours, the winter they came up this pass and took every boy who could lift a pack.'),
                kogarashi('I was one of those boys. I walked back alone. Nothing comes up this road again.'),
            ],
        },
        done: [
            haizumi('The gate is open and my carts are moving. I’ve written down the hour. I’ve also written down that the warden put his hand on the wheel and turned it himself, after.'),
            haizumi('The boy from the saddle has been sent down to me to thaw. He asks a great many questions. I’ve answered eleven, and I’ve written down that he lived.', { chose: ['sentry', 'warm'] }),
            haizumi('They brought a boy down from the saddle last night. He’ll lose two toes and keep the rest. I measured. Nobody has asked me who walked past him, and I haven’t said.', { chose: ['sentry', 'pass'] }),
            haizumi('Above the passes is Hushcrown. I’ve never been sent ore from there and I’ve never been asked to test anything. I don’t know what they do. That’s unusual for me, and I dislike it.'),
        ],
    },

    // ── Hushcrown Heights ────────────────────────────────────────────────────
    'crossing-war-5': {
        offer: [
            orito('The Rime Gate is open. I had the news by relay and I wrote it down twice, in case the first copy was a mistake. You’ve walked the whole coast, and you’ve done it on paper I stamped.'),
            orito('The pass report names a boy on the Listening Saddle, kept alive by a fire that nobody on the watch laid. I’ve written that a stranger laid it. I know how to spell your name, and I left it out.', { standing: 'rime-sentry-warmed' }),
            orito('The pass report names a boy found late on the Listening Saddle. It doesn’t say who passed him. I’ve written what it says. A record can’t hold what nobody will tell it.', { standing: 'rime-sentry-passed' }),
            orito('There’s one post left before the heights, and it’s held by two wards at once. I have its pattern in the record. I want you to have it. A record ought to be some use to somebody.'),
        ],
        stages: {
            record: [
                orito('The Double Watch keeps two wards and raises them in a fixed order. Break them out of order and the first comes back. The order is hung on the post itself, for the watch to read.'),
                orito('You’ve met both wards before, at the landing and on the shelf. The heights have no woundroot and no inkseed. The remakers up there make the same tools from what grows around them.'),
            ],
            marker: [seen('From the Keelroot Marker the post is a dark tooth on the ridge. Two lamps burn on it, one above the other. The watch changes at the lower lamp first.')],
            disks: [
                seen('Two ward disks hang on the post, one above the other. The upper disk is glazed dark, the color of a medicine bottle. The lower is polished until it shows your face.'),
                seen('The stone under the upper disk is worn smooth by hands. The stone under the lower one is rough. The watch touches the top disk first, every time.'),
            ],
            order: [seen('You have both disks in your head now. One is dark and one is bright, and one of them is always raised before the other.')],
            root: [orito('The remakers use windroot where we use woundroot. It grows under the red boughs. Six will do for one batch.')],
            grit: [seen('The seam leaves a dark streak on your fingers that does not rub off. The remakers cast this grit into everything: caps, links, needle points.')],
            loach: [seen('The pool is so still that it holds the far ridge upside down. The loach in it are black and slow, and the water clouds wherever one turns.')],
            vial: [seen('A pattern is stamped into the workbench: a branching root. Somebody has worn it almost flat with use. The windroot boils down the same way the woundroot did.')],
            ink: [seen('The second pattern hangs in the loft, a fish pressed between two boards. The remakers changed the ingredients and kept the tools exactly as they were.')],
            bell: [seen('The Witness Bell does not ring. The watch on the post changes when its shadow reaches the second root, and for a few breaths there is nobody at either lamp.')],
            warden: [
                futae('There are two of us on this post, and we share one name. My sister speaks well of the villages. I remember what they did. Tonight is my watch.'),
                futae('You broke four gates to stand here. Each one was shut by someone who had been hurt. Did any of them tell you that?'),
            ],
        },
        done: [
            orito('Both wards are down and the post is open. I’ve written it. I notice that I’ve run out of gates to write about.'),
            orito('There’s one name I’ve never written, because nobody has ever given it to me. Everyone on this coast answers to her. Come back when your record is long enough to be worth her reading.'),
        ],
    },
    'the-unmoored': {
        offer: [
            orito('I’ve kept the record of this coast for thirty years. Every garrison reports to me. Every one of them takes its orders from someone who appears nowhere in it.'),
            orito('She was born on this coast, to a family your villages had struck off their roll. Nobody here counted her, so nobody wrote her down, and now she rules the coast that way. I’d like, once, to meet the person I’ve never been allowed to write about.'),
        ],
        stages: {
            record: [
                orito('Before you go up, hear your own record. She’ll have read it. She reads everything I write and has never once let me write her.'),
                orito('It says you carried the cut tallies out of the garrison, and that I wrote a third of the landing back in.', { standing: 'tide-tallies-carried' }),
                orito('It says you stood at the commander’s table and left his cut tallies where they lay.', { standing: 'tide-tallies-left' }),
                orito('It says a boy on the Listening Saddle lived because a stranger stopped.', { standing: 'rime-sentry-warmed' }),
                orito('It says a boy on the Listening Saddle was passed in the cold by someone in a hurry.', { standing: 'rime-sentry-passed' }),
                orito('It says you carried a dead woman’s letter home across the water.', { standing: 'tale-letter-carried' }),
                orito('It says you found a letter forty years unsent and left it sealed in my keeping.', { standing: 'tale-letter-kept' }),
                orito('It says you measured the water off the ledge and set the shells, so that any boat could land safely.', { standing: 'tale-ledge-marked' }),
                orito('It says you held the lead line and left the ledge dark.', { standing: 'tale-ledge-unmarked' }),
                orito('It says a runner passed the Witness Shrine, and that you were the one who wrote it.', { standing: 'tale-runner-witnessed' }),
                orito('It says there’s a blank line in the shrine’s register, and that you chose to leave it blank.', { standing: 'tale-runner-unwritten' }),
                orito('It says you put a docket of names into the hands of a woman whose own name was on it.', { standing: 'tale-docket-brought' }),
                orito('It says you read the names of everyone the last boat left behind, and put the docket back under its stone.', { standing: 'tale-docket-returned' }),
                orito('It says the Witness Bell is answered now when it rings.', { standing: 'tale-bell-answered' }),
                orito('It says you found what would answer the Witness Bell, and buried it again.', { standing: 'tale-bell-silent' }),
                orito('That’s what I have of you. You kept having to decide what got written down. Go and meet the woman who decided nothing should be.'),
            ],
            trace: [seen('Three narrow tracks come together on the Unheard March. Two are worn by patrols. The third is fresh, light, and walked by one person who does not stop to rest.')],
            seal: [seen('The guards on the march wear no garrison mark. They carry the seal anyway. Whoever they answer to still wants her orders obeyed on paper.')],
            root: [seen('The windroot bed is picked almost bare. The remakers have been busy. Somebody above expects to need a great many tools, or expects someone else to.')],
            grit: [seen('You know this seam now. The streak it leaves on your hands is the same one on every tool you have carried up this coast.')],
            order: [seen('The seal sits under the press the way it did at the landing, a long way below. It is the same order. You have learned to forge the coast’s own word.')],
            snare: [seen('Your hands tie the tamer’s knot without your having to think about it. It holds.')],
            senbon: [seen('There is no emberglass this high. The silver grit takes the heat instead and keeps it. You have an hour. You have had an hour before.')],
            ask: [
                seen('The door of the quiet crown is plain cedar with no mark on it. Every gate on this coast was carved with the names of the families who built it. This one was left bare on purpose.'),
                seen('When she falls, she will ask what you want. Everyone you met on the way up told you why the coast is shut. Nobody told you what to ask for.'),
            ],
            garrison: [seen('A broken seal lies in the entry hall. Its witness copy hangs in the gallery above. In the hall beyond, the crest it was pressed from sits on a bare table. She kept all three, and guards them in that order.')],
            crown: [
                nanashi('So you are the one Orito keeps writing about. I have read all of it. He has neat handwriting.'),
                nanashi('You took people nobody had counted over my pass on forged paper. I did not stop it. I was one of them once, and nobody forged anything for me.', { finished: 'uncounted-3' }),
                nanashi('A roll is how they find you. Your villages wrote down every child and came for them at fourteen. We walked out of that, and I have kept this shore off every map since. Then my own commanders started cutting families off a roll of their own.'),
                nanashi('I have never been written down, and I have never been sent for. You want to change that for everyone here. Come and tell me which way.'),
            ],
        },
        done: [
            nanashi('You asked me to open it. I will. The boats will come, and behind the boats will come the men with the lists. When they do, remember that you were warned by someone who had read the list.', { chose: ['ask', 'open'] }),
            nanashi('Take the bracer. My ridge wardens wore it when the passes were worth guarding. They will be again.', { chose: ['ask', 'open'] }),
            nanashi('You asked me to keep it shut. I had not expected that from a village shinobi. Then there is one more person on this coast who is written nowhere, and it is you.', { chose: ['ask', 'closed'] }),
            nanashi('Take the mantle. It is what I wore when I had no name to put on it. You have just given yours away.', { chose: ['ask', 'closed'] }),
            orito('She let me write her name. It’s one word, and it isn’t much of a name. I’ve been looking at it all morning.'),
        ],
    },

    // ── The Boatwright's Tools ───────────────────────────────────────────────
    'boatwright-tools-1': {
        offer: [
            urabe('You sent the toll takers off my shoal. I’ve eaten better this week than I have all year, and I work better fed.', { finished: 'tale-shoal-toll' }),
            urabe('Look at this bench. Somebody came in the night and took every iron I own. They left the wood. They knew exactly what a boatwright can’t replace.'),
            urabe('I can make a hull without a garrison’s leave. I can’t make one without tools. Help me rig the bench again, and I’ll show you where this coast keeps the things it builds with.'),
        ],
        stages: {
            slip: [urabe('It was a wrecker called Sabiro. He works Needle Shoal and strips anything that floats. Somebody paid him to strip me. A boat that leaves is bad for somebody’s business.')],
            cord: [urabe('Cord first. Eight lengths from the strand. I rig the bench before I rig a boat, the same as I was taught.')],
            fittings: [urabe('Six fittings from the seam. Take a good look at that seam while you’re there. I’ll want you to remember where it is.')],
            rig: [urabe('Hand me the cord. I’ll show you a boatwright’s hitch. It’s slow to tie and it never slips, which is more than I can say for most people.')],
            fit: [urabe('Four fittings will do the bench. Keep the other two. You’re going to need them, and not for my sake.')],
            roots: [urabe('Sabiro drinks what the garrison drinks. They pay him in it. You know what that draught does, and you know what undoes it.')],
            vial: [orito('The wrecker again? He takes the draught as wages. Write that down somewhere, because I’m not permitted to.')],
            wrecker: [
                sabiro('The boatwright sent you for his irons. He can have them back when he stops building things that sail. I’m paid by the tide to keep this shore the way it is.'),
            ],
        },
        done: [
            urabe('Every iron, and he had even kept them oiled. A man who strips boats for a living knows good tools when he steals them.'),
            urabe('The strand and the seam are yours to work whenever you like. I’ve told the gatherers so. A clan that means to build on this coast will want both, and you’ll know where to send them.'),
        ],
    },
    'boatwright-tools-2': {
        offer: [
            urabe('A hull that holds in a harbor will open like a hand out here. The water on this coast is colder and it works at every seam. My teacher knew how to stop it. I only know what he used.'),
            urabe('Pitchwood and caulk eel. One comes in on the tide at Pitchwrack Strand and the other lives under the Sounding Ledge. Somebody has been burning the first before I can reach it.'),
        ],
        stages: {
            slip: [urabe('Pitch seals the seam and the eel’s skin, boiled down, keeps the pitch from cracking in the cold. It smells worse than you are imagining.')],
            pitch: [urabe('Six spars of pitchwood from the drift. Take the ones still beading at the cut end. The dry ones have given up everything they had.')],
            eel: [urabe('Four caulk eel from the Sounding Pool. They bite. I mention it because nobody mentioned it to me.')],
            haul: [urabe('Stack the spars by the pot. Not near it. My last apprentice stacked them near it.')],
            glue: [urabe('And the eel. Good. Now go and see who is burning my drift, because I can’t caulk a hull with ashes.')],
            seed: [urabe('Her name is Yaniko and she works behind mirrors. The adept at the shelf taught her the trick before you met the adept. You know the ink for it.')],
            silt: [seen('The rim of the Mirror Pool is quiet now. Whoever stood here to watch the water has gone. The silt is where it always was.')],
            ink: [hagino('For the drift burner? Good. Her smoke comes down on my relay and my clerks cough for a week. Use the basin.')],
            burner: [
                yaniko('Every spar that washes up here could be a boat. Every boat could be a way in for your villages. I burn them on the beach, and I sleep well afterward.'),
            ],
        },
        done: [
            urabe('The drift is coming in clean. I have pitch in the pot for the first time since spring. Stand over there if you’d like to keep your eyebrows.'),
            urabe('The strand and the pool are open to you for good. Clans who raise a Landing here ask for pitchwood and eel before they ask for anything else. Now you can answer them.'),
        ],
    },
    'boatwright-tools-3': {
        offer: [
            urabe('There’s one timber I can’t cut on this shore. A keel has to grow in the curve it’ll sail in. The only roots that do that are in the Briarwood, where a storm took a cedar off the cliff.'),
            urabe('I’ve wanted to lay a real keel for eleven years. I’m not a young man. I’d like to do it while I can still lift one end.'),
        ],
        stages: {
            slip: [urabe('The keel cutters got there first. They take every root before it’s grown and sell it as firewood. Their leader keeps a beast bonded to him, the way the tamer did.')],
            root: [urabe('Eight lengths of keelroot from the fall. Cut along the curve, never across it. If you cut across it, bring it back anyway and we’ll both be sad.')],
            watch: [seen('The keel cutters walk the Foldwood Path in a line, with axes on their shoulders. Two beasts range ahead of them and one stays close to the man at the back.')],
            thorn: [seen('The briars at the spindle have grown back since you were last here. Somebody has been stripping cane from the far side. You are not the only one tying knots in this forest.')],
            links: [urabe('Two links from the old tether will weight a snare. You’ve done this before. I only build boats, so I won’t pretend to tell you how.')],
            snare: [seen('The knot comes back to your hands. The old tether post has fresh cord marks on it beside your own.')],
            haul: [urabe('Set it down gently. Look at that curve. It grew for forty years to become a boat, and it very nearly became kindling.')],
            reaver: [
                hazeru('Firewood sells. A keel sells once, to a fool who wants to leave. I’m doing this coast a favor by keeping its trees on the ground.'),
            ],
        },
        done: [
            urabe('I laid the keel this morning. I laid it alone, before anyone was up, because I didn’t want to be watched. It’s straight. I checked four times.'),
            urabe('Keelroot Fall is yours to cut. I have one request. When you take a root, leave the one beside it.'),
        ],
    },

    // ── The Uncounted ────────────────────────────────────────────────────────
    'uncounted-1': {
        offer: [
            ukishi('You’re staring. I’m used to it. I was born on this coast, I’ve lived here thirty years, and I’m on no roll the Unmoored keep. On paper I’ve never been here.'),
            ukishi('There are a great many of us. No roll means no ration, no claim on a house and no right to complain. I want to bring some of them out through this quay. I need a shinobi who can forge.'),
        ],
        stages: {
            quay: [ukishi('The warden of this quay turns back every boat without paper. He’s a careful man. Careful men believe whatever is written, so we’ll write something.')],
            post: [seen('The duty desk has two stamps on it. One is the quay master’s, worn and trusted. The other is the watch captain’s, newer, and used for orders that cannot wait.')],
            papers: [
                ukishi('Either will open the quay. The quay master’s pass is slow, and the watch will check it twice and find nothing. The captain’s order is obeyed at once, and somebody will ask about it in the morning.'),
                ukishi('I have my own opinion. It’s your hand on the stamp, so it’s your choice.'),
            ],
            seal: [ukishi('The couriers carry the seal you need. They leave it at the cache in the Folded Cut while they rest. They rest a great deal.')],
            seed: [ukishi('Forger’s ink is made from inkseed. Four heads. You’ll know the bed.')],
            forge: [hagino('I’m not looking at what you are writing. I’m looking at the wall. It’s a very interesting wall.')],
            warden: [
                moyai('Nothing leaves this quay without paper, and nothing has for nine years. People call that hard. I call it the reason this shore still belongs to the people on it.'),
            ],
        },
        done: [
            ukishi('He read it, folded it and stood aside. Eleven people went down those steps tonight who didn’t exist this morning. One of them was my mother.'),
            ukishi('The quay is a second dock now, for you and for anyone you vouch for. I’ll be here. I have a list of names, and it’s the only list on this coast that I trust.'),
        ],
    },
    'uncounted-2': {
        offer: [
            ukishi('The watch looked twice at that pass and found nothing wrong with it. Nobody has asked a question since. It was the patient way, and it has held.', { standing: 'uncounted-quay-pass' }),
            ukishi('They noticed the captain’s order by morning, as I said they would. The captain is still explaining himself. It bought us one night, and one night was enough.', { standing: 'uncounted-watch-order' }),
            ukishi('I told you there were more of us. I didn’t tell you there’s a roll of the uncounted. Somebody on this coast wrote down every person they decided not to count.'),
            ukishi('It’s kept in the Sunken Record. I want one entry changed. If a name appears in the witness register, the roll must give way to it. That’s their own rule, and I mean to use it.'),
        ],
        stages: {
            quay: [ukishi('The register at the Witness Shrine is older than the roll. If a witness has signed for you, you were seen, and a person who was seen can’t be struck off. We need one line in that book.')],
            shrine: [seen('The witness register is bound in red cord. Most pages are full. Near the middle, a single line has been left blank, with names above and below it.')],
            ruin: [seen('The rubbing shows the roll’s own binding. Somebody cut a page from this book and bound it into another. The uncounted were counted here first, and then taken out.')],
            name: [
                ukishi('One name goes on that blank line. If it’s the runner who carries the roll, she becomes a person who was seen, and she can walk out in daylight. She’s alive, though, and a living name can be asked about.'),
                ukishi('Or we write a witness who died years ago. No one living can say he didn’t sign. No one living is helped by it either, except us.'),
            ],
            hollow: [seen('The couriers rest in the hollow with the roll between them. They pass a strip of dispatch cloth back and forth as they talk. One of them keeps looking uphill.')],
            seal: [ukishi('Take their seal. Leave the roll where it is. I want them to carry it back and find it changed.')],
            thorn: [ukishi('Thorn cane binds an entry into the register. Four canes. The shrine keeper will know what it is for, and she won’t ask.')],
            forge: [seen('The register room is quiet. Somebody sheltered a person in here once and left in a hurry. A pot of ink on one shelf was left open.')],
            keeper: [
                kazoe('I keep the roll. I didn’t decide who goes on it. I only write what I’m told, and I’ve told myself that for twenty years.'),
                kazoe('If you change a line, I have to answer for it. Show me why I should.'),
            ],
        },
        done: [
            ukishi('He read the entry and then he read the register. Then he took his own pen and struck the line from the roll himself. I’ve never seen a man look so tired and so relieved.'),
            ukishi('She walked out by the shrine gate this morning, in daylight, and nobody stopped her. I watched from the cedars. She didn’t look back once.', { chose: ['name', 'runner'] }),
            ukishi('A dead man signed for us, and nobody can call him a liar. It’s a strange thing to owe. I’ve put a stone on his grave.', { chose: ['name', 'witness'] }),
        ],
    },
    'uncounted-3': {
        offer: [
            ukishi('The runner sends word from the far side of the shrine. She’s well, and she’s carrying messages for us now.', { standing: 'uncounted-runner-named' }),
            ukishi('I still think about the dead man who signed for us. Nobody has questioned it. Nobody could.', { standing: 'uncounted-dead-witness' }),
            ukishi('One night and one name were never going to be enough. There are sixty people in the high passes with no roll, no ration and a winter coming. I mean to walk all of them over.'),
            ukishi('The toll captain on the Sillward Traverse counts everyone who crosses. So they’ll cross on a pass that says they’ve already been counted.'),
        ],
        stages: {
            quay: [ukishi('There’s a split tally hidden in the cleft above the Garrison Ascent. Half of it’s with the couriers. The other half matches a list in the Pass Record House. The clerks call it a docket, and it names a pass.')],
            cleft: [seen('The tally is a strip of cedar split down its length. This half has three notches cut close together and one corner sliced off at a slant.')],
            house: [
                seen('Three dockets lie on the toll counter, each pinned to half a tally. The first has two notches and a square end. The second has three notches and a slanted corner. The third has three notches and a square end.'),
            ],
            match: [seen('The half from the cleft is in your hand. Only one docket on the counter was ever part of the same strip of cedar.')],
            pass: [
                ukishi('The docket names two kinds of pass we could copy. A salt carrier’s is common, and every gate searches a salt carrier. A dispatch rider is waved through, and then counted at the far end by someone who expects him.'),
                ukishi('Sixty people. Choose the one you’d want to be carrying.'),
            ],
            seal: [ukishi('The couriers at the cleft carry the seal. You know this part.')],
            stylus: [ukishi('A pass up here is cut, not written. Frost splinter takes an edge fine enough. Three will do.')],
            forge: [seen('The toll counter is worn in two places, where the captain’s elbows rest. The docket book lies open. Nobody has written in the margin for years.')],
            cairn: [seen('Sixty people stand out of the wind behind the cairn with everything they own on their backs. Nobody is talking. A child is counting them under her breath and keeps starting again.')],
            captain: [
                sekimori('I count everyone who crosses. It isn’t cruelty. If I don’t know how many went up, I don’t know how many to look for when the snow comes.'),
                sekimori('I have sixty people at my cairn and no count for any of them. Explain that to me.'),
            ],
        },
        done: [
            ukishi('He counted them. Every one. Then he wrote sixty in his book in his own hand and let them through. They’re on a roll now. It’s his, and it’s the first one that has ever said they were here.'),
            ukishi('I’m the last name on my list, and I’ve crossed it off. I don’t know what I do now that there’s nobody left to bring over. I expect I’ll find out.'),
        ],
    },

    // ── Raise the Clan Gate ──────────────────────────────────────────────────
    'clan-gate-1': {
        offer: [
            orito('A clan wants to hold ground here. I have a book for that, and it’s been empty since I was given it. The Unmoored hold everything, so nobody has ever needed to write a claim.'),
            orito('I’d like to write the first one. It should be written properly, or the first clan to hold land here will be the first to have it taken back on a clerk’s error.'),
        ],
        stages: {
            record: [orito('A claim has three parts. The ground is staked, the stake is witnessed, and whoever held it before is told. The Unmoored will send their land officer, a reeve, to tell you that you’re mistaken.')],
            stake: [seen('Four cornerstones mark the plot. Your clan’s stakes stand between them with a line strung taut. It does not look like much yet.')],
            cord: [orito('A boundary is recorded in cord, the length of each side. Four lengths from the strand.')],
            seal: [orito('Their surveyors carry the seal that would undo your claim. Without it, their reeve has only his voice.')],
            order: [orito('This order tells the reeve to stand down from ground he has no claim on. It’s the same order as before. I find that I’m getting used to stamping it.')],
            reeve: [
                kuiuchi('Every stone on this coast was set by the families who walked out. Your clan arrived last season. Staking a plot doesn’t make you one of us.'),
            ],
        },
        done: [
            orito('It’s written. Your clan holds ground on this coast, and the book that says so has one page in it. I’ve read it three times.'),
            orito('Build something on it. A claim with nothing built on it’s easy to cross out.'),
        ],
    },
    'clan-gate-2': {
        offer: [
            orito('I’ve seen what the Unmoored do to a hall. They don’t attack it. They send one person at night with a pot of pitch. By morning there’s nothing to record.'),
            orito('Your clan has a hall worth burning now, or soon will. I’d like to still be writing about it next year.'),
        ],
        stages: {
            record: [orito('The one they send is called Tsuketa. She’s paid in the garrison draught, like the wrecker. A fire set by someone who can’t be hurt is very hard to put out.')],
            hall: [seen('The hall stands where the stakes stood. Its timber is still pale. Somebody has hung a lamp over the door, and it has not gone out yet.')],
            roots: [orito('Woundroot, six. You know the bank.')],
            fittings: [orito('And two fittings to cap the vials. I keep a count of how many of these you’ve made. It’s higher than I expected.')],
            vial: [orito('The basin is ready. I’ve stopped pretending I don’t know what this is for.')],
            burner: [
                tsuketa('I burn what the clans raise. I’m told it keeps the coast from filling up with halls and flags and people who think they own it. I’ve never asked whether that is true.'),
            ],
        },
        done: [
            orito('The hall is standing and the lamp over its door is still lit. I walked up to look at it myself, which I don’t usually do.'),
            orito('She asked me, before she left, whether what she had been told was true. I said I only write things down. It was the first time I was ashamed to say it.'),
        ],
    },
    'clan-gate-3': {
        offer: [
            orito('A raid is coming for every Landing on this coast. I know because the order passed across my counter to be stamped, and I stamped it. That’s my job.'),
            orito('Telling you isn’t my job, and I find I no longer care. Your clan has a gate now. I’d like to see it hold.'),
        ],
        stages: {
            record: [orito('The raid captain carries two wards, the gate captain’s and the commander’s. He’ll raise them in that order. You’ve broken both, and you’ll need both tools in hand before he arrives.')],
            gate: [seen('The gate stands on the founding ground with the hall behind it. Your clan’s mark is cut into the lintel. Below it, somebody has left room for more.')],
            seal: [seen('The first raiders come over the boundary line at a walk. They do not expect anyone to be standing on it.')],
            cord: [orito('Cord for the order. Four lengths.')],
            order: [orito('I’ve stamped this order for you three times now. I’m going to keep the stamp where I can reach it.')],
            roots: [orito('Woundroot. Six.')],
            fittings: [orito('Two fittings. Then the vials, and then I think you should go and stand at your gate.')],
            vial: [seen('The basin is still warm from the last batch. Orito has left the door unbarred and gone to stand at the window.')],
            captain: [
                semeguchi('I was told this would be a hall and some stakes. Nobody told me there would be a gate. Somebody at the Record House hasn’t been sending us everything.'),
                semeguchi('It makes no difference. A gate comes down the same way a wall does.'),
            ],
        },
        done: [
            orito('The gate held. I’ve written it, and I’ve written who was standing in it. That’s more than my job asks of me.'),
            orito('Your clan’s Landing is in my book for good. They can take the ground from you. They can’t make it so that you were never here. I’ve seen to that.'),
        ],
    },

    // ── Untamed Coast ────────────────────────────────────────────────────────
    'untamed-coast-1': {
        offer: [
            ashigara('Don’t come any closer. Not you. Your companion. I want to see how it stands when it doesn’t know I’m watching. Good. It trusts you. That’s rarer than people think.'),
            ashigara('There’s a hound on this landing that nobody has ever tamed. I don’t want it caught. I want to know that it can be reached. A beast nobody can reach ends up being hunted.'),
        ],
        stages: {
            trace: [ashigara('The prints split around the juniper there. Two beasts or one that doubled back. Let your companion tell you. It has a better nose than either of us.')],
            fish: [ashigara('The hounds here follow the oil of needle fish. Four from the shoal.')],
            lure: [ashigara('Work the oil into cord. Twist it tight. A lure that drips will bring every gull on the coast before it brings one hound.')],
            set: [ashigara('Set them at the High Sill and stay downwind. Old Brinejaw hides in the sea smoke when it’s watched. That’s how it has lasted this long.')],
            cord: [seen('The smoke rolls in off the water and the shape on the sill is gone. Your companion is still staring at the place where it stood.')],
            stone: [seen('Your companion will not leave the sill. It keeps its nose to the wind and waits for you to come back with whatever you went to fetch.')],
            shard: [orito('You need a light that smoke can’t hide. Across the water your boatwright uses stormglass for it. We have none here. Splitstone flares the same way when you strike it, and I have that written down.')],
            hound: [seen('The smoke thins around the light. Old Brinejaw is larger than the prints said, grey at the muzzle, and it is looking at your companion, not at you.')],
        },
        done: [
            ashigara('It let your companion come within a length of it. Then it went back into the smoke on its own. That’s all I wanted. Nobody will hunt a beast that has been seen to stand still.'),
            ashigara('I’m keeper of a trace, which means I look at the ground for a living. You’ve given me something to look up at. Come back. There’s a pack in the Briarwood I worry about.'),
        ],
    },
    'untamed-coast-2': {
        offer: [
            ashigara('You cut the collar off that beast at the Scent Stone. It hasn’t come near a person since. It’s alive and it answers to nobody. I think that was right, but I’m not sure.', { standing: 'tale-collar-cut' }),
            ashigara('The beast you left its collar on still sleeps by the steps. Children feed it. It’s alive, and it’ll never be wild again. I think that was kind, but I’m not sure.', { standing: 'tale-collar-left' }),
            ashigara('The pack at the Briarwood fords has stopped hunting. They circle one den and won’t leave it. Their mother is in there, and something is wrong with her.'),
            ashigara('A pack that won’t hunt starves in a month. I need to see her, and they won’t let me near. They may let your companion.'),
        ],
        stages: {
            trace: [ashigara('She’s called Thornmother. The pack is bonded to her the way a tamer’s beast is bonded to him, except that nobody tied it. They did it themselves.')],
            ford: [seen('Claw prints end in the shallows at Antlerwash Ford. Your companion crosses without being asked and waits on the far bank with its ears forward.')],
            fish: [ashigara('Scent carp, from the shelf at Stillfang Mere. Four. Leave them a day if you can stand it.')],
            lure: [seen('The carp oil is dark and it clings. Your companion sneezes and then leans in to smell it again.')],
            set: [seen('The Scent Stone still carries an old mark. Your companion adds its own beside it before you can set the lures down.')],
            thorn: [seen('The pack closes around the den in a ring. None of them will break it. Whatever holds them there is not hunger.')],
            links: [seen('The tether post has been used since you were last here. Somebody else in this forest has been cutting bonds, or tying them.')],
            snare: [seen('You tie the knot. It is strange to make a tamer’s tool for a bond that no tamer made.')],
            mother: [seen('Thornmother comes out of the den slowly, favoring one leg. The pack parts for her and closes behind. She has a length of old wire wound deep in her shoulder.')],
        },
        done: [
            ashigara('The wire is out. It was a snare, an old one, set by someone who never came back for it. The pack hunted last night for the first time in a month.'),
            ashigara('They bonded to her because she was hurt and wouldn’t leave. Cutting the bond let them go and feed. Then they came back anyway. I’d like to understand that before I die.'),
        ],
    },
    'untamed-coast-3': {
        offer: [
            ashigara('There’s a white fox in the passes that no trap has ever held. I’ve been told about it for thirty years by people who didn’t see it. Last month I saw it.'),
            ashigara('It’s plated in rime from nose to tail. I don’t think it grew that way. I think the warden’s frost got into it, the winter he shut the gate, and it’s been cold ever since.'),
        ],
        stages: {
            trace: [ashigara('I don’t want it caught either. I want the frost off it. An old fox shouldn’t have to live frozen because of a man’s quarrel.')],
            scrape: [seen('Two hoof cuts share the ledge with a tuft of white hair that is not ibex. Your companion noses the tuft and then looks up the rim, shivering.')],
            fish: [ashigara('Icebell smelt keep their scent in the cold. Four, from the shelf at the Tilted Tarn. Nothing else will carry up there.')],
            lure: [seen('The smelt oil goes stiff in the wind. You work it into the cord with numb fingers while your companion stands against your legs to block the draft.')],
            set: [seen('The wind hums through the hollow at the Wind Collar. Your companion hears something in it that you cannot, and answers once, quietly.')],
            glass: [seen('The emberglass seam is warm under your hand even here. Rime plates the fox from nose to tail, and heat at the seams is the only thing that lifts it.')],
            splinter: [seen('The Frost Witness has given up a few more splinters since the gate opened. The line of frost on its shaded face is shorter than it was.')],
            senbon: [haizumi('For a fox? I’ve tested this heat against frost plate and against nothing else. Write down what happens. I’ll want it for the register.')],
            fox: [seen('Whitemane stands on the saddle with the wind behind it. The rime on its coat rings faintly when it moves. It is old, and it is tired, and it does not run.')],
        },
        done: [
            ashigara('The frost came off in plates and it stood there steaming. It looked at your companion for a long while. Then it walked down off the saddle, which I’m told it hasn’t done in nine winters.'),
            ashigara('That’s three beasts nobody could reach, and you have reached all three without putting a rope on one of them. I’ve kept this trace my whole life. You’ve done more with it than I did.'),
        ],
    },

    // ── Side tales ───────────────────────────────────────────────────────────
    'tale-unsent-letter': {
        offer: [
            orito('I have a letter in my keeping that is older than my time at this counter. A woman left it here to be sent to a village across the water. No courier of the Unmoored would carry it.'),
            orito('I’m supposed to record what becomes of everything left with me. I can’t close that entry, and it troubles me more each year.'),
        ],
        stages: {
            hear: [orito('She came ashore with the first families and wrote home once. She waited at Needle Shoal every low tide for a boat that would take it. I have her name. I’ve never had her answer.')],
            shoal: [seen('A flat rock at the shoal is worn in one place, as if somebody sat there often. Marks are scratched beside it, one for each tide. There are a great many.')],
            trace: [seen('Your companion follows something along the trace and stops at a low cairn under the juniper. A strip of the same paper is weighted under the top stone. She did not go home.')],
            letter: [seen('The letter is addressed in a careful hand. The seal has never been broken. The village it names is still there, across the water you sailed.')],
            tell: [
                orito('Then I’ll write that it was carried home, forty years late, by the first person who could.', { chose: ['letter', 'carry'] }),
                orito('Then I’ll write that it was read by no one and kept. That’s an ending too. I’d begun to think it wouldn’t get one.', { chose: ['letter', 'keep'] }),
            ],
        },
        done: [orito('The entry is closed. I’ve been looking at the page it sat on. It was only one line, and it has bothered me for years.')],
    },
    'tale-shoal-toll': {
        offer: [
            urabe('I fish Needle Shoal for my supper, the same as everyone on this landing. Every evening a patrol walks down and takes a third of what anyone has caught. They call it the garrison’s share.'),
            urabe('Nobody ever agreed to it. I’m too old to argue with four men and too hungry to keep paying. You look like you could manage the argument.'),
        ],
        stages: {
            hear: [urabe('Catch what you like. They’ll come for it at dusk, they always do. I’d dearly like them to go back up that stair with empty hands for once.')],
            catch: [seen('The shoal is quiet at low water. Other people are fishing along the rocks, and every one of them keeps glancing at the stair.')],
            toll: [seen('Four men come down the stair with a basket between them. The people on the rocks start sorting their catch into two piles before anyone has spoken.')],
            bring: [urabe('All four? You kept all four. I had honestly expected you to bring me three and an apology.')],
        },
        done: [urabe('They didn’t come down the stair this evening. Half the landing ate a whole supper. I don’t suppose it’ll last, but I’ll remember what it tasted like.')],
    },
    'tale-last-sounding': {
        offer: [
            hagino('There was a man who measured the water off the ledge below here. He dropped a weighted line and set out shells to show where a boat could come in safely. He did it for nobody. It was simply what he did.'),
            hagino('He’s stopped, and my couriers’ boats are scraping the rocks. I read every dispatch on this coast and not one of them says where he went.'),
        ],
        stages: {
            hear: [hagino('The shells are how you read it. White side up is safe water. I never learned the rest. I should have asked him while he was there to ask.')],
            ledge: [seen('The shells are still on the ledge, in a line, white side up. The last one is furred with salt. Nobody has moved it in weeks.')],
            drift: [seen('The lead line lies tangled in the drift at Pitchwrack Strand, coiled the way a careful man would coil it. He did not lose it. He was made to put it down.')],
            desk: [seen('The duty desk has an entry in the watch captain’s hand. It says the ledge is not to be marked. It says a marked ledge is a door, and the coast has enough doors.')],
            mark: [seen('The lead line is in your hands. The shells are where he left them. The watch is not looking this way.')],
            tell: [
                hagino('You marked it. My couriers will come in dry tonight. So will anyone else who can read a shell.', { chose: ['mark', 'mark'] }),
                hagino('You left it dark. I understand why. I’ll tell my couriers to learn the rocks the hard way, and I’ll keep his line here in case he comes back for it.', { chose: ['mark', 'leave'] }),
            ],
        },
        done: [hagino('I’ve written to every relay on the coast asking after him. Somebody will know. It’s the first dispatch I’ve ever sent that was only mine.')],
    },
    'tale-uncollected-packet': {
        offer: [
            ukishi('Somebody left a packet at the Courier’s Cache a season ago and never came back for it. I know because I use that cache, and I’ve been leaving it alone out of manners.'),
            ukishi('The couriers have noticed it too. If they take it, we learn nothing. If we take it, we may learn who else on this coast is passing things in secret.'),
        ],
        stages: {
            hear: [ukishi('It’s tied with the watch’s own double knot. Either the watch left it, or someone who wanted it to look that way. I’d like to know which before I trust that cache again.')],
            cache: [seen('The packet is small and flat and wrapped in oilcloth. It has been here long enough for moss to grow over one corner.')],
            hold: [seen('Boots on the path above. The couriers have come back for it today of all days. They stop when they see the stone has been moved.')],
            steps: [seen('The tide is coming up the Brine Steps one cut at a time. The lowest is already under. The packet stays dry inside your coat.')],
            packet: [seen('The knot is the watch’s. The oilcloth is the kind the uncounted use. Whoever tied this stood with one foot on each side.')],
            tell: [
                ukishi('A watchman, writing to his sister. She’s one of ours. He’s been leaving her food for a year and couldn’t put his name to it. I know her. I’ll see that she gets it.', { chose: ['packet', 'open'] }),
                ukishi('You burned it. Then whoever wrote it’s safe from me as well as from them. I’d have read it. I’m glad one of us has better manners.', { chose: ['packet', 'burn'] }),
            ],
        },
        done: [ukishi('I’m using the cache again. I leave it a little tidier than I find it. If someone else is using it too, I’d like them to know they’re in good company.')],
    },
    'tale-runners-cord': {
        offer: [
            kusabi('The runner you wrote into the register walks past this tree some mornings now. She raises a hand to me. It made me think of another runner, and of a line that is still blank.', { standing: 'uncounted-runner-named' }),
            kusabi('The keeper of the Witness Shrine once hid a runner in her register room. The girl was carrying something the garrison wanted, and she left in the dark with the ink still wet.'),
            kusabi('The register has a blank line where her passing should be written. The keeper is my friend, and she won’t fill it or strike it. It’s sat there for years, and it weighs on her.'),
        ],
        stages: {
            hear: [kusabi('A witness register records who was seen. A blank line says somebody was seen and nobody would swear to it. The keeper left a strip of red cord to mark the place. Start there.')],
            shrine: [seen('The red cord is tied around a peg in the register room, at the height of a girl’s shoulder. Under it, someone has scratched a single tally mark in the wood.')],
            hollow: [seen('A strip of dispatch cloth is caught in the moss of the hollow. Its edge is cut the same way as the cord. She came through here running, and uphill.')],
            trackers: [seen('Three men sit above the hollow with their backs to a cedar. They have a fire that has plainly been lit in the same place many times. They are still waiting for her.')],
            register: [seen('The register lies open at the blank line. The names above and below it are in the keeper’s hand. A pen is on the shelf beside it, and it has been freshly cut.')],
            tell: [
                seen('You write that she passed through. The ink dries. She is in the book now, witnessed, and anyone who reads it will know which way she ran.', { chose: ['register', 'write'] }),
                seen('You leave the line as it is and close the book. Nobody can follow a blank line. Nobody can swear by one either.', { chose: ['register', 'blank'] }),
            ],
        },
        done: [kusabi('The keeper has stopped looking at that page. She told me so herself. Whatever you did with it, it’s settled now, and she sleeps better for that.')],
    },
    'tale-old-collar': {
        offer: [
            ashigara('There’s a beast in the Briarwood that slipped its tamer years ago. It still wears the collar. It’s grown since, and the collar hasn’t.'),
            ashigara('I’ve tried to get near it for two seasons. It runs from me. It may not run from your companion. I don’t know what the right thing is, and I’d rather somebody else decided.'),
        ],
        stages: {
            hear: [ashigara('Go and look at the Sundered Tether first. That’s where it broke free. You should see what it broke before you decide what it owes anybody.')],
            braid: [seen('The braid on the old tether is frayed through, not cut. Your companion smells it for a long time. Whatever was tied here pulled until the cord gave out.')],
            carp: [ashigara('Scent carp will bring it. Four, from the shelf. It’s been fed by hand before, and it’ll remember the smell of that.')],
            leave: [seen('You lay the carp on the Scent Stone and step back. Your companion sits down beside you without being told, and the two of you wait.')],
            collar: [seen('It comes out of the trees slowly. It is thin, and the collar has worn a bare ring into its neck. It takes a fish and does not run. It looks at your hands.')],
            tell: [
                ashigara('You cut it. It ran, and it won’t come to a hand again. It’s free now, and it’s on its own. I won’t tell you that is all good.', { chose: ['collar', 'cut'] }),
                ashigara('You left it on. It followed you as far as the steps and lay down. Somebody will feed it. It’ll never be wild again, and I won’t tell you that is all good.', { chose: ['collar', 'leave'] }),
            ],
        },
        done: [ashigara('Thank you for deciding. I’ve looked after beasts for forty years and I couldn’t do it. I kept putting it off, because not deciding was easier.')],
    },
    'tale-kept-ember': {
        offer: [
            haizumi('I keep one ember alight in a stone cup. The first families lit it the first winter they spent in these passes, and every assayer since has fed it. I don’t keep it for old times’ sake. It’s the longest record of heat that anyone has.'),
            haizumi('It’s burning low and the seam is across a saddle the watch has started to guard. I’d go myself. I’m told I measure better than I climb.'),
        ],
        stages: {
            hear: [haizumi('Emberglass, four pieces. It feeds the cup for a season. If the ember goes out, ninety years of readings end on my watch, and I’d rather they didn’t.')],
            glass: [seen('The seam glows faintly where you break it. The pieces are warm in your pack, and the warmth shows through the cloth.')],
            saddle: [seen('The watch on the Listening Saddle has seen the glow from your pack. Three of them step into the path. One of them asks what a village shinobi wants with fire.')],
            feed: [haizumi('Set them in one at a time, and go slowly. Look at that. It hasn’t burned that clean since my teacher’s time.')],
        },
        done: [haizumi('I’ve entered the reading. I’ve also entered who carried the glass, which the register has no column for. I ruled one in.')],
    },
    'tale-last-docket': {
        offer: [
            ukishi('Sixty people are on a roll because of that salt carrier’s pass. They were searched at every gate and nothing was found. I think of it each time I see a gate.', { standing: 'uncounted-salt-pass' }),
            ukishi('The far end is still asking where its dispatch rider went. Let them ask. Sixty people are over the pass.', { standing: 'uncounted-dispatch-pass' }),
            ukishi('The last boat for the villages sailed before the Unmoored shut the coast. It couldn’t take everyone. Somebody wrote down who was left on the shore, and the list was sent up to the passes to be kept.'),
            ukishi('I’ve looked for that docket my whole life. I think I know where it is now. I’m not sure I want to be the one who reads it.'),
        ],
        stages: {
            hear: [ukishi('The Pass Record House keeps the last sailing docket in its loft. It was sealed, and the seal’s other half is under the Last Dispatch Cairn. Match them, and you’ll know it’s the true one.')],
            loft: [seen('The docket is a single sheet folded into four. The names run down it in two columns, close together, in a hand that was hurrying.')],
            cairn: [seen('Under the cap of the cairn is a seal pressed into wax. It fits the mark on the docket exactly. This is the list, and it was meant to be found here.')],
            docket: [seen('You have read it. Forty names. Near the bottom is a family name you have heard on this coast before, from a woman who says she is on no roll at all.')],
            tell: [
                ukishi('That’s my grandmother. And that is my mother, written as a child of three. We weren’t uncounted. Somebody counted us and left us behind, and I don’t know yet which is worse.', { chose: ['docket', 'bring'] }),
                ukishi('You put it back. I see. Then I’ll go on not knowing, which I’m practiced at. I think you meant it kindly. I’ll decide later whether it was.', { chose: ['docket', 'return'] }),
            ],
        },
        done: [ukishi('I’ve stopped looking for it. I either have it or I’ve been spared it. I find that I can rest in either case.')],
    },
    'tale-second-bell': {
        offer: [
            orito('The Witness Bell on the heights hangs over a stone cut for two. I have the mason’s account. He was paid for two cradles and delivered two. Only one bell was ever hung.'),
            orito('An account that doesn’t balance keeps me awake. I’m too old to climb to Bellroot Verge. You aren’t.'),
        ],
        stages: {
            hear: [orito('A witness bell is rung when something is sworn. One bell means it was said. A second bell, answering, means it was heard. This coast has been swearing things for ninety years with nobody to answer.')],
            bell: [seen('The second hollow in the stone is clean and sharp. No bell ever sat in it. A groove runs from its edge toward the far ridge, the way a mason marks where something is to be carried.')],
            pool: [seen('The pool holds the far ridge upside down. One tree stands apart on it, and in the water you can see what you could not from the path: something pale is hanging in its roots.')],
            guards: [seen('Two guards stand on the saddle below the tree. They are not watching the road. They are watching the tree.')],
            marker: [seen('Curled inside the root is a bronze clapper, green with age and wrapped in oilcloth. The second bell was never cast. Somebody hid the only part of it that was.')],
            clapper: [seen('It is heavy for its size. Hung beside the Witness Bell, it would strike it from the other side. The heights would hear it, and so would the garrison.')],
            tell: [
                orito('Then the account balances. Two cradles, one bell, and one answer. I can close the page.', { chose: ['clapper', 'hang'] }),
                orito('Then the account stays open, and I know why. I can live with an open page if I know what is on the other side of it.', { chose: ['clapper', 'bury'] }),
            ],
        },
        done: [
            orito('Since she opened the coast, the bell is rung more often. I’m told people climb up there only to hear it.', { standing: 'coast-opened' }),
            orito('The mason’s account is ninety years old, and I’ve finally signed it off.', { chose: ['clapper', 'hang'] }),
            orito('I left the line for the clapper blank. If the watch ever asks to see this book, they can read what the mason was paid. They won’t find where you put it.', { chose: ['clapper', 'bury'] }),
            orito('He was an honest man. He only left out the part that wasn’t his to tell.'),
        ],
    },
    'tale-first-pattern': {
        offer: [
            urabe('My teacher learned his trade from a remaker on the heights. She cast fittings from grit and taught him to cut a pattern before he ever cut a plank. He talked about her until the day he died.'),
            urabe('Her first pattern is still hanging in the workshop up there. I’ve never seen it. I’d like a rubbing of it before I’m too old to care about such things.'),
        ],
        stages: {
            hear: [urabe('Everything I know about rigging came from that pattern. It reached me secondhand, through a man with a bad memory. I want to see how much of it I got wrong.')],
            patterns: [seen('Two patterns hang in the workshop. One is sharp and much used. The other is older and worn nearly flat, and somebody has hung it higher, out of the way of work.')],
            grit: [seen('A pattern nobody casts from is only a carving. One casting would show what the old one still holds.')],
            cast: [seen('You leave the grit on the bench under the old pattern. A remaker at the far bench looks at it, and at you, and takes down her ladle without a word.')],
            tell: [urabe('Give it here. Well. He had the sizes right. He had the curve backward. I’ve been cutting it backward for thirty years, and my boats float anyway.')],
        },
        done: [
            urabe('The coast is open, and I’m going to cut the next one the right way round. It’ll be meant to leave.', { standing: 'coast-opened' }),
            urabe('The coast stays shut, and I’ll cut the next one the right way round regardless. A boat should be made properly even if it never sails.', { standing: 'coast-kept-closed' }),
            urabe('I’ve pinned the rubbing over my bench. Next to it I’ve pinned one of my own, the backward one. I think he’d have laughed.'),
        ],
    },
};
