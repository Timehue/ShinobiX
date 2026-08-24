import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    INTEL_PAYOFF_HEADING,
    LOW_PROVISION_DAYS,
    cookRecipeForMaterial,
    intelPayoffLines,
    lowProvisionFloor,
    storesItemSignpost,
    storesLedgerEmptyLine,
    storesLedgerScopeLine,
    storesSpendAuthorityLine,
    villageSupplyCall,
    type VillageSupplyCallInput,
} from "./village-stores-signposts";
import { COOK_MATERIAL_IDS, COOK_RECIPES } from "./cafeteria";
import { GARRISON_RATIONS_PER_DAY, INTEL_DECLARE_BASE_COST, INTEL_TTL_DAYS, RATION_ITEM_ID, WAR_RATIONS_PER_DAY } from "./village-stores";

// ── 1. Cookable-material mapping ───────────────────────────────────────────

test("every cookable material carries a signpost naming its recipe and yield", () => {
    assert.ok(COOK_MATERIAL_IDS.length >= 3, "the fixture assumes the shipped recipes");
    for (const id of COOK_MATERIAL_IDS) {
        const sign = storesItemSignpost(id);
        assert.ok(sign, `${id} is a cook input and must be signposted`);
        const recipe = cookRecipeForMaterial(id);
        assert.ok(recipe);
        assert.equal(sign.screen, "cafeteria");
        assert.equal(sign.actionLabel, "Cook at the Cafeteria");
        assert.match(sign.line, new RegExp(`^Cooks into ${recipe.name} at the Cafeteria — `, "u"));
        assert.ok(sign.line.includes(`${recipe.rations} rations`), sign.line);
        // Cooking is not free (Field 30 ryo, Campaign 80) — the signpost must
        // say so, or it reads as a costless conversion.
        assert.ok(sign.line.includes(`${recipe.ryo} ryo a batch`), sign.line);
        // Canonical unit only — never "craft points" / "pts" / "supplies".
        assert.doesNotMatch(sign.line, /craft point|\bpts\b|supplies/iu);
    }
});

test("the Beast Meat signpost reads as a sentence a hunter can act on", () => {
    assert.deepEqual(storesItemSignpost("hunt-beast-meat"), {
        itemId: "hunt-beast-meat",
        line: "Cooks into Field Rations at the Cafeteria — 5 rations for your village's stores, 30 ryo a batch.",
        actionLabel: "Cook at the Cafeteria",
        screen: "cafeteria",
    });
});

test("a cooked ration pack points at the Town Hall, not back at the kitchen", () => {
    const sign = storesItemSignpost(RATION_ITEM_ID);
    assert.ok(sign);
    assert.equal(sign.screen, "townHall");
    assert.equal(sign.actionLabel, "Donate at the Town Hall");
    assert.equal(sign.line, "Donate these at the Town Hall — every pack becomes one ration in your village's stores.");
});

test("items with no place in the stores loop stay silent", () => {
    for (const id of ["", "kunai", "hunt-titan-bone", "dungeon-legendary-relic", "chakra-pill"]) {
        assert.equal(storesItemSignpost(id), null, `${id} must not be signposted`);
    }
    assert.equal(cookRecipeForMaterial("hunt-titan-bone"), null);
});

test("the frost pelt and ash scale share one recipe, first-listed wins", () => {
    const pelt = cookRecipeForMaterial("hunt-frost-pelt");
    const scale = cookRecipeForMaterial("hunt-ash-scale");
    assert.equal(pelt?.id, "campaign-rations");
    assert.equal(scale?.id, "campaign-rations");
    assert.equal(COOK_RECIPES.find((r) => r.id === "campaign-rations")?.rations, 20);
});

// ── 2. "Should we nag?" ────────────────────────────────────────────────────

const base: VillageSupplyCallInput = {
    village: "Frostfang Village",
    loaded: true,
    provisions: 500,
    activeWars: 0,
    unfedWars: 0,
};

test("a village at peace is never nagged, however empty its stores", () => {
    assert.equal(villageSupplyCall({ ...base, provisions: 0 }), null);
    assert.equal(villageSupplyCall({ ...base, provisions: 0, activeWars: 0, unfedWars: 0 }), null);
});

