import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors, safeName } from "../_utils.js";
import {
  CHRONICLE_AI_DIFFICULTIES,
  type ChronicleAiDifficulty,
} from "../../shared/chronicle-duel.js";
import {
  CARD_CLASH_AI_TOKEN_TTL_SECONDS,
  cardClashAiTokenKey,
} from "./_ai-reward.js";
import { createAiMatch, projectAiMatch } from "./_ai-engine.js";
import { resolveChronicleDeckWithSave } from "./_deck.js";

function submittedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "string"
      ? [entry]
      : entry &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string"
        ? [String((entry as { id: string }).id)]
        : [],
  );
}

/** Starts a current-rules, server-authoritative AI duel. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    const body = (
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})
    ) as Record<string, unknown>;
    const playerName = safeName(String(body.playerName ?? ""));
    if (!playerName)
      return res.status(400).json({ error: "Missing playerName." });
    const identity = await authedPlayerOrAdmin(req, playerName);
    if (!identity)
      return res.status(401).json({ error: "Authentication required." });
    if (!identity.admin && identity.name !== playerName)
      return res
        .status(403)
        .json({ error: "You can only start your own AI duel." });
    if (
      !identity.admin &&
      !(await enforceRateLimitKv(
        req,
        res,
        "card-clash-ai-start",
        30,
        60_000,
        identity.name,
      ))
    )
      return;

    const requested = submittedIds(body.deck);
    // AI and PvP share one locked server resolver: starter grants, ownership,
    // copy limits, migration and saved-deck persistence cannot drift apart.
    const resolved = await resolveChronicleDeckWithSave(
      playerName,
      requested,
      identity.admin,
    );
    if (!resolved)
      return res
        .status(400)
        .json({ error: "No legal 40-card Chronicle deck is available." });
    const resolvedDeck = resolved.deck;

    const requestedDifficulty = String(body.difficulty ?? "medium");
    const difficulty: ChronicleAiDifficulty = CHRONICLE_AI_DIFFICULTIES.includes(
      requestedDifficulty as ChronicleAiDifficulty,
    )
      ? (requestedDifficulty as ChronicleAiDifficulty)
      : "medium";
    const matchId = randomUUID();
    // Dungeon/event callers own their encounter stakes. Allowing a client to
    // opt out of Card Hall rewards cannot grant value or alter duel rules.
    const settlementMode =
      body.externalStakes === true ? "external" : "standard";
    const session = createAiMatch(
      matchId,
      playerName,
      resolvedDeck,
      difficulty,
      Date.now(),
      Math.random,
      settlementMode,
    );
    await kv.set(cardClashAiTokenKey(matchId), session, {
      ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS,
    });
    return res
      .status(200)
      .json({
        ok: true,
        matchId,
        session: projectAiMatch(session),
        migratedDeck: resolved.usedRequested ? undefined : resolvedDeck,
        ...(resolved.saveVersion === undefined
          ? {}
          : { _saveVersion: resolved.saveVersion }),
      });
  } catch (err) {
    console.error("[card-clash/ai-start]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
