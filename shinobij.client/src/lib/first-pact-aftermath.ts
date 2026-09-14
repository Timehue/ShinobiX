import type { FirstPactAftermathId, FirstPactProgress, FirstPactVowId } from "../../../shared/first-pact-contract";
import type { Pet } from "../types/pet";

export type FirstPactCompanionView = {
    id: string;
    /** Name in the server-sealed vow record. */
    historicalName: string | null;
    /** Current name, available only while this pet is still present. */
    currentName: string | null;
    role?: string;
    available: boolean;
};

const cleanName = (value: unknown) => String(value ?? "").trim().slice(0, 48);
const PET_ROLES = new Set(["defender", "tracker", "assassin", "sage"]);
const AFTERMATH_FINDINGS = new Set<FirstPactAftermathId>([
    "writ-silencing", "writ-audit", "writ-pruning", "writ-impound",
]);

export function resolveFirstPactCompanions(
    progress: FirstPactProgress,
    pets: readonly Pet[],
    presentPetIds?: ReadonlySet<string>,
): FirstPactCompanionView[] {
    const ids = progress.mainQuest.pactCompanionIds;
    if (!ids) return [];
    const historicalNames = progress.mainQuest.pactCompanionNames ?? ids.map(() => null);
    const byId = new Map(pets.map((pet) => [pet.id, pet]));
    return ids.map((id, index) => {
        const pet = byId.get(id);
        const available = !!pet && (presentPetIds === undefined || presentPetIds.has(id));
        const currentName = available ? cleanName(pet?.nickname) || cleanName(pet?.name) : "";
        const historicalName = cleanName(historicalNames[index]) || null;
        const role = available ? cleanName(pet?.role).toLowerCase() : "";
        return {
            id,
            historicalName,
            currentName: currentName || null,
            ...(PET_ROLES.has(role) ? { role } : {}),
            available,
        };
    });
}

const join = (names: readonly string[]) => {
    if (!names.length) return "";
    return names.length === 1
        ? names[0]
        : names.length === 2
            ? names.join(" and ")
            : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
};

const historicalRecord = (companions: readonly FirstPactCompanionView[]) => {
    const names = companions.flatMap((entry) => entry.historicalName ? [entry.historicalName] : []);
    const unknown = companions.length - names.length;
    return { names, unknown, joined: join(names) };
};

const presentCompanions = (companions: readonly FirstPactCompanionView[]) =>
    companions.filter((entry) => entry.available && entry.currentName);

export function firstPactCompanionCourtLines(
    progress: FirstPactProgress,
    companions: readonly FirstPactCompanionView[],
): string[] {
    if (!progress.mainQuest.pactCompanionIds || progress.finalTrial.wins < 1) return [];
    const present = presentCompanions(companions);
    if (present.length < 4) {
        const record = historicalRecord(companions);
        return [record.joined
            ? record.unknown
                ? `Orin keeps four lines on the pact docket. Vey's copy names ${record.joined} and leaves ${record.unknown} line${record.unknown === 1 ? "" : "s"} blank. “I cannot fill what her copy lost.”`
                : `Orin keeps four lines on the pact docket. Vey's copy names ${record.joined}. “Those are the names I will call when the Court sits.”`
            : "Orin keeps four blank lines on the pact docket. “Vey's surviving copy gives me no names. I will not pretend it does.”"];
    }
    const [first, second, third, fourth] = present.map((entry) => entry.currentName!);
    const lines: Record<FirstPactVowId, string[]> = {
        "open-road": [
            `${first} checks the west gate whenever it opens. ${second} stays near the formation without blocking that path.`,
            `${third} waits near the water while ${fourth} faces the sand. Orin leaves four spaces on the docket instead of writing one disposition for the group.`,
        ],
        "shared-reason": [
            `${first} watches you when Orin reads your reason aloud. ${second} watches the opposing gate instead.`,
            `${third} stays near you while ${fourth} turns toward the opposing gate. The same reason did not make them wait alike.`,
        ],
        "kept-future": [
            `${first} and ${second} chose opposite sides of the starting line. Neither yielded the place first.`,
            `${third} waits beside the reserve gate. ${fourth} keeps to the rail. Vey has left both positions in the copy.`,
        ],
    };
    return progress.mainQuest.pactVow ? lines[progress.mainQuest.pactVow] : [];
}

