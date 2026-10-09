/*
 * Sector War Card and Pet tables: what each side reads while it waits, and what
 * a finished duel did to the war.
 *
 * Pure on purpose. The screens that use it (SectorWarCardBattle over the shared
 * CardClashDuelScreen, SectorWarPetBattle over the shared PetDuelReplayScreen)
 * pull in stylesheets and the 3D arena, which node tests cannot load; the
 * decisions that were wrong live here, where a test can read them directly.
 *
 * The server says which seat (if any) the viewer holds (`viewerSide`), whether
 * they may answer an open table (`canAnswer` / `seatOpen`), and whether a
 * finished duel counted for the war (`warResult`). Nothing here re-derives
 * those from names or clocks.
 */
import type { Screen } from "../types/core";

/** A Card table answer that is not a match yet: which wait it is. An open-world
 *  duel also names the other duelist and the one who started it. */
export type SectorTableWaiting = { status?: string; viewerSide?: string | null; opponent?: string | null; initiator?: string };

/** What a finished duel did to the war (api/village/sector-card.ts, sector-pet.ts). */
export type SectorWarResult = { scored: boolean; points?: number; reason?: string };

/** The duel ended after the war did, or belongs to an earlier war on the
 *  sector: it never counted, and must never read as scored. */
export function warResultUncounted(result: SectorWarResult | undefined): boolean {
    return !!result && !result.scored && result.reason !== "draw";
}

const UNCOUNTED_NOTE = "It did not count: the war on this sector was already over when it ended.";

/** Where a table's Back goes, in words. A table opened from the world map goes
 *  back to the world map; it used to say "Back to War Map" either way. */
export function sectorTableBackLabel(backScreen: Screen): string {
    return backScreen === "worldMap" ? "Back to World Map" : "Back to War Map";
}

/** The Card table's waiting copy, for the wait the server reports. The old
 *  single line ("Waiting for the defending challenger to join.") was shown to
 *  the DEFENDER too, who was the defending challenger. */
export function sectorCardWaitingNote(waiting: SectorTableWaiting): string {
    if (waiting.status === "awaiting-defender") {
        return waiting.viewerSide === "p1"
            ? "Your table is open. Waiting for a defender of this sector to answer."
            : "An attacker has opened this sector's table. Taking the defender's seat…";
    }
    if (waiting.status === "awaiting-attacker") {
        return "No attacker has opened this sector's table yet. You'll be seated the moment one does.";
    }
    // An open-world duel (api/village/sector-card.ts runEngage): one player
    // challenged another standing in the sector, and the challenged player's
    // client takes its seat as soon as it hears.
    if (waiting.status === "awaiting-target") {
        const opponent = waiting.opponent || "";
        return waiting.initiator && waiting.initiator === opponent
            ? `${opponent} challenged you to a card duel for this sector. Taking your seat…`
            : `Waiting for ${opponent || "your opponent"} to take their seat. If they have not sat down within a minute, the duel is called off and nothing scores.`;
    }
    if (sectorCardWaitEnded(waiting)) {
        return "This duel was called off before it began. Nothing scored for either side.";
    }
    return "Waiting for the other side of the table.";
}

/** A wait that will never become a match: an open-world duel that was called
 *  off, or whose challenged player never took their seat. */
export function sectorCardWaitEnded(waiting: SectorTableWaiting): boolean {
    return waiting.status === "void";
}

/** Under the board's own Victory/Defeat heading. Says "scored" only when the
 *  server reports it did — a duel that outlived its war used to read as scored. */
export function sectorCardDoneNote(won: boolean, draw: boolean, result?: SectorWarResult): string {
    if (draw) return "A technical draw scores nothing for either side.";
    if (warResultUncounted(result)) return UNCOUNTED_NOTE;
    return won ? "The server scored this win for your side of the war." : "The server scored this win for the enemy side of the war.";
}

