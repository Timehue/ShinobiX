import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayer, isAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { randomUUID } from 'crypto';
import { sectorChatKey } from './sector/_chat.js';
import { isSectorChatSector, type SectorChatMessage } from '../shared/sector-chat.js';

/**
 * Player-submitted abuse/content reports (EU DSA notice-and-action + UK Online
 * Safety Act in-service reporting). A signed-in player flags a player, message,
 * profile, or chat line; the report is queued server-side for staff review.
 *
 *   POST   { targetType, category, targetName?, targetId?, context?, note? }
 *          player-authed → queues a report → { ok: true }
 *   GET                              admin-authed → { reports: Report[] }  (newest first)
 *   DELETE { id }                    admin-authed → resolves/removes one   → { ok: true }
 *
 * Reports live in ONE base-store hash keyed by report id (`reports:queue`).
 * Field-level hset is atomic on the base Postgres store, so concurrent submits
 * with distinct ids never clobber each other. Storage is small JSON per report;
 * staff DELETE to resolve, which keeps the queue bounded in normal operation.
 *
 * Anti-abuse: per-reporter rate limit (a report is cheap to file, so cap the
 * flood), strict allowlists on the enum fields, and hard length caps on the
 * free-text fields. The note is stored verbatim (only length-capped, control
 * chars stripped) — NOT run through the profanity masker: a report often must
 * quote the offending text for staff to judge it, and the admin UI renders
 * through React (escaped), so masking would destroy evidence without adding
 * safety.
 */

const REPORTS_KEY = 'reports:queue';

const CATEGORIES = new Set([
    'harassment', 'hate', 'sexual', 'threats',
    'spam', 'scam', 'cheating', 'impersonation', 'other',
]);
const TARGET_TYPES = new Set(['player', 'message', 'profile', 'clan-chat', 'other']);

const NOTE_MAX = 1000;
const SHORT_MAX = 80;
const ID_MAX = 160;

interface StoredReport {
    id: string;
    createdAt: number;
    reporter: string;
    targetType: string;
    category: string;
    targetName: string | null;
    targetId: string | null;
    context: string | null;
    note: string | null;
    /** A server-side copy of a reported line that will not outlive review. */
    evidence?: { name: string; text: string; ts: number };
    status: 'open';
}

/**
 * Sector chat lines fade within the hour (shared/sector-chat.ts), long before
 * staff can review a report, so a report on one keeps its own copy of what was
 * said. The copy is read from storage by id, never taken from the reporter, so
 * a report cannot put words in someone else's mouth. Best effort: a miss or a
 * storage error files the report without it.
 */
async function sectorChatEvidence(targetType: string, context: string | null, targetId: string | null): Promise<StoredReport['evidence']> {
    const match = /^sector-chat:(\d+)$/.exec(context ?? '');
    if (targetType !== 'message' || !match || !targetId) return undefined;
    const sector = Number(match[1]);
    if (!isSectorChatSector(sector)) return undefined;
    try {
        const lines = await kv.get<SectorChatMessage[]>(sectorChatKey(sector));
        const line = Array.isArray(lines) ? lines.find((m) => m?.id === targetId) : undefined;
        return line ? { name: clip(line.name, SHORT_MAX), text: clip(line.text, NOTE_MAX), ts: Number(line.ts) || 0 } : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Trim + cap a free-text field, replacing any Unicode control character (null
 * bytes, newlines, tabs, C0/C1) with a space. Content is otherwise preserved
 * verbatim (see the module note on why the report note is not profanity-masked).
 */
function clip(value: unknown, max: number): string {
    return String(value ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, max);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'POST') {
        const reporter = await authedPlayer(req);
        if (!reporter) return res.status(401).json({ error: 'Sign in to report.' });

        // A report is cheap to file, so cap the flood per account (KV-backed so
        // it survives instance hops). Deliberately generous — legitimate players
        // rarely file many, but a griefer shouldn't be able to spam the queue.
        if (!(await enforceRateLimitKv(req, res, 'report', 12, 60 * 60 * 1000, reporter))) return;

        const body = typeof req.body === 'string'
            ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
            : (req.body ?? {});

        const targetType = clip(body.targetType, 24);
        if (!TARGET_TYPES.has(targetType)) return res.status(400).json({ error: 'Invalid target type.' });
        const category = clip(body.category, 24);
        if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid category.' });

        const id = randomUUID();
        const targetId = clip(body.targetId, ID_MAX) || null;
        const context = clip(body.context, SHORT_MAX) || null;
        const evidence = await sectorChatEvidence(targetType, context, targetId);
        const record: StoredReport = {
            id,
            createdAt: Date.now(),
            reporter,
            targetType,
            category,
            targetName: clip(body.targetName, SHORT_MAX) || null,
            targetId,
            context,
            note: clip(body.note, NOTE_MAX) || null,
            ...(evidence ? { evidence } : {}),
            status: 'open',
        };

        await kv.hset(REPORTS_KEY, { [id]: record });
        return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
        // Review surface — staff only. Both admin roles may triage reports.
        if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only.' });
        const all = (await kv.hgetall<Record<string, StoredReport>>(REPORTS_KEY)) ?? {};
        const reports = Object.values(all)
            .filter((r): r is StoredReport => !!r && typeof r === 'object')
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        return res.status(200).json({ reports });
    }

    if (req.method === 'DELETE') {
        // Resolve / dismiss a report — staff only.
        if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only.' });
        const body = typeof req.body === 'string'
            ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
            : (req.body ?? {});
        const id = clip(body.id ?? req.query?.id, ID_MAX);
        if (!id) return res.status(400).json({ error: 'Missing report id.' });
        await kv.hdel(REPORTS_KEY, id);
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
}
