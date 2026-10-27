import { randomInt, randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors, safeName } from "../_utils.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import {
    abandonKeeperRun,
    chooseKeeperBoon,
    chooseKeeperNode,
    keeperPathOf,
    type KeeperPathRecord,
} from "../../shared/keeper-path-contract.js";
import { resolveChronicleDeckMutation } from "./_deck.js";
import { chronicleUnlockedFor, CHRONICLE_LOCKED_ERROR } from "./_starter-cards.js";
import { newKeeperRun } from "./_keeper-path.js";

/**
 * /api/card-clash/keeper-run -- Keeper's Path, the single-player Chronicle run.
 *
 * Actions: `state`, `start` (seal the saved deck and draw a map), `choose-node`,
 * `choose-boon`, `abandon`. Fights themselves start at /card-clash/ai-start
 * with `{ keeperRun: true }` and settle through /card-clash/ai-move, so a duel
 * can never be won here. Every write is one locked save mutation on the
 * server-owned `keeperPath` record; the browser names node and boon ids only.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).end();
    try {
        const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ""));
        if (!playerName) return res.status(400).json({ error: "Missing playerName." });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: "Authentication required." });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: "You can only walk your own Keeper's Path." });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, "card-clash-keeper-run", 60, 60_000, identity.name))) return;
        if (!identity.admin && !(await chronicleUnlockedFor(playerName))) return res.status(409).json({ error: CHRONICLE_LOCKED_ERROR });

        const action = String(body.action ?? "state");
        res.setHeader("Cache-Control", "private, no-store");
        if (action === "state") {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const character = record?.character as Record<string, unknown> | undefined;
            if (!character) return res.status(404).json({ error: "Character not found." });
            return res.status(200).json({ ok: true, keeperPath: keeperPathOf(character) });
        }

        const now = Date.now();
        const result = await mutatePlayerSave<KeeperPathRecord>(playerName, ({ character }) => {
            const current = keeperPathOf(character);
            let next: KeeperPathRecord | null = null;
            let refusal = "";
            let nextCharacter: Record<string, unknown> = character;
            if (action === "start") {
                if (current.run?.status === "active") refusal = "A Keeper's Path run is already under way. Finish or abandon it first.";
                else {
                    // The deck is sealed for the whole run: the client's current
                    // list is admitted only if it validates against the collection.
                    const requested = Array.isArray(body.deck) ? body.deck.filter((id): id is string => typeof id === "string") : [];
                    const deck = resolveChronicleDeckMutation(character, requested);
                    if (!deck.ok) return deck;
                    nextCharacter = deck.character;
                    next = { ...current, run: newKeeperRun(randomUUID().replace(/-/g, "").slice(0, 16), randomInt(1, 0x7fffffff), deck.value.deck, now) };
                }
            } else if (action === "choose-node") {
                const moved = chooseKeeperNode(current, String(body.nodeId ?? "").slice(0, 32));
                if (moved.changed) next = moved.record;
                else refusal = "That path is not open from where you stand.";
            } else if (action === "choose-boon") {
                const chosen = chooseKeeperBoon(current, String(body.boonId ?? "").slice(0, 32));
                if (chosen.changed) next = chosen.record;
                else refusal = "That boon is not on offer.";
            } else if (action === "abandon") {
                next = abandonKeeperRun(current).record;
            } else {
                return { ok: false as const, status: 400, error: "Unknown Keeper's Path action." };
            }
            if (refusal) return { ok: false as const, status: 409, error: refusal };
            if (!next || (next === current && nextCharacter === character)) return { ok: true as const, character, value: current, write: false };
            return { ok: true as const, character: { ...nextCharacter, keeperPath: next }, value: next };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, keeperPath: result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error("[card-clash/keeper-run]", error);
        return res.status(500).json({ error: "Internal server error." });
    }
}
