"use strict";
/*
 * Server-side Shinobi Card Clash engine for the clan-war duel.
 *
 * The clan-war tile duel is server-authoritative real-time PvP that applies live
 * clan-war HP damage, so the match rules must run on the server — the client
 * engine in shinobij.client/src/lib/card-clash.ts can't be imported here (the
 * api/ bundle compiles separately). This is a focused port of the same rules:
 * 3 locations, 6 turns, a ramping chakra economy, On-Reveal abilities, and a
 * "win 2 of 3 locations" finish.
 *
 * Networking model: each turn both players SECRETLY stage their plays and then
 * commit. When both have committed (or the turn deadline elapses) the server
 * resolves the turn — revealing both sides' cards simultaneously (in coin-flip
 * order), applying On-Reveal effects, then advancing. Opponents never see each
 * other's staged plays or hand contents until reveal (the handler projects the
 * session per-viewer).
 *
 * Stat trust follows the existing tilecards precedent: canonical card stats live
 * in the client bundle, so the client submits derived Clash stats and the server
 * enforces ID ownership (in the handler) + hard stat bounds (cost 1-6, power
 * 1-12) + deck-construction limits here. Bounds cap any cheating exactly as the
 * old 1-99 / sum 60-340 checks did.
 *
 * Engine functions MUTATE the plain-object match/side state they're given — the
 * handler reads the session from KV (already a fresh JSON copy), mutates, then
 * persists, all inside a withKvLock.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASH_LOCATIONS = exports.CLASH_MAX_LEGENDARY = exports.CLASH_SLOTS = exports.CLASH_MAX_HAND = exports.CLASH_OPENING_HAND = exports.CLASH_MAX_TURNS = exports.CLASH_DECK_SIZE = void 0;
exports.clashCopyLimit = clashCopyLimit;
exports.validateSubmittedDeck = validateSubmittedDeck;
exports.deckCardIds = deckCardIds;
exports.pickRandomLocationIds = pickRandomLocationIds;
exports.locationDefsByIds = locationDefsByIds;
exports.createMatch = createMatch;
exports.dealOpening = dealOpening;
exports.shuffleDeck = shuffleDeck;
exports.locationBonus = locationBonus;
exports.displayedPower = displayedPower;
exports.locationSidePower = locationSidePower;
exports.totalBoardPower = totalBoardPower;
exports.determineWinner = determineWinner;
exports.validatePlays = validatePlays;
exports.resolveTurn = resolveTurn;
// ── Constants ────────────────────────────────────────────────────────────────
exports.CLASH_DECK_SIZE = 12;
exports.CLASH_MAX_TURNS = 6;
exports.CLASH_OPENING_HAND = 3;
exports.CLASH_MAX_HAND = 7;
exports.CLASH_SLOTS = 4;
exports.CLASH_MAX_LEGENDARY = 2;
exports.CLASH_LOCATIONS = [
    { id: 'training-ground', name: 'Training Ground', description: 'No special effect.', effectType: 'none' },
    { id: 'volcano-pass', name: 'Volcano Pass', description: 'Fire cards here have +2 Power.', effectType: 'fireBonus' },
    { id: 'river-shrine', name: 'River Shrine', description: 'Water cards here have +2 Power.', effectType: 'waterBonus' },
    { id: 'stone-gate', name: 'Stone Gate', description: 'Earth cards here have +2 Power.', effectType: 'earthBonus' },
    { id: 'wind-bridge', name: 'Wind Bridge', description: 'Wind cards here have +2 Power.', effectType: 'windBonus' },
    { id: 'storm-peak', name: 'Storm Peak', description: 'Lightning cards here have +2 Power.', effectType: 'lightningBonus' },
    { id: 'moonshadow-ruins', name: 'Moonshadow Ruins', description: 'Shadow cards here have +2 Power.', effectType: 'shadowBonus' },
    { id: 'frozen-lake', name: 'Frozen Lake', description: 'Ice cards here have +2 Power.', effectType: 'iceBonus' },
    { id: 'ninja-academy', name: 'Ninja Academy', description: 'Common cards here have +2 Power.', effectType: 'commonBonus' },
    { id: 'black-market', name: 'Black Market', description: 'Rare cards here have +2 Power.', effectType: 'rareBonus' },
    { id: 'hollow-gate', name: 'Hollow Gate', description: 'Epic and Legendary cards here have +2 Power.', effectType: 'epicLegendaryBonus' },
    { id: 'hidden-dojo', name: 'Hidden Dojo', description: 'Cards that cost 1 or 2 have +1 Power here.', effectType: 'lowCostBonus' },
    { id: 'kage-summit', name: 'Kage Summit', description: 'Cards that cost 5 or 6 have +2 Power here.', effectType: 'highCostBonus' },
    { id: 'balance-shrine', name: 'Balance Shrine', description: 'Neutral cards here have +2 Power.', effectType: 'neutralBonus' },
    { id: 'forgotten-battlefield', name: 'Forgotten Battlefield', description: 'Elementless cards here have +2 Power.', effectType: 'noneBonus' },
    { id: 'chunin-arena', name: 'Chunin Exam Arena', description: 'Cards that cost 3 or 4 have +2 Power here.', effectType: 'midCostBonus' },
    { id: 'sacred-spring', name: 'Sacred Hot Spring', description: 'All cards here have +1 Power.', effectType: 'allHereBonus' },
    { id: 'hidden-village', name: 'Hidden Village', description: 'Cards with 3 or less Power here have +2 Power.', effectType: 'lowPowerBonus' },
    { id: 'legends-battlefield', name: 'Battlefield of Legends', description: 'Cards with 8 or more Power here have +2 Power.', effectType: 'highPowerBonus' },
];
const RARITIES = new Set(['common', 'rare', 'epic', 'legendary']);
const ABILITIES = new Set([
    'none', 'onRevealBuffSelf', 'onRevealBuffAlliesHere', 'onRevealDebuffEnemiesHere',
    'moveAfterReveal', 'protectSelf', 'drawCard', 'discountNextCard', 'summonClone',
    'onRevealBuffAlliesEverywhere', 'onRevealDebuffEnemiesEverywhere', 'onRevealDoubleSelf',
]);
// ── Deck validation ──────────────────────────────────────────────────────────
function clashCopyLimit(rarity) {
    return rarity === 'common' || rarity === 'rare' ? 2 : 1;
}
/**
 * Validate a client-submitted deck: exactly 12 cards, each with sane bounds, and
 * the copy / legendary-cap rules. ID ownership is checked separately by the
 * handler against the player's save. Returns the cleaned deck or an error.
 */
