/*
 * The War Hall's rules (screens/VillageWarScreen.tsx): the declaration price,
 * the peace and surrender controls, which winner's crates the player may claim,
 * and the Kage's war commands. Kept out of lib/world-state.ts so it ships in the
 * War Hall's lazy chunk rather than the startup bundle, and so it is testable
 * without rendering the screen.
 *
 * Every rule here mirrors the server, which stays the authority: a price or a
 * peace state shown here only decides what the screen offers, and the server's
 * answer always wins.
 */
import { WAR_CRATE_EXPIRY_MS } from "../constants/game";
import type { Character } from "../types/character";
import { comebackCostMultiplier } from "./village-stores";
import { fetchWarMap, WarMapRequestError, type WarMapResponse } from "./village-war-map";
import { postVillageWarUpdate, villageWarCrateEarnedBy, type VillageWarRecord } from "./world-state";

/** Mirrors api/_war-economy.ts DECLARE_WAR_WR: a declaration's full price. */
export const VILLAGE_WAR_DECLARE_WR = 800;
/** Mirrors api/world-state.ts VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS. Charged
 *  to the Kage personally, and only while the war system is switched off. */
export const VILLAGE_WAR_DECLARE_HONOR_SEALS = 500;
/** How long a read of the war map may take before the price counts as unknown. */
const DECLARE_QUOTE_TIMEOUT_MS = 8_000;

/** The War Resources a declaration costs a village holding `sectorsHeld`
 *  sectors: the server's discountedWrCost(DECLARE_WAR_WR, held). The comeback
 *  discount makes it free at 0 sectors and 25% / 50% / 75% of the price at 1-3. */
export function villageWarDeclareWrCost(sectorsHeld: number): number {
    return Math.round(VILLAGE_WAR_DECLARE_WR * comebackCostMultiplier(sectorsHeld));
}

/**
 * What declaring costs right now.
 *   • war-resources: the war system is on, so the village pool pays.
 *   • honor-seals: the war system is switched off, so the Kage pays personally.
 *   • unknown: the war map could not be read. The button stays usable and the
 *     server's answer decides.
 */
export type WarDeclareQuote =
    | { mode: "war-resources"; cost: number; pool: number; sectorsHeld: number }
    | { mode: "honor-seals"; cost: number }
    | { mode: "unknown" };

/** Price a declaration for `village` from a war-map read. The war map reads its
 *  held-sector count from the same helper the server charges with. */
export function warDeclareQuoteFromMap(map: Pick<WarMapResponse, "villages"> | null | undefined, village: string): WarDeclareQuote {
    const view = Array.isArray(map?.villages) ? map.villages.find(candidate => candidate.village === village) : undefined;
    // A restricted view carries no war chest (the server shows a village's pool
    // to its own members only), so the price cannot be checked against it.
    if (!view || view.restricted) return { mode: "unknown" };
    const sectorsHeld = Math.max(0, Math.floor(Number(view.sectorsHeld) || 0));
    return {
        mode: "war-resources",
        cost: villageWarDeclareWrCost(sectorsHeld),
        pool: Math.max(0, Math.floor(Number(view.warResources) || 0)),
        sectorsHeld,
    };
}

/** Load the declaration price. A 404 from the war map means the war system is
 *  switched off, the one case where the Kage's own Honor Seals pay. Any other
 *  failure, or a read slower than `timeoutMs`, leaves the price unknown. */
