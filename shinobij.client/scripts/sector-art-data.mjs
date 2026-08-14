// Per-sector art direction for the overworld — the single prompt sheet consumed by
// gen-sector-art.mjs. Every wild sector (1-60) gets its own painted scene (the 2.5D
// parallax vista) and its own top-down adventure-map floor, classified by where the
// sector's marker actually sits on the painted World Map (shared/sector-links.ts
// SECTOR_POINTS × the world-map keyart) — NOT by biomeForWorldSector(), whose coarse
// numeric bands disagree with the painted geography in places. Sector 99 keeps its
// bespoke /deathgate-sector.webp art and is deliberately absent here.
//
// `ambience` uses the existing Biome ambience vocabulary (forest/snow/shadow/
// volcano/central) so drifting particles + god-ray tint keep matching the new art.

// region → shared prompt fragments. `scene` fragments describe an establishing shot
// (gen-bg.mjs appends the house STYLE suffix); `floor` fragments describe the same
// place as a top-down adventure map (gen-sector-art.mjs wraps them in the worldmap
// style pre/post — superseded by scripts/keyart-floor-style.mjs).
const REGION = {
    ashenleaf: {
        ambience: 'forest',
        floorBase: 'A lush emerald forest route with drifting pink cherry-blossom petals. Winding dirt trails and mossy root paths thread across the whole map and link every area; dense tree groves, fern thickets, blossom drifts and small grassy clearings.',
    },
    midlands: {
        ambience: 'central',
        floorBase: 'A bright green midland meadow route. Tan dirt roads and mown grass paths wind across the whole map and link every area; wildflower drifts, hedgerows, scattered boulders and small streams with plank crossings.',
    },
    volcano: {
        ambience: 'volcano',
        floorBase: 'A dangerous volcanic route. Cooled dark-lava paths and grey ash trails wind across the whole map between glowing molten-orange lava streams and jagged obsidian ridges, linking every safe area.',
    },
    frostborder: {
        ambience: 'snow',
        floorBase: 'A glacial border route where ice meets green land. Packed-snow trails and meltwater stream banks wind across the whole map and link every area; patches of glassy blue ice, frost-rimed rocks and hardy pines beside mossy thawed ground.',
    },
    frostfang: {
        ambience: 'snow',
        floorBase: 'A frozen glacial route under pale daylight. Packed-snow trails wind across the whole map and link every area; pine groves, snowdrifts, glassy pale-blue ice, and clusters of blue ice-crystal formations.',
    },
    castle: {
        ambience: 'central',
        floorBase: 'A maintained castle-city district. Fitted grey stone roads and garden walkways connect every part of the map; tended gardens, colourful flower beds, low hedges, koi ponds, indigo-and-gold banners on lamp posts.',
    },
    darktemple: {
        ambience: 'shadow',
        floorBase: 'A haunted temple approach at dusk on dark scorched ground. Cracked black-stone paths wind across the whole map and link every area; bare dead-tree groves, rows of cold stone lanterns, drifting purple mist and faint violet ember-light.',
    },
    carnival: {
        ambience: 'central',
        floorBase: 'A festival-grounds route at golden dusk. Trampled grass paths and strings of glowing paper lanterns wind across the whole map and link every area; striped tent canopies in red, teal and purple, bunting between poles, crates and hay bales, dry scrub and a few green cacti at the edges.',
    },
    moonshadow: {
        ambience: 'shadow',
        floorBase: 'A mystical violet forest route by moonlight. Pale stone paths and luminous petal trails wind across the whole map and link every area; amethyst-leafed tree groves, glowing purple crystals, moonstone boulders and still reflective pools.',
    },
    stormveil: {
        ambience: 'central',
        floorBase: 'A harbor water-city route. Wooden boardwalks, piers and arched plank bridges wind across the whole map over turquoise shallows and link every area; stilt houses roofed in deep azure cobalt-blue tiles, moored boats, coiled ropes, barrels and fishing nets.',
    },
};

