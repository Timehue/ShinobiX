/*
 * Village Stores — SIGNPOSTS.
 *
 * The stores loop (hunt → cook → donate → the Kage spends) shipped fully wired
 * and completely unadvertised: a hunter holding Beast Meat was never told it is
 * ration input, a village marching hungry never said so anywhere a player
 * looks, and an explorer who ground a sector to Mapped only ever saw the Kage's
 * declare get cheaper. This module is the copy layer that closes that hole.
 *
 * Everything here is PURE and display-only. It changes no rule, cost, cap,
 * reward or authority — spending the stores stays Kage-only (ANBU appointees
 * may order a garrison fed), which these strings describe rather than alter.
 * Screens own the markup; this file owns the sentences and the "should we say
 * anything at all?" predicates, so both are testable without a DOM.
 */
import { COOK_RECIPES, type CookRecipe } from "./cafeteria";
import {
    GARRISON_RATIONS_PER_DAY,
    INTEL_DECLARE_BASE_COST,
    INTEL_TTL_DAYS,
    RATION_ITEM_ID,
    WAR_RATIONS_PER_DAY,
    type IntelTier,
} from "./village-stores";

const nonNeg = (v: unknown) => {
    const n = Math.floor(Number(v) || 0);
    return n > 0 ? n : 0;
};

// ── 1. Route the hunter toward the kitchen ──────────────────────────────────

export type StoresItemSignpost = {
    /** The item this signpost describes. */
    itemId: string;
    /** One sentence naming what the item becomes and where. */
    line: string;
    /** Real button label — the affordance, never a tooltip. */
    actionLabel: string;
    /** Screen id the button navigates to. */
    screen: "cafeteria" | "townHall";
};

/** The recipe a material feeds, if any (first recipe that accepts it wins —
 *  the same "first owned material" order applyCookRecipe uses). */
export function cookRecipeForMaterial(itemId: string): CookRecipe | null {
    const id = String(itemId ?? "");
    return COOK_RECIPES.find((r) => r.materials.includes(id)) ?? null;
}

/**
 * What an inventory entry means to the Village Stores, or null when it means
 * nothing (which is most items — the Inventory must stay quiet about them).
 *
 * Cookable hunt materials point at the Cafeteria; a cooked ration pack points
 * at the Town Hall, because a pack sitting in a backpack feeds nobody.
 */
export function storesItemSignpost(itemId: string): StoresItemSignpost | null {
    const id = String(itemId ?? "");
    if (!id) return null;
    if (id === RATION_ITEM_ID) {
        return {
            itemId: id,
            line: "Donate these at the Town Hall — every pack becomes one ration in your village's stores.",
            actionLabel: "Donate at the Town Hall",
            screen: "townHall",
        };
    }
    const recipe = cookRecipeForMaterial(id);
    if (!recipe) return null;
    return {
        itemId: id,
        line: `Cooks into ${recipe.name} at the Cafeteria — ${recipe.rations.toLocaleString()} rations for your village's stores, ${recipe.ryo.toLocaleString()} ryo a batch.`,
        actionLabel: "Cook at the Cafeteria",
        screen: "cafeteria",
    };
}

// ── 2. Give the village a visible need ──────────────────────────────────────

/**
 * How many days of siege rations count as "comfortable". Below that, with a war
 * actually running, the village is one bad day from losing its fortifications.
 * A DISPLAY threshold only — the server's fed/unfed verdict is unchanged.
 */
export const LOW_PROVISION_DAYS = 2;

/** Rations a village wants in hand to keep `activeWars` sieges standing for
 *  LOW_PROVISION_DAYS days. Mirrors WAR_RATIONS_PER_DAY per war per day. */
export function lowProvisionFloor(activeWars: number): number {
    return Math.max(1, nonNeg(activeWars)) * WAR_RATIONS_PER_DAY * LOW_PROVISION_DAYS;
}

export type VillageSupplyCall = {
    /** "hungry" = a war actually went unfed today; "low" = it will tomorrow. */
    tone: "hungry" | "low";
    headline: string;
    body: string;
    actionLabel: string;
    screen: "cafeteria";
};

