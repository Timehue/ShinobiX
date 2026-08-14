import { kv } from "../_storage.js";
import { withKvLock } from "../_lock.js";
import { bumpLegacyStats, legacyEnabled } from "../_legacy-track.js";
import type { ChronicleActionIntent, ChronicleMatch, ChronicleSideKey } from "../../shared/chronicle-duel.js";

export const FREEPLAY_LEGACY_MIN_DURATION_MS = 45_000;
export const FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE = 3;
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

export function ensureFreePlayLegacyCredit(session: CreditSession): boolean {
  if (session.legacyCredit || !session.state || session.state.status !== "complete") return false;
  const winner = session.state.winner;
  if (!winner || winner === "draw") return false;
  const participation = session.participation;
  const qualified = Boolean(
    participation
    && participation.endedBy === "play"
    && session.updatedAt - participation.startedAt >= FREEPLAY_LEGACY_MIN_DURATION_MS
    && participation.p1Actions >= FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE
    && participation.p2Actions >= FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE
    && session.state.turnNumber >= 3,
  );
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

function pairHistoryKey(left: string, right: string): string {
  const pair = [left.trim().toLowerCase(), right.trim().toLowerCase()].sort();
  return `cc-freeplay-legacy-pair:${encodeURIComponent(pair[0])}:${encodeURIComponent(pair[1])}`;
}

async function reservePairDecision(credit: FreePlayLegacyCredit, now: number): Promise<boolean> {
  const key = pairHistoryKey(credit.winnerName, credit.targetName);
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
  const eligible = await reservePairDecision(credit, session.updatedAt);
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