function validateSubmittedDeck(raw) {
    if (!Array.isArray(raw) || raw.length !== exports.CLASH_DECK_SIZE)
        return { ok: false, error: `Deck must be exactly ${exports.CLASH_DECK_SIZE} cards.` };
    const deck = [];
    const counts = {};
    let legendary = 0;
    for (const r of raw) {
        if (typeof r !== 'object' || r === null)
            return { ok: false, error: 'Malformed card in deck.' };
        const o = r;
        const id = String(o.id ?? '');
        const element = String(o.element ?? '');
        const rarity = String(o.rarity ?? '');
        const cost = Number(o.cost);
        const power = Number(o.power);
        const ability = String(o.ability ?? 'none');
        if (!id || !element)
            return { ok: false, error: 'Card missing id/element.' };
        if (!RARITIES.has(rarity))
            return { ok: false, error: 'Invalid card rarity.' };
        if (!ABILITIES.has(ability))
            return { ok: false, error: 'Invalid card ability.' };
        if (!Number.isInteger(cost) || cost < 1 || cost > 6)
            return { ok: false, error: 'Card cost out of bounds (1-6).' };
        if (!Number.isInteger(power) || power < 1 || power > 12)
            return { ok: false, error: 'Card power out of bounds (1-12).' };
        // Power is bounded by COST: both derive from the card's average stat
        // (client deriveCardClashCard). A cheap card therefore can NEVER be
        // high-power — cost 1 ⇒ a common with avg<24 ⇒ power≤3; cost 2 ⇒ a common
        // (avg<32) or rare (avg<45) ⇒ power≤6 (epic/legendary can't be cost ≤2).
        // These ceilings come from the cost BANDS themselves (not the catalog), so
        // they never reject a legit card — built-in or creator — yet they close the
        // worst forgery the flat 1-12 bound allowed: an owned weak common submitted
        // as a 1-cost 12-power card (audit #8). cost≥3 keeps the 1-12 bound: it
        // can't be tightened without the per-card canonical stats, which live only
        // in the client bundle (a full id→stats mirror is the complete fix).
        const maxPowerForCost = cost === 1 ? 3 : cost === 2 ? 6 : 12;
        if (power > maxPowerForCost)
            return { ok: false, error: `Card power ${power} is too high for cost ${cost}.` };
        counts[id] = (counts[id] ?? 0) + 1;
        if (counts[id] > clashCopyLimit(rarity))
            return { ok: false, error: 'Too many copies of a card for its rarity.' };
        if (rarity === 'legendary')
            legendary++;
        deck.push({ id, element, rarity: rarity, cost, power, ability: ability });
    }
    if (legendary > exports.CLASH_MAX_LEGENDARY)
        return { ok: false, error: `Max ${exports.CLASH_MAX_LEGENDARY} Legendary cards.` };
    return { ok: true, deck };
}
/** Distinct card ids referenced by a deck (handler uses this for ownership). */
function deckCardIds(deck) {
    return Array.from(new Set(deck.map((c) => c.id)));
}
// ── Setup ────────────────────────────────────────────────────────────────────
function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
/** Pick 3 distinct random location ids (handler call; tests pass ids explicitly). */
function pickRandomLocationIds() {
    return shuffleInPlace([...exports.CLASH_LOCATIONS]).slice(0, 3).map((l) => l.id);
}
function locationDefsByIds(ids) {
    return ids.map((id) => exports.CLASH_LOCATIONS.find((l) => l.id === id) ?? exports.CLASH_LOCATIONS[0]);
}
/** Build an empty match over the chosen locations. */
function createMatch(locationIds) {
    return {
        locations: locationDefsByIds(locationIds).map((def) => ({ def, p1: [], p2: [] })),
        turn: 1,
        iidCounter: 0,
        log: [],
    };
}
/** Deal the opening hand from a (shuffled) deck. */
function dealOpening(deck) {
    return { hand: deck.slice(0, exports.CLASH_OPENING_HAND), rest: deck.slice(exports.CLASH_OPENING_HAND) };
}
function shuffleDeck(deck) {
    return shuffleInPlace([...deck]);
}
// ── Power / scoring ──────────────────────────────────────────────────────────
function locationBonus(card, def) {
    switch (def.effectType) {
        case 'fireBonus': return card.element === 'Fire' ? 2 : 0;
        case 'waterBonus': return card.element === 'Water' ? 2 : 0;
        case 'earthBonus': return card.element === 'Earth' ? 2 : 0;
        case 'windBonus': return card.element === 'Wind' ? 2 : 0;
        case 'lightningBonus': return card.element === 'Lightning' ? 2 : 0;
        case 'shadowBonus': return card.element === 'Shadow' ? 2 : 0;
        case 'iceBonus': return card.element === 'Ice' ? 2 : 0;
        case 'commonBonus': return card.rarity === 'common' ? 2 : 0;
        case 'rareBonus': return card.rarity === 'rare' ? 2 : 0;
        case 'epicLegendaryBonus': return card.rarity === 'epic' || card.rarity === 'legendary' ? 2 : 0;
        case 'lowCostBonus': return card.cost <= 2 ? 1 : 0;
        case 'highCostBonus': return card.cost >= 5 ? 2 : 0;
        case 'neutralBonus': return card.element === 'Neutral' ? 2 : 0;
        case 'noneBonus': return card.element === 'None' ? 2 : 0;
        case 'midCostBonus': return card.cost === 3 || card.cost === 4 ? 2 : 0;
        case 'allHereBonus': return 1;
        case 'lowPowerBonus': return card.power <= 3 ? 2 : 0;
        case 'highPowerBonus': return card.power >= 8 ? 2 : 0;
        default: return 0;
    }
}
function displayedPower(card, def) {
    return card.currentPower + locationBonus(card, def);
}
function locationSidePower(loc, side) {
    return loc[side].reduce((s, c) => s + displayedPower(c, loc.def), 0);
}
function totalBoardPower(match, side) {
    return match.locations.reduce((s, loc) => s + locationSidePower(loc, side), 0);
}
function determineWinner(match) {
    let p1 = 0, p2 = 0;
    for (const loc of match.locations) {
        const a = locationSidePower(loc, 'p1');
        const b = locationSidePower(loc, 'p2');
        if (a > b)
            p1++;
        else if (b > a)
            p2++;
    }
    if (p1 > p2)
        return 'p1';
    if (p2 > p1)
        return 'p2';
    const pa = totalBoardPower(match, 'p1');
    const pb = totalBoardPower(match, 'p2');
    if (pa > pb)
        return 'p1';
    if (pb > pa)
        return 'p2';
    return 'draw';
}
function effectiveCost(cost, discount) {
    return Math.max(1, cost - discount);
}
// ── Commit validation ────────────────────────────────────────────────────────
/**
 * Validate a side's staged plays for the current turn WITHOUT mutating: every
 * hand index distinct & in range, each target location has room (accounting for
 * cards already there + earlier plays this commit), and total chakra (with
 * discountNextCard applied in play order) is affordable.
 */