export type VillageSupplyCallInput = {
    village: string;
    /** False while the stores read is still in flight or failed — say nothing. */
    loaded: boolean;
    /** Rations in the treasury; null when genuinely unknown (NEVER pass 0 for
     *  "we have not read it yet" — an unknown must not raise an alarm). */
    provisions: number | null;
    /** Active sector wars this village is a participant in. */
    activeWars: number;
    /** Of those, how many this village marched hungry on TODAY. */
    unfedWars: number;
};

/**
 * The "should we nag?" predicate. Returns null — silence — unless there is
 * something a villager can actually do right now:
 *
 *  - a sector war this village went unfed on today (the loud case), or
 *  - a sector war running while the stores sit under two days of rations.
 *
 * A village at peace is NEVER nagged, however empty its stores, and neither is
 * a village whose stores have not been read yet. That is deliberate: a banner
 * that is always on stops being read.
 */
export function villageSupplyCall(input: VillageSupplyCallInput): VillageSupplyCall | null {
    const village = String(input.village ?? "").trim() || "Your village";
    if (!input.loaded || input.provisions == null || !Number.isFinite(Number(input.provisions))) return null;
    const provisions = nonNeg(input.provisions);
    const activeWars = nonNeg(input.activeWars);
    // "A village at peace is NEVER nagged" is this function's own promise, so
    // it is kept HERE rather than trusted from the caller: an unfed war can only
    // ever be one of the wars that is actually running, and a stale or racing
    // unfed count must not raise a siege alarm on a village with no siege.
    const unfedWars = Math.min(nonNeg(input.unfedWars), activeWars);
    if (unfedWars > 0) {
        return {
            tone: "hungry",
            headline: `${village} is marching hungry.`,
            body: provisions > 0
                ? `A sector war went unfed today and the stores are down to ${provisions.toLocaleString()} rations. Cook ration packs at the Cafeteria, then donate them at the Town Hall.`
                : "A sector war went unfed today and the stores stand empty. Cook ration packs at the Cafeteria, then donate them at the Town Hall.",
            actionLabel: "Cook rations at the Cafeteria",
            screen: "cafeteria",
        };
    }
    if (activeWars < 1) return null;
    if (provisions >= lowProvisionFloor(activeWars)) return null;
    return {
        tone: "low",
        headline: `${village} is running short of rations.`,
        body: provisions > 0
            ? `${provisions.toLocaleString()} rations left, and a siege eats ${WAR_RATIONS_PER_DAY} a day — ${GARRISON_RATIONS_PER_DAY} more for a fed garrison. Cook ration packs at the Cafeteria, then donate them at the Town Hall.`
            : `The stores stand empty, and a siege eats ${WAR_RATIONS_PER_DAY} rations a day — ${GARRISON_RATIONS_PER_DAY} more for a fed garrison. Cook ration packs at the Cafeteria, then donate them at the Town Hall.`,
        actionLabel: "Cook rations at the Cafeteria",
        screen: "cafeteria",
    };
}

// ── 3. Show the explorer what their Intel bought ────────────────────────────

/** Heading over the payoff lines on the sector Intel card. */
export const INTEL_PAYOFF_HEADING = "What your intel bought";

export type IntelThresholds = { scouted: number; mapped: number; infiltrated: number };

/**
 * What crossing into `tier` actually changed, for the player who earned it, and
 * what the next tier would add. Every figure is already on the intel payload or
 * in the declare-cost mirror — no new endpoint, no new fetch.
 *
 * The declare figures are the BASE cost, which is a CEILING and not a floor: a
 * village's comeback discount comes off on top (comebackCostMultiplier is 0 at
 * zero sectors held and only reaches 1 at four or more), so the real declare is
 * anywhere from free to this number. That is why these say "at most" — "starts
 * at" pointed the wrong way. They are named as the KAGE's cost on purpose: the
 * explorer earns the intel, the Kage spends it.
 */