export function firstPactCompanionEverydayLines(
    npcId: string,
    progress: FirstPactProgress,
    companions: readonly FirstPactCompanionView[],
): string[] {
    if (!progress.mainQuest.pactCompanionIds || progress.mainStep !== "challenge-court-echo") return [];
    const present = presentCompanions(companions);
    if (npcId === "scribe-vey") {
        const record = historicalRecord(companions);
        return [record.joined
            ? `Vey has entered ${record.joined} beneath your vow${record.unknown ? ` and left ${record.unknown} line${record.unknown === 1 ? "" : "s"} blank` : " on four separate lines"}. She asks where each one stood, then leaves room for the answer to change.`
            : "Vey keeps four blank lines beneath your vow. “The names are gone from this copy,” she says. “The spaces stay.”"];
    }
    if (!present.length) return [];
    const first = present[0].currentName!;
    const second = present[1]?.currentName;
    if (!second) return npcId === "keeper-sena"
        ? [`Sena leaves the yard gate unlatched. ${first} chooses a place near the cedar; she leaves three bowls untouched.`]
        : [];
    if (npcId === "keeper-sena") {
        if (progress.mainQuest.pactVow === "open-road") return [
            `Sena leaves the yard gate unlatched. ${first} checks the opening; ${second} settles by the cedar. “I can keep a place without closing it,” she says.`,
        ];
        if (progress.mainQuest.pactVow === "shared-reason") return [
            `Sena reads your reason once. ${first} stays near her; ${second} turns toward the street. “Same words,” she says. “Two answers. Good.”`,
        ];
        return [
            `${first} stops at the water rail while ${second} circles to the shade. Sena moves neither bowl. “They can disagree without making me choose a winner.”`,
        ];
    }
    return [];
}

export type FirstPactAftermathScene = {
    id: FirstPactAftermathId;
    npcId: string;
    label: string;
    title: string;
    lines: string[];
};

