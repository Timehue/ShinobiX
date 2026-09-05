import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { kv } from "../_storage.js";
import { cors, safeName } from "../_utils.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import {
    FIRST_PACT_MIN_LEVEL,
    FIRST_PACT_MAIN_BEATS,
    FIRST_PACT_WORLD_HEIGHT,
    FIRST_PACT_WORLD_WIDTH,
    firstPactAuraStoneReward,
    firstPactDistrictAt,
    firstPactEarnedTitleKeys,
    firstPactWritEncounter,
    type FirstPactMainBeat,
    type FirstPactProgress,
} from "../../shared/first-pact-contract.js";
import { FIRST_PACT_TITLES } from "../_titles-registry.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import {
    acceptFirstPactStableQuest,
    advanceFirstPactMain,
    checkpointFirstPact,
    enterFirstPact,
    enterFirstPactFindingForPlayer,
    readFirstPactProgress,
} from "./_state.js";

const MAIN_BEATS = new Set<string>(FIRST_PACT_MAIN_BEATS);

/**
 * The only thing the crossing pays out into the wider game.
 *
 * First Pact battles are sealed reward-ineligible on purpose -- a level-100
 * campaign that paid per fight would be a faucet -- so what a finished crossing
 * grants is cosmetic and once-ever: titles, credited from the STORED progress
 * rather than anything the client said, into the server-owned vault the save
 * sanitizer re-injects and the registry marks wearable.
 *
 * The player is not made to wear one. Which title is worn is theirs to choose
 * from the profile, the same as every other earned title.
 *
 * Best-effort by design, exactly like the liberator grant it mirrors: a failure
 * here must never fail the story beat that earned it, and the write is
 * idempotent, so the next completion call re-grants anything that was missed.
 *
 * The committed `_saveVersion` comes back with it. A route that writes the save
 * and does not say so leaves the client believing it holds the newer copy, and
 * its next autosave overwrites the vault this just credited.
 *
 * Aura Stones ride in the SAME mutation, and are paid only in the pass that
 * first credits `Pactbound`. That title is the idempotency key: the save
 * sanitizer re-injects the stored serverTitles vault unconditionally, so a
 * client cannot drop the title to be paid twice, and because both writes are
 * one closure the currency can never land without the marker that says it did.
 */
async function grantFirstPactCompletion(
    playerName: string,
    progress: FirstPactProgress,
): Promise<{ titles: string[]; auraStones: number; saveVersion?: number }> {
    const earned = firstPactEarnedTitleKeys(progress)
        .map((key) => FIRST_PACT_TITLES[key])
        .filter((title): title is string => typeof title === "string" && title.length > 0);
    const crossingTitle = FIRST_PACT_TITLES.complete;
    const stones = Math.max(0, Math.floor(firstPactAuraStoneReward(progress)));
    if (!earned.length || !playerName) return { titles: [], auraStones: 0 };
    try {
        const mutation = await mutatePlayerSave<{ titles: string[]; auraStones: number }>(playerName, ({ character }) => {
            const vault = Array.isArray(character.serverTitles)
                ? (character.serverTitles as unknown[]).filter((t): t is string => typeof t === "string")
                : [];
            const fresh = earned.filter((title) => !vault.includes(title));
            // First time the crossing has ever been closed on this character.
            const firstClosing = Boolean(crossingTitle) && !vault.includes(crossingTitle);
            const payStones = firstClosing ? stones : 0;
            if (!fresh.length && !payStones) {
                return { ok: true, character, value: { titles: [], auraStones: 0 }, write: false };
            }
            const held = Number(character.auraStones);
            return {
                ok: true,
                value: { titles: fresh, auraStones: payStones },
                character: {
                    ...character,
                    serverTitles: [...vault, ...fresh],
                    ...(payStones ? { auraStones: (Number.isFinite(held) ? held : 0) + payStones } : {}),
                },
            };
        });
        return mutation.ok
            ? { titles: mutation.value.titles, auraStones: mutation.value.auraStones, saveVersion: mutation._saveVersion }
            : { titles: [], auraStones: 0 };
    } catch {
        return { titles: [], auraStones: 0 };
    }
}

