import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors } from "../_utils.js";
import { withKvLock } from "../_lock.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import { bumpLegacyStats, legacyBootstrapBeforeCounterIncrement } from "../_legacy-track.js";
import {
  CARD_CLASH_AI_MIN_WIN_DURATION_MS,
  CARD_CLASH_AI_TOKEN_TTL_SECONDS,
  cardClashAiReward,
  cardClashAiTokenKey,
  utcDateKey,
} from "./_ai-reward.js";
import {
  CHRONICLE_RULES_VERSION,
  type ChronicleProjection,
} from "../../shared/chronicle-duel.js";
import {
  applyPlayerAction,
  captureAiStep,
  forfeit,
  isDone,
  projectAiMatch,
  type AiMatchResult,
  type AiMatchSession,
} from "./_ai-engine.js";
import {
  DUNGEON_CARD_AUTHORITY_VERSION,
  applyDungeonCardTerminal,
} from "../dungeon/_encounter-proof.js";

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
  /** A surrender is a terminal receipt, not a paid/completed match. */
  forfeited?: true;
};
type AiLegacyCredit = { receiptId: string; status: "pending" | "done" | "skipped" };
type StoredSession = AiMatchSession & {
  settledReward?: SettledReward;
  legacyCredit?: AiLegacyCredit;
  endedBy?: "forfeit";
};

function ensureAiLegacyCredit(session: StoredSession, key: string): boolean {
  if (session.legacyCredit || !session.settledAt || session.settledReward?.result !== "player") return false;
  const qualified = session.settledAt - Number(session.createdAt ?? 0) >= CARD_CLASH_AI_MIN_WIN_DURATION_MS;
  session.legacyCredit = { receiptId: `card-ai:${key}`, status: qualified ? "pending" : "skipped" };
  return true;
}

async function repairAiLegacyCredit(session: StoredSession, key: string): Promise<boolean> {
  const prepared = ensureAiLegacyCredit(session, key);
  if (session.legacyCredit?.status !== "pending") return prepared;
  const save = await kv.get<Record<string, unknown>>(`save:${session.playerName}`);
  const character = (save?.character ?? null) as Record<string, unknown> | null;
  const delivered = await bumpLegacyStats(
    session.playerName,
    { cardClashWins: 1 },
    {
      receiptId: session.legacyCredit.receiptId,
      characterForBootstrap: legacyBootstrapBeforeCounterIncrement(character, "cardClashWins"),
    },
  );
  if (!delivered) return prepared;
  session.legacyCredit.status = "done";
  return true;
}

async function authoritativePlayerSnapshot(playerName: string): Promise<{
  character?: Record<string, unknown>;
  _saveVersion?: number;
}> {
  const record = await kv.get<Record<string, unknown>>(
    `save:${playerName.trim().toLowerCase()}`,
  );
  const character = record?.character;
  if (!character || typeof character !== "object") return {};
  const saveVersion = Number(record?._saveVersion);
  return {
    character: character as Record<string, unknown>,
    ...(Number.isFinite(saveVersion) && saveVersion > 0
      ? { _saveVersion: saveVersion }
      : {}),
  };
}

async function settleDungeonCard(
  session: StoredSession,
  now: number,
): Promise<
  | {
      ok: true;
      character: Record<string, unknown>;
      saveVersion: number;
    }
  | { ok: false; status: number; error: string }
> {
  const dungeonRunToken = session.dungeonRunToken;
  if (
    !dungeonRunToken ||
    session.dungeonAuthorityVersion !== DUNGEON_CARD_AUTHORITY_VERSION
  ) {
    return {
      ok: false,
      status: 409,
      error: "The Dungeon Card session has no current authority binding.",
    };
  }
  const settled = await mutatePlayerSave(
    session.playerName,
    ({ character }) => {
      const applied = applyDungeonCardTerminal({
        character,
        dungeonRunToken,
        matchId: session.matchId,
        outcome: session.winner ?? "draw",
        now,
      });
      if (!applied.ok) {
        return { ok: false as const, status: 409, error: applied.error };
      }
      return {
        ok: true as const,
        character: applied.character,
        value: null,
        write: !applied.alreadyApplied,
      };
    },
  );
  if (!settled.ok) return settled;
  return {
    ok: true,
    character: settled.character,
    saveVersion: settled._saveVersion,
  };
}

