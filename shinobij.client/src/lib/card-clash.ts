/*
 * Shinobi Card Clash — the engine for the standalone 3-location card game that
 * replaces the old "Shinobi Tiles" side-number duel in the Card Hall.
 *
 * This is a Marvel-Snap-style game: 6 turns, a ramping chakra economy, three
 * randomly-picked locations, and a "win 2 of 3" finish. It reuses the existing
 * 150-card TileCard catalog (id/name/element/rarity/art) and DERIVES new
 * Clash-style stats (cost / power / role / ability) from the old top/right/
 * bottom/left tile values, so no card has to be hand-rewritten.
 *
 * Pure data + pure functions: no React, no App state, no I/O. Every state
 * transition returns a NEW CardClashMatchState (immutable updates) so the
 * owning screen component can keep match state in useState and re-render
 * predictably. Shuffles/random picks use Math.random — this is a client-side
 * PvE minigame with no determinism contract (unlike the ranked pet sims).
 */

import type { TileCard } from "../data/tile-cards";

// ── Roles & abilities ──────────────────────────────────────────────────────

export type CardClashRole =
    | "fighter"
    | "defender"
    | "support"
    | "assassin"
    | "summoner"
    | "control";

export type CardClashAbilityType =
    | "none"
    | "onRevealBuffSelf"
    | "onRevealBuffAlliesHere"
    | "onRevealDebuffEnemiesHere"
    | "ongoingElementBoostHere"
    | "moveAfterReveal"
    | "protectSelf"
    | "drawCard"
    | "discountNextCard"
    | "summonClone"
    // Marquee (legendary) effects — bigger, board-wide swings.
    | "onRevealBuffAlliesEverywhere"
    | "onRevealDebuffEnemiesEverywhere"
    | "onRevealDoubleSelf";

export type CardClashCard = TileCard & {
    cost: number;
    power: number;
    role: CardClashRole;
    abilityType: CardClashAbilityType;
    abilityText: string;
};

// ── Card conversion: old tile stats → new Clash stats ───────────────────────

function cardAverage(card: TileCard): number {
    return (card.top + card.right + card.bottom + card.left) / 4;
}

function cardSpread(card: TileCard): number {
    return (
        Math.max(card.top, card.right, card.bottom, card.left) -
        Math.min(card.top, card.right, card.bottom, card.left)
    );
}

export function deriveCardRole(card: TileCard, spread: number): CardClashRole {
    const name = card.name.toLowerCase();

    if (
        name.includes("clone") ||
        name.includes("spirit") ||
        name.includes("wisp") ||
        name.includes("summon")
    )
        return "summoner";

    if (
        name.includes("guard") ||
        name.includes("turtle") ||
        name.includes("golem") ||
        name.includes("behemoth") ||
        name.includes("titan")
    )
        return "defender";

    if (
        name.includes("spy") ||
        name.includes("assassin") ||
        name.includes("thief") ||
        name.includes("stalker") ||
        name.includes("reaper")
    )
        return "assassin";

    if (
        name.includes("monk") ||
        name.includes("sage") ||
        name.includes("keeper") ||
        name.includes("messenger")
    )
        return "support";

    if (card.element === "Ice" || card.element === "Shadow") return "control";

    if (spread >= 30) return "fighter";

    return "fighter";
}

export function deriveAbilityType(
    card: TileCard,
    role: CardClashRole,
): CardClashAbilityType {
    // Plain commons stay vanilla so beginners have reliable "just power" cards.
    if (card.rarity === "common" && card.element === "None") return "none";

    if (role === "summoner") return "summonClone";
    if (role === "support" && card.element === "Neutral") return "drawCard";
    if (role === "defender") return "protectSelf";

    switch (card.element) {
        case "Fire":
            return "onRevealDebuffEnemiesHere";
        case "Water":
            return "onRevealBuffAlliesHere";
        case "Earth":
            return "protectSelf";
        case "Wind":
            return "moveAfterReveal";
        case "Lightning":
            return "discountNextCard";
        case "Shadow":
            return "onRevealDebuffEnemiesHere";
        case "Ice":
            return "onRevealDebuffEnemiesHere";
        case "Neutral":
            return "onRevealBuffSelf";
        case "None":
        default:
            return "onRevealBuffSelf";
    }
}

export function describeAbility(
    abilityType: CardClashAbilityType,
    card: TileCard,
): string {
    switch (abilityType) {
        case "none":
            return "No ability. Reliable raw power.";
        case "onRevealBuffSelf":
            return "On Reveal: This card gains +2 Power.";
        case "onRevealBuffAlliesHere":
            return "On Reveal: Your other cards here gain +1 Power.";
        case "onRevealDebuffEnemiesHere":
            return "On Reveal: Enemy cards here lose -1 Power.";
        case "ongoingElementBoostHere":
            return `Ongoing: Your ${card.element} cards here have +1 Power.`;
        case "moveAfterReveal":
            return "On Reveal: Move this to another friendly location with space.";
        case "protectSelf":
            return "Ongoing: This card cannot be reduced below its base Power.";
        case "drawCard":
            return "On Reveal: Draw 1 card.";
        case "discountNextCard":
            return "On Reveal: Your next card costs 1 less.";
        case "summonClone":
            return "On Reveal: Add a 1-Power Shadow Clone here if there is space.";
        case "onRevealBuffAlliesEverywhere":
            return "On Reveal: All your other cards gain +1 Power.";
        case "onRevealDebuffEnemiesEverywhere":
            return "On Reveal: All enemy cards lose -1 Power.";
        case "onRevealDoubleSelf":
            return "On Reveal: Double this card's Power.";
        default:
            return "No ability.";
    }
}

