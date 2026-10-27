import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { kv } from "../_storage.js";
import { cors, safeName } from "../_utils.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import {
    FIRST_PACT_MIN_LEVEL,
    FIRST_PACT_MAIN_BEATS,
    FIRST_PACT_AFTERMATH_IDS,
    FIRST_PACT_WORLD_HEIGHT,
    FIRST_PACT_WORLD_WIDTH,
    firstPactAuraStoneParts,
    firstPactAuraStonesOwed,
    firstPactDistrictAt,
    firstPactEarnedTitleKeys,
    firstPactWritEncounter,
    type FirstPactAuraParts,
    type FirstPactMainBeat,
    type FirstPactAftermathId,
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
    visitFirstPactAftermathForPlayer,
    readFirstPactProgress,
    startFirstPactUnbrokenForPlayer,
    abandonFirstPactUnbrokenForPlayer,
} from "./_state.js";
import {
    ExhibitionError,
    abandonExhibition,
    draftExhibition,
    exhibitionView,
    orderExhibition,
    readExhibition,
    startExhibition,
    swapExhibition,
} from "./_exhibition.js";

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
 * The story beat commits before this separate save mutation. A failed mutation
 * therefore returns a retryable response, and an exact completion replay calls
 * this idempotent grant again without reopening any other story transition.
 *
 * The committed character and `_saveVersion` come back together. The client
 * adopts that pair atomically, so a version observation can never move ahead
 * of the title and currency snapshot it describes.
 *
 * Aura Stones ride in the SAME mutation. Each part of the reward (the
 * crossing, every writ, Vale Stable) is paid once, whenever it is earned, and
 * `firstPactAuraPaid` records which parts have been paid. That stamp is the
 * idempotency key: it is server-owned (the save sanitizer copies the stored
 * value over anything a client sends), and because the stamp and the currency
 * are one closure the stones can never land without the record that says so.
 *
 * Writs and Vale Stable stay open after the crossing closes. Before the stamp
 * existed, `Pactbound` was the only key, so a writ or the stable finished
 * afterwards credited its title but never its stones.
 */
type AuraPaid = FirstPactAuraParts;

function storedAuraPaid(
    character: Record<string, unknown>,
    vault: readonly string[],
    progress: FirstPactProgress,
): { paid: AuraPaid; stamped: boolean } {
    const raw = character.firstPactAuraPaid;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>;
        return { paid: { base: record.base === true, writs: record.writs === true, stable: record.stable === true }, stamped: true };
    }
    // A crossing closed before the stamp existed. What was paid then cannot be
    // proven, and the owner ruled no backfill: every part already earned counts
    // as paid, and only parts earned from here on pay.
    if (FIRST_PACT_TITLES.complete && vault.includes(FIRST_PACT_TITLES.complete)) {
        return { paid: firstPactAuraStoneParts(progress), stamped: false };
    }
    return { paid: { base: false, writs: false, stable: false }, stamped: false };
}

async function grantFirstPactCompletion(
    playerName: string,
    progress: FirstPactProgress,
): Promise<
    | { ok: true; titles: string[]; auraStones: number; character: Record<string, unknown>; saveVersion: number }
    | { ok: false }