export async function loadWarDeclareQuote(
    village: string,
    readWarMap: () => Promise<WarMapResponse> = fetchWarMap,
    timeoutMs: number = DECLARE_QUOTE_TIMEOUT_MS,
): Promise<WarDeclareQuote> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const map = await Promise.race([
            readWarMap(),
            new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
        ]);
        return map ? warDeclareQuoteFromMap(map, village) : { mode: "unknown" };
    } catch (error) {
        if (error instanceof WarMapRequestError && error.status === 404) {
            return { mode: "honor-seals", cost: VILLAGE_WAR_DECLARE_HONOR_SEALS };
        }
        return { mode: "unknown" };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/** Why the Declare button is disabled, or null when it can be pressed. Only a
 *  price the payer is known to be short of blocks it; while the price loads it
 *  waits, and an unknown price leaves the decision to the server. */
export function warDeclareBlockReason(quote: WarDeclareQuote | null, kageHonorSeals: number): string | null {
    if (!quote) return "Checking the declaration cost…";
    if (quote.mode === "war-resources" && quote.pool < quote.cost) {
        return `Needs ${quote.cost.toLocaleString()} War Resources. The village pool holds ${quote.pool.toLocaleString()}.`;
    }
    const seals = Math.max(0, Math.floor(Number(kageHonorSeals) || 0));
    if (quote.mode === "honor-seals" && seals < quote.cost) {
        return `Needs ${quote.cost.toLocaleString()} Honor Seals. You have ${seals.toLocaleString()}.`;
    }
    return null;
}

/** The cost line under "Declare War". */
export function warDeclareCostText(quote: WarDeclareQuote | null): string {
    if (!quote) return "Checking the cost…";
    if (quote.mode === "honor-seals") return `${quote.cost.toLocaleString()} of your own Honor Seals (the war system is switched off)`;
    if (quote.mode === "unknown") return `Up to ${VILLAGE_WAR_DECLARE_WR.toLocaleString()} War Resources from the village pool`;
    if (quote.cost === 0) return "Free: your village holds no sectors (comeback discount)";
    const discount = quote.cost < VILLAGE_WAR_DECLARE_WR
        ? ` (comeback discount: ${quote.sectorsHeld} sector${quote.sectorsHeld === 1 ? "" : "s"} held)`
        : "";
    return `${quote.cost.toLocaleString()} War Resources from the village pool${discount}. The pool holds ${quote.pool.toLocaleString()}.`;
}

/** The confirm dialog text for declaring on `target`. */
export function warDeclareConfirmText(quote: WarDeclareQuote | null, target: string): string {
    const price = !quote || quote.mode === "unknown"
        ? `It is paid from your village's War Resources (up to ${VILLAGE_WAR_DECLARE_WR.toLocaleString()}).`
        : quote.mode === "honor-seals"
            ? `The war system is switched off, so this costs ${quote.cost.toLocaleString()} Honor Seals from your own treasury.`
            : quote.cost === 0
                ? "It costs nothing: your village holds no sectors."
                : `This spends ${quote.cost.toLocaleString()} War Resources from your village's pool.`;
    return `Declare war on ${target}? ${price} Fighting starts 1 hour after the declaration.`;
}

export type WarPeaceCommand = "propose-peace" | "withdraw-peace";
export type VillageWarCommand = WarPeaceCommand | "surrender";

/** The peace offers on a war, and the peace button this village's Kage gets. */
export type VillageWarPeaceView = {
    /** When this village's Kage offered peace, while the offer stands. */
    ourOfferAt: number | null;
    /** When the enemy Kage offered peace, while the offer stands. */
    enemyOfferAt: number | null;
    peaceCommand: WarPeaceCommand;
    peaceLabel: "Propose peace" | "Accept peace" | "Withdraw peace offer";
};

function offerAt(war: Pick<VillageWarRecord, "peaceProposals">, village: string): number | null {
    const at = Math.floor(Number(war.peaceProposals?.[village]));
    return Number.isSafeInteger(at) && at > 0 ? at : null;
}

/** A no-winner peace needs BOTH Kages: the second proposal ends the war. So our
 *  Kage withdraws a standing offer, accepts the enemy's, or proposes first. */
export function villageWarPeaceView(war: Pick<VillageWarRecord, "peaceProposals">, myVillage: string, enemyVillage: string): VillageWarPeaceView {
    const ourOfferAt = offerAt(war, myVillage);
    const enemyOfferAt = offerAt(war, enemyVillage);
    if (ourOfferAt) return { ourOfferAt, enemyOfferAt, peaceCommand: "withdraw-peace", peaceLabel: "Withdraw peace offer" };
    return { ourOfferAt, enemyOfferAt, peaceCommand: "propose-peace", peaceLabel: enemyOfferAt ? "Accept peace" : "Propose peace" };
}

/** The surrender confirmation: it must say plainly that this is a loss. */
export function warSurrenderConfirmText(myVillage: string, enemyVillage: string): string {
    return `Surrender to ${enemyVillage}? The war ends now as a LOSS for ${myVillage}. ${enemyVillage} wins: it takes spoils from our village treasury, and its fighters earn Legendary War Crates. This cannot be undone.`;
}

/** The confirmation for accepting the enemy's standing peace offer. */
export function warAcceptPeaceConfirmText(enemyVillage: string): string {
    return `Accept ${enemyVillage}'s peace offer? The war ends now with no winner: no spoils and no winner's crates for either side.`;
}

/** A war row from a server reply, or null when the reply carried none. */
export function villageWarRow(raw: unknown): VillageWarRecord | null {
    const row = raw as Partial<VillageWarRecord> | null | undefined;
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !Array.isArray(row.villages) || row.villages.length !== 2) return null;
    return row as VillageWarRecord;
}