// Hand-tuned marquee abilities for the 30 legendaries, so each god-tier card
// feels unique instead of element-templated. They're still gated by high cost
// (4-6 chakra → turn-5/6 plays) + the max-2-legendary deck rule, so a strong
// On-Reveal isn't an auto-win.
export const LEGENDARY_ABILITY_OVERRIDES: Record<string, CardClashAbilityType> = {
    "tc-121": "protectSelf",                       // Worldroot Behemoth — immovable roots
    "tc-122": "onRevealDoubleSelf",                // Stormgod Dragon — breath splits the sky
    "tc-123": "onRevealBuffAlliesEverywhere",      // Ocean Sovereign — rallies every tide
    "tc-124": "onRevealDebuffEnemiesEverywhere",   // Inferno Sovereign — living flame
    "tc-125": "moveAfterReveal",                   // Sky King Garuda — wings beat hurricanes
    "tc-126": "onRevealDebuffEnemiesEverywhere",   // Eclipse Sovereign — eats the sun
    "tc-127": "protectSelf",                       // Eternal Glacier King — frozen eternal
    "tc-128": "drawCard",                          // Grand Sage of Balance — boundless insight
    "tc-129": "onRevealDoubleSelf",                // Forgotten Hokage — undying skill
    "tc-130": "onRevealDebuffEnemiesEverywhere",   // World-Ender Titan — apocalypse
    "tc-131": "onRevealDebuffEnemiesHere",         // Heaven-Shatter Drake — one bolt
    "tc-132": "onRevealBuffAlliesHere",            // Abyssal Leviathan — rallies the deep
    "tc-133": "onRevealDoubleSelf",                // Phoenix Emperor — eternal rebirth
    "tc-134": "discountNextCard",                  // Storm Empress — rules every cloud
    "tc-135": "onRevealDebuffEnemiesEverywhere",   // Void Devourer — hungers for all light
    "tc-136": "onRevealDebuffEnemiesHere",         // Frostfall Empress — snow obeys
    "tc-137": "onRevealBuffAlliesEverywhere",      // Zen Master Eternal — perfect harmony
    "tc-138": "drawCard",                          // Legendary Wanderer — knows every blade
    "tc-139": "protectSelf",                       // Primordial Dragon — older than villages
    "tc-140": "onRevealDebuffEnemiesEverywhere",   // Plasma God Beast — lightning made aware
    "tc-141": "onRevealBuffAlliesEverywhere",      // Tidal God Beast — the ocean's will
    "tc-142": "onRevealDoubleSelf",                // Solar God Beast — a fragment of the sun
    "tc-143": "moveAfterReveal",                   // Tempest God Beast — living tornado
    "tc-144": "onRevealDebuffEnemiesEverywhere",   // Shadow God Beast — born in the eclipse
    "tc-145": "onRevealDebuffEnemiesHere",         // Frost God Beast — polar night
    "tc-146": "onRevealBuffAlliesEverywhere",      // Equilibrium God — perfect in every measure
    "tc-147": "onRevealDoubleSelf",                // Final Shinobi — last living blade
    "tc-148": "onRevealDebuffEnemiesEverywhere",   // Demon-King Slayer — ended the demon king
    "tc-149": "onRevealDoubleSelf",                // Cosmic Phoenix — soars between stars
    "tc-150": "onRevealBuffAlliesEverywhere",      // World-Eater Naga — coils swallow continents
};

export function deriveCardClashCard(card: TileCard): CardClashCard {
    const avg = cardAverage(card);
    const spread = cardSpread(card);

    let cost = 1;
    let power = 1;

    if (card.rarity === "common") {
        cost = avg < 24 ? 1 : avg < 32 ? 2 : 3;
        power = Math.round(avg / 8);
    } else if (card.rarity === "rare") {
        cost = avg < 45 ? 2 : avg < 56 ? 3 : 4;
        power = Math.round(avg / 8);
    } else if (card.rarity === "epic") {
        cost = avg < 68 ? 3 : avg < 78 ? 4 : 5;
        power = Math.round(avg / 8);
    } else if (card.rarity === "legendary") {
        cost = avg < 84 ? 4 : avg < 91 ? 5 : 6;
        power = Math.round(avg / 8);
    }

    cost = Math.max(1, Math.min(6, cost));
    power = Math.max(1, Math.min(12, power));

    const role = deriveCardRole(card, spread);
    const abilityType = LEGENDARY_ABILITY_OVERRIDES[card.id] ?? deriveAbilityType(card, role);
    const abilityText = describeAbility(abilityType, card);

    return { ...card, cost, power, role, abilityType, abilityText };
}

/** Convert a full TileCard catalog into Clash cards (used by the screen). */
export function toClashCards(cards: TileCard[]): CardClashCard[] {
    return cards.map(deriveCardClashCard);
}

/** Index Clash cards by id for fast deck → card resolution. */
export function indexClashCards(
    cards: CardClashCard[],
): Record<string, CardClashCard> {
    const map: Record<string, CardClashCard> = {};
    for (const c of cards) map[c.id] = c;
    return map;
}

// ── Locations ───────────────────────────────────────────────────────────────

export type CardClashLocationEffectType =
    | "none"
    | "fireBonus"
    | "waterBonus"
    | "earthBonus"
    | "windBonus"
    | "lightningBonus"
    | "shadowBonus"
    | "iceBonus"
    | "commonBonus"
    | "rareBonus"
    | "epicLegendaryBonus"
    | "lowCostBonus"
    | "highCostBonus"
    | "neutralBonus"
    | "noneBonus"
    | "midCostBonus"
    | "allHereBonus"
    | "lowPowerBonus"
    | "highPowerBonus";