test("the peace guard holds on its own — an unfed count with no war is ignored", () => {
    // The promise above is this function's, so it may not depend on the caller
    // pre-filtering. A stale or racing unfedWars must never raise a siege alarm
    // at a village that is not besieging anything.
    assert.equal(villageSupplyCall({ ...base, activeWars: 0, unfedWars: 1 }), null);
    assert.equal(villageSupplyCall({ ...base, provisions: 0, activeWars: 0, unfedWars: 3 }), null);
    // Clamped, not discarded: one real war with a nonsense unfed count of 5 is
    // still the loud case, exactly once.
    const call = villageSupplyCall({ ...base, provisions: 5, activeWars: 1, unfedWars: 5 });
    assert.equal(call?.tone, "hungry");
});

test("a well-stocked village at war is quiet too", () => {
    assert.equal(villageSupplyCall({ ...base, activeWars: 1, provisions: lowProvisionFloor(1) }), null);
    assert.equal(villageSupplyCall({ ...base, activeWars: 2, provisions: lowProvisionFloor(2) }), null);
});

test("an unread or failed stores fetch says nothing — unknown is not an alarm", () => {
    assert.equal(villageSupplyCall({ ...base, loaded: false, provisions: 0, activeWars: 1, unfedWars: 1 }), null);
    assert.equal(villageSupplyCall({ ...base, provisions: null, activeWars: 1, unfedWars: 1 }), null);
    assert.equal(villageSupplyCall({ ...base, provisions: Number.NaN, activeWars: 1, unfedWars: 1 }), null);
});

test("an unfed war is the loud case and names the village", () => {
    const call = villageSupplyCall({ ...base, provisions: 12, activeWars: 1, unfedWars: 1 });
    assert.ok(call);
    assert.equal(call.tone, "hungry");
    assert.equal(call.headline, "Frostfang Village is marching hungry.");
    assert.equal(call.body, "A sector war went unfed today and the stores are down to 12 rations. Cook ration packs at the Cafeteria, then donate them at the Town Hall.");
    assert.equal(call.actionLabel, "Cook rations at the Cafeteria");
    assert.equal(call.screen, "cafeteria");
});

test("an unfed war with empty stores says empty, never \"0 rations\"", () => {
    const call = villageSupplyCall({ ...base, provisions: 0, activeWars: 1, unfedWars: 1 });
    assert.ok(call);
    assert.equal(call.tone, "hungry");
    assert.equal(call.body, "A sector war went unfed today and the stores stand empty. Cook ration packs at the Cafeteria, then donate them at the Town Hall.");
});

test("a war running on thin stores is the quiet case, with both burn rates named", () => {
    const call = villageSupplyCall({ ...base, provisions: 40, activeWars: 1, unfedWars: 0 });
    assert.ok(call);
    assert.equal(call.tone, "low");
    assert.equal(call.headline, "Frostfang Village is running short of rations.");
    assert.ok(call.body.includes(`eats ${WAR_RATIONS_PER_DAY} a day`), call.body);
    assert.ok(call.body.includes(`${GARRISON_RATIONS_PER_DAY} more for a fed garrison`), call.body);
});

test("the low-stores floor scales with the number of wars", () => {
    assert.equal(lowProvisionFloor(1), WAR_RATIONS_PER_DAY * LOW_PROVISION_DAYS);
    assert.equal(lowProvisionFloor(3), 3 * WAR_RATIONS_PER_DAY * LOW_PROVISION_DAYS);
    // A malformed count still yields one war's worth rather than zero.
    assert.equal(lowProvisionFloor(0), WAR_RATIONS_PER_DAY * LOW_PROVISION_DAYS);
    assert.equal(lowProvisionFloor(-4), WAR_RATIONS_PER_DAY * LOW_PROVISION_DAYS);
});

test("a blank village name still produces a readable sentence", () => {
    const call = villageSupplyCall({ ...base, village: "   ", provisions: 0, activeWars: 1, unfedWars: 1 });
    assert.equal(call?.headline, "Your village is marching hungry.");
});