> {
    const earned = firstPactEarnedTitleKeys(progress)
        .map((key) => FIRST_PACT_TITLES[key])
        .filter((title): title is string => typeof title === "string" && title.length > 0);
    const parts = firstPactAuraStoneParts(progress);
    if (!earned.length || !playerName) return { ok: false };
    try {
        const mutation = await mutatePlayerSave<{ titles: string[]; auraStones: number }>(playerName, ({ character }) => {
            const vault = Array.isArray(character.serverTitles)
                ? (character.serverTitles as unknown[]).filter((t): t is string => typeof t === "string")
                : [];
            const fresh = earned.filter((title) => !vault.includes(title));
            const { paid, stamped } = storedAuraPaid(character, vault, progress);
            const payStones = Math.max(0, Math.floor(firstPactAuraStonesOwed(parts, paid)));
            const nextPaid: AuraPaid = {
                base: paid.base || parts.base,
                writs: paid.writs || parts.writs,
                stable: paid.stable || parts.stable,
            };
            const stampChanged = !stamped
                || nextPaid.base !== paid.base || nextPaid.writs !== paid.writs || nextPaid.stable !== paid.stable;
            if (!fresh.length && !payStones && !stampChanged) {
                return { ok: true, character, value: { titles: [], auraStones: 0 }, write: false };
            }
            const held = Number(character.auraStones);
            return {
                ok: true,
                value: { titles: fresh, auraStones: payStones },
                character: {
                    ...character,
                    serverTitles: [...vault, ...fresh],
                    firstPactAuraPaid: nextPaid,
                    ...(payStones ? { auraStones: (Number.isFinite(held) ? held : 0) + payStones } : {}),
                },
            };
        });
        return mutation.ok
            ? {
                ok: true,
                titles: mutation.value.titles,
                auraStones: mutation.value.auraStones,
                character: mutation.character,
                saveVersion: mutation._saveVersion,
            }
            : { ok: false };
    } catch {
        return { ok: false };
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
        let grantedCharacter: Record<string, unknown> | undefined;
        let aftermathReplayed: boolean | undefined;
        let mainReplayed: boolean | undefined;
        let repairCompletionGrant = false;
        if (action === "state") {
            progress = await readFirstPactProgress(playerName);
            repairCompletionGrant = progress.mainStep === "complete";
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
            const pets = Array.isArray(character.pets)
                ? character.pets.filter((pet): pet is Record<string, unknown> => !!pet && typeof pet === "object" && !Array.isArray(pet))
                : [];
            const result = await advanceFirstPactMain(playerName, beat as FirstPactMainBeat, pets);
            const completionReplay = beat === "complete-crossing" && result.progress.mainStep === "complete";
            if (!result.advanced && !completionReplay) {
                return res.status(409).json({ error: "That moment is not available in the current chapter.", progress: result.progress });
            }
            progress = result.progress;
            mainReplayed = !result.advanced;
            // Closing the crossing is the one beat that pays outward.
            // Its exact replay also runs the idempotent grant. This closes the
            // progress -> save -> response gap if the first grant or response
            // was interrupted after the story state had already committed.
            repairCompletionGrant = beat === "complete-crossing" && progress.mainStep === "complete";
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
        } else if (action === "visit-aftermath") {
            const aftermathId = String(body.aftermathId ?? "");
            if (!(FIRST_PACT_AFTERMATH_IDS as readonly string[]).includes(aftermathId)) {
                return res.status(400).json({ error: "Unknown return visit." });
            }
            const result = await visitFirstPactAftermathForPlayer(playerName, aftermathId as FirstPactAftermathId);
            if (!result.visited && !result.replayed) {
                return res.status(409).json({
                    error: "That part of the city has no unfinished return visit in this crossing.",
                    progress: result.progress,
                });
            }
            aftermathReplayed = result.replayed;
            progress = result.progress;
        } else if (action.startsWith("exhibition-")) {
            // Orin's Stable Exhibition. Every rental and trade is read back from
            // the server's own run record; the browser only names ids from it.
            const current = await readFirstPactProgress(playerName);
            try {
                if (action === "exhibition-start") await startExhibition(playerName, current);
                else if (action === "exhibition-draft") await draftExhibition(playerName, body.petIds);
                else if (action === "exhibition-order") await orderExhibition(playerName, body.petIds);
                else if (action === "exhibition-swap") await swapExhibition(playerName, body.outPetId, body.inPetId);
                else if (action === "exhibition-abandon") await abandonExhibition(playerName);
                else return res.status(400).json({ error: "Unknown Exhibition action." });
            } catch (error) {
                if (error instanceof ExhibitionError) return res.status(error.status).json({ error: error.message, progress: current });
                throw error;
            }
            progress = current;
        } else if (action === "replay-unbroken-start" || action === "replay-unbroken-abandon") {
            const current = await readFirstPactProgress(playerName);
            if (current.mainStep !== "complete") {
                return res.status(409).json({ error: "The Court replays its arguments only after the crossing is closed.", progress: current });
            }
            progress = action === "replay-unbroken-start"
                ? await startFirstPactUnbrokenForPlayer(playerName, body.hard === true)
                : await abandonFirstPactUnbrokenForPlayer(playerName);
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

        if (repairCompletionGrant) {
            const granted = await grantFirstPactCompletion(playerName, progress);
            if (!granted.ok) {
                return res.status(503).json({
                    error: "The crossing is preserved, but its reward could not be recorded. Try again.",
                    progress,
                });
            }
            grantedTitles = granted.titles;
            grantedAuraStones = granted.auraStones;
            grantedCharacter = granted.character;
            grantedSaveVersion = granted.saveVersion;
        }

        // The postgame run rides along once the crossing is closed, so the
        // screen never shows a stale draft, trade or round.
        const exhibition = progress.mainStep === "complete" ? exhibitionView(await readExhibition(playerName)) : null;

        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json({
            ok: true,
            progress,
            ...(exhibition ? { exhibition } : {}),
            ...(mainReplayed === undefined && aftermathReplayed === undefined
                ? {}
                : { replayed: mainReplayed ?? aftermathReplayed }),
            ...(grantedTitles.length ? { grantedTitles } : {}),
            ...(grantedAuraStones ? { grantedAuraStones } : {}),
            ...(grantedCharacter ? { character: grantedCharacter } : {}),
            ...(grantedSaveVersion === undefined ? {} : { _saveVersion: grantedSaveVersion }),
        });
    } catch (error) {
        console.error("[first-pact/state]", error);
        return res.status(500).json({ error: "The Celestial crossing could not be recorded." });
    }
}