export function intelPayoffLines(tier: IntelTier, thresholds: IntelThresholds): string[] {
    const full = INTEL_DECLARE_BASE_COST.none;
    const mappedCost = INTEL_DECLARE_BASE_COST.mapped;
    const infiltratedCost = INTEL_DECLARE_BASE_COST.infiltrated;
    const wr = (n: number) => `${nonNeg(n).toLocaleString()} WR`;
    const pts = (n: number) => nonNeg(n).toLocaleString();
    if (tier === "scouted") {
        return [
            "Your village can now see this sector's garrison and its structures.",
            `At ${pts(thresholds.mapped)} intel it is Mapped, and your Kage's war declare here costs at most ${wr(mappedCost)} instead of ${wr(full)}.`,
        ];
    }
    if (tier === "mapped") {
        return [
            `Mapped — your Kage's war declare here costs at most ${wr(mappedCost)} instead of ${wr(full)}, ${wr(full - mappedCost)} saved.`,
            `At ${pts(thresholds.infiltrated)} intel it is Infiltrated, and the declare costs at most ${wr(infiltratedCost)}.`,
        ];
    }
    if (tier === "infiltrated") {
        return [
            `Infiltrated — your Kage's war declare here costs at most ${wr(infiltratedCost)} instead of ${wr(full)}, ${wr(full - infiltratedCost)} saved.`,
            `There is no higher tier — but intel goes cold ${INTEL_TTL_DAYS} days after your village's last find here, so keep working this sector to hold it.`,
        ];
    }
    return [];
}

// ── 5. The Supply log says what it is ───────────────────────────────────────
//
// The ledger records DRAINS only — spoilage, siege rations, garrison feed,
// depot conversions, structure builds. Credits are deliberately not written to
// it (that is server behaviour and stays as it is). But a player who has just
// donated 20 rations, watched the Provisions row climb, and then read "Nothing
// drawn from the stores yet" directly beneath it reasonably concludes the
// donation vanished. These two strings fix the LEGIBILITY of that, not the
// ledger: they name the log's scope up front, and the empty state points back
// at the stock the donation actually landed in.

/** The scope line under the "Supply log" heading. Says what the log is BEFORE
 *  a player mistakes it for a receipt. */
export function storesLedgerScopeLine(village: string): string {
    const name = String(village ?? "").trim() || "your village";
    return `What the village spends out of the stores — a donation is never logged here, it lands in the Provisions and Materials rows above. An unfed war costs your side its fortifications, and provisions are how ${name} keeps a siege standing.`;
}

/**
 * The empty state, which must distinguish "nothing has been SPENT yet" from
 * "nothing happened". When there is stock on the shelves it says so and names
 * it, so a fresh donor sees their rations acknowledged.
 */
export function storesLedgerEmptyLine(input: { provisions: number; materialPoints: number }): string {
    const rations = nonNeg(input.provisions);
    const materials = nonNeg(input.materialPoints);
    const held: string[] = [];
    if (rations > 0) held.push(`${rations.toLocaleString()} rations`);
    if (materials > 0) held.push(`${materials.toLocaleString()} materials`);
    const scope = "Nothing spent yet. This log records what the village draws OUT of the stores — spoilage, siege rations, garrison feed, depot conversions and structure builds.";
    return held.length
        ? `${scope} What has been donated is already counted above: ${held.join(" and ")} standing ready for the Kage.`
        : `${scope} Donations are not entries here; they show in the Provisions and Materials rows above.`;
}

// ── 4. Make the Kage bottleneck legible (without changing it) ───────────────

/**
 * One line under the Provisions / Materials rows so a villager who cannot spend
 * the stores still knows who can and what for — a full storehouse should read
 * as "ready for the Kage", not as a dead number.
 *
 * Returns null while the stores have not been read: the screen already owns the
 * loading and error states, and a bare 0 must never stand in for "unknown".
 */
export function storesSpendAuthorityLine(input: { loaded: boolean; provisions: number; materialPoints: number }): string | null {
    if (!input.loaded) return null;
    const stocked = nonNeg(input.provisions) > 0 || nonNeg(input.materialPoints) > 0;
    return stocked
        ? "Stocked and ready for the Kage. Only the Kage spends the stores — on sieges, mercenary bands and level 6+ structures — and ANBU appointees may order a garrison fed. Everyone else stocks them."
        : "The stores stand empty. Only the Kage spends them — on sieges, mercenary bands and level 6+ structures — so anything you donate is waiting for the next war, not for you.";
}
