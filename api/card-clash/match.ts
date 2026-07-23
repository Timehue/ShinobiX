import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { cors, safeName } from "../_utils.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { withKvLock } from "../_lock.js";
import { legacyEnabled, bumpLegacyStats } from "../_legacy-track.js";
import {
  resolveChronicleDeckWithSave,
  type ChronicleDeckResolution,
} from "./_deck.js";
import {
  CHRONICLE_RULES_VERSION,
  TURN_TIMEOUT_MS,
  applyAction,
  createMatch,
  passExpiredResponse,
  projectMatchForViewer,
  type ChronicleActionIntent,
  type ChronicleMatch,
  type ChronicleSideKey,
} from "../../shared/chronicle-duel.js";

const SESSION_TTL_SEC = 2 * 60 * 60;
const MATCH_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  "forfeit",
]);
type ClashPair = {
  matchId: string;
  p1Name: string;
  p2Name: string;
  createdAt: number;
};
type FreePlaySession = {
  matchId: string;
  rulesVersion: typeof CHRONICLE_RULES_VERSION;
  p1Name: string;
  p2Name: string;
  p1Deck?: string[];
  p2Deck?: string[];
  state?: ChronicleMatch;
  status: "awaiting-opponent" | "active" | "done";
  createdAt: number;
  updatedAt: number;
};
const sessionKey = (id: string) => `cc-freeplay:${id}`;
const pairKey = (id: string) => `cc-pair:${id}`;
function optionalIndex(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}
async function saveSession(session: FreePlaySession) {
  await kv.set(sessionKey(session.matchId), session, { ex: SESSION_TTL_SEC });
}

async function serverDeck(
  playerName: string,
  requested: readonly string[],
  admin: boolean,
): Promise<ChronicleDeckResolution | null> {
  return resolveChronicleDeckWithSave(playerName, requested, admin);
}

async function finalize(session: FreePlaySession): Promise<void> {
  if (
    !legacyEnabled() ||
    session.status !== "done" ||
    !session.state ||
    !session.state.winner ||
    session.state.winner === "draw"
  )
    return;
  const name = session.state.winner === "p1" ? session.p1Name : session.p2Name;
  const marked = await kv.set(`legacy:cc-tracked:${session.matchId}`, true, {
    nx: true,
    ex: 24 * 60 * 60,
  });
  if (marked) await bumpLegacyStats(name, { cardClashWins: 1 });
}

function autoAdvance(session: FreePlaySession, now: number): boolean {
  if (!session.state || session.state.status !== "active") return false;
  const originalState = session.state;
  let state = originalState;
  if (state.responseWindow && state.responseWindow.expiresAt <= now) {
    const passed = passExpiredResponse(state, now);
    if (passed.ok) state = passed.state;
  }
  if (!state.responseWindow && state.turnStartedAt + TURN_TIMEOUT_MS <= now) {
    const actor = state.activePlayer;
    for (let safety = 0; safety < 5 && state.activePlayer === actor; safety++) {
      const timeoutAction: ChronicleActionIntent =
        state.phase === "draw" || state.phase === "standby"
          ? { action: "advance-phase" }
          : state.phase === "battle"
            ? { action: "enter-main-2" }
            : state.phase === "main1" || state.phase === "main2"
              ? { action: "enter-end-phase" }
              : { action: "end-turn" };
      const advanced = applyAction(state, actor, timeoutAction, now);
      if (!advanced.ok) break;
      state = advanced.state;
    }
  }
  if (state === originalState) return false;
  session.state = state;
  session.status = state.status === "complete" ? "done" : "active";
  session.updatedAt = now;
  return true;
}

function intent(
  body: Record<string, unknown>,
  action: string,
): ChronicleActionIntent {
  return {
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
  };
}

