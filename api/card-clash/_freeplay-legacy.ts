import { kv } from "../_storage.js";
import { withKvLock } from "../_lock.js";
import { bumpLegacyStats, legacyEnabled } from "../_legacy-track.js";
import type { ChronicleActionIntent, ChronicleMatch, ChronicleSideKey } from "../../shared/chronicle-duel.js";

export const FREEPLAY_LEGACY_MIN_DURATION_MS = 45_000;
export const FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE = 3;
/** The duel must reach this turn number to count. */
export const FREEPLAY_LEGACY_MIN_TURN = 3;
const PAIR_HISTORY_TTL_SEC = 7 * 24 * 60 * 60;
const PAIR_HISTORY_CAP = 16;

export type FreePlayParticipation = {
  startedAt: number;
  p1Actions: number;
  p2Actions: number;
  endedBy?: "play" | "forfeit" | "timeout";
};

export type FreePlayLegacyCredit = {
  receiptId: string;
  winnerName: string;
  targetName: string;
  status: "pending" | "done" | "skipped";
  reason?: "participation" | "reciprocal";
};

type CreditSession = {
  matchId: string;
  p1Name: string;
  p2Name: string;
  state?: ChronicleMatch;
  updatedAt: number;
  participation?: FreePlayParticipation;
  legacyCredit?: FreePlayLegacyCredit;
};

const MEANINGFUL_ACTIONS = new Set<ChronicleActionIntent["action"]>([
  "normal-summon", "set-monster", "flip-summon", "change-position",
  "activate-magic", "set-trap", "activate-trap", "attack", "end-turn",
]);

export function recordFreePlayParticipation(
  participation: FreePlayParticipation,
  actor: ChronicleSideKey,
  action: ChronicleActionIntent["action"],
  terminal: boolean,
): FreePlayParticipation {
  const next = { ...participation };
  if (MEANINGFUL_ACTIONS.has(action)) {
    if (actor === "p1") next.p1Actions += 1;
    else next.p2Actions += 1;
  }
  if (terminal) next.endedBy = action === "forfeit" ? "forfeit" : "play";
  return next;
}

/**
 * The free-play participation rule: a duel ended by play (not a forfeit or the
 * clock), at least FREEPLAY_LEGACY_MIN_DURATION_MS long, with three meaningful
 * actions from EACH side, that reached turn 3. Because both sides must have
 * played and nobody walked out, a duel that passes also proves the loser was
 * engaged. Shared by the Legacy credit and the card Chronicle Point credit
 * (api/card-clash/_card-cp.ts), so the two can never disagree about a duel.
 */
export function freePlayParticipationQualified(input: {
  participation?: FreePlayParticipation;
  /** The duel's terminal clock (the session's updatedAt when it ended). */
  endedAt: number;
  turnNumber: number;
}): boolean {
  const participation = input.participation;
  return Boolean(
    participation
    && participation.endedBy === "play"
    && input.endedAt - participation.startedAt >= FREEPLAY_LEGACY_MIN_DURATION_MS
    && participation.p1Actions >= FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE
    && participation.p2Actions >= FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE
    && input.turnNumber >= FREEPLAY_LEGACY_MIN_TURN,
  );
}

export function ensureFreePlayLegacyCredit(session: CreditSession): boolean {
  if (session.legacyCredit || !session.state || session.state.status !== "complete") return false;
  const winner = session.state.winner;
  if (!winner || winner === "draw") return false;
  const qualified = freePlayParticipationQualified({
    participation: session.participation,
    endedAt: session.updatedAt,
    turnNumber: session.state.turnNumber,
  });
  session.legacyCredit = {
    receiptId: `card-pvp:${session.matchId}`,
    winnerName: winner === "p1" ? session.p1Name : session.p2Name,
    targetName: winner === "p1" ? session.p2Name : session.p1Name,
    status: qualified ? "pending" : "skipped",
    ...(qualified ? {} : { reason: "participation" as const }),
  };
  return true;
}

type PairOutcome = { matchId: string; winner: string; at: number; eligible: boolean };
type PairHistory = { outcomes: PairOutcome[] };

/** The free-play history the Legacy credit reads. Other callers name their own. */
export const FREEPLAY_PAIR_HISTORY_PREFIX = "cc-freeplay-legacy-pair";

function pairHistoryKey(left: string, right: string, prefix = FREEPLAY_PAIR_HISTORY_PREFIX): string {
  const pair = [left.trim().toLowerCase(), right.trim().toLowerCase()].sort();
  return `${prefix}:${encodeURIComponent(pair[0])}:${encodeURIComponent(pair[1])}`;
}

/**
 * Record (once per receipt) whether this duel's win is reciprocal: the pair's
 * previous recorded winner was this duel's loser. A replay of the same receipt
 * returns the decision first recorded, so every caller that names one duel by
 * one receipt reads one answer. `historyPrefix` selects the history: the
 * default is the free-play one the Legacy credit uses.
 */
export async function reserveFreePlayPairDecision(
  credit: Pick<FreePlayLegacyCredit, "receiptId" | "winnerName" | "targetName">,
  now: number,
  historyPrefix: string = FREEPLAY_PAIR_HISTORY_PREFIX,
): Promise<boolean> {
  const key = pairHistoryKey(credit.winnerName, credit.targetName, historyPrefix);
  return withKvLock(key, async () => {
    const stored = await kv.get<PairHistory>(key);
    const outcomes = Array.isArray(stored?.outcomes) ? stored.outcomes : [];
    const replay = outcomes.find((entry) => entry.matchId === credit.receiptId);
    if (replay) return replay.eligible;
    const previous = outcomes.at(-1);
    // Once a pair starts alternating winners, every reciprocal leg is
    // progression-neutral. Repeated same-direction wins still pass through the
    // Legacy tracker's per-target 1,1,.5,.25,0 decay.
    const reciprocal = Boolean(previous && previous.winner === credit.targetName.toLowerCase());
    const outcome: PairOutcome = {
      matchId: credit.receiptId,
      winner: credit.winnerName.toLowerCase(),
      at: now,
      eligible: !reciprocal,
    };
    await kv.set(key, { outcomes: [...outcomes, outcome].slice(-PAIR_HISTORY_CAP) }, { ex: PAIR_HISTORY_TTL_SEC });
    return outcome.eligible;
  }, { failClosed: true });
}

/** Repair a persisted terminal match's Legacy outbox. Returns true when the session record changed. */
export async function repairFreePlayLegacyCredit(session: CreditSession): Promise<boolean> {
  const credit = session.legacyCredit;
  if (!credit || credit.status !== "pending") return false;
  if (!legacyEnabled()) {
    credit.status = "done";
    return true;
  }
  const eligible = await reserveFreePlayPairDecision(credit, session.updatedAt);
  if (!eligible) {
    credit.status = "skipped";
    credit.reason = "reciprocal";
    return true;
  }
  const delivered = await bumpLegacyStats(
    credit.winnerName,
    { cardClashWins: 1 },
    { receiptId: credit.receiptId, pvpTarget: credit.targetName },
  );
  if (!delivered) return false;
  credit.status = "done";
  return true;
}
