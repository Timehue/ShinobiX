import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors, safeName } from "../_utils.js";
import { withKvLock } from "../_lock.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import {
  CHRONICLE_AI_DIFFICULTIES,
  CHRONICLE_RULES_VERSION,
  type ChronicleAiDifficulty,
  type ChronicleProjection,
} from "../../shared/chronicle-duel.js";
import {
  CARD_CLASH_AI_TOKEN_TTL_SECONDS,
  cardClashAiTokenKey,
} from "./_ai-reward.js";
import { captureAiStep, createAiMatch, projectAiMatch } from "./_ai-engine.js";
import {
  resolveChronicleDeckMutation,
  resolveChronicleDeckWithSave,
} from "./_deck.js";
import { chronicleUnlockedFor, CHRONICLE_LOCKED_ERROR } from "./_starter-cards.js";
import {
  DUNGEON_CARD_AUTHORITY_VERSION,
  dungeonCardMatchId,
  resolveDungeonCardAuthority,
} from "../dungeon/_encounter-proof.js";

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

const DUNGEON_RUN_TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

function dungeonCardTerminalRecorded(
  activeRun: Record<string, unknown>,
  matchId: string,
): boolean {
  return activeRun.cardAuthorityVersion === DUNGEON_CARD_AUTHORITY_VERSION
    && activeRun.cardLastProofId === matchId
    && (activeRun.cardLastOutcome === "player"
      || activeRun.cardLastOutcome === "opponent"
      || activeRun.cardLastOutcome === "draw")
    && Number.isFinite(Number(activeRun.cardSettledAt));
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

/** Starts a current-rules, server-authoritative AI duel. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    const body = (
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})
    ) as Record<string, unknown>;
    const hasDungeonEnvelope = Object.prototype.hasOwnProperty.call(
      body,
      "dungeon",
    );
    const dungeonEnvelope =
      body.dungeon &&
      typeof body.dungeon === "object" &&
      !Array.isArray(body.dungeon)
        ? (body.dungeon as Record<string, unknown>)
        : null;
    const dungeonRunToken =
      typeof dungeonEnvelope?.token === "string"
        ? dungeonEnvelope.token.trim()
        : "";
    if (
      hasDungeonEnvelope &&
      (!dungeonEnvelope || !DUNGEON_RUN_TOKEN_RE.test(dungeonRunToken))
    ) {
      return res
        .status(400)
        .json({ error: "A valid nested Dungeon run token is required." });
    }
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

    // The Chronicle stays sealed until the scribe event: no codex, no HALL
    // duels. World-embedded encounters (dungeon card tiles and other
    // externalStakes duels) stay open — a locked player must never hit a
    // dead-end room. Spoofing the flag buys nothing: the lock is onboarding
    // pacing, and encounter duels already carry no hall reward token.
    if (
      !identity.admin &&
      body.externalStakes !== true &&
      !dungeonRunToken &&
      !(await chronicleUnlockedFor(playerName))
    ) {
      return res.status(409).json({ error: CHRONICLE_LOCKED_ERROR });
    }

    const requested = submittedIds(body.deck);
    if (dungeonRunToken) {
      // The Dungeon Card seal has one stable match id. Its Chronicle lock is
      // always acquired before the nested save mutation, establishing the
      // global cc-ai -> save lock order for starts, moves, and retries.
      const matchId = dungeonCardMatchId(playerName, dungeonRunToken);
      const key = cardClashAiTokenKey(matchId);
      const out = await withKvLock(
        key,
        async () => {
          const existing = await kv.get<
            ReturnType<typeof createAiMatch> & {
              dungeonRunToken?: string;
              dungeonAuthorityVersion?: number;
            }
          >(key);
          if (existing) {
            if (
              existing.playerName.toLowerCase() !== playerName.toLowerCase() ||
              existing.matchId !== matchId ||
              existing.difficulty !== "medium" ||
              existing.settlementMode !== "external" ||
              existing.dungeonAuthorityVersion !==
                DUNGEON_CARD_AUTHORITY_VERSION ||
              existing.dungeonRunToken !== dungeonRunToken
            ) {
              return {
                status: 409,
                body: {
                  error:
                    "The sealed Dungeon Card session conflicts with its authority binding.",
                },
              };
            }
            const retiredRules =
              Number(existing.rulesVersion) !== CHRONICLE_RULES_VERSION ||
              Number(existing.state?.rulesVersion) !== CHRONICLE_RULES_VERSION;
            const admitted = await mutatePlayerSave<{
              authority: ReturnType<typeof resolveDungeonCardAuthority>;
              terminalRecorded: boolean;
              replacementDeck: string[] | null;
              usedRequested: boolean;
            }>(
              playerName,
              ({ character }) => {
                let authority: ReturnType<typeof resolveDungeonCardAuthority>;
                try {
                  authority = resolveDungeonCardAuthority({
                    playerName,
                    character,
                    dungeonRunToken,
                  });
                } catch (error) {
                  return {
                    ok: false as const,
                    status: 409,
                    error:
                      error instanceof Error
                        ? error.message
                      : "The Dungeon Card seal is no longer active.",
                  };
                }
                const terminalRecorded = dungeonCardTerminalRecorded(
                  authority.activeRun,
                  matchId,
                );
                if (retiredRules && !terminalRecorded) {
                  const deck = resolveChronicleDeckMutation(character, requested);
                  if (!deck.ok) return deck;
                  return {
                    ok: true as const,
                    character: deck.character,
                    value: {
                      authority,
                      terminalRecorded: false,
                      replacementDeck: deck.value.deck,
                      usedRequested: deck.value.usedRequested,
                    },
                  };
                }
                return {
                  ok: true as const,
                  character,
                  value: {
                    authority,
                    terminalRecorded,
                    replacementDeck: null,
                    usedRequested: false,
                  },
                  write: false,
                };
              },
            );
            if (!admitted.ok) {
              return {
                status: admitted.status,
                body: { error: admitted.error },
              };
            }
            if (retiredRules && admitted.value.replacementDeck) {
              const aiSteps: ChronicleProjection[] = [];
              const replacement = createAiMatch(
                matchId,
                playerName,
                admitted.value.replacementDeck,
                "medium",
                Date.now(),
                Math.random,
                "external",
                (state) => captureAiStep(aiSteps, state),
              );
              replacement.dungeonRunToken =
                admitted.value.authority.dungeonRunToken;
              replacement.dungeonAuthorityVersion =
                DUNGEON_CARD_AUTHORITY_VERSION;
              await kv.set(key, replacement, {
                ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS,
              });
              return {
                status: 200,
                body: {
                  ok: true,
                  matchId,
                  session: projectAiMatch(replacement),
                  ...(aiSteps.length ? { aiSteps } : {}),
                  migratedDeck: admitted.value.usedRequested
                    ? undefined
                    : admitted.value.replacementDeck,
                  _saveVersion: admitted._saveVersion,
                  resumedWithCurrentRules: true,
                },
              };
            }
            const snapshot = existing.settledAt || admitted.value.terminalRecorded
              ? await authoritativePlayerSnapshot(playerName)
              : {};
            return {
              status: 200,
              body: {
                ok: true,
                matchId,
                session: projectAiMatch(existing),
                ...snapshot,
              },
            };
          }

          const prepared = await mutatePlayerSave(
            playerName,
            ({ character }) => {
              let authority: ReturnType<typeof resolveDungeonCardAuthority>;
              try {
                authority = resolveDungeonCardAuthority({
                  playerName,
                  character,
                  dungeonRunToken,
                });
              } catch (error) {
                return {
                  ok: false as const,
                  status: 409,
                  error:
                    error instanceof Error
                      ? error.message
                      : "The Dungeon Card seal is not authorized.",
                };
              }
              const deck = resolveChronicleDeckMutation(character, requested);
              if (!deck.ok) return deck;
              return {
                ok: true as const,
                character: deck.character,
                value: { ...deck.value, authority },
              };
            },
          );
          if (!prepared.ok) {
            return {
              status: prepared.status,
              body: { error: prepared.error },
            };
          }
          const aiSteps: ChronicleProjection[] = [];
          const session = createAiMatch(
            matchId,
            playerName,
            prepared.value.deck,
            "medium",
            Date.now(),
            Math.random,
            "external",
            (state) => captureAiStep(aiSteps, state),
          );
          session.dungeonRunToken = prepared.value.authority.dungeonRunToken;
          session.dungeonAuthorityVersion = DUNGEON_CARD_AUTHORITY_VERSION;
          await kv.set(key, session, {
            ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS,
          });
          return {
            status: 200,
            body: {
              ok: true,
              matchId,
              session: projectAiMatch(session),
              ...(aiSteps.length ? { aiSteps } : {}),
              migratedDeck: prepared.value.usedRequested
                ? undefined
                : prepared.value.deck,
              _saveVersion: prepared._saveVersion,
            },
          };
        },
        { failClosed: true },
      );
      return res.status(out.status).json(out.body);
    }

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
    const aiSteps: ChronicleProjection[] = [];
    const session = createAiMatch(
      matchId,
      playerName,
      resolvedDeck,
      difficulty,
      Date.now(),
      Math.random,
      settlementMode,
      (state) => captureAiStep(aiSteps, state),
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
        ...(aiSteps.length ? { aiSteps } : {}),
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