/** Current-rules unranked PvP. Pairing, hidden information, move legality and winner are server-owned. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  const identity = await authedPlayerOrAdmin(req);
  if (!identity)
    return res.status(401).json({ error: "Authentication required." });
  if (
    !identity.admin &&
    !(await enforceRateLimitKv(
      req,
      res,
      "card-clash-match",
      150,
      60_000,
      identity.name,
    ))
  )
    return;
  try {
    const body = (
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})
    ) as Record<string, unknown>;
    const action = String(body.action ?? "").toLowerCase();
    const matchId = String(body.matchId ?? "").trim();
    if (!MATCH_ID_RE.test(matchId))
      return res.status(400).json({ error: "Invalid matchId." });

    const result = await withKvLock(
      sessionKey(matchId),
      async () => {
        let session = await kv.get<FreePlaySession>(sessionKey(matchId));
        const pair = await kv.get<ClashPair>(pairKey(matchId));
        // The pair record is intentionally short-lived: it authorizes creation
        // of the session, not the full duel. Once created, the session's copied
        // participant names are immutable and remain the authority until the
        // two-hour duel TTL expires.
        const participants = session ?? pair;
        if (!participants)
          return {
            status: 404 as const,
            body: { error: "Chronicle showdown not found or expired." },
          };
        const me = identity.admin
          ? safeName(String(body.playerName ?? participants.p1Name))
          : identity.name;
        const side: ChronicleSideKey | null =
          me === participants.p1Name
            ? "p1"
            : me === participants.p2Name
              ? "p2"
              : null;
        if (!side)
          return {
            status: 403 as const,
            body: { error: "You are not a participant in this duel." },
          };
        const now = Date.now();
        let createdSession = false;
        if (!session) {
          if (!pair)
            return {
              status: 404 as const,
              body: { error: "Match pairing expired before either player joined." },
            };
          session = {
            matchId,
            rulesVersion: CHRONICLE_RULES_VERSION,
            p1Name: pair.p1Name,
            p2Name: pair.p2Name,
            status: "awaiting-opponent",
            createdAt: now,
            updatedAt: now,
          };
          createdSession = true;
        }
        if (session.rulesVersion !== CHRONICLE_RULES_VERSION)
          return {
            status: 409 as const,
            body: { error: "This duel used retired rules; start a new duel." },
          };
        const autoAdvanced = autoAdvance(session, now);

        if (action === "state") {
          // State polls are read-only unless they create the short-lived pair
          // handoff or resolve an expired response/turn. This avoids a KV write
          // every few seconds for a turn-based game.
          if (createdSession || autoAdvanced) await saveSession(session);
          if (autoAdvanced) await finalize(session);
          return {
            status: 200 as const,
            body: {
              session: session.state
                ? projectMatchForViewer(session.state, side)
                : {
                    matchId,
                    rulesVersion: CHRONICLE_RULES_VERSION,
                    status: session.status,
                    viewerSide: side,
                  },
            },
          };
        }
        if (action === "join" || action === "submit-deck") {
          const resolvedDeck = await serverDeck(
            me,
            Array.isArray(body.deck)
              ? body.deck.filter((id): id is string => typeof id === "string")
              : [],
            identity.admin,
          );
          if (!resolvedDeck)
            return {
              status: 400 as const,
              body: { error: "No legal 40-card Chronicle deck is available." },
            };
          const deck = resolvedDeck.deck;
          if (side === "p1") session.p1Deck = deck;
          else session.p2Deck = deck;
          if (!session.state && session.p1Deck && session.p2Deck) {
            session.state = createMatch(
              session.p1Name,
              session.p1Deck,
              session.p2Name,
              session.p2Deck,
              Math.random,
              now,
            );
            session.status = "active";
          }
          session.updatedAt = now;
          await saveSession(session);
          return {
            status: 200 as const,
            body: {
              ...(resolvedDeck.saveVersion === undefined
                ? {}
                : { _saveVersion: resolvedDeck.saveVersion }),
              session: session.state
                ? projectMatchForViewer(session.state, side)
                : {
                    matchId,
                    rulesVersion: CHRONICLE_RULES_VERSION,
                    status: session.status,
                    viewerSide: side,
                  },
            },
          };
        }
        if (!session.state)
          return {
            status: 409 as const,
            body: { error: "Waiting for the other duelist to join." },
          };
        if (!ACTIONS.has(action))
          return {
            status: 400 as const,
            body: { error: `Unknown action: ${action}` },
          };
        const applied = applyAction(
          session.state,
          side,
          intent(body, action),
          now,
        );
        if (!applied.ok)
          return { status: 400 as const, body: { error: applied.error } };
        session.state = applied.state;
        session.status =
          applied.state.status === "complete" ? "done" : "active";
        session.updatedAt = now;
        await saveSession(session);
        await finalize(session);
        return {
          status: 200 as const,
          body: { session: projectMatchForViewer(session.state, side) },
        };
      },
      { failClosed: true },
    );
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[card-clash/match]", error);
    return res.status(500).json({ error: "Internal server error." });
  }
}