function finiteCoordinate(value: unknown, max: number): number | null {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).end();

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ""));
        if (!playerName) return res.status(400).json({ error: "Invalid player name." });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: "Authentication required." });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: "Can only enter your own Celestial crossing." });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, "first-pact-state", 40, 60_000, identity.name))) return;

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = save?.character as Record<string, unknown> | undefined;
        if (!character) return res.status(404).json({ error: "Character not found." });
        if (Math.floor(Number(character.level) || 0) < FIRST_PACT_MIN_LEVEL) {
            return res.status(403).json({
                error: `The First Pact unlocks at level ${FIRST_PACT_MIN_LEVEL}.`,
                requiredLevel: FIRST_PACT_MIN_LEVEL,
            });
        }

        const action = String(body.action ?? "state");
        let progress;
        // Titles credited by this call, so the screen can name what was earned
        // without ever being the thing that decides it.
        let grantedTitles: string[] = [];
        let grantedAuraStones = 0;
        let grantedSaveVersion: number | undefined;
        if (action === "state") {
            progress = await readFirstPactProgress(playerName);
        } else if (action === "enter") {
            progress = await enterFirstPact(playerName);
        } else if (action === "accept-stable-quest") {
            const result = await acceptFirstPactStableQuest(playerName);
            if (!result.accepted) {
                return res.status(409).json({
                    error: result.progress.mainStep === "cross-the-threshold"
                        ? "Cross the Celestial threshold before seeking Vale Stable."
                        : "Vale Stable's tournament request is already recorded.",
                    progress: result.progress,
                });
            }
            progress = result.progress;
        } else if (action === "advance-main") {
            const beat = String(body.beat ?? "");
            if (!MAIN_BEATS.has(beat)) return res.status(400).json({ error: "Unknown First Pact story beat." });
            const result = await advanceFirstPactMain(playerName, beat as FirstPactMainBeat);
            if (!result.advanced) {
                return res.status(409).json({ error: "That moment is not available in the current chapter.", progress: result.progress });
            }
            progress = result.progress;
            // Closing the crossing is the one beat that pays outward.
            if (progress.mainStep === "complete") {
                const granted = await grantFirstPactCompletion(playerName, progress);
                grantedTitles = granted.titles;
                grantedAuraStones = granted.auraStones;
                grantedSaveVersion = granted.saveVersion;
            }
        } else if (action === "enter-finding") {
            const writId = String(body.writId ?? "");
            if (!firstPactWritEncounter(writId)) {
                return res.status(400).json({ error: "Unknown Court writ." });
            }
            const result = await enterFirstPactFindingForPlayer(playerName, writId);
            if (!result.entered) {
                return res.status(409).json({
                    error: "The Court will not enter that finding: it is already in the record, unanswered, or beyond your spendable standing.",
                    progress: result.progress,
                });
            }
            progress = result.progress;
        } else if (action === "checkpoint") {
            const position = body.position && typeof body.position === "object" && !Array.isArray(body.position)
                ? body.position as Record<string, unknown>
                : null;
            const x = finiteCoordinate(position?.x, FIRST_PACT_WORLD_WIDTH - 1);
            const y = finiteCoordinate(position?.y, FIRST_PACT_WORLD_HEIGHT - 1);
            if (x == null || y == null) {
                return res.status(400).json({ error: "Invalid Sunken Court checkpoint." });
            }
            const result = await checkpointFirstPact(playerName, { x, y, district: firstPactDistrictAt({ x, y }) });
            if (!result.checkpointed) {
                return res.status(409).json({ error: "Cross the Celestial threshold before recording a city checkpoint.", progress: result.progress });
            }
            progress = result.progress;
        } else {
            return res.status(400).json({ error: "Unknown First Pact action." });
        }

        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json({
            ok: true,
            progress,
            ...(grantedTitles.length ? { grantedTitles } : {}),
            ...(grantedAuraStones ? { grantedAuraStones } : {}),
            ...(grantedSaveVersion === undefined ? {} : { _saveVersion: grantedSaveVersion }),
        });
    } catch (error) {
        console.error("[first-pact/state]", error);
        return res.status(500).json({ error: "The Celestial crossing could not be recorded." });
    }
}
