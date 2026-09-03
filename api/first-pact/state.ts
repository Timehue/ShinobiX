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
    firstPactDistrictAt,
    type FirstPactMainBeat,
} from "../../shared/first-pact-contract.js";
import {
    acceptFirstPactStableQuest,
    advanceFirstPactMain,
    checkpointFirstPact,
    enterFirstPact,
    readFirstPactProgress,
} from "./_state.js";

const MAIN_BEATS = new Set<string>(FIRST_PACT_MAIN_BEATS);

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
        return res.status(200).json({ ok: true, progress });
    } catch (error) {
        console.error("[first-pact/state]", error);
        return res.status(500).json({ error: "The Celestial crossing could not be recorded." });
    }
}