test("the call to action never uses dev jargon or a banned unit", () => {
    for (const input of [
        { ...base, provisions: 0, activeWars: 1, unfedWars: 1 },
        { ...base, provisions: 40, activeWars: 1, unfedWars: 0 },
    ]) {
        const call = villageSupplyCall(input);
        assert.ok(call);
        assert.doesNotMatch(`${call.headline} ${call.body}`, /craft point|\bpts\b|materialPoints|provisions\b/iu);
    }
});

// ── 3. Intel payoff copy ───────────────────────────────────────────────────

const THRESHOLDS = { scouted: 100, mapped: 250, infiltrated: 500 };

test("an unscouted sector gets no payoff lines — the card owns that empty state", () => {
    assert.deepEqual(intelPayoffLines("none", THRESHOLDS), []);
});

test("Scouted names the reveal and the next tier's declare saving", () => {
    assert.deepEqual(intelPayoffLines("scouted", THRESHOLDS), [
        "Your village can now see this sector's garrison and its structures.",
        "At 250 intel it is Mapped, and your Kage's war declare here costs at most 175 WR instead of 250 WR.",
    ]);
});

test("Mapped states the saving in WR and points at Infiltrated", () => {
    assert.deepEqual(intelPayoffLines("mapped", THRESHOLDS), [
        "Mapped — your Kage's war declare here costs at most 175 WR instead of 250 WR, 75 WR saved.",
        "At 500 intel it is Infiltrated, and the declare costs at most 125 WR.",
    ]);
});

test("Infiltrated states the full saving and says intel goes cold", () => {
    assert.deepEqual(intelPayoffLines("infiltrated", THRESHOLDS), [
        "Infiltrated — your Kage's war declare here costs at most 125 WR instead of 250 WR, 125 WR saved.",
        `There is no higher tier — but intel goes cold ${INTEL_TTL_DAYS} days after your village's last find here, so keep working this sector to hold it.`,
    ]);
});

test("the declare figure is a CEILING, never a floor", () => {
    // The real price is base x comebackCostMultiplier(sectorsHeld), which is 0
    // at zero sectors held and only reaches 1 at four or more. "Starts at 175"
    // pointed the wrong way: 175 is the most it can cost, not the least.
    for (const tier of ["scouted", "mapped", "infiltrated"] as const) {
        for (const line of intelPayoffLines(tier, THRESHOLDS)) {
            assert.doesNotMatch(line, /starts at|from as little as|as low as/iu, line);
        }
    }
    assert.ok(intelPayoffLines("mapped", THRESHOLDS)[0].includes("costs at most 175 WR"));
});

test("Infiltrated never tells a player to stop working the sector", () => {
    // Intel EXPIRES: expiresAt is pushed out on every credit and the entry drops
    // 7 days after the last one, so "nothing further to gather" cost the player
    // their tier — and contradicted the expiry label on the same card.
    const closing = intelPayoffLines("infiltrated", THRESHOLDS)[1];
    assert.doesNotMatch(closing, /nothing further to gather|as open to your village as it gets/iu, closing);
    assert.ok(closing.includes("goes cold"), closing);
    assert.ok(closing.includes(`${INTEL_TTL_DAYS} days`), closing);
    assert.ok(/keep working this sector/u.test(closing), closing);
});

test("the payoff savings are derived from the declare-cost mirror, not hardcoded", () => {
    const mapped = intelPayoffLines("mapped", THRESHOLDS)[0];
    const saved = INTEL_DECLARE_BASE_COST.none - INTEL_DECLARE_BASE_COST.mapped;
    assert.ok(mapped.includes(`${INTEL_DECLARE_BASE_COST.mapped} WR instead of ${INTEL_DECLARE_BASE_COST.none} WR`), mapped);
    assert.ok(mapped.includes(`${saved} WR saved`), mapped);
});

test("server-supplied thresholds win over the client mirror", () => {
    const lines = intelPayoffLines("scouted", { scouted: 40, mapped: 1_200, infiltrated: 4_000 });
    assert.ok(lines[1].includes("1,200 intel"), lines[1]);
    const next = intelPayoffLines("mapped", { scouted: 40, mapped: 1_200, infiltrated: 4_000 });
    assert.ok(next[1].includes("4,000 intel"), next[1]);
});

test("the payoff heading is plain English", () => {
    assert.equal(INTEL_PAYOFF_HEADING, "What your intel bought");
});