export function sectorCardGarrisonDoneNote(won: boolean, draw: boolean, result?: SectorWarResult): string {
    if (draw) return "A technical draw scores nothing for either side.";
    if (warResultUncounted(result)) return UNCOUNTED_NOTE;
    return won
        ? "You broke the garrison. The server scored it for your side at garrison weight."
        : "The garrison held. The server scored this win for the defence.";
}

/** Forfeit wording, "Question? Consequence." — CardClashDuelScreen's Leave
 *  reuses the part after "? ". It used to say "Your side scores nothing", but a
 *  forfeit is the other side's WIN, and it scores for them. */
export const SECTOR_CARD_FORFEIT_CONFIRM = "Forfeit the showdown? The enemy side takes the win, and it scores for their side of the war.";
export const SECTOR_CARD_GARRISON_FORFEIT_CONFIRM = "Withdraw from the garrison? The garrison takes the win, and it scores for the defence.";

/** The Pet table as the server projects it to one viewer. */
export type SectorPetView = {
    status: "awaiting-defender" | "done";
    attackerVillage: string;
    defenderVillage: string;
    p1: { name: string; pet?: { name?: string } };
    p2?: { name: string };
    winner?: "p1" | "p2" | "draw";
    garrison?: boolean;
    /** Which seat is the viewer's (null: none). Absent only from an older server. */
    viewerSide?: "p1" | "p2" | null;
    /** The viewer may answer this open duel (a defender of the sector). */
    canAnswer?: boolean;
    warResult?: SectorWarResult;
};

function petSideOf(session: SectorPetView, me: string): "p1" | "p2" | null {
    if (session.viewerSide !== undefined) return session.viewerSide;
    const name = me.toLowerCase();
    return session.p1.name.toLowerCase() === name ? "p1"
        : session.p2 && session.p2.name.toLowerCase() === name ? "p2" : null;
}

/**
 * The waiting card, or null to show the pet picker.
 *
 * Only the attacker who opened the duel waits on it. Everyone used to get the
 * attacker's "waiting for a defender" card — including the defender who had
 * come to answer, who therefore never saw a picker and could not answer.
 */
export function sectorPetWaiting(session: SectorPetView, me: string): { headline: string; detail: string } | null {
    if (session.status !== "awaiting-defender") return null;
    const side = petSideOf(session, me);
    if (side === "p1") {
        return {
            headline: "Waiting for a defender to answer with their pet…",
            detail: `Your pet ${session.p1.pet?.name ?? ""} stands ready.`,
        };
    }
    if (session.canAnswer) return null;
    return {
        headline: `${session.attackerVillage} has a pet duel open on this sector.`,
        detail: "Only a defender of the sector can answer it. Your village's next duel can open once this one is decided.",
    };
}

export function sectorPetBanner(session: SectorPetView, me: string): string {
    const side = petSideOf(session, me);
    const verdict = session.winner === "draw" ? "The pet duel ended in a draw — the sector holds."
        : side && session.winner === side ? "Your pet won the sector duel!"
            : side ? "Your pet was defeated."
                : `${session.winner === "p1" ? session.attackerVillage : session.defenderVillage} took the duel.`;
    return warResultUncounted(session.warResult) ? `${verdict} ${UNCOUNTED_NOTE}` : verdict;
}

/** An open-world pet battle's screen before its decided session arrives, or
 *  when it cannot be read: the server keeps it half an hour, and only its two
 *  villages may watch it. It was scored when it was fought, either way. */
export const SECTOR_PET_OPEN_BATTLE_STATUS = {
    loading: "Recovering the battle…",
    missing: "This battle can no longer be watched. Whatever it scored is already on the war's tally.",
};

/**
 * The "next duel" control on a decided duel, or null for none.
 *
 * The server keeps a decided duel for half an hour and accepts the next
 * attacker's opening over it, but the screen only ever replayed it, so the
 * table read as locked. A garrison duel offers none: the garrison re-forms on
 * its own clock.
 */
export function sectorPetNextDuelLabel(session: SectorPetView, garrison: boolean): string | null {
    if (garrison || session.garrison || session.status !== "done") return null;
    return session.viewerSide === "p1" ? "Open a new duel" : "Back to the table";
}