async function settle(
  session: StoredSession,
  now: number,
  // Stable per-session id (the session's KV key): the in-save receipt below is
  // keyed on it so a retry after a crash-between-payout-and-session-mark
  // replays the recorded reward instead of paying twice (P0-2 — this was the
  // codebase's one duplicate-direction settlement window).
  receiptId: string,
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
  const forfeited = session.endedBy === "forfeit";
  const quickWin =
    winner === "player" &&
    now - Number(session.createdAt ?? 0) < CARD_CLASH_AI_MIN_WIN_DURATION_MS;
  const today = utcDateKey(now);
  const settled = await mutatePlayerSave(
    session.playerName,
    ({ character }) => {
      // In-save replay receipt: if this session already paid (a retry after a
      // crash between the payout write and the session settledAt mark), hand
      // back the recorded reward without paying again.
      const redeemed = Array.isArray(character.redeemedCardClashAiSessions)
        ? (character.redeemedCardClashAiSessions as Array<{ id?: unknown; reward?: SettledReward }>)
        : [];
      const prior = redeemed.find((e) => e && typeof e === "object" && e.id === receiptId);
      if (prior?.reward) {
        return {
          ok: true as const,
          character,
          value: prior.reward,
          // Crash recovery after the payout/receipt write but before the
          // terminal session write must not bump the save again. The receipt
          // itself is the complete authority for the prior settlement.
          write: false,
        };
      }
      const alreadyWonToday =
        String(character.cardClashDailyWinDate ?? "") === today;
      // An AI spar never pays (owner rule: only world events, wandering AI,
      // PvP and missions pay). cardClashAiReward is pinned to zero; the
      // settlement receipt keeps its shape so clients and replays are stable.
      const reward = forfeited || quickWin
        ? { ryo: 0, dailyBonus: false }
        : cardClashAiReward(winner, alreadyWonToday);
      const value: SettledReward = {
        result: winner,
        ryo: reward.ryo,
        dailyBonus: reward.dailyBonus,
        ...(forfeited ? { forfeited: true as const } : {}),
      };
      const nextCharacter = {
        ...character,
        // No ledger write: the save's ryo is left exactly as it was.
        ...(reward.ryo > 0 ? { ryo: num(character.ryo) + reward.ryo } : {}),
        cardClashWins:
          num(character.cardClashWins) + (!forfeited && winner === "player" ? 1 : 0),
        cardClashLosses:
          num(character.cardClashLosses) + (!forfeited && winner === "opponent" ? 1 : 0),
        cardClashDraws:
          num(character.cardClashDraws) + (!forfeited && winner === "draw" ? 1 : 0),
        cardClashDailyWinDate: reward.dailyBonus
          ? today
          : character.cardClashDailyWinDate,
        // Receipt rides the SAME write as the payout (atomic by construction).
        redeemedCardClashAiSessions: [
          ...redeemed.slice(-39),
          { id: receiptId, reward: value },
        ],
      };
      return { ok: true as const, character: nextCharacter, value };
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

async function persistOrSettle(
  session: StoredSession,
  key: string,
  aiSteps?: ChronicleProjection[],
) {
  const steps = aiSteps?.length ? { aiSteps } : {};
  if (!isDone(session)) {
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return {
      status: 200 as const,
      body: { ok: true, session: projectAiMatch(session), ...steps },
    };
  }
  if (session.settledAt) {
    if (await repairAiLegacyCredit(session, key)) await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    if (session.legacyCredit?.status === "pending") {
      return {
        status: 503 as const,
        body: { error: "The match is safe, but its Legacy record is still being sealed. Please retry." },
      };
    }
    const snapshot = await authoritativePlayerSnapshot(session.playerName);
    return {
      status: 200 as const,
      body: {
        ok: true,
        session: projectAiMatch(session),
        reward: session.settledReward,
        ...snapshot,
        ...steps,
      },
    };
  }
  const now = Date.now();
  if (session.settlementMode === "external") {
    if (session.dungeonRunToken) {
      // Lock order is deliberately cc-ai -> save: persistOrSettle is called
      // inside the match lock, and mutatePlayerSave acquires the nested save
      // lock. The run proof commits before settledAt, so a lost response can
      // safely replay the same idempotent proof mutation.
      const dungeon = await settleDungeonCard(session, now);
      if (!dungeon.ok) {
        await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
        return {
          status: dungeon.status as 404 | 409 | 503,
          body: { error: dungeon.error },
        };
      }
      session.settledAt = now;
      await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
      return {
        status: 200 as const,
        body: {
          ok: true,
          session: projectAiMatch(session),
          character: dungeon.character,
          _saveVersion: dungeon.saveVersion,
          ...steps,
        },
      };
    }
    session.settledAt = now;
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return {
      status: 200 as const,
      body: { ok: true, session: projectAiMatch(session), ...steps },
    };
  }
  const paid = await settle(session, now, key);
  if (!paid.ok) {
    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    return { status: paid.status as 404 | 503, body: { error: paid.error } };
  }
  session.settledAt = now;
  session.settledReward = paid.reward;
  ensureAiLegacyCredit(session, key);
  // Persist the terminal payout and pending Legacy outbox before delivery.
  await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
  if (session.legacyCredit?.status === "pending") {
    const delivered = await bumpLegacyStats(
      session.playerName,
      { cardClashWins: 1 },
      {
        receiptId: session.legacyCredit.receiptId,
        characterForBootstrap: legacyBootstrapBeforeCounterIncrement(paid.character, "cardClashWins"),
      },
    );
    if (delivered) {
      session.legacyCredit.status = "done";
      await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
    }
  }
  if (session.legacyCredit?.status === "pending") {
    return {
      status: 503 as const,
      body: { error: "The match is safe, but its Legacy record is still being sealed. Please retry." },
    };
  }
  return {
    status: 200 as const,
    body: {
      ok: true,
      session: projectAiMatch(session),
      reward: paid.reward,
      character: paid.character,
      _saveVersion: paid.saveVersion,
      ...steps,
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
        if (action === "state") {
          if (isDone(session) && !session.settledAt) {
            return persistOrSettle(session, key);
          }
          if (session.settledAt && await repairAiLegacyCredit(session, key)) {
            await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
          }
          if (session.legacyCredit?.status === "pending") {
            return {
              status: 503 as const,
              body: { error: "The match is safe, but its Legacy record is still being sealed. Please retry." },
            };
          }
          const snapshot = session.settledAt
            ? await authoritativePlayerSnapshot(session.playerName)
            : {};
          return {
            status: 200 as const,
            body: {
              ok: true,
              session: projectAiMatch(session),
              reward: session.settledReward,
              ...snapshot,
            },
          };
        }
        if (action === "forfeit" || action === "retreat") {
          if (!isDone(session)) {
            // Explicit surrender is economically neutral. Persisting the cause
            // on the session lets settlement commit a durable zero-value replay
            // receipt without turning rapid start/forfeit loops into a faucet or
            // progression counter.
            session.endedBy = "forfeit";
            forfeit(session);
          }
          return persistOrSettle(session, key);
        }
        if (!ACTIONS.has(action))
          return {
            status: 400 as const,
            body: { error: `Unknown action: ${action}` },
          };
        if (isDone(session)) return persistOrSettle(session, key);
        const aiSteps: ChronicleProjection[] = [];
        const moved = applyPlayerAction(
          session,
          {
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
          },
          Date.now(),
          (state) => captureAiStep(aiSteps, state),
        );
        if (!moved.ok)
          return { status: 400 as const, body: { error: moved.error } };
        return persistOrSettle(session, key, aiSteps);
      },
      { failClosed: true },
    );
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error("[card-clash/ai-move]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}
