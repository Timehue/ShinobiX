import type { FirstPactMainStep } from "../../../shared/first-pact-contract";
import {
    FIRST_PACT_ARCHITECTURE,
    type FirstPactDirection,
    type FirstPactNpcDefinition,
    type FirstPactPoint,
} from "./first-pact-world";

/**
 * Interiors for the six buildings the city already authors a public door on.
 *
 * A door the player can walk onto but never through reads worse than a solid
 * wall, so every `publicThreshold` in FIRST_PACT_ARCHITECTURE opens a room here
 * and the contract test refuses to let a new door ship without one. Rooms are
 * authored as character rows rather than placed furniture: the shell, the
 * furnishings and the walkable aisle are one artifact, so a room cannot drift
 * into a state where its only chair blocks its only door.
 */

export const FirstPactInteriorTile = {
    Void: 0,
    Floor: 1,
    Wall: 2,
    Door: 3,
    Mat: 4,
    Shelf: 5,
    Table: 6,
    Hearth: 7,
    Dais: 8,
    Pillar: 9,
} as const;

export type FirstPactInteriorTile = typeof FirstPactInteriorTile[keyof typeof FirstPactInteriorTile];

const LEGEND: Readonly<Record<string, FirstPactInteriorTile>> = {
    "#": FirstPactInteriorTile.Wall,
    ".": FirstPactInteriorTile.Floor,
    ",": FirstPactInteriorTile.Mat,
    D: FirstPactInteriorTile.Door,
    S: FirstPactInteriorTile.Shelf,
    T: FirstPactInteriorTile.Table,
    H: FirstPactInteriorTile.Hearth,
    "=": FirstPactInteriorTile.Dais,
    P: FirstPactInteriorTile.Pillar,
};

const WALKABLE = new Set<FirstPactInteriorTile>([
    FirstPactInteriorTile.Floor,
    FirstPactInteriorTile.Mat,
    FirstPactInteriorTile.Door,
    FirstPactInteriorTile.Dais,
]);

/** What this room has to say at one particular moment in the main story. */
export type FirstPactInteriorStepSpeech = Readonly<{
    step: FirstPactMainStep;
    lines: readonly string[];
}>;

export type FirstPactInteriorNpc = Readonly<{
    id: string;
    name: string;
    title: string;
    position: FirstPactPoint;
    facing: FirstPactDirection;
    palette: FirstPactNpcDefinition["palette"];
    portrait: FirstPactNpcDefinition["portrait"];
    /** Spoken whenever no step-specific lines apply. */
    lines: readonly string[];
    /** Why a given building is worth entering at a given point in the story. */
    stepLines?: readonly FirstPactInteriorStepSpeech[];
}>;

/** The one thing in the room worth crossing it for. */
export type FirstPactInteriorFocus = Readonly<{
    id: string;
    label: string;
    /** A solid furnishing; the player reads it from an adjacent walkable tile. */
    position: FirstPactPoint;
    lines: readonly string[];
}>;

export type FirstPactInterior = Readonly<{
    id: string;
    /** The FIRST_PACT_ARCHITECTURE placement whose public door opens this room. */
    buildingId: string;
    name: string;
    subtitle: string;
    rows: readonly string[];
    npcs: readonly FirstPactInteriorNpc[];
    focus: FirstPactInteriorFocus;
}>;