export type CardClashLocation = {
    id: string;
    name: string;
    description: string;
    effectType: CardClashLocationEffectType;
};

export const CARD_CLASH_LOCATIONS: CardClashLocation[] = [
    { id: "training-ground", name: "Training Ground", description: "No special effect.", effectType: "none" },
    { id: "volcano-pass", name: "Volcano Pass", description: "Fire cards here have +2 Power.", effectType: "fireBonus" },
    { id: "river-shrine", name: "River Shrine", description: "Water cards here have +2 Power.", effectType: "waterBonus" },
    { id: "stone-gate", name: "Stone Gate", description: "Earth cards here have +2 Power.", effectType: "earthBonus" },
    { id: "wind-bridge", name: "Wind Bridge", description: "Wind cards here have +2 Power.", effectType: "windBonus" },
    { id: "storm-peak", name: "Storm Peak", description: "Lightning cards here have +2 Power.", effectType: "lightningBonus" },
    { id: "moonshadow-ruins", name: "Moonshadow Ruins", description: "Shadow cards here have +2 Power.", effectType: "shadowBonus" },
    { id: "frozen-lake", name: "Frozen Lake", description: "Ice cards here have +2 Power.", effectType: "iceBonus" },
    { id: "ninja-academy", name: "Ninja Academy", description: "Common cards here have +2 Power.", effectType: "commonBonus" },
    { id: "black-market", name: "Black Market", description: "Rare cards here have +2 Power.", effectType: "rareBonus" },
    { id: "hollow-gate", name: "Hollow Gate", description: "Epic and Legendary cards here have +2 Power.", effectType: "epicLegendaryBonus" },
    { id: "hidden-dojo", name: "Hidden Dojo", description: "Cards that cost 1 or 2 have +1 Power here.", effectType: "lowCostBonus" },
    { id: "kage-summit", name: "Kage Summit", description: "Cards that cost 5 or 6 have +2 Power here.", effectType: "highCostBonus" },
    { id: "balance-shrine", name: "Balance Shrine", description: "Neutral cards here have +2 Power.", effectType: "neutralBonus" },
    { id: "forgotten-battlefield", name: "Forgotten Battlefield", description: "Elementless cards here have +2 Power.", effectType: "noneBonus" },
    { id: "chunin-arena", name: "Chunin Exam Arena", description: "Cards that cost 3 or 4 have +2 Power here.", effectType: "midCostBonus" },
    { id: "sacred-spring", name: "Sacred Hot Spring", description: "All cards here have +1 Power.", effectType: "allHereBonus" },
    { id: "hidden-village", name: "Hidden Village", description: "Cards with 3 or less Power here have +2 Power.", effectType: "lowPowerBonus" },
    { id: "legends-battlefield", name: "Battlefield of Legends", description: "Cards with 8 or more Power here have +2 Power.", effectType: "highPowerBonus" },
];

// ── Match state ─────────────────────────────────────────────────────────────

export type CardClashSide = "player" | "opponent";

export type CardClashPlayedCard = CardClashCard & {
    instanceId: string;
    owner: CardClashSide;
    basePower: number;
    currentPower: number;
    locationIndex: number;
    revealed: boolean;
    protectedFromReduction?: boolean;
    /** True for engine-summoned tokens (Shadow Clone) — never returned to hand. */
    isToken?: boolean;
};

export type CardClashLocationState = {
    location: CardClashLocation;
    playerCards: CardClashPlayedCard[];
    opponentCards: CardClashPlayedCard[];
};

export type CardClashResult = "player" | "opponent" | "draw";

export type CardClashMatchState = {
    turn: number;
    maxTurns: 6;
    playerDeck: CardClashCard[];
    opponentDeck: CardClashCard[];
    playerHand: CardClashCard[];
    opponentHand: CardClashCard[];
    locations: CardClashLocationState[];
    playerChakra: number;
    opponentChakra: number;
    playerNextCardDiscount: number;
    opponentNextCardDiscount: number;
    status: "playing" | "complete";
    winner?: CardClashResult;
    log: string[];
    /** Monotonic counter for unique played-card instanceIds. */
    instanceCounter: number;
};

// ── Tokens & constants ──────────────────────────────────────────────────────

export const SHADOW_CLONE_CARD: CardClashCard = {
    id: "token-shadow-clone",
    name: "Shadow Clone",
    element: "Neutral",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    rarity: "common",
    description: "A temporary clone created by a card effect.",
    cost: 0,
    power: 1,
    role: "summoner",
    abilityType: "none",
    abilityText: "No ability.",
};

export const CARD_CLASH_DECK_SIZE = 12;
export const CARD_CLASH_MAX_HAND = 7;
export const CARD_CLASH_MAX_TURNS = 6;
export const CARD_CLASH_LOCATION_SLOTS = 4;
export const CARD_CLASH_MAX_LEGENDARY = 2;

export const CARD_CLASH_WIN_RYO = 50;
export const CARD_CLASH_DRAW_RYO = 15;
export const CARD_CLASH_LOSS_RYO = 5;
export const CARD_CLASH_DAILY_BONUS_RYO = 250;

// ── Deck-building rules ─────────────────────────────────────────────────────

/** Max copies of one card id allowed in a deck, by rarity. */
export function deckCopyLimit(rarity: TileCard["rarity"]): number {
    return rarity === "common" || rarity === "rare" ? 2 : 1;
}

export type DeckValidation = { valid: boolean; errors: string[] };