// ── 4. Kage bottleneck legibility ──────────────────────────────────────────

test("an unread stores block gets no authority line — no bare zero standing in", () => {
    assert.equal(storesSpendAuthorityLine({ loaded: false, provisions: 0, materialPoints: 0 }), null);
    assert.equal(storesSpendAuthorityLine({ loaded: false, provisions: 900, materialPoints: 900 }), null);
});

test("a stocked storehouse reads as ready for the Kage", () => {
    const line = storesSpendAuthorityLine({ loaded: true, provisions: 900, materialPoints: 0 });
    assert.ok(line);
    assert.match(line, /^Stocked and ready for the Kage\./u);
    assert.ok(line.includes("Only the Kage spends the stores"), line);
    assert.ok(line.includes("ANBU appointees may order a garrison fed"), line);
    assert.equal(storesSpendAuthorityLine({ loaded: true, provisions: 0, materialPoints: 12 }), line);
});

test("an empty storehouse says so instead of implying a broken screen", () => {
    const line = storesSpendAuthorityLine({ loaded: true, provisions: 0, materialPoints: 0 });
    assert.ok(line);
    assert.match(line, /^The stores stand empty\./u);
    assert.ok(line.includes("Only the Kage spends them"), line);
});

test("the authority copy never re-permissions the stores", () => {
    for (const stocked of [true, false]) {
        const line = storesSpendAuthorityLine({ loaded: true, provisions: stocked ? 5 : 0, materialPoints: 0 });
        assert.ok(line);
        assert.doesNotMatch(line, /you can spend|anyone can spend|spend them yourself/iu);
    }
});

// ── 5. The Supply log says what it is ──────────────────────────────────────

test("the scope line names what the log is BEFORE it can be mistaken for a receipt", () => {
    const line = storesLedgerScopeLine("Frostfang Village");
    assert.match(line, /^What the village spends out of the stores/u);
    assert.ok(line.includes("a donation is never logged here"), line);
    assert.ok(line.includes("Provisions and Materials rows above"), line);
    assert.ok(line.includes("Frostfang Village keeps a siege standing"), line);
});

test("the scope line still reads as a sentence without a village name", () => {
    assert.ok(storesLedgerScopeLine("").includes("how your village keeps a siege standing"));
    assert.ok(storesLedgerScopeLine("  ").includes("how your village keeps a siege standing"));
});

test("an empty log with stock on the shelves ACKNOWLEDGES the donation", () => {
    const line = storesLedgerEmptyLine({ provisions: 240, materialPoints: 1_320 });
    assert.match(line, /^Nothing spent yet\./u);
    assert.ok(line.includes("already counted above: 240 rations and 1,320 materials standing ready for the Kage."), line);
    // The killer misread: "nothing drawn yet" beside a Provisions row that just
    // climbed reads as a lost donation. It must never say nothing happened.
    assert.doesNotMatch(line, /Nothing drawn from the stores yet/u);
});

test("the empty log names only the store that actually holds something", () => {
    const rationsOnly = storesLedgerEmptyLine({ provisions: 40, materialPoints: 0 });
    assert.ok(rationsOnly.includes("40 rations standing ready"), rationsOnly);
    assert.doesNotMatch(rationsOnly, /materials standing ready/u);
    const materialsOnly = storesLedgerEmptyLine({ provisions: 0, materialPoints: 900 });
    assert.ok(materialsOnly.includes("900 materials standing ready"), materialsOnly);
    assert.doesNotMatch(materialsOnly, /rations standing ready/u);
});

test("a genuinely empty storehouse points at the rows instead of inventing stock", () => {
    const line = storesLedgerEmptyLine({ provisions: 0, materialPoints: 0 });
    assert.match(line, /^Nothing spent yet\./u);
    assert.ok(line.includes("Donations are not entries here"), line);
    assert.doesNotMatch(line, /standing ready/u);
    assert.doesNotMatch(line, /\b0 rations\b/u);
});

test("both Supply log strings keep the drain vocabulary and the canonical units", () => {
    const all = storesLedgerScopeLine("Frostfang Village") + " " + storesLedgerEmptyLine({ provisions: 5, materialPoints: 5 });
    assert.doesNotMatch(all, /craft point|\bpts\b|materialPoints/iu);
    for (const kind of ["spoilage", "siege rations", "garrison feed", "depot conversions", "structure builds"]) {
        assert.ok(storesLedgerEmptyLine({ provisions: 0, materialPoints: 0 }).includes(kind), kind);
    }
});