export type VillageWarCommandResult =
    | { ok: true; war: VillageWarRecord | null }
    | { ok: false; status: number; error: string };

/** Send a Kage war command (`POST /api/world-state` kind `war-command`). The
 *  server checks the seat and the war; this only reports its answer. */
export async function postVillageWarCommand(command: VillageWarCommand, myVillage: string, enemyVillage: string): Promise<VillageWarCommandResult> {
    try {
        const { status, data } = await postVillageWarUpdate({ kind: "war-command", command, villages: [myVillage, enemyVillage] });
        if (status >= 200 && status < 300) return { ok: true, war: villageWarRow(data?.war) };
        return { ok: false, status, error: String(data?.error ?? `The war command failed (HTTP ${status}).`) };
    } catch {
        return { ok: false, status: 0, error: "The server could not be reached. Try again." };
    }
}

/** How long a row adopted from a command is kept against an older poll. */
export const ADOPTED_WAR_ROW_GRACE_MS = 60_000;
export type AdoptedWarRow = { row: VillageWarRecord; at: number };

/**
 * Merge a world-state poll with the rows the War Hall adopted from its own
 * commands. That GET can be served from a cache seconds old, which used to put
 * a just-declared war, or a just-sent peace offer, back to its old state until
 * the cache caught up. An adopted row stands until the poll carries the same
 * row or a newer one (by `updatedAt`), or until its grace runs out.
 */
export function mergeAdoptedWarRows(
    polled: readonly VillageWarRecord[],
    adopted: ReadonlyMap<string, AdoptedWarRow>,
    now: number,
): { wars: VillageWarRecord[]; pending: Map<string, AdoptedWarRow> } {
    const pending = new Map<string, AdoptedWarRow>();
    for (const [id, entry] of adopted) {
        if (now - entry.at > ADOPTED_WAR_ROW_GRACE_MS) continue;
        const polledRow = polled.find(row => row.id === id);
        if (!polledRow || Number(entry.row.updatedAt) > Number(polledRow.updatedAt)) pending.set(id, entry);
    }
    const wars = polled.map(row => pending.get(row.id)?.row ?? row);
    for (const [id, entry] of pending) {
        if (!polled.some(row => row.id === id)) wars.push(entry.row);
    }
    return { wars, pending };
}

/** The ended wars whose winner's crate this player can claim from the War Hall:
 *  a win they fought in (villageWarCrateEarnedBy), keyed by the server-stamped
 *  `warCrateId`, not yet claimed or declined, and inside the claim window. */
export function claimableVillageWarCrates(
    wars: readonly VillageWarRecord[],
    character: Pick<Character, "name" | "village" | "claimedWarCrateIds">,
    now: number,
    declined: ReadonlySet<string> = new Set(),
): (VillageWarRecord & { warCrateId: string; endedAt: number })[] {
    const claimed = new Set(character.claimedWarCrateIds ?? []);
    return wars.filter((war): war is VillageWarRecord & { warCrateId: string; endedAt: number } =>
        villageWarCrateEarnedBy(war, character)
        && !claimed.has(String(war.warCrateId))
        && !declined.has(String(war.warCrateId))
        && now - Number(war.endedAt) <= WAR_CRATE_EXPIRY_MS);
}

/** What to tell the player when the server declines a crate claim. */
export function warCrateDeclineMessage(reason: unknown): string {
    switch (reason) {
        case "already-claimed": return "You already claimed this war crate.";
        case "expired": return "This war crate has expired. Crates must be claimed within 7 days of the war's end.";
        case "not-winner":
        case "no-won-war": return "Only the winning village can claim this war crate.";
        default: return "This war crate is not yours to claim. It goes to the shinobi who fought for the winning village.";
    }
}