/** Validate a 12-card deck against the copy / legendary-cap rules. */
export function validateDeck(
    deckIds: string[],
    cardsById: Record<string, CardClashCard>,
): DeckValidation {
    const errors: string[] = [];

    if (deckIds.length !== CARD_CLASH_DECK_SIZE)
        errors.push(`Deck must contain exactly ${CARD_CLASH_DECK_SIZE} cards (currently ${deckIds.length}).`);

    const counts: Record<string, number> = {};
    let legendaryCount = 0;
    for (const id of deckIds) {
        counts[id] = (counts[id] ?? 0) + 1;
        const card = cardsById[id];
        if (!card) {
            errors.push(`Unknown card "${id}" in deck.`);
            continue;
        }
        if (card.rarity === "legendary") legendaryCount++;
    }

    for (const [id, count] of Object.entries(counts)) {
        const card = cardsById[id];
        if (!card) continue;
        const limit = deckCopyLimit(card.rarity);
        if (count > limit)
            errors.push(`Too many copies of ${card.name} (${count}/${limit} allowed for ${card.rarity}).`);
    }

    if (legendaryCount > CARD_CLASH_MAX_LEGENDARY)
        errors.push(`Too many Legendary cards (${legendaryCount}/${CARD_CLASH_MAX_LEGENDARY} allowed).`);

    return { valid: errors.length === 0, errors };
}

/** Can `cardId` be added to the current deck without breaking a rule? */
export function canAddToDeck(
    deckIds: string[],
    cardId: string,
    cardsById: Record<string, CardClashCard>,
): { ok: boolean; reason?: string } {
    const card = cardsById[cardId];
    if (!card) return { ok: false, reason: "Unknown card." };
    if (deckIds.length >= CARD_CLASH_DECK_SIZE)
        return { ok: false, reason: `Deck is full (${CARD_CLASH_DECK_SIZE} cards).` };

    const copies = deckIds.filter((id) => id === cardId).length;
    const limit = deckCopyLimit(card.rarity);
    if (copies >= limit)
        return { ok: false, reason: `Max ${limit} cop${limit === 1 ? "y" : "ies"} of a ${card.rarity}.` };

    if (card.rarity === "legendary") {
        const legendaries = deckIds.filter((id) => cardsById[id]?.rarity === "legendary").length;
        if (legendaries >= CARD_CLASH_MAX_LEGENDARY)
            return { ok: false, reason: `Max ${CARD_CLASH_MAX_LEGENDARY} Legendary cards per deck.` };
    }

    return { ok: true };
}

/**
 * Build a legal 12-card deck that always works — used by embedded duels
 * (dungeon / world events) so a player who never opened the Deck Builder can
 * still be dropped into a match. Prefers the player's strongest owned cards,
 * uses copy limits, then pads from the catalog's commons/rares to guarantee 12.
 */
export function buildPlayableDeck(
    ownedIds: string[],
    cardsById: Record<string, CardClashCard>,
    catalog: CardClashCard[],
): string[] {
    const deck: string[] = [];
    const counts: Record<string, number> = {};
    let legendary = 0;

    const tryAdd = (card: CardClashCard | undefined): boolean => {
        if (!card) return false;
        if (deck.length >= CARD_CLASH_DECK_SIZE) return false;
        if ((counts[card.id] ?? 0) >= deckCopyLimit(card.rarity)) return false;
        if (card.rarity === "legendary" && legendary >= CARD_CLASH_MAX_LEGENDARY) return false;
        deck.push(card.id);
        counts[card.id] = (counts[card.id] ?? 0) + 1;
        if (card.rarity === "legendary") legendary++;
        return true;
    };

    const owned = ownedIds
        .map((id) => cardsById[id])
        .filter((c): c is CardClashCard => Boolean(c))
        .sort((a, b) => b.power - a.power || a.cost - b.cost);

    // Two passes so common/rare second copies get used before padding.
    for (const c of owned) { if (deck.length >= CARD_CLASH_DECK_SIZE) break; tryAdd(c); }
    for (const c of owned) { if (deck.length >= CARD_CLASH_DECK_SIZE) break; tryAdd(c); }

    if (deck.length < CARD_CLASH_DECK_SIZE) {
        const filler = catalog
            .filter((c) => c.rarity === "common" || c.rarity === "rare")
            .sort((a, b) => a.cost - b.cost);
        let i = 0;
        let guard = 0;
        while (deck.length < CARD_CLASH_DECK_SIZE && filler.length > 0 && guard < 2000) {
            guard++;
            tryAdd(filler[i % filler.length]);
            i++;
        }
    }

    return deck.slice(0, CARD_CLASH_DECK_SIZE);
}

// ── Random helpers ──────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function pickRandomLocations(count: number): CardClashLocation[] {
    return shuffle(CARD_CLASH_LOCATIONS).slice(0, count);
}

// ── AI deck generation ──────────────────────────────────────────────────────

type RarityWeights = Partial<Record<TileCard["rarity"], number>>;

function aiRarityWeights(playerLevel: number): RarityWeights {
    if (playerLevel >= 50)
        return { common: 0.35, rare: 0.35, epic: 0.22, legendary: 0.08 };
    if (playerLevel >= 25) return { common: 0.45, rare: 0.4, epic: 0.15 };
    return { common: 0.6, rare: 0.4 };
}

function weightedRarity(weights: RarityWeights): TileCard["rarity"] {
    const entries = Object.entries(weights) as [TileCard["rarity"], number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [rarity, w] of entries) {
        roll -= w;
        if (roll <= 0) return rarity;
    }
    return entries[0][0];
}

/**
 * Build a legal 12-card AI deck from the built-in catalog (NOT the player's
 * collection). Honours the same copy / legendary-cap rules as a player deck so
 * the opponent never fields an illegal pile.
 */