// ── The strings the Village Stores UI contract pins ────────────────────────
//
// These labels are load-bearing for the shipped e2e specs. The signposting
// pass added SIBLINGS to them; renaming or removing one is the regression this
// guards. Source-level, because the screens that own them cannot be rendered
// in node without their whole App graph.

test("the Inventory signpost is gated on the SAME capability both destinations are", () => {
    // A signpost may not promise a closed kitchen. Cafeteria.tsx hides its whole
    // "Cook for the village" section behind
    // capabilityAdmissionAllowed(useCapabilityViewAvailability("villageWar")),
    // and TownHall.tsx gates the stores rows on the identical read. With that
    // capability unavailable an ungated signpost sent a hunter to a Cafeteria
    // with no kitchen, and told a ration-pack holder their pack "becomes one
    // ration in your village's stores" when the donation actually falls through
    // to a loose treasury item. Source-level, because Inventory cannot be
    // rendered in node without its whole App graph.
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const inventory = read("../screens/Inventory.tsx");
    assert.ok(
        inventory.includes('capabilityAdmissionAllowed(useCapabilityViewAvailability("villageWar"))'),
        "Inventory.tsx must read the villageWar capability the way Cafeteria.tsx does",
    );
    assert.ok(
        /const selectedStoresSignpost = storesOpen \? storesItemSignpost\(/u.test(inventory),
        "Inventory.tsx must gate storesItemSignpost on that read, failing CLOSED",
    );
    // Both destinations still gate themselves — this fix is a THIRD gate on the
    // same fact, not a move of an existing one.
    assert.ok(read("../screens/Cafeteria.tsx").includes('capabilityAdmissionAllowed(useCapabilityViewAvailability("villageWar"))'));
    assert.ok(read("../screens/TownHall.tsx").includes("const storesOpen = sectorMapOpen;"));
});

test("the Town Hall supply banner never reads an UNREAD provisions field as 0", () => {
    // storesLoaded is an OR across three independent facts, so a treasury
    // carrying materialPoints but no provisions key reads as loaded. Passing
    // `storesView.provisions` (which is `?? 0`) then let an unread field assert
    // "The stores stand empty" at a village mid-siege. The known-ness has to be
    // derived PER FIELD and the banner handed null, which villageSupplyCall
    // already treats as silence.
    const townHall = readFileSync(new URL("../screens/TownHall.tsx", import.meta.url), "utf8");
    assert.ok(
        townHall.includes("const provisionsKnown = state.treasury.provisions !== undefined || storesSnapshot?.provisions !== undefined;"),
        "TownHall.tsx must derive provisions known-ness on its own",
    );
    assert.ok(
        townHall.includes("provisions: provisionsKnown ? storesView.provisions : null,"),
        "the supply call must be handed null, not 0, for an unread provisions field",
    );
    assert.doesNotMatch(townHall, /provisions: storesLoaded \? storesView\.provisions : null/u);
    // And the predicate really is silent on null — the guarantee the call site leans on.
    assert.equal(villageSupplyCall({ ...base, provisions: null, activeWars: 2, unfedWars: 2 }), null);
});

test("the contracted Village Stores labels survive verbatim", () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const cafeteria = read("../screens/Cafeteria.tsx");
    const townHall = read("../screens/TownHall.tsx");
    const sectorPool = read("./sector-pool.ts");
    for (const needle of ["Cook for the village"]) {
        assert.ok(cafeteria.includes(needle), `Cafeteria.tsx must keep "${needle}"`);
    }
    for (const needle of ["Donate to Provisions", "Donate to Materials", "Donate Item", "Supply log", "<strong>Provisions:</strong>", "<strong>Materials:</strong>"]) {
        assert.ok(townHall.includes(needle), `TownHall.tsx must keep "${needle}"`);
    }
    for (const needle of ["Gathered today", "Picked clean"]) {
        assert.ok(sectorPool.includes(needle), `sector-pool.ts must keep "${needle}"`);
    }
});