export const FIRST_PACT_INTERIORS: readonly FirstPactInterior[] = [
    {
        id: "unedited-stacks",
        buildingId: "high-court-archive",
        name: "The Unedited Stacks",
        subtitle: "High Court Archive",
        rows: [
            "###############",
            "#SSSSS.S.SSSSS#",
            "#.............#",
            "#SS.SSS.SSS.SS#",
            "#.............#",
            "#SS.SSS=SSS.SS#",
            "#.............#",
            "#SS.SSS.SSS.SS#",
            "#SSSSS...SSSSS#",
            "#SSSSS...SSSSS#",
            "#######D#######",
        ],
        npcs: [
            {
                id: "archive-warden-ashi",
                name: "Warden Ashi",
                title: "Keeper of the stacks",
                position: { x: 5, y: 4 },
                facing: "south",
                palette: "cyan",
                portrait: "scribe",
                lines: [
                    "The Court does not burn what it disagrees with. It reissues it, and the old wording stops being anywhere.",
                    "Vey leaves the discarded originals on the north shelf. I am paid to notice them and I have never once managed it.",
                ],
                stepLines: [
                    {
                        step: "meet-scribe-vey",
                        lines: [
                            "You want the scribe, and the scribe is not in here. He works on the steps outside, where the Court cannot claim he was consulted.",
                            "Ask him what the city looked like before the last revision. He is the only official left who will answer that honestly.",
                        ],
                    },
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "Three requests came down this week to reissue the weather record, the bell log and the water tallies.",
                            "Whatever you are noticing out there, someone in this building is already writing the version that makes it ordinary.",
                        ],
                    },
                    {
                        step: "recover-withheld-record",
                        lines: [
                            "The Menagerie pulled its obedience slate from these stacks, and the original underneath it never came back.",
                            "If Vey has found it, take it out of this district before an official offers to hold it for safekeeping.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "discard-shelf",
            label: "Read the discard shelf",
            position: { x: 7, y: 1 },
            lines: [
                "Nine copies of one census, each kinder than the last. The earliest counts the bonded beasts as witnesses. The newest counts them as equipment.",
                "Nothing was destroyed. A city can lose its own memory while every page is still on the shelf.",
            ],
        },
    },
    {
        id: "kept-ledgers",
        buildingId: "west-record-hall",
        name: "The Hall of Kept Ledgers",
        subtitle: "West Record Hall",
        rows: [
            "#############",
            "#SSSS.S.SSSS#",
            "#...........#",
            "#S.SS...SS.S#",
            "#...........#",
            "#S.SS.=.SS.S#",
            "#...........#",
            "#SSSS...SSSS#",
            "######D######",
        ],
        npcs: [
            {
                id: "ledger-keeper-mun",
                name: "Ledger-keeper Mun",
                title: "Hall of kept ledgers",
                position: { x: 4, y: 4 },
                facing: "south",
                palette: "amber",
                portrait: "registrar",
                lines: [
                    "Every pact the Court has ever signed is in this room, and every one of them is still being signed.",
                    "A pact that can be revised after the fact is not a pact. It is a schedule. Tell the Registrar I said so.",
                ],
                stepLines: [
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "The east bell has a ringing log going back four hundred years, and every entry names the warden who pulled it.",
                            "Last week the entry names nobody. It was written anyway, in an official hand, the same morning it happened.",
                        ],
                    },
                    {
                        step: "return-to-vey",
                        lines: [
                            "Three corrections were filed against your three facts before you had finished collecting them.",
                            "That is not the Court being quick. That is the Court knowing what you were going to find.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "standing-ledger",
            label: "Read the standing ledger",
            position: { x: 6, y: 1 },
            lines: [
                "The oldest entry is four words long, and it is the only one nobody has amended: they came when called.",
                "Beneath it, in a later hand, someone has written the correction the Court prefers: they were brought.",
            ],
        },
    },
    {
        id: "council-annex",
        buildingId: "east-council-annex",
        name: "The Council Annex",
        subtitle: "East Council Annex",
        rows: [
            "###########",
            "#SSS.S.SSS#",
            "#.........#",
            "#S.SS.SS.S#",
            "#.........#",
            "#S.T.=.T.S#",
            "#.........#",
            "#SSS...SSS#",
            "#####D#####",
        ],
        npcs: [
            {
                id: "annex-attendant-sero",
                name: "Attendant Sero",
                title: "Council annex",
                position: { x: 3, y: 4 },
                facing: "south",
                palette: "slate",
                portrait: "registrar",
                lines: [
                    "The council sits above us and votes on wording. What they decide here becomes what happened.",
                    "You are the first visitor this season who arrived without an appointment. Do not let them give you one.",
                ],
                stepLines: [
                    {
                        step: "return-to-vey",
                        lines: [
                            "The council has moved to hear an item called the harmless explanation of recent weather, and it sits tomorrow.",
                            "Whatever you are carrying to the scribe, carry it tonight. After tomorrow it is merely a disagreement with the record.",
                        ],
                    },
                    {
                        step: "make-first-pact",
                        lines: [
                            "The wording of your pact will be argued in this room long after you have left the city.",
                            "So choose a sentence that survives being repeated by people who wish you had said something else.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "sealed-docket",
            label: "Read the sealed docket",
            position: { x: 5, y: 1 },
            lines: [
                "A single motion, tabled and never heard: that the bonded be asked before they are counted.",
                "The seal is unbroken. It has been tabled for two hundred years, which is one way to answer a question.",
            ],
        },
    },
    {
        id: "guardian-hall",
        buildingId: "guardian-hall",
        name: "The Guardian Hall",
        subtitle: "Guardian Gardens",
        rows: [
            "###############",
            "#SSSSS.T.SSSSS#",
            "#.............#",
            "#P.P..P.P..P.P#",
            "#.............#",
            "#P.P..P=P..P.P#",
            "#.............#",
            "#P.P..P.P..P.P#",
            "#SSS.......SSS#",
            "#######D#######",
        ],
        npcs: [
            {
                id: "oathkeeper-bel",
                name: "Oathkeeper Bel",
                title: "Guardian hall",
                position: { x: 5, y: 4 },
                facing: "south",
                palette: "jade",
                portrait: "keeper",
                lines: [
                    "Every guardian who stood in this hall swore the same sentence, and not one of them was asked to swear it twice.",
                    "The Court wants the oath renewed each season now. An oath you can be made to repeat is a leash with better manners.",
                ],
                stepLines: [
                    {
                        step: "challenge-court-menagerie",
                        lines: [
                            "The Menagerie will meet you with four that were never asked. They fight well, and they fight because they were told to.",
                            "Yours will fight badly the moment they stop choosing it. Give them the reason before the gate opens, not after.",
                        ],
                    },
                    {
                        step: "make-first-pact",
                        lines: [
                            "Every guardian who swore in this hall learned the same thing on the same day: the oath binds the one who speaks it.",
                            "If your pact binds only the four standing behind you, then the Court has already written it for you.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "oath-stone",
            label: "Read the oath stone",
            position: { x: 7, y: 1 },
            lines: [
                "The stone carries one line, cut deep enough to outlast the hall: we are answerable to what we bound.",
                "Someone has begun a second line beneath it and stopped. The chisel marks are fresh, and they are shaking.",
            ],
        },
    },
    {
        id: "keepers-lodge",
        buildingId: "garden-lodge",
        name: "The Keeper's Lodge",
        subtitle: "Guardian Gardens",
        rows: [
            "#############",
            "#SSS.HTH.SSS#",
            "#...........#",
            "#S.T...T.S..#",
            "#...........#",
            "#S.,,,=,,,.S#",
            "#...........#",
            "#S.T...T.S..#",
            "#SSS.....SSS#",
            "######D######",
        ],
        npcs: [
            {
                id: "lodge-steward-nia",
                name: "Steward Nia",
                title: "Keeper's lodge",
                position: { x: 4, y: 4 },
                facing: "south",
                palette: "rose",
                portrait: "keeper",
                lines: [
                    "The lodge keeps the bonding roster. Names on the left, and on the right the name each one answered to first.",
                    "Half the right-hand column is blank now. The Court says the omission tidies the record. I say a name is not clutter.",
                ],
                stepLines: [
                    {
                        step: "challenge-court-menagerie",
                        lines: [
                            "The Menagerie four came through this lodge as yearlings, and every right-hand column on their line is blank.",
                            "They were never asked. Remember that when one of them will not stop, and you are deciding what it is.",
                        ],
                    },
                    {
                        step: "recover-withheld-record",
                        lines: [
                            "The handlers the Court calls the Withheld kept this roster in the old ink. That is the whole of their crime.",
                            "Whatever original you are carrying will read like this book. Do not let anyone tell you it is sentimental.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "bonding-roster",
            label: "Read the bonding roster",
            position: { x: 6, y: 1 },
            lines: [
                "The roster is kept in two inks. The old hand records which of the pair chose the other, and it is not always the handler.",
                "The new hand records only ownership, and it is faster to write. That is the entire argument the Court has ever made.",
            ],
        },
    },
    {
        id: "tea-archive",
        buildingId: "garden-court-pavilion",
        name: "The Tea Archive",
        subtitle: "Guardian Gardens",
        rows: [
            "#############",
            "#SS.H.T.H.SS#",
            "#...........#",
            "#S.,,,,,,,.S#",
            "#..,,,=,,,..#",
            "#S.,,,,,,,.S#",
            "#..T.....T..#",
            "#SS.......SS#",
            "######D######",
        ],
        npcs: [
            {
                id: "tea-apprentice-juno",
                name: "Juno",
                title: "Kaio's apprentice",
                position: { x: 4, y: 3 },
                facing: "south",
                palette: "jade",
                portrait: "citizen",
                lines: [
                    "Old Kaio takes his tea outside now. He says the room has started agreeing with him too quickly.",
                    "I write down what the visitors say before they leave. By evening the official version has usually improved it.",
                ],
                stepLines: [
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "No animal in this quarter will drink from the north basin, and that water is cleaner than what we pour in this room.",
                            "Follow the pipe down to the Gateworks and ask Tam what the intake is pulling toward. He has stopped writing the answer down.",
                        ],
                    },
                    {
                        step: "meet-engineer-tam",
                        lines: [
                            "Tam came here after his last shift and drank nothing. He asked whether the kettle notes are sent to the Court.",
                            "They are not. I told him so, and he talked for an hour. Most of it is in the case behind you now.",
                        ],
                    },
                ],
            },
        ],
        focus: {
            id: "kettle-notes",
            label: "Read the kettle notes",
            position: { x: 6, y: 1 },
            lines: [
                "Two hundred years of small talk, kept because nobody thought it worth editing. It is the most honest archive in the city.",
                "The last three seasons share one complaint in every hand: the animals have stopped drinking from the north basin.",
            ],
        },
    },
] as const;

export type FirstPactInteriorId = typeof FIRST_PACT_INTERIORS[number]["id"];

const BY_BUILDING = new Map<string, FirstPactInterior>(
    FIRST_PACT_INTERIORS.map((interior) => [interior.buildingId, interior]),
);
const BY_DOOR = new Map<string, FirstPactInterior>();
for (const placement of FIRST_PACT_ARCHITECTURE) {
    const threshold = placement.publicThreshold;
    const interior = BY_BUILDING.get(placement.id);
    if (threshold && interior) BY_DOOR.set(`${threshold.x},${threshold.y}`, interior);
}

/** The lines this keeper has for the player right now. */
export function firstPactInteriorNpcLines(
    npc: FirstPactInteriorNpc,
    mainStep: FirstPactMainStep,
): readonly string[] {
    return npc.stepLines?.find((entry) => entry.step === mainStep)?.lines ?? npc.lines;
}

export function firstPactInterior(id: string): FirstPactInterior | null {
    return FIRST_PACT_INTERIORS.find((interior) => interior.id === id) ?? null;
}

/** The room a world tile opens into, or null for ordinary ground. */
export function firstPactInteriorAtDoor(point: FirstPactPoint): FirstPactInterior | null {
    return BY_DOOR.get(`${point.x},${point.y}`) ?? null;
}

/** The world tile this room returns the player to. */
export function firstPactInteriorExit(interior: FirstPactInterior): FirstPactPoint {
    const placement = FIRST_PACT_ARCHITECTURE.find((entry) => entry.id === interior.buildingId);
    const threshold = placement?.publicThreshold;
    if (!threshold) throw new Error(`${interior.id} has no world door`);
    return { x: threshold.x, y: threshold.y };
}

export function firstPactInteriorSize(interior: FirstPactInterior): { width: number; height: number } {
    return { width: interior.rows[0]?.length ?? 0, height: interior.rows.length };
}

export function firstPactInteriorTileAt(interior: FirstPactInterior, x: number, y: number): FirstPactInteriorTile {
    const row = interior.rows[y];
    if (!row) return FirstPactInteriorTile.Void;
    return LEGEND[row[x] ?? ""] ?? FirstPactInteriorTile.Void;
}

export function isFirstPactInteriorWalkable(interior: FirstPactInterior, x: number, y: number): boolean {
    return WALKABLE.has(firstPactInteriorTileAt(interior, x, y));
}

/** The room's single door cell, in room coordinates. */
export function firstPactInteriorDoor(interior: FirstPactInterior): FirstPactPoint {
    for (let y = 0; y < interior.rows.length; y += 1) {
        const x = interior.rows[y].indexOf("D");
        if (x >= 0) return { x, y };
    }
    throw new Error(`${interior.id} has no door cell`);
}

/** Where the player stands on arrival: one step inside the door. */
export function firstPactInteriorEntry(interior: FirstPactInterior): FirstPactPoint {
    const door = firstPactInteriorDoor(interior);
    return { x: door.x, y: door.y - 1 };
}

export function findFirstPactInteriorPath(
    interior: FirstPactInterior,
    from: FirstPactPoint,
    to: FirstPactPoint,
    blocked: ReadonlySet<string> = new Set(),
): FirstPactPoint[] {
    if (!isFirstPactInteriorWalkable(interior, from.x, from.y)) return [];
    if (!isFirstPactInteriorWalkable(interior, to.x, to.y)) return [];
    const key = (point: FirstPactPoint) => `${point.x},${point.y}`;
    const previous = new Map<string, FirstPactPoint>();
    const seen = new Set<string>([key(from)]);
    let frontier: FirstPactPoint[] = [from];
    while (frontier.length) {
        const next: FirstPactPoint[] = [];
        for (const cell of frontier) {
            if (cell.x === to.x && cell.y === to.y) {
                const path: FirstPactPoint[] = [cell];
                let cursor = key(cell);
                while (previous.has(cursor)) {
                    const step = previous.get(cursor)!;
                    path.unshift(step);
                    cursor = key(step);
                }
                return path;
            }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const neighbour = { x: cell.x + dx, y: cell.y + dy };
                const neighbourKey = key(neighbour);
                if (seen.has(neighbourKey)) continue;
                if (blocked.has(neighbourKey)) continue;
                if (!isFirstPactInteriorWalkable(interior, neighbour.x, neighbour.y)) continue;
                seen.add(neighbourKey);
                previous.set(neighbourKey, cell);
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return [];
}

/** Cells the room's own inhabitants are standing on. */
export function firstPactInteriorOccupied(interior: FirstPactInterior): Set<string> {
    return new Set(interior.npcs.map((npc) => `${npc.position.x},${npc.position.y}`));
}

/** Walkable cells touching a solid furnishing, for reading it from the aisle. */
export function firstPactInteriorApproaches(interior: FirstPactInterior, point: FirstPactPoint): FirstPactPoint[] {
    return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        .map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy }))
        .filter((cell) => isFirstPactInteriorWalkable(interior, cell.x, cell.y));
}