export function generateAiDeck(
    catalog: CardClashCard[],
    playerLevel: number,
): CardClashCard[] {
    const weights = aiRarityWeights(playerLevel);
    const allowed = new Set(Object.keys(weights));
    const byRarity: Record<string, CardClashCard[]> = {};
    for (const c of catalog) {
        if (!allowed.has(c.rarity)) continue;
        (byRarity[c.rarity] ??= []).push(c);
    }

    const deck: CardClashCard[] = [];
    const counts: Record<string, number> = {};
    let legendaryCount = 0;
    let safety = 0;

    while (deck.length < CARD_CLASH_DECK_SIZE && safety < 500) {
        safety++;
        const rarity = weightedRarity(weights);
        const pool = byRarity[rarity];
        if (!pool || pool.length === 0) continue;
        const card = pool[Math.floor(Math.random() * pool.length)];
        if (card.rarity === "legendary" && legendaryCount >= CARD_CLASH_MAX_LEGENDARY)
            continue;
        if ((counts[card.id] ?? 0) >= deckCopyLimit(card.rarity)) continue;
        deck.push(card);
        counts[card.id] = (counts[card.id] ?? 0) + 1;
        if (card.rarity === "legendary") legendaryCount++;
    }

    // Safety backfill: if weighting starved the deck (tiny catalog), top up from
    // any remaining commons/rares so the AI always has 12 cards.
    if (deck.length < CARD_CLASH_DECK_SIZE) {
        const filler = catalog.filter((c) => c.rarity === "common" || c.rarity === "rare");
        let i = 0;
        while (deck.length < CARD_CLASH_DECK_SIZE && filler.length > 0) {
            const card = filler[i % filler.length];
            if ((counts[card.id] ?? 0) < deckCopyLimit(card.rarity)) {
                deck.push(card);
                counts[card.id] = (counts[card.id] ?? 0) + 1;
            } else if (i > filler.length * 3) {
                break; // exhausted distinct copies
            }
            i++;
        }
    }

    return shuffle(deck);
}

// ── Match creation ──────────────────────────────────────────────────────────

const OPENING_HAND = 3;

/**
 * Create a fresh match: convert the player deck, generate + shuffle an AI deck,
 * pick 3 random locations, deal opening hands, and set turn 1 / 1 chakra.
 */
export function createCardClashMatch(
    playerDeckIds: string[],
    allCards: TileCard[],
    playerLevel: number,
): CardClashMatchState {
    const catalog = toClashCards(allCards);
    const byId = indexClashCards(catalog);

    const playerDeckFull = playerDeckIds
        .map((id) => byId[id])
        .filter((c): c is CardClashCard => Boolean(c));

    let playerDeck = shuffle(playerDeckFull);
    let opponentDeck = generateAiDeck(catalog, playerLevel);

    const playerHand = playerDeck.slice(0, OPENING_HAND);
    playerDeck = playerDeck.slice(OPENING_HAND);
    const opponentHand = opponentDeck.slice(0, OPENING_HAND);
    opponentDeck = opponentDeck.slice(OPENING_HAND);

    const locations: CardClashLocationState[] = pickRandomLocations(3).map((location) => ({
        location,
        playerCards: [],
        opponentCards: [],
    }));

    return {
        turn: 1,
        maxTurns: CARD_CLASH_MAX_TURNS,
        playerDeck,
        opponentDeck,
        playerHand,
        opponentHand,
        locations,
        playerChakra: 1,
        opponentChakra: 1,
        playerNextCardDiscount: 0,
        opponentNextCardDiscount: 0,
        status: "playing",
        winner: undefined,
        log: ["⚔️ The clash begins! Turn 1 — you have 1 Chakra."],
        instanceCounter: 0,
    };
}

// ── Power & scoring ─────────────────────────────────────────────────────────

export function getLocationPowerBonus(
    card: CardClashPlayedCard,
    location: CardClashLocation,
): number {
    switch (location.effectType) {
        case "fireBonus":
            return card.element === "Fire" ? 2 : 0;
        case "waterBonus":
            return card.element === "Water" ? 2 : 0;
        case "earthBonus":
            return card.element === "Earth" ? 2 : 0;
        case "windBonus":
            return card.element === "Wind" ? 2 : 0;
        case "lightningBonus":
            return card.element === "Lightning" ? 2 : 0;
        case "shadowBonus":
            return card.element === "Shadow" ? 2 : 0;
        case "iceBonus":
            return card.element === "Ice" ? 2 : 0;
        case "commonBonus":
            return card.rarity === "common" ? 2 : 0;
        case "rareBonus":
            return card.rarity === "rare" ? 2 : 0;
        case "epicLegendaryBonus":
            return card.rarity === "epic" || card.rarity === "legendary" ? 2 : 0;
        case "lowCostBonus":
            return card.cost <= 2 ? 1 : 0;
        case "highCostBonus":
            return card.cost >= 5 ? 2 : 0;
        case "neutralBonus":
            return card.element === "Neutral" ? 2 : 0;
        case "noneBonus":
            return card.element === "None" ? 2 : 0;
        case "midCostBonus":
            return card.cost === 3 || card.cost === 4 ? 2 : 0;
        case "allHereBonus":
            return 1;
        case "lowPowerBonus":
            return card.power <= 3 ? 2 : 0;
        case "highPowerBonus":
            return card.power >= 8 ? 2 : 0;
        case "none":
        default:
            return 0;
    }
}

/** Displayed power = permanent match buffs/debuffs + the location's bonus. */
export function getCardDisplayedPower(
    card: CardClashPlayedCard,
    location: CardClashLocation,
): number {
    return card.currentPower + getLocationPowerBonus(card, location);
}