// sector → { region, name, scene, floor } — `floor` here is the per-sector
// points-of-interest sentence appended to its region's floorBase.
export const SECTOR_ART = {
    // ——— Ashen Leaf forest (top-left of the world map) ———
    36: { region: 'ashenleaf', name: 'Cliffside Deepwood', scene: 'ancient emerald forest on high sea cliffs, giant moss-covered trees, distant teal pagoda rooftops through the canopy, waterfalls spilling off the cliff edge into a turquoise sea far below', floor: 'Points of interest along the paths: turquoise sea filling one entire edge of the map below white sea cliffs, a clifftop overlook ledge, a moss-swallowed fallen log bridge, a giant ancient tree with exposed roots, and a tiny spring pool.' },
    37: { region: 'ashenleaf', name: 'Blossom Grove', scene: 'sun-dappled cherry-blossom grove inside an emerald forest, drifting pink petals, a winding root path, teal pagoda rooftops of a hidden village beyond the canopy', floor: 'Points of interest along the paths: a ring of blossoming cherry trees, a petal-covered clearing, a small red bench pavilion, and a stone basin fed by a trickle.' },
    38: { region: 'ashenleaf', name: 'Ashen Leaf Gates', scene: 'the great bare wooden torii gates of a forest shinobi village hung with paper lanterns, emerald canopy and pink blossoms, a stone road leading inward, waterfall cliffs behind', floor: 'Points of interest along the paths: a grand bare wooden torii gate, a guard post hut, a blank notice board, and a lantern-lined approach road.' },
    39: { region: 'ashenleaf', name: 'Canopy Heights', scene: 'treetop walkways and rope bridges strung between giant forest trees, cherry blossoms drifting, glimpses of a turquoise sea horizon beyond the canopy', floor: 'Points of interest along the paths: a rope-bridge crossing between platforms, a rope ladder base, a lookout stump, and a cluster of glowing forest mushrooms.' },
    40: { region: 'ashenleaf', name: 'Headland Woods', scene: 'windswept forest headland where emerald woods meet white sea cliffs, a lone cherry tree in bloom, seabirds wheeling, distant sails on a turquoise sea', floor: 'Points of interest along the paths: a lone blossoming cherry tree on a grass bluff above white sea cliffs, turquoise sea along one edge of the map, a driftwood-marked cliff trail, an old stone cairn, and a gull-nested rock.' },
    41: { region: 'ashenleaf', name: 'Gorgeview Plateau', scene: 'forest plateau ending at a long wooden rope bridge over a river gorge, emerald woods behind, bright green midland meadows across the water', floor: 'Points of interest along the paths: a deep river gorge crossing the map with white water at its bottom, a sturdy bridge spanning it, a gorge-edge railing walk, cherry-blossom trees, a wayfarer campsite with a cold fire-ring, and a berry thicket.' },
    42: { region: 'ashenleaf', name: 'Heartwood Shrine', scene: 'a mossy forest shrine clearing deep in an emerald wood, ancient stone lanterns and a weathered red torii, shafts of god-light through the canopy, drifting cherry petals', floor: 'Points of interest along the paths: a wide moss-ringed open grass clearing at the heart of the map (kept empty), a row of old stone lanterns beside it, a purification water basin, and a petal-strewn prayer path.' },
    43: { region: 'ashenleaf', name: 'Fern Terraces', scene: 'forest cliff terraces above a wide river gorge, waterfalls pouring off mossy ledges, fern thickets, a great arched bridge in the hazy distance', floor: 'Points of interest along the paths: stepped mossy terraces linked by log stairs, a ledge waterfall with a plank crossing, a fern hollow, and a collapsed old flume.' },

    // ——— Midlands (green meadows between the forest, castle and coast) ———
    44: { region: 'midlands', name: 'North Reach', scene: 'bright green upland meadow crossed by a tan dirt road, scattered boulders and wildflower drifts, a river glinting to the north, dark volcanic peaks smoking on the horizon', floor: 'Points of interest along the paths: a boulder field with a squeeze-through gap, a wildflower drift, a leaning bare wooden waymarker post at the roadside, and a shallow stony river ford crossing the road, open wild meadow stretching in every direction.' },
    45: { region: 'midlands', name: 'Crossway Hills', scene: 'rolling green hills with a carved stone waymarker where two roads cross, windswept grass, the indigo spires of a great castle rising to the south-east', floor: 'Points of interest along the paths: a carved stone waymarker at a crossroads, a shepherd’s lean-to, a windswept lone oak, and a dew pond.' },
    25: { region: 'midlands', name: 'Great Bridge Gorge', scene: 'a mighty arched wooden bridge spanning a white-water river gorge between green cliffs, waterfalls upstream, drifting mist and spray, roads winding away on either side', floor: 'Points of interest along the paths: a deep white-water river gorge splitting the whole map, one grand arched wooden bridge crossing it, a spray-misted overlook, a toll-keeper’s abandoned hut, and stacked timber piles.' },
    23: { region: 'midlands', name: 'Falls Overlook', scene: 'green clifftop meadows split by a waterfall river gorge, rope-and-plank crossings, spray rainbows hanging over the drop', floor: 'Points of interest along the paths: a waterfall river gorge cutting across the map, a rope-and-plank crossing over it, a rainbow-spray overlook rail, a mossy millstone ruin, and a kingfisher pool.' },
    28: { region: 'midlands', name: 'Goatstone Terraces', scene: 'terraced green hills with grazing pastures, dry-stone walls along a tan road, the sea glinting far to the west', floor: 'Points of interest along the paths: long dry-stone walls dividing grassy pasture terraces, a wooden stile, a small goat pen, a hilltop standing stone, and a spring trough, quiet grazing farmland.' },
    29: { region: 'midlands', name: 'Milestone Vale', scene: 'a rolling meadow vale where three roads meet at a mossy milestone, wildflowers, a stream running under a small stone bridge', floor: 'Points of interest along the paths: a mossy old milestone at a three-way meeting of roads, a small stone bridge over a stream, a flower-ring fairy circle, and a hollow oak.' },
    30: { region: 'midlands', name: 'Teahouse Fields', scene: 'hedged green farmland south-west of a castle city, cart tracks between fields, a roadside tea stall under a spreading oak', floor: 'Points of interest along the paths: a roadside tea stall under a big oak, hedged field plots, a hay cart on a track, and a scarecrow post.' },

    // ——— Volcano (obsidian fortress and lava fields, top-centre) ———
    52: { region: 'volcano', name: 'Obsidian Forecourt', scene: 'the obsidian forecourt of a black volcanic fortress, jagged spires edged in red light, rivers of glowing lava carving through dark rock, ash drifting on the wind', floor: 'Points of interest along the safe paths: a black fortress outer gate, a cracked obsidian courtyard, a lava river with a wide basalt slab bridge clearly linking both banks, and a rack of cooled slag.' },
    7: { region: 'volcano', name: 'Cinder Foothills', scene: 'scorched foothill badlands where green grass gives way to black volcanic rock, a lava-lit canyon road, ember glow on low ash clouds, a dark fortress looming to the north', floor: 'Points of interest along the safe paths: a boundary line where green turf chars into black rock, a smoking ground vent, a ruined watch post, and an ash-buried cart.' },
    51: { region: 'volcano', name: 'Cinderfrost Divide', scene: 'a stark divide with glowing lava-cracked black ash fields on one side and a towering wall of glacial blue ice on the other, steam rising along the boundary', floor: 'unused', floorFull: 'A volcanic ash route veined with fire and frost. Black ash trails wind across the whole map and link every area; glowing orange lava cracks vein the black ash ground everywhere, steam plumes drift, and patches of pale-blue ice and snow lie scattered across the ash between them. Points of interest along the trails: an obsidian arch, a frozen-over lava tube mouth, and a cairn of half-melted stones.' },
    2: { region: 'volcano', name: 'Northroad Saddle', scene: 'a high grassy saddle on the north road, wind-bent grass and dark scree slopes, a smoking volcano on one horizon and glittering ice spires on the other', floor: 'unused', floorFull: 'A high mountain route over a broad grassy saddle. Wide dirt trails wind across windswept green ridgetops and link every area; wind-bent grass, grey scree slopes, dark volcanic boulders, thin drifting ash haze. Points of interest along the trails: a switchback trail up the scree, a trail-marker rope line, a sheltered hollow campsite, and a faint orange volcano glow on the far northern horizon.' },

    // ——— Frost border (bridge country between the castle lands and the ice) ———
    3: { region: 'frostborder', name: 'Glacier Bridge', scene: 'a grand timber bridge crossing a glacial river toward an ice-castle city, frozen waterfalls hanging from blue cliffs, pennants snapping in the cold wind', floor: 'Points of interest along the paths: a grand timber bridge over a glacial river, rope streamers stiff in the wind, an ice-fisher’s hole, and a frost-rimed rest shelter, with mossy thawed green ground showing along one bank.' },
    55: { region: 'frostborder', name: 'Icefall Cliffs', scene: 'icefall cliffs where frozen cascades hang above a green valley, meltwater streams braiding through mossy rocks, ice glinting against warm meadow light', floor: 'Points of interest along the paths: glacial snow and blue icefall cliffs with broad bright-green mossy thaw meadows breaking through along the lower trails, a hanging frozen waterfall face, braided meltwater streams with stepping stones, and an icicle-fanged rock overhang.' },

    // ——— Frostfang glacier realm (top-right) ———
    46: { region: 'frostfang', name: 'Far Glacier Shelf', scene: 'a vast glacier shelf under pale sun, deep-blue crevasses, wind-sculpted ice dunes, the crystalline towers of an ice city far to the west', floor: 'Points of interest along the trails: a wild untouched glacier shelf, a deep blue crevasse crossed by a natural snow bridge, wind-sculpted ice dunes, an abandoned frozen-in supply sled, and a dark snow cave mouth.' },
    47: { region: 'frostfang', name: 'Frostfang Gates', scene: 'the frost-rimed gates of a glacial shinobi city, walls of carved blue ice, frozen waterfall columns flanking the road, banners stiff with frost', floor: 'Points of interest along the trails: smooth carved blue-ice gate pillars, a frozen waterfall column, a guard brazier glowing against the snow, and a lantern-lined approach.' },
    48: { region: 'frostfang', name: 'Needle Spires', scene: 'needle-thin ice spires on a high snowfield, auroral light playing over crystalline towers, snow banners streaming from the peaks', floor: 'Points of interest along the trails: a cluster of needle-thin ice spires, an aurora-lit snowfield, a crystal outcrop, and a collapsed snow tunnel.' },
    49: { region: 'frostfang', name: 'Highpass Peaks', scene: 'jagged white mountain peaks above a frozen pass, an ice-carved stairway winding up, a distant glacial city glittering below', floor: 'Points of interest along the trails: a grand ice-carved stairway climbing the slope as the centrepiece of the map, a snow-covered bridge crossing the frozen river, a rope handrail line, a frozen cataract, and a summit prayer-flag pole.' },
    50: { region: 'frostfang', name: 'Glacier Terraces', scene: 'terraces of a crystalline ice city carved into a glacier face, bridges of blue ice between towers under freshly fallen unbroken snow, snowfall drifting past glowing windows', floor: 'Points of interest along the trails: a blue-ice bridge between terraces, glowing carved windows in an ice wall, an ice-sculpture garden, and a frozen fountain.' },
    53: { region: 'frostfang', name: 'Shrinefall Shelf', scene: 'a wind-scoured snow shelf overlooking a frozen bay, an ancient ice-carved shrine ringed by frost lanterns, a pale sun halo overhead', floor: 'Points of interest along the trails: a wide wind-scoured open snow shelf at the heart of the map ringed by frost lanterns (kept empty, no buildings), a frozen bay overlook, and an offering cairn.' },
    54: { region: 'frostfang', name: 'Knife-Edge Summit', scene: 'the knife-edge summit ridge of a great white mountain, cornices of wind-packed snow, the whole frozen realm spread out below in blue light', floor: 'Points of interest along the trails: a high frozen mountain pass winding between steep dark rock slopes, rope anchor lines along the trail, a snow cornice overlook, a wind-scoured stone cairn, and a tiny emergency shelter dugout.' },

    // ——— Central castle city (the indigo keep at the heart of the map) ———
    56: { region: 'castle', name: 'West Gardens', scene: 'manicured castle gardens west of an indigo-purple keep, fitted stone walkways, koi ponds and clipped hedges, a golden castle emblem catching the light', floor: 'Points of interest along the roads: a koi pond with an arched stone bridge, clipped hedge parterres, a gardener’s tool shed, and a sundial plinth.' },
    57: { region: 'castle', name: 'North Gate Plaza', scene: 'the north gate plaza of a majestic indigo castle city, a banner-lined stone road, ornate lamp posts, purple towers rising behind the battlements', floor: 'Points of interest along the roads: a grand gate plaza with banner poles, an ornate double lamp row, a market awning stall, and a mounted notice board.' },
    58: { region: 'castle', name: 'Walled Garden', scene: 'a serene walled garden in the shadow of an indigo castle, a gilded garden shrine among flowerbeds and stone lanterns, petals floating on a reflecting pool', floor: 'Points of interest along the roads: a gilded garden shrine among flowerbeds at the garden’s heart, a reflecting pool with floating petals, a wisteria pergola walk, and paired stone lanterns.' },
    59: { region: 'castle', name: 'South Terraces', scene: 'the south terraces of a grand indigo castle, sweeping stone stairs, ornamental cherry trees, the ring road curving below', floor: 'Points of interest along the roads: sweeping terrace stairs, ornamental cherry trees in stone planters, a balustrade overlook, and a small tiered fountain.' },
    60: { region: 'castle', name: 'Grand Esplanade', scene: 'a grand esplanade descending from castle gates in wide stone steps, banner poles and statue plinths, green parkland and roads fanning out to the south', floor: 'Points of interest along the roads: wide ceremonial steps, a hero statue on a plinth, twin colonnades of warm stone lanterns, and a park lawn with picnic cloths.' },
    1: { region: 'castle', name: 'East Ring Road', scene: 'the east ring road of an indigo castle city, stone bridges over garden canals, market awnings against the outer wall, purple spires overhead', floor: 'Points of interest along the roads: a stone bridge over a garden canal, a row of market awnings, a public well with a bucket crane, and a postern door in the city wall.' },

    // ——— Central-east fields (between the castle and the violet forest) ———
    9: { region: 'midlands', name: 'Windmill Fields', scene: 'green farmland fields east of a castle city, a tan road lined with hedgerows, haystacks and a windmill, a purple forest rising on the far horizon', floor: 'Points of interest along the paths: a tall wooden windmill as the centrepiece of the map, ranked haystacks, a hedgerow gate, and a farm pond with ducks.' },
    10: { region: 'midlands', name: 'Watchruin Ridge', scene: 'a high green ridge road with a ruined stone watchtower, views toward hanging icefalls north and a violet forest east', floor: 'Points of interest along the paths: a ruined round watchtower, a tumbled rampart line to clamber over, a ridge-top viewpoint, and a rabbit-warren bank.' },
    19: { region: 'moonshadow', name: 'Jade River Bridge', scene: 'a stone bridge over a slow jade river at the very edge of a violet amethyst-leafed forest, bright green sunlit meadow in the foreground bank, reeds and fireflies, lantern posts on the bridge', floor: 'Points of interest along the paths: a lantern-posted stone bridge over a jade river, a reed bank with fireflies, a fishing jetty, and the first amethyst-leafed trees of a violet wood.' },

    // ——— South of the castle: darkening road, temple, festival ———
    12: { region: 'darktemple', name: 'Waymarker Road', scene: 'a darkening road south of the castle where hedgerows give way to black-stone waymarkers, purple mist gathering over the fields ahead', floor: 'Points of interest along the paths: a line of black-stone waymarkers, a last green hedgerow fading to dark ground, an abandoned shinobi courier handcart, and a mist hollow.' },
    20: { region: 'midlands', name: 'Southern Crossroads', scene: 'a broad crossroads in rolling green scrubland, a leaning signpost and a dry stone well, festival tent tops just visible to the south', floor: 'Points of interest along the paths: a leaning multi-arm signpost, a dry stone well, a scrub thicket shortcut, and distant tent-top pennants past the map edge.' },
    18: { region: 'darktemple', name: 'Hollow Temple', scene: 'a black shrine-temple with a blazing violet portal gate, scorched dark stone courtyard, floating embers of purple light, dead trees and torii silhouettes', floor: 'Points of interest along the paths: a black temple façade with a glowing violet portal gate, a scorched courtyard, toppled torii silhouettes, and floating purple ember-light.' },
    13: { region: 'darktemple', name: 'Lantern Approach', scene: 'a cracked lantern road approaching a black temple, rows of extinguished stone lanterns, a purple glow bleeding into the dusk sky ahead', floor: 'Points of interest along the paths: rows of extinguished stone lanterns, a cracked flagstone processional way, a dried ceremonial pool, and a fallen bell on its side.' },
    14: { region: 'carnival', name: 'Festival Grounds', scene: 'a festival ground before opening hour, striped circus tents in red, teal and purple all sealed shut, strings of paper lanterns, bunting between poles, trampled grass paths aglow at dusk', floor: 'Points of interest along the paths: a striped big-top tent, a ring-toss stall, a lantern-strung dance ring, and stacked festival crates.' },
    35: { region: 'carnival', name: 'Cactus Flats', scene: 'dry scrubland at the festival’s edge, tall green cacti and tumble-grass, a striped big-top and pennant flags rising beyond the brush', floor: 'Points of interest along the paths: a stand of tall green cacti, a tumble-grass flat, a broken wagon wheel half-buried, and a pennant pole marking the festival edge.' },
    33: { region: 'carnival', name: 'Boardwalk Scrub', scene: 'scrub meadow between marsh and festival grounds, a boardwalk path over boggy pools, distant tent flags and a glint of turquoise sea to the west', floor: 'unused', floorFull: 'A scrubland marsh route between wetlands and far-off festival grounds. Trampled grass paths and a winding low plank boardwalk cross boggy pools and link every area; cattail reeds, scrub bushes, dry grass hummocks, a few green cacti. Points of interest along the paths: a duck-hunter’s blind, a dry hummock campsite, and tiny colourful pennant tips just visible on the far southern horizon.' },

    // ——— Moonshadow violet forest (bottom-right) ———
    4: { region: 'moonshadow', name: 'Amethyst Canopy', scene: 'a violet-canopied forest of amethyst-leafed trees, glowing spores drifting, indigo rooftops of a hidden village deep in the wood', floor: 'Points of interest along the paths: a grove of amethyst-leafed trees, a drift of glowing spores, a moonstone boulder ring, and a spirit-fox den mouth.' },
    5: { region: 'moonshadow', name: 'Moonstone Rise', scene: 'east amethyst woods where purple trees part around moonstone boulders, a pale path lit by luminous flowers', floor: 'Points of interest along the paths: a moonstone boulder outcrop, a luminous flower bed, a pale winding ridge path, and a crystal-crowned stump.' },
    6: { region: 'moonshadow', name: 'Moonlit Cove Cliffs', scene: 'purple forest sea-cliffs, amethyst trees leaning over waterfalls that drop into a moonlit cove', floor: 'Points of interest along the paths: a cliff-edge waterfall chute, a cove overlook platform, leaning amethyst trees, and a tide-pool stair.' },
    8: { region: 'moonshadow', name: 'Crystal Plaza', scene: 'a moonlit plaza around a towering glowing purple crystal, violet trees ringing polished dark stone, motes of light rising', floor: 'Points of interest along the paths: a towering glowing purple crystal on a polished plinth, a ring of violet trees, radiating inlay paths, and floating light motes.' },
    11: { region: 'moonshadow', name: 'Moonshadow Gates', scene: 'the moon-arch gates of a violet forest village, crystal lanterns, indigo roofs behind, a glowing purple monument at the avenue’s end', floor: 'Points of interest along the paths: a crescent moon-arch gate, paired crystal lanterns, an avenue of violet trees, and a gatekeeper’s kiosk.' },
    15: { region: 'moonshadow', name: 'Western Eaves', scene: 'the western eaves of a violet forest where green meadow grass laps against amethyst trunks, a river border crossed by stepping stones', floor: 'Points of interest along the paths: a violet amethyst forest opening onto broad bright-green sunlit meadow clearings along its western paths, a small border river with stepping stones, a petal-fall drift, and a carved boundary stone.' },
    16: { region: 'moonshadow', name: 'Moongrotto', scene: 'a hushed moon-shrine grotto beneath violet canopy, a crescent altar of pale stone, luminous petals falling on still dark water', floor: 'Points of interest along the paths: a wide open moonlit clearing of pale moss at the grotto’s heart (kept empty), a still dark reflecting pool beside it, luminous petal falls, and a mossy grotto arch.' },
    17: { region: 'moonshadow', name: 'Fallswood', scene: 'southern violet woods above tiered waterfalls, glowing mushrooms on mossy banks, fireflies over the pools', floor: 'Points of interest along the paths: tiered waterfall pools cascading through the centre of the map with mossy banks, clusters of glowing mushrooms, a log bridge over a chute, and a firefly hollow.' },

    // ——— Stormveil harbor city (bottom-left) ———
    21: { region: 'stormveil', name: 'North Docks', scene: 'north docks of a blue-roofed harbor city on stilts, fishing boats tied to wooden piers, gulls over turquoise shallows', floor: 'Points of interest along the boardwalks: a fishing pier with tied boats, drying racks of nets, a crab-pot stack, and a gull-perched mooring post.' },
    22: { region: 'stormveil', name: 'Upper Terraces', scene: 'upper terraces of a sea city, azure-tiled roofs stepping down to the water, rope bridges between stilt houses, sails drying in the wind', floor: 'Points of interest along the boardwalks: stepped terrace walks between azure-roofed houses, a rope bridge span, a sail-drying frame, and a terrace herb garden.' },
    26: { region: 'stormveil', name: 'Western Piers', scene: 'the western piers where tall ships berth, furled white sails and cargo cranes, a lighthouse beam sweeping a turquoise bay', floor: 'Points of interest along the boardwalks: a tall-ship berth with a gangplank, a wooden cargo crane, stacked crates and barrels, and a small striped lighthouse on the point.' },
    27: { region: 'stormveil', name: 'Canal Heart', scene: 'the canal heart of a water city at first light before anyone wakes, empty moored sampans bobbing between stilt houses, paper lanterns still glowing against plain timber walls, reflections rippling in the still channels', floor: 'Points of interest along the boardwalks: a canal crossing with a low arched bridge, a sampan tied at a house post, a floating market raft, and strings of lanterns over the water.' },
    31: { region: 'stormveil', name: 'Harbor Gates', scene: 'the harbor gates of a sea village, a great pier arch hung with signal flags, a tall ship passing, blue roofs crowding the waterline', floor: 'Points of interest along the boardwalks: a rope of colourful signal pennants spanning the main pier, a harbormaster’s kiosk with an azure roof, a bell post, and a welcome pontoon.' },
    32: { region: 'stormveil', name: 'Eastern Stilts', scene: 'eastern residential docks, laundry lines between azure-roofed stilt homes, fishing lines cast off the boardwalk', floor: 'Points of interest along the boardwalks: laundry lines between stilt homes, a boardwalk fishing spot, a floating garden box, and a rowboat tied under a house.' },
    34: { region: 'stormveil', name: 'Clocktower Hill', scene: 'a grassy hill above a harbor city crowned by an old stone clocktower, a tide-shrine of rope-bound pillars overlooking the bay, salt wind in the grass', floor: 'Points of interest along the paths: an old stone clocktower on one side of the hilltop, a wide open grass knoll overlooking the bay (kept empty), a bell rope post, and a kite meadow.' },
    24: { region: 'stormveil', name: 'Reedmarsh Boardwalk', scene: 'wetland boardwalks approaching a sea city, reed beds and brackish pools, herons stalking, blue rooftops rising in the west', floor: 'unused', floorFull: 'A wetland marsh route at the edge of a sea city. Winding low plank boardwalks cross wide brackish reed marshes and link every area; dense reed beds, brackish pools, mud flats, wading herons. Points of interest along the boardwalks: a heron pool, an eel-trap rack, and a stilted rest hut.' },

    // ——— The 2026-07-29 expansion (61-66) ———
    // These are keyed by their OWN ids: they are new places, so no historical
    // art filename is being reused. Every other entry above is keyed by its
    // pre-renumbering id because those files must never be renamed.
    61: { region: 'midlands', name: 'Westfurrow Fields', scene: 'wide ploughed farm furrows on a green western upland at first light, a low drystone wall, hay stooks standing in the field, distant forest cliffs hazy to the north', floor: 'Points of interest along the paths: long ploughed furrows crossing the map, a drystone field wall with a stile, a cluster of hay stooks, a turnip cellar hatch, and a lone scarecrow on a bare pole.' },
    // 62 and 63 override their region base entirely — a shingle landing and a
    // quiet tallgrass river bend both fight their region's default vocabulary
    // (meadow roads / tents-and-bunting), same reason as 24 and 33 above.
    62: { region: 'midlands', name: 'Greycliff Landing', scene: 'a small stone landing at the foot of grey western sea cliffs, an empty rowboat drawn up on shingle, crab pots stacked against the rock, turquoise water lapping at first light', floor: 'unused', floorFull: 'A rocky western shore route below grey sea cliffs. Shingle paths and cut stone stairs wind across the whole map and link every area; turquoise shallows filling one edge, tide pools, wet boulders, tufts of salt grass and drying nets on frames. Points of interest along the shore: a low stone slipway into the water, an upturned rowboat on the shingle, a stack of crab pots against the rock, and a cliff stair cut into the headland.' },
    63: { region: 'carnival', name: 'Tallgrass Bend', scene: 'a river bend in deep tallgrass south of the festival grounds at dusk, the grass head-high and golden, a plank footbridge over slow green water, tent pennants tiny on the far horizon', floor: 'unused', floorFull: 'A golden tallgrass river route at dusk. Trampled grass paths wind across the whole map and link every area; head-high golden grass stands, a slow green river curving through, willow clumps, reed banks and dry hummocks. Points of interest along the paths: a plank footbridge over the river bend, a reed cutter’s stack, a flattened grass campsite, and tiny colourful festival pennants just visible on the far northern horizon.' },
    64: { region: 'darktemple', name: 'Lantern Vigil', scene: 'a vigil of cold stone lanterns along a dark scorched shinobi road at dusk, dead trees clawing at a violet sky, faint ember-light in the lantern mouths, purple mist pooling on the ground', floor: 'Points of interest along the paths: a long double row of cold stone lanterns lining the road, a bare offering table of plain stone, a dead-tree grove, and a low cracked flagstone circle.' },
    65: { region: 'frostfang', name: 'Eastwind Cirque', scene: 'a high glacier bowl scoured by east wind, blue-white ice walls curving around a frozen tarn, spindrift streaming off the rim, hardy pines clinging to the lower rocks', floor: 'Points of interest along the paths: a frozen tarn of glassy blue ice at the centre, a curving ice-wall rim, a wind-scoured snow ramp, a cluster of frost-rimed boulders, and a snow-buried pine stand.' },
    66: { region: 'volcano', name: 'Emberspine Ridge', scene: 'a jagged obsidian spine ridge deep in the ash fields, glowing orange lava seams running along its base, black grit drifting on the wind, the volcano’s smoking cone looming behind', floor: 'Points of interest along the paths: a jagged obsidian spine running across the map, glowing lava seams at its base, a cooled-lava arch to duck through, a sulphur vent field, and a black grit hollow.' },
};

