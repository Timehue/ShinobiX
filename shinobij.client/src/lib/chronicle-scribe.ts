/*
 * chronicle-scribe — the one-time "traveler's codex" road event that introduces
 * the Shinobi Chronicle card game in-fiction.
 *
 * A wandering Chronicle scribe (Scribe Ihara) finds the player once they've
 * found their feet on the road (level 17+, the quiet band after the academy
 * arc), tells them where the cards come from — the Chronicle predates the
 * villages, begun when the Hollow Gate still stood above ground — and hands
 * over the traveler's codex: the old academy teaching set.
 *
 * Sibling of lib/hollow-rifts.ts (same roaming-giver pattern: client-derived
 * spawn, presence gate, TriggeredVisualNovel, sentinel choice marker). The
 * grant is server-authoritative: POST /api/card-clash/claim-starter tops the
 * collection up to the SAME starter floor the lazy first-duel grant already
 * applies (api/card-clash/_starter-cards.ts) and sets the one-time
 * `starterCardsClaimed` latch that retires this NPC.
 */
import type { Character } from "../types/character";
import type { Biome } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import type { Wanderer } from "./wanderers";
import { wandererPresenceGate, wandererDayBucket } from "./wanderers";

export const SCRIBE_WANDERER_ID = "chronicle-scribe";
/** Sentinel choice trait WorldMap intercepts (never stored as a story trait). */
export const SCRIBE_ACCEPT_MARKER = "__chronicle-scribe-accept";
export const SCRIBE_NAME = "Scribe Ihara";
export { SCRIBE_MIN_LEVEL } from "./chronicle-lock";
import { SCRIBE_MIN_LEVEL } from "./chronicle-lock";
/** Ihara's own face (public/portraits, generated 2026-07-24 via gen-asset.mjs):
 *  gray bun with an ink brush, ink-stained fingers holding a worn card, satchel
 *  of scrolls. Used for the map standee, the tap dialog, and the VN speaker. */
const SCRIBE_PORTRAIT = "/portraits/chronicle-scribe-ihara.webp";

/** Whether the scribe still has business with this shinobi. */
export function scribeEligible(character: Pick<Character, "level" | "starterCardsClaimed">): boolean {
    if ((character.level ?? 0) < SCRIBE_MIN_LEVEL) return false;
    return character.starterCardsClaimed !== true;
}

/**
 * The scribe for the player's current sector this 6h window, or []. Same
 * presence-gate rhythm as the rift giver, slightly more present (0.45) — this
 * is an onboarding beat, and she should be found within a session or two of
 * becoming eligible, not stalked across a week of sectors.
 */
export function scribeWandererFor(character: Character, sector: number | null, now: Date = new Date()): Wanderer[] {
    if (sector == null || !scribeEligible(character)) return [];
    const bucket = wandererDayBucket(now);
    if (!wandererPresenceGate(`scribe#${character.name}#${sector}#${bucket}`, 0.45)) return [];
    return [synthChronicleScribe(sector)];
}

/** Ihara as a roaming sector wanderer; talking to her opens the codex VN. */
export function synthChronicleScribe(sector: number): Wanderer {
    const home = 5 * 12 + ((sector * 7 + 3) % 8) + 2;
    return {
        id: SCRIBE_WANDERER_ID,
        name: SCRIBE_NAME,
        archetype: "courier",
        verb: "quest",
        level: 30,
        homeTile: home,
        waypoints: [home, home + 1, home - 1],
        greeting: "Hold up — you. I've walked three sectors to catch you. Don't make it four.",
        tellTint: "#f0c463",
        avatarKey: "courier",
        avatarImage: SCRIBE_PORTRAIT,
    };
}

type ScribePage = { title: string; scene: string; dialogue: string[] };