export function locationSidePower(
    loc: CardClashLocationState,
    side: CardClashSide,
): number {
    const cards = side === "player" ? loc.playerCards : loc.opponentCards;
    return cards.reduce((sum, c) => sum + getCardDisplayedPower(c, loc.location), 0);
}

export function totalBoardPower(
    state: CardClashMatchState,
    side: CardClashSide,
): number {
    return state.locations.reduce((sum, loc) => sum + locationSidePower(loc, side), 0);
}

/** Decide the winner: most locations won, tiebreak on total board power. */
export function determineWinner(state: CardClashMatchState): CardClashResult {
    let playerLocs = 0;
    let opponentLocs = 0;
    for (const loc of state.locations) {
        const p = locationSidePower(loc, "player");
        const o = locationSidePower(loc, "opponent");
        if (p > o) playerLocs++;
        else if (o > p) opponentLocs++;
    }
    if (playerLocs > opponentLocs) return "player";
    if (opponentLocs > playerLocs) return "opponent";

    const pPower = totalBoardPower(state, "player");
    const oPower = totalBoardPower(state, "opponent");
    if (pPower > oPower) return "player";
    if (oPower > pPower) return "opponent";
    return "draw";
}

// ── Effective cost ──────────────────────────────────────────────────────────

export function getEffectiveCost(card: CardClashCard, discount: number): number {
    return Math.max(1, card.cost - discount);
}

// ── Immutable state helpers ─────────────────────────────────────────────────

function chakraFor(state: CardClashMatchState, side: CardClashSide): number {
    return side === "player" ? state.playerChakra : state.opponentChakra;
}

function discountFor(state: CardClashMatchState, side: CardClashSide): number {
    return side === "player" ? state.playerNextCardDiscount : state.opponentNextCardDiscount;
}

function handFor(state: CardClashMatchState, side: CardClashSide): CardClashCard[] {
    return side === "player" ? state.playerHand : state.opponentHand;
}

function withSideCards(
    loc: CardClashLocationState,
    side: CardClashSide,
    cards: CardClashPlayedCard[],
): CardClashLocationState {
    return side === "player"
        ? { ...loc, playerCards: cards }
        : { ...loc, opponentCards: cards };
}

function sideCards(loc: CardClashLocationState, side: CardClashSide): CardClashPlayedCard[] {
    return side === "player" ? loc.playerCards : loc.opponentCards;
}

/** Find a played card (and where it lives) by instanceId. */
function findPlayed(
    state: CardClashMatchState,
    instanceId: string,
): { locIndex: number; side: CardClashSide } | null {
    for (let li = 0; li < state.locations.length; li++) {
        const loc = state.locations[li];
        if (loc.playerCards.some((c) => c.instanceId === instanceId))
            return { locIndex: li, side: "player" };
        if (loc.opponentCards.some((c) => c.instanceId === instanceId))
            return { locIndex: li, side: "opponent" };
    }
    return null;
}

/** Draw one card from a side's deck into its hand (respects max hand). */
function drawForSide(state: CardClashMatchState, side: CardClashSide): CardClashMatchState {
    const deck = side === "player" ? state.playerDeck : state.opponentDeck;
    const hand = handFor(state, side);
    if (deck.length === 0 || hand.length >= CARD_CLASH_MAX_HAND) return state;
    const [top, ...rest] = deck;
    return side === "player"
        ? { ...state, playerDeck: rest, playerHand: [...state.playerHand, top] }
        : { ...state, opponentDeck: rest, opponentHand: [...state.opponentHand, top] };
}

// ── On-reveal effects ───────────────────────────────────────────────────────

/**
 * Apply the just-revealed card's On-Reveal / Ongoing-set effect. Returns a new
 * state. First-pass effect set per the design doc — kept intentionally simple.
 */