// The six themed communal shrines — one raised by each village, one warding the
// Hollow Gate road, one for the Ancients (the hundred legacies). Mid-route
// placement (never a village-gate sector) so visiting is a small pilgrimage.
// `standee` is the transparent-cutout prop prompt (fal flux paints it on plain
// white; BiRefNet mattes it out). Keep ids stable — they are KV keys and MUST
// match shared/shrines.ts SHRINE_DEFS.
export const SHRINES = {
    'heartwood': { sector: 42, name: 'Heartwood Shrine (Ashen Leaf)', region: 'Ashen Leaf Deepwood', standee: 'an ancient mossy forest village shrine, a weathered grey stone pagoda-roofed shrine housing with teal-green roof tiles and a small red torii gate in front, a carved leaf emblem above its door, moss and pink cherry petals on the roof, two small stone lanterns with warm flames' },
    'tide': { sector: 34, name: 'Tidecaller Shrine (Stormveil)', region: 'Stormveil Heights', standee: 'a sea tide village shrine of weathered rope-bound driftwood pillars with a hanging bronze ship’s bell, a small azure-blue tiled roof, coiled sacred rope with paper streamers, a carved wave emblem, a barnacled stone base with seafoam-teal accents' },
    'frostveil': { sector: 53, name: 'Frostveil Shrine (Frostfang)', region: 'the Frostreach Shelf', standee: 'an ice village shrine carved from translucent blue glacier ice, glowing pale-blue inner light, a carved fang emblem in the ice face, frost lanterns at its base, fine snow dusting its roof' },
    'moonwell': { sector: 16, name: 'Moonwell Shrine (Moonshadow)', region: 'the Moonshadow Wilds', standee: 'a crescent-moon village shrine of pale moonstone, a carved crescent arch over a small dark reflecting basin, a carved moon emblem, floating violet crystal shards orbiting it, soft purple glow and luminous petals' },
    'hollowgate': { sector: 13, name: 'Hollow Gate Shrine', region: 'the Lantern Approach', standee: 'a black obsidian warding shrine, a dark stone shrine housing with a faint ominous violet portal glow inside its doorway, paper warding seals and sacred rope wrapped tightly around it, two small lanterns burning with purple flame, a cracked scorched stone base' },
    'ancients': { sector: 10, name: 'Shrine of the Ancients', region: 'the Watchruin Ridge', standee: 'an ancient weathered ruin shrine older than memory, moss-covered cracked pale stone, a ring of one hundred faint glowing golden carved glyphs around its base, a broken pillar leaning against it, old tree roots grown over one side, soft golden-white motes of light rising' },
};

export const REGIONS = REGION;

/** Ambience biome for a sector's NEW art (falls back to 'central'). */
export function ambienceFor(sector) {
    const art = SECTOR_ART[sector];
    return art ? REGION[art.region].ambience : 'central';
}

/** Full top-down floor place-description for a sector. `floorFull` overrides
 *  the region base entirely — for sectors whose identity fights their region's
 *  default terrain vocabulary (e.g. the grassy saddle inside the volcano band). */
export function floorPromptFor(sector) {
    const art = SECTOR_ART[sector];
    if (!art) return null;
    return art.floorFull ?? `${REGION[art.region].floorBase} ${art.floor}`;
}