export function firstPactAftermathScene(
    id: FirstPactAftermathId,
    progress: FirstPactProgress,
    companions: readonly FirstPactCompanionView[],
): FirstPactAftermathScene {
    const present = presentCompanions(companions);
    const first = present[0]?.currentName;
    const second = present[1]?.currentName;
    const vowMoment = (
        openRoad: string,
        sharedReason: string,
        keptFuture: string,
        onePresent: string,
        nonePresent: string,
    ) => !first
        ? nonePresent
        : !second
            ? onePresent
            :
        progress.mainQuest.pactVow === "open-road"
            ? openRoad
            : progress.mainQuest.pactVow === "shared-reason"
                ? sharedReason
                : progress.mainQuest.pactVow === "kept-future"
                    ? keptFuture
                    : onePresent;
    const scenes: Record<FirstPactAftermathId, Omit<FirstPactAftermathScene, "id">> = {
        "writ-silencing": {
            npcId: "bellwarden-isu",
            label: "Inspect the rejected muzzle beneath the bell",
            title: "The bell rope",
            lines: [
                "One rejected muzzle hangs from a peg below Isu's bell rope. Its inventory tag is blank. Isu has tied the relief warden's refusal note through the buckle so the next detail must remove both.",
                vowMoment(
                    `${first} backs toward the open street when the leather swings. ${second} stays beside Isu. She takes the muzzle down and leaves both ways clear.`,
                    `${first} watches Isu's hands. ${second} watches the bell above them. They stay for the same work without fixing on the same danger.`,
                    `${first} stops before the peg; ${second} passes under it. Isu moves the muzzle aside for the one who would not.`,
                    `${first} stops when the muzzle swings. Isu takes it down before she reaches for the rope.`,
                    "Isu takes down the muzzle and checks the relief note is still tied through its buckle.",
                ),
                "“Relief comes before dusk,” Isu says. “I want her to tie the next refusal here herself.”",
            ],
        },
        "writ-audit": {
            npcId: "market-rho",
            label: "Inspect Rho's corrected stock book",
            title: "The separate column",
            lines: [
                "Rho turns the stock book around. The old STOCK heading has one red line through it. Beside the feed tally, each hauling beast now has a name board and a blank space for its own work.",
                vowMoment(
                    `${first} wanders to the open arcade and returns. ${second} has remained beside the name boards; Rho makes room for both at the counter.`,
                    `${first} settles by the boards while ${second} keeps watch on the feed scales. Rho leaves both places in his account.`,
                    `${first} waits by the open counter. ${second} chooses the crowded side by the haulers. Rho does not move either one for the clerk's convenience.`,
                    `Rho clears a place for ${first} beside the name boards, then rechecks the feed weight without moving that place.`,
                    "Rho compares every name board with the feed tally, one line at a time.",
                ),
                "“The auditor comes tomorrow,” Rho says. “Hold this page open while I check the last two loads.”",
            ],
        },
        "writ-pruning": {
            npcId: "garden-keeper",
            label: "Inspect the branch left outside the old plan",
            title: "The unplanned branch",
            lines: [
                "Kaio lays the old pruning diagram on the path. A living branch crosses its straight ink border and holds three warm nests above the paper.",
                vowMoment(
                    `${first} follows the shade beyond the path and comes back. ${second} waits under the branch. Kaio keeps the garden gate open.`,
                    `${first} watches the nests while ${second} watches Kaio unfold the plan. They keep the same vigil from different sides.`,
                    `${first} waits beneath the branch. ${second} chooses the far side of the path. Kaio marks both places outside the old line.`,
                    `${first} waits beneath the living branch. Kaio shifts the old diagram out of the drip from the nests.`,
                    "Kaio moves the old diagram out from under the nests and weighs its corners with four clean stones.",
                ),
                "“North crew comes at dawn,” Kaio says. “I will put this diagram in their hands before anyone lifts a saw.”",
            ],
        },
        "writ-impound": {
            npcId: "kennel-hand",
            label: "Inspect the opened kennel alleys",
            title: "Both gates open",
            lines: [
                "Pell has wedged both kennel gates open. Returned name boards hang at animal height; the impound tags lie face down in a wash basin.",
                vowMoment(
                    `${first} takes the alley to the street, pauses, and comes back by the cedar. ${second} never leaves the yard. Pell closes neither gate.`,
                    `${first} follows Pell toward the name boards while ${second} waits by the frightened animals. The work holds both of them.`,
                    `${first} takes the near alley. ${second} chooses the longer way around; Pell waits until they meet at the cedar.`,
                    `${first} tests the near alley while Pell sets the next returned name board at animal height.`,
                    "Pell sets the returned name boards in a dry row and leaves both alleys clear.",
                ),
                "“Four are still behind the inner gate,” Pell says. “Help me set their boards before night watch.”",
            ],
        },
        "vale-stable": {
            npcId: "keeper-sena",
            label: "Inspect Vale Stable's winner board",
            title: "Vale's public entry",
            lines: [
                "The assessor's transfer order has been folded under one short table leg. Above it, Sena has fixed the winner board to the cedar rail with every beast's chosen name still visible.",
                vowMoment(
                    `${first} slips through the unlatched yard gate and returns when ready. ${second} stays at the rail. Sena counts neither choice against them.`,
                    `${first} stays by the winner board while ${second} goes to the water pan. The same victory gives them different work.`,
                    `${first} stops at the rail. ${second} goes straight to the water pan. Sena leaves both names in the order they arrived.`,
                    `${first} chooses the cedar rail over the open stall. Sena leaves both spaces ready and checks a split hinge.`,
                    "Sena tests each stall latch, then leaves the yard gate open while she works.",
                ),
                "“The yard is ours through the week,” Sena says. “Two stall doors still drag. Hold this hinge while I reset it.”",
            ],
        },
    };
    return { id, ...scenes[id] };
}

export function firstPactAftermathForNpc(
    npcId: string,
    progress: FirstPactProgress,
    companions: readonly FirstPactCompanionView[],
): FirstPactAftermathScene | null {
    const available: FirstPactAftermathId[] = [
        ...progress.findings.filter((id): id is FirstPactAftermathId => AFTERMATH_FINDINGS.has(id as FirstPactAftermathId)),
        ...(progress.stableQuest.status === "complete" ? ["vale-stable" as const] : []),
    ];
    const id = available.find((entry) => firstPactAftermathScene(entry, progress, companions).npcId === npcId);
    return id ? firstPactAftermathScene(id, progress, companions) : null;
}

export function firstPactEpilogueCompanionCopy(companions: readonly FirstPactCompanionView[]): string {
    if (!companions.length) return "Vey's copy keeps four places for the companions who made the pact, though this older record cannot recover their names.";
    const present = companions.filter((entry) => entry.available && entry.currentName);
    const presentNames = present.flatMap((entry) => entry.currentName ? [entry.currentName] : []);
    const record = historicalRecord(companions);
    const crossing = presentNames.length
        ? `${join(presentNames)} ${presentNames.length === 1 ? "crosses" : "cross"} with you. `
        : "";
    if (!record.names.length) return `${crossing}Vey's copy keeps four places, though it cannot recover the names written there.`;
    return record.unknown
        ? `${crossing}Vey's copy keeps ${record.joined} beside the vow and leaves ${record.unknown} place${record.unknown === 1 ? "" : "s"} unnamed.`
        : `${crossing}Vey's copy keeps ${record.joined} beside the vow.`;
}