// The conversation. Voice: humanization contract v2 (docs/world-cohesion.md) —
// spoken TO the player, plain words, gruff-warm. Canon carried: the Chronicle
// predates the villages (begun while the Hollow Gate stood above ground); the
// Hollow burns archives, so the record lives as cards; the Chronicle is a
// LIVING record that changes as the world does.
const SCRIBE_PAGES: ScribePage[] = [
    {
        title: "The Scribe on the Road",
        scene: "An old traveler with an enormous satchel waves you down, then sits on the satchel to catch her breath.",
        dialogue: [
            "Hold up — you. The academy lists said I'd find you out this way. I've walked three sectors, so humor me a minute.",
            "Ihara. Chronicle scribe, forty years. The satchel IS the Chronicle — well. A corner of it.",
        ],
    },
    {
        title: "The Cards",
        scene: "She unbuckles the satchel. Cards — hundreds of them, sorted with string.",
        dialogue: [
            "You've seen the cards around. Kids trade them in the tavern. Gamblers fleece each other with them on the roads.",
            "Don't let that fool you. Every card in here is real. A tyrant that fell. A beast that took the coliseum sand. A shinobi worth remembering. We don't invent. We record.",
        ],
    },
    {
        title: "Older Than Your Village",
        scene: "She holds up a card so worn the art is only shadows.",
        dialogue: [
            "The Chronicle is older than your village. Older than all four. It started back when the Hollow Gate still stood above ground — you could walk right up and touch the thing, if you were stupid.",
            "The first scribes pressed cards of what came out of it. And of the ones who forced it back under. This one's from then. Don't breathe on it.",
        ],
    },
    {
        title: "Why Cards",
        scene: "She wraps the old card away again, gentle as a splint.",
        dialogue: [
            "Why cards, you're wondering. Because the Hollow burns archives first. Every single time. A library is one fire.",
            "Cards scatter. You can't burn what's in a thousand pockets. So the record lives — and it changes as the world does. A Kage falls, we press the card. Your beast makes a name on the sand, we press that too. The Chronicle doesn't close.",
        ],
    },
    {
        title: "The Traveler's Codex",
        scene: "She pulls a wrapped deck from the bottom of the satchel. It still smells of press-ink.",
        dialogue: [
            "Which brings me to you. The academies used to hand every graduate a traveler's codex — forty cards, the old teaching set. Mostly commons, a few that aren't. Argue with tradition, not with me.",
            "Take it. Learn the game at the Card Hall, or off any road gambler brave enough to sit with you. You'll come to know this world by its worst days — and that's the only way anyone really knows it.",
        ],
    },
];

/** The codex VN. Accepting fires SCRIBE_ACCEPT_MARKER (WorldMap claims server-side). */
export function scribeIntroEvent(biome: Biome): CreatorEvent {
    const last = SCRIBE_PAGES.length - 1;
    return {
        id: SCRIBE_WANDERER_ID,
        name: "The Traveler's Codex",
        biome,
        icon: "🎴",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: SCRIBE_PAGES[0].title,
        vnScene: SCRIBE_PAGES[0].scene,
        vnSpeaker: SCRIBE_NAME,
        vnPages: SCRIBE_PAGES.map((page, index) => ({
            title: page.title,
            scene: page.scene,
            speaker: SCRIBE_NAME,
            rightImage: SCRIBE_PORTRAIT,
            dialogue: page.dialogue,
            choices: index === last
                ? [
                    {
                        text: "Take the traveler's codex",
                        nextPage: last,
                        trait: SCRIBE_ACCEPT_MARKER,
                        conclusion: "She presses the deck into your hands and stands with a grunt. \"The Card Hall will deal you in now — tell them Ihara sent you. And if you ever do something worth pressing, I'll find you. I found you this time, didn't I?\"",
                    },
                    {
                        text: "Not now",
                        nextPage: last,
                        conclusion: "\"Ha. They all say that.\" She heaves the satchel back up. \"The satchel and I will find you again. We always do.\"",
                    },
                ]
                : undefined,
        })),
        levelReq: SCRIBE_MIN_LEVEL,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: SCRIBE_PAGES.flatMap((p) => p.dialogue),
    };
}

// ── Server call (server-authoritative; the client never grants) ──────────────

export type CodexClaimResult = {
    ok: boolean;
    granted?: string[];
    tileCards?: string[];
    reason?: "already-claimed" | "level" | "offline" | "error";
};

export async function claimTravelersCodex(playerName: string): Promise<CodexClaimResult> {
    try {
        const res = await fetch("/api/card-clash/claim-starter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        const data = await res.json().catch(() => null) as
            | { ok?: boolean; granted?: string[]; character?: { tileCards?: string[] }; error?: string }
            | null;
        if (res.ok && data?.ok) {
            return { ok: true, granted: data.granted ?? [], tileCards: data.character?.tileCards };
        }
        const reason = data?.error === "already-claimed" || data?.error === "level" ? data.error : "error";
        return { ok: false, reason };
    } catch {
        return { ok: false, reason: "offline" };
    }
}