export function applyOnRevealEffect(
    state: CardClashMatchState,
    cardInstanceId: string,
): CardClashMatchState {
    const where = findPlayed(state, cardInstanceId);
    if (!where) return state;
    const { locIndex, side } = where;
    const loc = state.locations[locIndex];
    const self = sideCards(loc, side).find((c) => c.instanceId === cardInstanceId);
    if (!self) return state;

    const isPlayer = side === "player";
    const who = isPlayer ? "You" : "The opponent";

    switch (self.abilityType) {
        case "onRevealBuffSelf": {
            const cards = sideCards(loc, side).map((c) =>
                c.instanceId === cardInstanceId
                    ? { ...c, currentPower: c.currentPower + 2 }
                    : c,
            );
            const locations = replaceLocation(state, locIndex, withSideCards(loc, side, cards));
            return { ...state, locations, log: [...state.log, `✨ ${self.name} gains +2 Power.`] };
        }

        case "onRevealBuffAlliesHere": {
            const cards = sideCards(loc, side).map((c) =>
                c.instanceId !== cardInstanceId
                    ? { ...c, currentPower: c.currentPower + 1 }
                    : c,
            );
            const locations = replaceLocation(state, locIndex, withSideCards(loc, side, cards));
            return {
                ...state,
                locations,
                log: [...state.log, `🌊 ${self.name} boosts allies at ${loc.location.name} (+1 Power).`],
            };
        }

        case "onRevealDebuffEnemiesHere": {
            const enemySide: CardClashSide = isPlayer ? "opponent" : "player";
            const enemies = sideCards(loc, enemySide).map((c) => {
                const floor = c.protectedFromReduction ? c.basePower : 0;
                return { ...c, currentPower: Math.max(floor, c.currentPower - 1) };
            });
            const locations = replaceLocation(state, locIndex, withSideCards(loc, enemySide, enemies));
            return {
                ...state,
                locations,
                log: [...state.log, `🔥 ${self.name} weakens enemies at ${loc.location.name} (-1 Power).`],
            };
        }

        case "protectSelf": {
            const cards = sideCards(loc, side).map((c) =>
                c.instanceId === cardInstanceId ? { ...c, protectedFromReduction: true } : c,
            );
            const locations = replaceLocation(state, locIndex, withSideCards(loc, side, cards));
            return { ...state, locations, log: [...state.log, `🛡️ ${self.name} braces — its Power can't be reduced below base.`] };
        }

        case "moveAfterReveal": {
            const target = state.locations.findIndex(
                (l, i) => i !== locIndex && sideCards(l, side).length < CARD_CLASH_LOCATION_SLOTS,
            );
            if (target === -1) return state; // no space — stays put
            const fromCards = sideCards(loc, side).filter((c) => c.instanceId !== cardInstanceId);
            const moved = { ...self, locationIndex: target };
            const toLoc = state.locations[target];
            const toCards = [...sideCards(toLoc, side), moved];
            let locations = replaceLocation(state, locIndex, withSideCards(loc, side, fromCards));
            locations = locations.map((l, i) => (i === target ? withSideCards(l, side, toCards) : l));
            return {
                ...state,
                locations,
                log: [...state.log, `💨 ${self.name} slips to ${toLoc.location.name}.`],
            };
        }

        case "drawCard": {
            const drawn = drawForSide(state, side);
            if (drawn === state) return state;
            return { ...drawn, log: [...drawn.log, `📜 ${who} draw a card.`] };
        }

        case "discountNextCard": {
            return isPlayer
                ? { ...state, playerNextCardDiscount: 1, log: [...state.log, `⚡ ${self.name} — your next card costs 1 less.`] }
                : { ...state, opponentNextCardDiscount: 1, log: [...state.log, `⚡ The opponent's next card costs 1 less.`] };
        }

        case "summonClone": {
            if (sideCards(loc, side).length >= CARD_CLASH_LOCATION_SLOTS) return state;
            const clone: CardClashPlayedCard = {
                ...SHADOW_CLONE_CARD,
                instanceId: `clash-${state.instanceCounter}`,
                owner: side,
                basePower: SHADOW_CLONE_CARD.power,
                currentPower: SHADOW_CLONE_CARD.power,
                locationIndex: locIndex,
                revealed: true,
                isToken: true,
            };
            const cards = [...sideCards(loc, side), clone];
            const locations = replaceLocation(state, locIndex, withSideCards(loc, side, cards));
            return {
                ...state,
                locations,
                instanceCounter: state.instanceCounter + 1,
                log: [...state.log, `🌀 ${self.name} summons a Shadow Clone at ${loc.location.name}.`],
            };
        }

        case "onRevealDoubleSelf": {
            const cards = sideCards(loc, side).map((c) =>
                c.instanceId === cardInstanceId ? { ...c, currentPower: c.currentPower * 2 } : c,
            );
            const locations = replaceLocation(state, locIndex, withSideCards(loc, side, cards));
            return { ...state, locations, log: [...state.log, `🌟 ${self.name} doubles its Power!`] };
        }

        case "onRevealBuffAlliesEverywhere": {
            const locations = state.locations.map((l) =>
                withSideCards(l, side, sideCards(l, side).map((c) =>
                    c.instanceId === cardInstanceId ? c : { ...c, currentPower: c.currentPower + 1 },
                )),
            );
            return { ...state, locations, log: [...state.log, `👑 ${self.name} empowers your whole board (+1).`] };
        }

        case "onRevealDebuffEnemiesEverywhere": {
            const enemySide: CardClashSide = isPlayer ? "opponent" : "player";
            const locations = state.locations.map((l) =>
                withSideCards(l, enemySide, sideCards(l, enemySide).map((c) => {
                    const floor = c.protectedFromReduction ? c.basePower : 0;
                    return { ...c, currentPower: Math.max(floor, c.currentPower - 1) };
                })),
            );
            return { ...state, locations, log: [...state.log, `💀 ${self.name} weakens the enemy board (-1).`] };
        }

        case "ongoingElementBoostHere":
        case "none":
        default:
            return state;
    }
}

function replaceLocation(
    state: CardClashMatchState,
    index: number,
    next: CardClashLocationState,
): CardClashLocationState[] {
    return state.locations.map((l, i) => (i === index ? next : l));
}

// ── Playing a card ──────────────────────────────────────────────────────────

export type PlayResult = { state: CardClashMatchState; error?: string };

/**
 * Play the hand card at `handIndex` for `side` onto `locationIndex`. Validates
 * ownership, the 4-slot limit, and chakra; spends chakra; reveals immediately;
 * then applies the On-Reveal effect. Returns a NEW state (or the same state +
 * an error string when the move is illegal).
 */
