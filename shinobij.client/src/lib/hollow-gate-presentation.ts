import {
    HOLLOW_GATE_DEPTH,
    canonicalHollowGateDepth,
    hollowGateHoundName,
    type HollowGateHoundKind,
} from "../../../shared/hollow-gate-contract";

export type HollowGateFloorProfile = {
    floor: number;
    name: string;
    epithet: string;
    atmosphere: string;
    lore: string;
    houndName: string;
    houndEpithet: string;
    signature: string;
    storyTitle: string;
    storyEcho: string;
    shrineTitle: string;
    shrineRite: string;
    petTrace: string;
    accent: string;
    accentSoft: string;
    fog: string;
};

const FLOOR_PROFILES: readonly HollowGateFloorProfile[] = Object.freeze([
    {
        floor: 1,
        name: "Broken Threshold",
        epithet: "Where the shrine stopped welcoming shinobi",
        atmosphere: "Ash drifts through a torii split by something that entered from below.",
        lore: "Fresh claw marks cross older shinobi names. The first ward did not fail—it was opened.",
        houndName: hollowGateHoundName(1),
        houndEpithet: "Ashfang, Keeper of the First Ward",
        signature: "Cinder Pounce",
        storyTitle: "The Shinobi Roll",
        storyEcho: "A singed register lists every shinobi who crossed the threshold. The final name was carved from the other side.",
        shrineTitle: "Shrine of the Open Palm",
        shrineRite: "Warm ash rises from the basin and rebuilds the torch flame around your hand.",
        petTrace: "Violet pawprints end at a child-sized academy sandal, untouched by the ash.",
        accent: "#d97745",
        accentSoft: "rgba(217, 119, 69, 0.22)",
        fog: "rgba(91, 42, 27, 0.48)",
    },
    {
        floor: 2,
        name: "Lantern Ossuary",
        epithet: "Every flame remembers a missing name",
        atmosphere: "Blue lanterns ignite one by one, always a room behind your footsteps.",
        lore: "The keeper sealed the dead into lantern glass so the Hollow could not learn their faces.",
        houndName: hollowGateHoundName(2),
        houndEpithet: "Veilrunner, Hunter Between Lanterns",
        signature: "Lantern-Slip Rend",
        storyTitle: "The Memory Lantern",
        storyEcho: "A lantern repeats one keeper's warning: never answer when the dark calls you by a borrowed name.",
        shrineTitle: "Shrine of Remembered Names",
        shrineRite: "The lanterns speak the names the Hollow tried to erase, and the torch answers each one.",
        petTrace: "A spectral Hound moves between the lantern reflections without disturbing a single flame.",
        accent: "#4cc9c0",
        accentSoft: "rgba(76, 201, 192, 0.2)",
        fog: "rgba(15, 75, 81, 0.45)",
    },
    {
        floor: 3,
        name: "Drowned Reliquary",
        epithet: "The old vows sleep beneath black water",
        atmosphere: "Water beads upward from the floor and circles relics that refuse to sink.",
        lore: "Prayer tablets name a guardian hound that carried the shrine's last children to safety.",
        houndName: hollowGateHoundName(3),
        houndEpithet: "Shrineback, Bearer of Broken Vows",
        signature: "Reliquary Breaker",
        storyTitle: "The Sunken Cradle",
        storyEcho: "Beneath the black water rests a woven cradle. Guardian teeth marks score the handle where it was carried to safety.",
        shrineTitle: "Shrine Beneath the Tide",
        shrineRite: "Water climbs the torch instead of drowning it, leaving a steady blue-white flame.",
        petTrace: "Wet pawprints climb the wall and continue across the ceiling toward the reliquary.",
        accent: "#5d8fea",
        accentSoft: "rgba(93, 143, 234, 0.22)",
        fog: "rgba(28, 45, 94, 0.5)",
    },
    {
        floor: 4,
        name: "Moonless Kennels",
        epithet: "The chains are empty; the breathing is not",
        atmosphere: "Iron rings sway without wind. Something large circles beyond the torchlight.",
        lore: "These were guardian kennels before the Miasma taught loyalty to hunger.",
        houndName: hollowGateHoundName(4),
        houndEpithet: "Riftmaw, Last of the Bound Pack",
        signature: "Moonless Execution",
        storyTitle: "The Empty Collar Rack",
        storyEcho: "Every collar bears a guardian's name. Riftmaw's chain was broken from inside the kennel.",
        shrineTitle: "Shrine of the Unbroken Leash",
        shrineRite: "The empty collars chime together and the torch flares as if a pack has gathered around it.",
        petTrace: "Several sets of glowing tracks circle you; only one belongs to a creature that is still alive.",
        accent: "#a768e8",
        accentSoft: "rgba(167, 104, 232, 0.22)",
        fog: "rgba(70, 28, 100, 0.52)",
    },
    {
        floor: 5,
        name: "Alpha Sanctum",
        epithet: "The heart of the Gate is awake",
        atmosphere: "Every ward points inward. A second heartbeat answers your own.",
        lore: "The Alpha was once the shrine's protector. The Hollow Gate did not create it—it kept it waiting.",
        houndName: hollowGateHoundName(5, "boss"),
        houndEpithet: "The Guardian That Outlived Its Shrine",
        signature: "Gate-Eater's Howl",
        storyTitle: "The Last Guardian's Vow",
        storyEcho: "The final tablet names the Alpha not as a monster, but as the seal that chose to remain when every keeper fled.",
        shrineTitle: "The Inward-Facing Shrine",
        shrineRite: "Every ward turns toward the sanctum. The torch becomes a small violet sun in your grip.",
        petTrace: "A single immense pawprint pulses like a heartbeat. The Alpha already knows you are here.",
        accent: "#ef476f",
        accentSoft: "rgba(239, 71, 111, 0.22)",
        fog: "rgba(92, 18, 56, 0.56)",
    },
]);

export function hollowGateFloorProfile(floorRaw: unknown): HollowGateFloorProfile {
    const floor = canonicalHollowGateDepth(floorRaw);
    return FLOOR_PROFILES[floor - 1] ?? FLOOR_PROFILES[HOLLOW_GATE_DEPTH - 1];
}

export function hollowGateEncounterPresentation(floor: unknown, kind: HollowGateHoundKind) {
    const profile = hollowGateFloorProfile(floor);
    return {
        name: hollowGateHoundName(floor, kind),
        epithet: kind === "boss" ? profile.houndEpithet : profile.houndEpithet.split(",")[0],
        signature: profile.signature,
    };
}

export const HOLLOW_GATE_HOUND_COMBAT = "/hollow-gate/hollow-hound-idle.webp";
export const HOLLOW_GATE_ALPHA_CINEMATIC = "/hollow-gate/hollow-hound-alpha-cinematic.webp";

export function hollowGateHoundCombatImage(sharedImages: Readonly<Record<string, string>>): string {
    return sharedImages["shrine:hollow-hound"]
        || sharedImages["shrine:tile-hollow-beast"]
        || HOLLOW_GATE_HOUND_COMBAT;
}

export function hollowGateAlphaCinematicImage(sharedImages: Readonly<Record<string, string>>): string {
    return sharedImages["shrine:hollow-hound-alpha-cinematic"]
        || HOLLOW_GATE_ALPHA_CINEMATIC;
}
