import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { kv } from "../_storage.js";
import { cors, safeName } from "../_utils.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { withKvLock, LockContendedError } from "../_lock.js";
import { resolvePlayerReference } from "../_account-name.js";
import { chronicleUnlocked, CHRONICLE_LOCKED_ERROR } from "./_starter-cards.js";

type ChallengeStatus = "pending" | "accepted" | "declined" | "expired";
type SparChallenge = {
  id: string;
  fromName: string;
  fromSlug: string;
  toName: string;
  toSlug: string;
  createdAt: number;
  expiresAt: number;
  status: ChallengeStatus;
  matchId?: string;
};
type QueueEntry = { name: string; level: number; joinedAt: number; lastSeen: number };

const QUEUE_KEY = "card-clash:queue";
const QUEUE_TTL_SECONDS = 2 * 60 * 60;
const MATCH_TTL_SECONDS = 5 * 60;
const PAIR_TTL_SECONDS = 5 * 60;
const CHALLENGE_TTL_SECONDS = 10 * 60;
const STALE_MS = 60 * 1000;
const challengeKey = (id: string) => `cc-challenge:${id}`;
const inboxKey = (slug: string) => `cc-challenge-inbox:${slug}`;
const inboxLockKey = (slug: string) => `cc-challenge-inbox-lock:${slug}`;
const matchKey = (slug: string) => `${QUEUE_KEY}:match:${slug}`;
const pairKey = (id: string) => `cc-pair:${id}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function playerSave(slug: string) {
  const save = asRecord(await kv.get<unknown>(`save:${slug}`));
  return { save, character: asRecord(save?.character) };
}

function publicChallenge(record: SparChallenge) {
  return { id: record.id, fromName: record.fromName, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
    const actorName = typeof body.name === "string" ? body.name.trim() : "";
    const action = typeof body.action === "string" ? body.action.toLowerCase() : "";
    if (!actorName || !["request", "inbox", "status", "respond"].includes(action)) {
      return res.status(400).json({ error: "Choose a player and a valid spar action." });
    }
    const identity = await authedPlayerOrAdmin(req, actorName);
    if (!identity) return res.status(401).json({ error: "Authentication required." });
    const actor = safeName(identity.admin ? actorName : identity.name);
    if (!identity.admin && actor !== safeName(actorName)) {
      return res.status(403).json({ error: "Cannot manage a spar challenge for another player." });
    }
    if (!identity.admin && !(await enforceRateLimitKv(req, res, "card-clash-challenge", 60, 60_000, actor))) return;

    if (action === "request") {
      const targetInput = typeof body.targetName === "string" ? body.targetName.trim() : "";
      if (!targetInput || targetInput.length > 40) return res.status(400).json({ error: "Enter the shinobi name you want to challenge." });
      const targetSlug = safeName(await resolvePlayerReference(targetInput));
      if (!targetSlug) return res.status(404).json({ error: "No shinobi was found by that name." });
      if (actor === targetSlug) return res.status(400).json({ error: "Choose another shinobi to spar with." });
      const [{ character: fromCharacter }, { character: toCharacter }] = await Promise.all([
        playerSave(actor), playerSave(targetSlug),
      ]);
      if (!fromCharacter || !toCharacter) return res.status(404).json({ error: "No shinobi was found by that name." });
      if (!chronicleUnlocked(fromCharacter) || !chronicleUnlocked(toCharacter)) {
        return res.status(409).json({ error: CHRONICLE_LOCKED_ERROR });
      }
      const now = Date.now();
      const record: SparChallenge = {
        id: randomUUID(),
        fromName: typeof fromCharacter.name === "string" ? fromCharacter.name : actor,
        fromSlug: actor,
        toName: typeof toCharacter.name === "string" ? toCharacter.name : targetSlug,
        toSlug: targetSlug,
        createdAt: now,
        expiresAt: now + CHALLENGE_TTL_SECONDS * 1000,
        status: "pending",
      };
      const result = await withKvLock<{ status: number; body: Record<string, unknown> }>(inboxLockKey(targetSlug), async () => {
        const inbox = await kv.get<string[]>(inboxKey(targetSlug)) ?? [];
        const liveIds: string[] = [];
        for (const id of inbox) {
          const old = await kv.get<SparChallenge>(challengeKey(id));
          if (!old || old.status !== "pending" || old.expiresAt <= now) continue;
          liveIds.push(id);
          if (old.fromSlug === actor) return { status: 409, body: { error: "You already have a pending challenge with that player." } };
        }
        await Promise.all([
          kv.set(challengeKey(record.id), record, { ex: CHALLENGE_TTL_SECONDS }),
          kv.set(inboxKey(targetSlug), [...liveIds, record.id], { ex: CHALLENGE_TTL_SECONDS }),
        ]);
        return { status: 200, body: { challenge: { id: record.id, toName: record.toName, status: record.status } } };
      }, { failClosed: true });
      return res.status(result.status).json(result.body);
    }

    if (action === "inbox") {
      const now = Date.now();
      const result = await withKvLock<{ challenges: ReturnType<typeof publicChallenge>[] }>(inboxLockKey(actor), async () => {
        const ids = await kv.get<string[]>(inboxKey(actor)) ?? [];
        const pending: SparChallenge[] = [];
        const keep: string[] = [];
        for (const id of ids) {
          const record = await kv.get<SparChallenge>(challengeKey(id));
          if (!record || record.toSlug !== actor || record.status !== "pending") continue;
          if (record.expiresAt <= now) {
            await kv.set(challengeKey(id), { ...record, status: "expired" }, { ex: 60 });
            continue;
          }
          keep.push(id);
          pending.push(record);
        }
        await kv.set(inboxKey(actor), keep, { ex: CHALLENGE_TTL_SECONDS });
        return { challenges: pending.sort((a, b) => a.createdAt - b.createdAt).map(publicChallenge) };
      }, { failClosed: true });
      return res.status(200).json(result);
    }

    const id = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "That spar challenge is invalid." });
    if (action === "status") {
      const record = await kv.get<SparChallenge>(challengeKey(id));
      if (!record) return res.status(200).json({ status: "expired" });
      if (record.fromSlug !== actor) return res.status(404).json({ error: "Spar challenge not found." });
      if (record.status === "pending" && record.expiresAt <= Date.now()) {
        await kv.set(challengeKey(id), { ...record, status: "expired" }, { ex: 60 });
        return res.status(200).json({ status: "expired" });
      }
      return res.status(200).json({ status: record.status, ...(record.matchId ? { matchId: record.matchId } : {}) });
    }

    const decision = body.decision === "accept" ? "accept" : body.decision === "decline" ? "decline" : "";
    if (!decision) return res.status(400).json({ error: "Accept or decline the spar challenge." });
    const result = await withKvLock<{ status: number; body: Record<string, unknown> }>(QUEUE_KEY, async () => {
      const record = await kv.get<SparChallenge>(challengeKey(id));
      if (!record || record.toSlug !== actor) return { status: 404, body: { error: "Spar challenge not found." } };
      if (record.status !== "pending") return { status: 409, body: { error: `This challenge is already ${record.status}.` } };
      const now = Date.now();
      if (record.expiresAt <= now) {
        await kv.set(challengeKey(id), { ...record, status: "expired" }, { ex: 60 });
        return { status: 410, body: { error: "This spar challenge has expired." } };
      }
      if (decision === "decline") {
        await kv.set(challengeKey(id), { ...record, status: "declined" }, { ex: 60 });
        return { status: 200, body: { status: "declined" } };
      }
      const [{ character: fromCharacter }, { character: toCharacter }] = await Promise.all([
        playerSave(record.fromSlug), playerSave(record.toSlug),
      ]);
      if (!fromCharacter || !toCharacter || !chronicleUnlocked(fromCharacter) || !chronicleUnlocked(toCharacter)) {
        await kv.set(challengeKey(id), { ...record, status: "expired" }, { ex: 60 });
        return { status: 409, body: { error: "Both players need the Traveler’s Codex to spar." } };
      }
      const [fromMatch, toMatch] = await Promise.all([
        kv.get<Record<string, unknown>>(matchKey(record.fromSlug)),
        kv.get<Record<string, unknown>>(matchKey(record.toSlug)),
      ]);
      if (fromMatch || toMatch) return { status: 409, body: { error: "One of these players is already entering a card duel." } };

      const matchId = randomUUID();
      const p1Name = record.fromSlug < record.toSlug ? record.fromSlug : record.toSlug;
      const p2Name = record.fromSlug < record.toSlug ? record.toSlug : record.fromSlug;
      const pair = { matchId, p1Name, p2Name, createdAt: now };
      const fromMatchRecord = { matchId, opponent: record.toSlug, p1: record.fromSlug === p1Name, createdAt: now };
      const toMatchRecord = { matchId, opponent: record.fromSlug, p1: record.toSlug === p1Name, createdAt: now };
      const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
      const filtered = queue.filter(entry => entry.name !== record.fromSlug && entry.name !== record.toSlug && now - (entry.lastSeen ?? entry.joinedAt) < STALE_MS);
      const accepted = { ...record, status: "accepted" as const, matchId };
      await Promise.all([
        kv.set(QUEUE_KEY, filtered, { ex: QUEUE_TTL_SECONDS }),
        kv.set(matchKey(record.fromSlug), fromMatchRecord, { ex: MATCH_TTL_SECONDS }),
        kv.set(matchKey(record.toSlug), toMatchRecord, { ex: MATCH_TTL_SECONDS }),
        kv.set(pairKey(matchId), pair, { ex: PAIR_TTL_SECONDS }),
        kv.set(challengeKey(id), accepted, { ex: MATCH_TTL_SECONDS }),
      ]);
      return { status: 200, body: { status: "accepted", matchId } };
    }, { failClosed: true });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof LockContendedError) return res.status(503).json({ error: "Card Hall matchmaking is busy. Please retry." });
    console.error("[card-clash/challenge]", error);
    return res.status(500).json({ error: "The spar challenge could not be completed." });
  }
}
