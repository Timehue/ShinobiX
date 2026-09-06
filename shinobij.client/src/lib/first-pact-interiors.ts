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
                    "Revised pages go into the public stacks. The pages they replace come to me for pulping.",
                    "Vey uses the north shelf before I count them. I need you to keep looking away while I continue failing to notice.",
                ],
                stepLines: [
                    {
                        step: "meet-scribe-vey",
                        lines: [
                            "Vey is on the steps outside. She works there so the council cannot list her as attending its revisions.",
                            "Show her your seal. If it resembles an older threshold mark, she will say what she can prove and stop there.",
                        ],
                    },
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "I have three rush revisions today: the bell log, the intake totals, and the north-wall bird count.",
                            "Get the witnesses' words to Vey before I am ordered to shelve the replacements.",
                        ],
                    },
                    {
                        step: "recover-withheld-record",
                        lines: [
                            "The Menagerie borrowed an obedience slate. The older page beneath it was never returned.",
                            "If Vey recovered that page, take it to Tam now. I cannot misplace the same original twice.",
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
                "Nine versions of one census. The first counts bonded beasts as witnesses. The latest lists them as equipment.",
                "Every version remains legible. Only the latest is indexed for readers.",
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
                    "I maintain signed pacts. Lately the council sends me amendments dated earlier than the signatures.",
                    "That is falsification with a ribbon on it. Tell Orin I said exactly that.",
                ],
                stepLines: [
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "Four hundred years of east-bell entries name the hand on the rope. Last week's entry has no name.",
                            "The ink is official and the time is precise. Ask Isu why the hand is missing.",
                        ],
                    },
                    {
                        step: "return-to-vey",
                        lines: [
                            "Corrections for the bell, intake, and bird count reached my desk before your report reached Vey.",
                            "I logged the receipt times. Take them to her; she will know what the sequence proves.",
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
                "The oldest entry reads: they came when called.",
                "A later hand added: they were brought. The addition has no witness signature.",
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
                    "The council is revising three incident reports upstairs, and I am expected to produce witnesses who agree.",
                    "You arrived without an appointment. Keep it that way or they will hold you here until their wording is ready.",
                ],
                stepLines: [
                    {
                        step: "return-to-vey",
                        lines: [
                            "Tomorrow's first item is titled Harmless Explanations for Recent Weather. The bell and intake are both attached.",
                            "Get your three witness statements to Vey tonight. Tomorrow the council will call them late objections.",
                        ],
                    },
                    {
                        step: "make-first-pact",
                        lines: [
                            "A council clerk has already requested the wording of your pact.",
                            "Keep it short. Every extra clause gives them somewhere to hide an amendment.",
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
                "One unopened motion asks that bonded beasts be consulted before a census assigns them.",
                "The seal dates back two hundred years. No hearing date was ever added.",
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
                    "A guardian swears once in this hall. The oath binds the speaker for life.",
                    "Now the Court orders seasonal renewals. I want the old rule restored before my novices are made to swear on command.",
                ],
                stepLines: [
                    {
                        step: "challenge-court-menagerie",
                        lines: [
                            "The Menagerie four were trained here. No keeper recorded what they chose.",
                            "Tell your four why you are entering before the gate opens. If one refuses, change the team.",
                        ],
                    },
                    {
                        step: "make-first-pact",
                        lines: [
                            "Remember the oath stone: the speaker is the one who becomes bound.",
                            "Promise what you will do. Do not turn your companions into the terms of your promise.",
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
                "One line is cut deep into the stone: we are answerable to what we bound.",
                "A fresh second line stops after three letters. The last chisel mark skids sideways.",
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
                    "I keep the bonding roster: handler on the left, the name their companion first answered to on the right.",
                    "The Court blanked half the right column. I am copying those names onto cloth tags before it takes the book.",
                ],
                stepLines: [
                    {
                        step: "challenge-court-menagerie",
                        lines: [
                            "The Menagerie four came through here as yearlings. Their chosen-name spaces were blank from the start.",
                            "They were never asked. If one keeps fighting after the handler falls, remember what training without an answer can do.",
                        ],
                    },
                    {
                        step: "recover-withheld-record",
                        lines: [
                            "The handlers called Withheld used the old two-name form. That refusal is what the Court charged them for.",
                            "Compare your original with this roster. Matching ink and spacing will support Vey's reading.",
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
                "The older ink records which partner chose first. It is not always the handler.",
                "The newer ink has one ownership field. It leaves no place for an animal's answer.",
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
                    "Kaio takes his tea outside because I kept finishing his complaints for him. He was right to be annoyed.",
                    "Now I write each visitor's exact words before I pour. Help me keep the kettle notes away from the council runners.",
                ],
                stepLines: [
                    {
                        step: "investigate-city-omens",
                        lines: [
                            "Nothing in the garden will drink from the north basin, though I scrubbed it twice and changed the leaves.",
                            "The pipe runs to Tam's lower intake. Ask her what is pulling the water; she no longer puts the answer on Court forms.",
                        ],
                    },
                    {
                        step: "meet-engineer-tam",
                        lines: [
                            "Tam came after her last shift, refused the basin water, and asked whether I send these notes to the Court.",
                            "I do not. Once she believed me, she gave me an hour of pressure readings. They are in the case behind you.",
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
                "Two hundred years of orders, gossip, and complaints, recorded beside the tea served that day.",
                "Across the last three seasons, different hands repeat one complaint: animals will not drink from the north basin.",
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