function validatePlays(match, side, sideKey, plays) {
    if (!Array.isArray(plays))
        return { ok: false, error: 'Invalid plays.' };
    if (plays.length === 0)
        return { ok: true }; // passing the turn is allowed
    const usedIndices = new Set();
    const addedPerLoc = {};
    let chakra = side.chakra;
    let discount = side.nextDiscount;
    for (const p of plays) {
        if (!Number.isInteger(p.handIndex) || p.handIndex < 0 || p.handIndex >= side.hand.length)
            return { ok: false, error: 'Play references a card not in hand.' };
        if (usedIndices.has(p.handIndex))
            return { ok: false, error: 'A card was played twice.' };
        if (!Number.isInteger(p.loc) || p.loc < 0 || p.loc >= match.locations.length)
            return { ok: false, error: 'Invalid location.' };
        const already = match.locations[p.loc][sideKey].length + (addedPerLoc[p.loc] ?? 0);
        if (already >= exports.CLASH_SLOTS)
            return { ok: false, error: 'A location is full (max 4).' };
        const card = side.hand[p.handIndex];
        const cost = effectiveCost(card.cost, discount);
        if (cost > chakra)
            return { ok: false, error: 'Not enough Chakra for those plays.' };
        chakra -= cost;
        discount = card.ability === 'discountNextCard' ? 1 : 0;
        usedIndices.add(p.handIndex);
        addedPerLoc[p.loc] = (addedPerLoc[p.loc] ?? 0) + 1;
    }
    return { ok: true };
}
// ── Turn resolution ──────────────────────────────────────────────────────────
function applyOnReveal(match, side, sideKey, played) {
    const enemyKey = sideKey === 'p1' ? 'p2' : 'p1';
    const loc = match.locations[played.loc];
    switch (played.ability) {
        case 'onRevealBuffSelf':
            played.currentPower += 2;
            break;
        case 'onRevealBuffAlliesHere':
            for (const c of loc[sideKey])
                if (c.iid !== played.iid)
                    c.currentPower += 1;
            break;
        case 'onRevealDebuffEnemiesHere':
            for (const c of loc[enemyKey]) {
                const floor = c.protectedFromReduction ? c.basePower : 0;
                c.currentPower = Math.max(floor, c.currentPower - 1);
            }
            break;
        case 'protectSelf':
            played.protectedFromReduction = true;
            break;
        case 'drawCard':
            if (side.deck.length > 0 && side.hand.length < exports.CLASH_MAX_HAND)
                side.hand.push(side.deck.shift());
            break;
        case 'discountNextCard':
            side.nextDiscount = 1;
            break;
        case 'summonClone': {
            if (loc[sideKey].length < exports.CLASH_SLOTS) {
                loc[sideKey].push({
                    id: 'token-shadow-clone', element: 'Neutral', rarity: 'common', cost: 0, power: 1,
                    ability: 'none', iid: `iid-${match.iidCounter++}`, owner: sideKey,
                    basePower: 1, currentPower: 1, loc: played.loc, isToken: true,
                });
            }
            break;
        }
        case 'moveAfterReveal': {
            const target = match.locations.findIndex((l, i) => i !== played.loc && l[sideKey].length < exports.CLASH_SLOTS);
            if (target !== -1) {
                const arr = loc[sideKey];
                const idx = arr.findIndex((c) => c.iid === played.iid);
                if (idx !== -1) {
                    const [moved] = arr.splice(idx, 1);
                    moved.loc = target;
                    match.locations[target][sideKey].push(moved);
                }
            }
            break;
        }
        case 'onRevealDoubleSelf':
            played.currentPower *= 2;
            break;
        case 'onRevealBuffAlliesEverywhere':
            for (const l of match.locations)
                for (const c of l[sideKey])
                    if (c.iid !== played.iid)
                        c.currentPower += 1;
            break;
        case 'onRevealDebuffEnemiesEverywhere':
            for (const l of match.locations)
                for (const c of l[enemyKey]) {
                    const floor = c.protectedFromReduction ? c.basePower : 0;
                    c.currentPower = Math.max(floor, c.currentPower - 1);
                }
            break;
        default:
            break;
    }
}
/** Reveal + place one side's staged plays in order, spending chakra + discounts. */
function revealSide(match, side, sideKey) {
    const plays = side.pending;
    if (plays.length === 0)
        return;
    // Snapshot the played cards by index BEFORE removing any (indices are stable
    // within a committed turn), then rebuild the hand without them.
    const playedCards = plays.map((p) => side.hand[p.handIndex]);
    const usedIdx = new Set(plays.map((p) => p.handIndex));
    side.hand = side.hand.filter((_, i) => !usedIdx.has(i));
    let discount = side.nextDiscount;
    for (let i = 0; i < plays.length; i++) {
        const card = playedCards[i];
        const cost = effectiveCost(card.cost, discount);
        side.chakra = Math.max(0, side.chakra - cost);
        discount = card.ability === 'discountNextCard' ? 1 : 0;
        const played = {
            ...card,
            iid: `iid-${match.iidCounter++}`,
            owner: sideKey,
            basePower: card.power,
            currentPower: card.power,
            loc: plays[i].loc,
        };
        match.locations[plays[i].loc][sideKey].push(played);
        match.log.push(`${sideKey === 'p1' ? '🟦' : '🟥'} plays ${card.id} at ${match.locations[plays[i].loc].def.name}.`);
        applyOnReveal(match, side, sideKey, played);
    }
    // discountNextCard played as the LAST card carries to next turn.
    side.nextDiscount = discount;
}
/**
 * Resolve a fully-committed turn: reveal both sides (reveal-first side's On-Reveal
 * effects resolve first), then advance — unless it was turn 6, in which case the
 * match is over. Mutates and returns the match + sides. Caller decides the winner
 * via determineWinner when isFinal.
 */
function resolveTurn(match, p1, p2, revealFirst) {
    const first = revealFirst === 'p1' ? p1 : p2;
    const second = revealFirst === 'p1' ? p2 : p1;
    const firstKey = revealFirst;
    const secondKey = revealFirst === 'p1' ? 'p2' : 'p1';
    revealSide(match, first, firstKey);
    revealSide(match, second, secondKey);
    // Clear this turn's staging.
    p1.pending = [];
    p2.pending = [];
    p1.committed = false;
    p2.committed = false;
    if (match.turn >= exports.CLASH_MAX_TURNS)
        return { isFinal: true };
    match.turn += 1;
    p1.chakra = match.turn;
    p2.chakra = match.turn;
    for (const s of [p1, p2]) {
        if (s.deck.length > 0 && s.hand.length < exports.CLASH_MAX_HAND)
            s.hand.push(s.deck.shift());
    }
    match.log.push(`— Turn ${match.turn} —`);
    return { isFinal: false };
}