export function playCard(
    state: CardClashMatchState,
    side: CardClashSide,
    handIndex: number,
    locationIndex: number,
): PlayResult {
    if (state.status !== "playing") return { state, error: "The match is over." };

    const hand = handFor(state, side);
    const card = hand[handIndex];
    if (!card) return { state, error: "That card is not in hand." };

    const loc = state.locations[locationIndex];
    if (!loc) return { state, error: "No such location." };
    if (sideCards(loc, side).length >= CARD_CLASH_LOCATION_SLOTS)
        return { state, error: "That location is full (max 4 cards)." };

    const discount = discountFor(state, side);
    const cost = getEffectiveCost(card, discount);
    if (cost > chakraFor(state, side))
        return { state, error: "Not enough Chakra." };

    const played: CardClashPlayedCard = {
        ...card,
        instanceId: `clash-${state.instanceCounter}`,
        owner: side,
        basePower: card.power,
        currentPower: card.power,
        locationIndex,
        revealed: true,
    };

    const nextHand = hand.filter((_, i) => i !== handIndex);
    const nextLocCards = [...sideCards(loc, side), played];
    const locations = replaceLocation(state, locationIndex, withSideCards(loc, side, nextLocCards));

    let next: CardClashMatchState = {
        ...state,
        locations,
        instanceCounter: state.instanceCounter + 1,
        playerHand: side === "player" ? nextHand : state.playerHand,
        opponentHand: side === "opponent" ? nextHand : state.opponentHand,
        playerChakra: side === "player" ? state.playerChakra - cost : state.playerChakra,
        opponentChakra: side === "opponent" ? state.opponentChakra - cost : state.opponentChakra,
        playerNextCardDiscount: side === "player" ? 0 : state.playerNextCardDiscount,
        opponentNextCardDiscount: side === "opponent" ? 0 : state.opponentNextCardDiscount,
        log: [
            ...state.log,
            `${side === "player" ? "🟦 You play" : "🟥 Opponent plays"} ${card.name} at ${loc.location.name}.`,
        ],
    };

    next = applyOnRevealEffect(next, played.instanceId);
    return { state: next };
}

// ── AI turn ─────────────────────────────────────────────────────────────────

/**
 * Greedy opponent: repeatedly play the affordable card with the best power-per-
 * chakra at the location where it helps most (prefers locations the AI is
 * losing, and counts the location's element/rarity/cost bonus). Plays until it
 * can no longer make a legal move.
 */
export function aiTakeTurn(state: CardClashMatchState): CardClashMatchState {
    let cur = state;
    let safety = 0;

    while (safety < 24) {
        safety++;
        const discount = cur.opponentNextCardDiscount;
        const hand = cur.opponentHand;

        // Best affordable card by power-per-effective-cost, then raw power.
        let bestHandIndex = -1;
        let bestCardScore = -Infinity;
        for (let i = 0; i < hand.length; i++) {
            const c = hand[i];
            const cost = getEffectiveCost(c, discount);
            if (cost > cur.opponentChakra) continue;
            const ratio = c.power / cost + c.power * 0.01;
            if (ratio > bestCardScore) {
                bestCardScore = ratio;
                bestHandIndex = i;
            }
        }
        if (bestHandIndex === -1) break;
        const card = hand[bestHandIndex];

        // Best location: prefer where the AI is losing, value the bonus the card
        // would gain there. Skip full locations.
        let bestLoc = -1;
        let bestLocScore = -Infinity;
        for (let li = 0; li < cur.locations.length; li++) {
            const loc = cur.locations[li];
            if (loc.opponentCards.length >= CARD_CLASH_LOCATION_SLOTS) continue;
            const deficit =
                locationSidePower(loc, "player") - locationSidePower(loc, "opponent");
            const asPlayed: CardClashPlayedCard = {
                ...card,
                instanceId: "probe",
                owner: "opponent",
                basePower: card.power,
                currentPower: card.power,
                locationIndex: li,
                revealed: true,
            };
            const marginal = getCardDisplayedPower(asPlayed, loc.location);
            const score = deficit + marginal;
            if (score > bestLocScore) {
                bestLocScore = score;
                bestLoc = li;
            }
        }
        if (bestLoc === -1) break;

        const res = playCard(cur, "opponent", bestHandIndex, bestLoc);
        if (res.error) break;
        cur = res.state;
    }

    return cur;
}

// ── End turn / match flow ───────────────────────────────────────────────────

/**
 * Resolve the player's End-Turn: the AI takes its turn, then either the match
 * finalises (after turn 6) or both sides advance — chakra rises to the new turn
 * number and both draw a card.
 */
export function endTurn(state: CardClashMatchState): CardClashMatchState {
    if (state.status !== "playing") return state;

    let next = aiTakeTurn(state);

    if (next.turn >= CARD_CLASH_MAX_TURNS) {
        const winner = determineWinner(next);
        const verdict =
            winner === "player"
                ? "🏆 You win the clash!"
                : winner === "opponent"
                  ? "💀 You lose the clash."
                  : "🤝 The clash ends in a draw.";
        return { ...next, status: "complete", winner, log: [...next.log, verdict] };
    }

    const nextTurn = next.turn + 1;
    next = { ...next, turn: nextTurn, playerChakra: nextTurn, opponentChakra: nextTurn };
    next = drawForSide(next, "player");
    next = drawForSide(next, "opponent");
    return { ...next, log: [...next.log, `— Turn ${nextTurn} — ${nextTurn} Chakra.`] };
}

/** Player concedes: the match ends immediately as an opponent win. */
export function retreat(state: CardClashMatchState): CardClashMatchState {
    if (state.status !== "playing") return state;
    return {
        ...state,
        status: "complete",
        winner: "opponent",
        log: [...state.log, "🏳️ You retreat. The clash is forfeit."],
    };
}

// ── Rewards ─────────────────────────────────────────────────────────────────

export type CardClashRewardSummary = {
    ryo: number;
    baseRyo: number;
    dailyBonus: boolean;
    result: CardClashResult;
};

/** Pure reward calc: base payout by result + a once-per-day first-win bonus. */
export function cardClashReward(
    result: CardClashResult,
    alreadyWonToday: boolean,
): CardClashRewardSummary {
    const baseRyo =
        result === "player"
            ? CARD_CLASH_WIN_RYO
            : result === "draw"
              ? CARD_CLASH_DRAW_RYO
              : CARD_CLASH_LOSS_RYO;
    const dailyBonus = result === "player" && !alreadyWonToday;
    return {
        ryo: baseRyo + (dailyBonus ? CARD_CLASH_DAILY_BONUS_RYO : 0),
        baseRyo,
        dailyBonus,
        result,
    };
}
