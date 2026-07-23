import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors } from "../_utils.js";
import { withKvLock } from "../_lock.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import {
  CARD_CLASH_AI_MIN_WIN_DURATION_MS,
  CARD_CLASH_AI_TOKEN_TTL_SECONDS,
  cardClashAiReward,
  cardClashAiTokenKey,
  utcDateKey,
} from "./_ai-reward.js";
import { CHRONICLE_RULES_VERSION } from "../../shared/chronicle-duel.js";
import {
  applyPlayerAction,
  forfeit,
  isDone,
  projectAiMatch,
  type AiMatchResult,
  type AiMatchSession,
} from "./_ai-engine.js";

const MATCH_ID_RE = /^[0-9a-fA-F-]{20,80}$/;
const ACTIONS = new Set([
  "normal-summon",
  "set-monster",
  "flip-summon",
  "change-position",
  "activate-magic",
  "set-trap",
  "activate-trap",
  "pass-response",
  "advance-phase",
  "start-battle",
  "attack",
  "enter-main-2",
  "enter-end-phase",
  "end-turn",
]);
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function optionalIndex(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

type SettledReward = {
  result: AiMatchResult;
  ryo: number;
  dailyBonus: boolean;
};
type StoredSession = AiMatchSession & { settledReward?: SettledReward };

async function settle(
  session: StoredSession,
  now: number,
): Promise<
  | {
      ok: true;
      reward: SettledReward;
      character: Record<string, unknown>;
      saveVersion: number;
    }
  | { ok: false; status: number; error: string }
> {
  const winner = session.winner ?? "draw";
  const quickWin =
    winner === "player" &&
    now - Number(session.createdAt ?? 0) < CARD_CLASH_AI_MIN_WIN_DURATION_MS;
  const today = utcDateKey(now);
  const settled = await mutatePlayerSave(
    session.playerName,
    ({ character }) => {
      const alreadyWonToday =
        String(character.cardClashDailyWinDate ?? "") === today;
      const reward = quickWin
        ? { ryo: 0, dailyBonus: false }
        : cardClashAiReward(winner, alreadyWonToday);
      const nextCharacter = {
        ...character,
        ryo: num(character.ryo) + reward.ryo,
        cardClashWins:
          num(character.cardClashWins) + (winner === "player" ? 1 : 0),
        cardClashLosses:
          num(character.cardClashLosses) + (winner === "opponent" ? 1 : 0),
        cardClashDraws:
          num(character.cardClashDraws) + (winner === "draw" ? 1 : 0),
        cardClashDailyWinDate: reward.dailyBonus
          ? today
          : character.cardClashDailyWinDate,
      };
      return {
        ok: true as const,
        character: nextCharacter,
        value: {
          result: winner,
          ryo: reward.ryo,
          dailyBonus: reward.dailyBonus,
        } as SettledReward,
      };
    },
  );
  if (!settled.ok)
    return { ok: false, status: settled.status, error: settled.error };
  return {
    ok: true,
    reward: settled.value,
    character: settled.character,
    saveVersion: settled._saveVersion,
  };
}

async function persistOrSettle(session: StoredSession, key: string) {
  if (!isDone(session)) {
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return {
      status: 200 as const,
      body: { ok: true, session: projectAiMatch(session) },
    };
  }
  if (session.settledAt)
    return {
      status: 200 as const,
      body: {
        ok: true,
        session: projectAiMatch(session),
        reward: session.settledReward,
      },
    };
  const now = Date.now();
  if (session.settlementMode === "external") {
    session.settledAt = now;
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return {
      status: 200 as const,
      body: { ok: true, session: projectAiMatch(session) },
    };
  }
  const paid = await settle(session, now);
  if (!paid.ok) {
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return { status: paid.status as 404 | 503, body: { error: paid.error } };
  }
  session.settledAt = now;
  session.settledReward = paid.reward;
  await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
  return {
    status: 200 as const,
    body: {
      ok: true,
      session: projectAiMatch(session),
      reward: paid.reward,
      character: paid.character,
      _saveVersion: paid.saveVersion,
    },
  };
}

/** Executes one current-rules intent; stats, legality, AI and settlement are server-owned. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    const body = (
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})
    ) as Record<string, unknown>;
    const matchId = String(body.matchId ?? "").trim();
    const action = String(body.action ?? "");
    if (!MATCH_ID_RE.test(matchId))
      return res.status(400).json({ error: "Invalid matchId." });
    const identity = await authedPlayerOrAdmin(req);
    if (!identity)
      return res.status(401).json({ error: "Authentication required." });
    if (
      !identity.admin &&
      !(await enforceRateLimitKv(
        req,
        res,
        "card-clash-ai-move",
        180,
        60_000,
        identity.name,
      ))
    )
      return;

    const key = cardClashAiTokenKey(matchId);
    const out = await withKvLock(
      key,
      async () => {
        const session = await kv.get<StoredSession>(key);
        if (!session)
          return {
            status: 404 as const,
            body: { error: "Chronicle showdown not found or expired." },
          };
        if (!identity.admin && identity.name !== session.playerName)
          return {
            status: 403 as const,
            body: { error: "This duel belongs to another player." },
          };
        if (
          session.rulesVersion !== CHRONICLE_RULES_VERSION ||
          session.state?.rulesVersion !== CHRONICLE_RULES_VERSION
        )
          return {
            status: 409 as const,
            body: { error: "This duel used retired rules; start a new duel." },
          };
        if (action === "state")
          return {
            status: 200 as const,
            body: {
              ok: true,
              session: projectAiMatch(session),
              reward: session.settledReward,
            },
          };
        if (action === "forfeit" || action === "retreat") {
          if (!isDone(session)) forfeit(session);
          return persistOrSettle(session, key);
        }
        if (!ACTIONS.has(action))
          return {
            status: 400 as const,
            body: { error: `Unknown action: ${action}` },
          };
        if (isDone(session)) return persistOrSettle(session, key);
        const moved = applyPlayerAction(session, {
          action,
          handIndex: optionalIndex(body.handIndex),
          zoneIndex: optionalIndex(body.zoneIndex),
          tributeZoneIndexes: Array.isArray(body.tributeZoneIndexes)
            ? body.tributeZoneIndexes
                .map(optionalIndex)
                .filter((n): n is number => n !== undefined)
            : undefined,
          attackerZoneIndex: optionalIndex(body.attackerZoneIndex),
          targetZoneIndex:
            body.targetZoneIndex === null
              ? null
              : optionalIndex(body.targetZoneIndex),
          targetSide:
            body.targetSide === "p1" || body.targetSide === "p2"
              ? body.targetSide
              : undefined,
          graveyardIndex: optionalIndex(body.graveyardIndex),
          ...(body.position === "attack" || body.position === "defense"
            ? { position: body.position }
            : {}),
        });
        if (!moved.ok)
          return { status: 400 as const, body: { error: moved.error } };
        return persistOrSettle(session, key);
      },
      { failClosed: true },
    );
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error("[card-clash/ai-move]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
