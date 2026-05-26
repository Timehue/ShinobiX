import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { safeEqual } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';

// ─── Moderation key model ─────────────────────────────────────────────────────
//
//   mod:ban:<lowercase-name>       — { until, reason, by, at, permanent? }
//   mod:silence:<lowercase-name>   — { until, reason, by, at }
//   mod:ip:<lowercase-name>        — { lastIp, ips: string[], lastSeenAt }
//   mod:by-ip:<ip>                 — string[] of names that have used this IP
//   mod:audit                      — append-only log capped at 200 entries
//
// All `mod:*` keys are excluded from server-reset wipes so punishments and
// IP linkage survive a full reset.

export type BanRecord = {
    until: number;           // ms epoch; 0/Infinity if permanent
    reason: string;
    by: string;              // admin name or "admin" for password auth
    at: number;              // ms epoch when ban issued
    permanent?: boolean;
};

export type SilenceRecord = {
    until: number;
    reason: string;
    by: string;
    at: number;
};

export type IpRecord = {
    lastIp: string;
    ips: string[];
    lastSeenAt: number;
};

export type FpRecord = {
    lastFp: string;
    fps: string[];
    lastSeenAt: number;
};

export type AuditEntry = {
    ts: number;
    actor: string;           // admin who took the action
    action: 'ban' | 'unban' | 'silence' | 'unsilence' | 'kick' | 'delete-chat-message';
    target: string;
    detail?: string;
};

const BAN_KEY_PREFIX = 'mod:ban:';
const SILENCE_KEY_PREFIX = 'mod:silence:';
const IP_KEY_PREFIX = 'mod:ip:';
const BY_IP_KEY_PREFIX = 'mod:by-ip:';
const FP_KEY_PREFIX = 'mod:fp:';
const BY_FP_KEY_PREFIX = 'mod:by-fp:';
const AUDIT_KEY = 'mod:audit';

const MAX_AUDIT_ENTRIES = 200;
const MAX_IPS_PER_ACCOUNT = 25;
const MAX_NAMES_PER_IP = 50;
const MAX_FPS_PER_ACCOUNT = 10;
const MAX_NAMES_PER_FP = 50;
// Reject fingerprints that don't match the expected hex format / length.
// Stops the header from being abused to dump arbitrary garbage into KV.
const FP_PATTERN = /^[0-9a-f]{16,64}$/;

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

function banKey(name: string): string { return `${BAN_KEY_PREFIX}${normalizeName(name)}`; }
function silenceKey(name: string): string { return `${SILENCE_KEY_PREFIX}${normalizeName(name)}`; }
function ipKey(name: string): string { return `${IP_KEY_PREFIX}${normalizeName(name)}`; }
function byIpKey(ip: string): string { return `${BY_IP_KEY_PREFIX}${ip}`; }
function fpKey(name: string): string { return `${FP_KEY_PREFIX}${normalizeName(name)}`; }
function byFpKey(fp: string): string { return `${BY_FP_KEY_PREFIX}${fp}`; }

/** Returns the active ban record, or null if none / expired. */
export async function getActiveBan(name: string): Promise<BanRecord | null> {
    if (!name) return null;
    const rec = await kv.get<BanRecord>(banKey(name));
    if (!rec) return null;
    if (rec.permanent) return rec;
    if (rec.until <= Date.now()) {
        await kv.del(banKey(name)).catch(() => 0);
        return null;
    }
    return rec;
}

/** Returns the active silence record, or null if none / expired. */
export async function getActiveSilence(name: string): Promise<SilenceRecord | null> {
    if (!name) return null;
    const rec = await kv.get<SilenceRecord>(silenceKey(name));
    if (!rec) return null;
    if (rec.until <= Date.now()) {
        await kv.del(silenceKey(name)).catch(() => 0);
        return null;
    }
    return rec;
}

/** Extract the client browser fingerprint from the x-client-fp header. */
export function clientFpFrom(req: VercelRequest): string {
    const raw = req.headers['x-client-fp'];
    const s = (Array.isArray(raw) ? raw[0] : raw) ?? '';
    const trimmed = String(s).trim().toLowerCase();
    if (!trimmed || !FP_PATTERN.test(trimmed)) return '';
    return trimmed;
}

/** Extract the request's client IP, normalized (first XFF hop wins). */
export function clientIpFrom(req: VercelRequest): string {
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    const fromXff = xffStr?.split(',')[0]?.trim();
    if (fromXff) return fromXff;
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
    return (req.socket?.remoteAddress ?? 'unknown').trim();
}

/**
 * Record that `name` was just observed with browser fingerprint `fp`.
 * Mirrors recordClientIp but for fingerprints, which survive VPNs.
 * Safe to call on every heartbeat / login.
 */
export async function recordClientFingerprint(name: string, fp: string): Promise<void> {
    if (!name || !fp || !FP_PATTERN.test(fp)) return;
    const n = normalizeName(name);
    try {
        const [existing, fpList] = await Promise.all([
            kv.get<FpRecord>(fpKey(n)),
            kv.get<string[]>(byFpKey(fp)),
        ]);
        const fps = existing?.fps ?? [];
        const nextFps = [fp, ...fps.filter(x => x !== fp)].slice(0, MAX_FPS_PER_ACCOUNT);
        const forward: FpRecord = { lastFp: fp, fps: nextFps, lastSeenAt: Date.now() };
        const names = Array.isArray(fpList) ? fpList : [];
        const nextNames = [n, ...names.filter(x => x !== n)].slice(0, MAX_NAMES_PER_FP);
        await Promise.all([
            kv.set(fpKey(n), forward),
            kv.set(byFpKey(fp), nextNames),
        ]);
    } catch {
        // Best-effort — never break the calling handler.
    }
}

/**
 * Record that `name` was just observed coming from `ip`. Updates both
 * mod:ip:<name> (forward lookup) and mod:by-ip:<ip> (reverse index).
 * Safe to call on every heartbeat / login.
 */
export async function recordClientIp(name: string, ip: string): Promise<void> {
    if (!name || !ip || ip === 'unknown') return;
    const n = normalizeName(name);
    try {
        const [existing, ipList] = await Promise.all([
            kv.get<IpRecord>(ipKey(n)),
            kv.get<string[]>(byIpKey(ip)),
        ]);
        // Forward: append IP to the per-account list (dedup, cap).
        const ips = existing?.ips ?? [];
        const nextIps = [ip, ...ips.filter(x => x !== ip)].slice(0, MAX_IPS_PER_ACCOUNT);
        const forward: IpRecord = { lastIp: ip, ips: nextIps, lastSeenAt: Date.now() };
        // Reverse: append name to the per-IP list (dedup, cap).
        const names = Array.isArray(ipList) ? ipList : [];
        const nextNames = [n, ...names.filter(x => x !== n)].slice(0, MAX_NAMES_PER_IP);
        await Promise.all([
            kv.set(ipKey(n), forward),
            kv.set(byIpKey(ip), nextNames),
        ]);
    } catch {
        // IP tracking is best-effort — never break the calling handler.
    }
}

async function appendAudit(entry: AuditEntry): Promise<void> {
    try {
        const existing = (await kv.get<AuditEntry[]>(AUDIT_KEY)) ?? [];
        const next = [entry, ...existing].slice(0, MAX_AUDIT_ENTRIES);
        await kv.set(AUDIT_KEY, next);
    } catch {
        // best-effort
    }
}

function isAdminAuth(req: VercelRequest): boolean {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return false;
    const header = req.headers['x-admin-password'];
    const headerStr = Array.isArray(header) ? header[0] : header;
    const bodyPw = (() => {
        try {
            const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            return typeof b?.password === 'string' ? b.password : '';
        } catch { return ''; }
    })();
    if (headerStr && safeEqual(headerStr, expected)) return true;
    if (bodyPw && safeEqual(bodyPw, expected)) return true;
    return false;
}

function durationMs(d: unknown): number {
    if (d === 'permanent') return Number.POSITIVE_INFINITY;
    const days = Number(d);
    if (!Number.isFinite(days) || days <= 0) return 0;
    return Math.floor(days) * 24 * 60 * 60 * 1000;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Light rate-limit to stop accidental hammering.
    if (!enforceRateLimit(req, res, 'admin-moderation', 60, 60_000)) return;

    if (!isAdminAuth(req)) {
        return res.status(401).json({ error: 'Admin authentication required.' });
    }

    try {
        if (req.method === 'GET') {
            // Return the full mod state: active bans, active silences, audit log.
            const [banKeys, silKeys, audit] = await Promise.all([
                kv.keys(`${BAN_KEY_PREFIX}*`),
                kv.keys(`${SILENCE_KEY_PREFIX}*`),
                kv.get<AuditEntry[]>(AUDIT_KEY),
            ]);
            const [banVals, silVals] = await Promise.all([
                banKeys.length ? kv.mget<BanRecord[]>(...banKeys) : Promise.resolve([]),
                silKeys.length ? kv.mget<SilenceRecord[]>(...silKeys) : Promise.resolve([]),
            ]);
            const now = Date.now();
            const bans = banKeys
                .map((k, i) => ({ name: k.slice(BAN_KEY_PREFIX.length), record: banVals[i] }))
                .filter(b => b.record && (b.record.permanent || b.record.until > now));
            const silences = silKeys
                .map((k, i) => ({ name: k.slice(SILENCE_KEY_PREFIX.length), record: silVals[i] }))
                .filter(s => s.record && s.record.until > now);
            return res.status(200).json({
                bans,
                silences,
                audit: Array.isArray(audit) ? audit : [],
            });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { kind, target, reason, days, actor } = body as {
            kind?: string;
            target?: string;
            reason?: string;
            days?: number | 'permanent';
            actor?: string;
        };

        const actorName = (typeof actor === 'string' && actor.trim()) ? actor.trim() : 'admin';
        const targetName = typeof target === 'string' ? normalizeName(target) : '';

        if (kind === 'ban') {
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });
            const dur = durationMs(days);
            if (dur === 0) return res.status(400).json({ error: 'Invalid duration.' });
            const permanent = dur === Number.POSITIVE_INFINITY;
            const rec: BanRecord = {
                until: permanent ? 0 : Date.now() + dur,
                reason: (reason ?? '').slice(0, 500),
                by: actorName,
                at: Date.now(),
                permanent,
            };
            await kv.set(banKey(targetName), rec);
            // Also clear active presence + any auth header session won't help, so
            // the player will be kicked on next auth check.
            await kv.del(`presence:${targetName}`).catch(() => 0);
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'ban',
                target: targetName,
                detail: permanent ? 'permanent' : `${Math.round(dur / 86400000)}d — ${rec.reason}`,
            });
            return res.status(200).json({ ok: true, ban: rec });
        }

        if (kind === 'unban') {
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });
            await kv.del(banKey(targetName));
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'unban',
                target: targetName,
            });
            return res.status(200).json({ ok: true });
        }

        if (kind === 'silence') {
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });
            const dur = durationMs(days);
            if (dur === 0 || dur === Number.POSITIVE_INFINITY) {
                return res.status(400).json({ error: 'Silence requires a finite duration in days.' });
            }
            const rec: SilenceRecord = {
                until: Date.now() + dur,
                reason: (reason ?? '').slice(0, 500),
                by: actorName,
                at: Date.now(),
            };
            await kv.set(silenceKey(targetName), rec);
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'silence',
                target: targetName,
                detail: `${Math.round(dur / 86400000)}d — ${rec.reason}`,
            });
            return res.status(200).json({ ok: true, silence: rec });
        }

        if (kind === 'unsilence') {
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });
            await kv.del(silenceKey(targetName));
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'unsilence',
                target: targetName,
            });
            return res.status(200).json({ ok: true });
        }

        if (kind === 'kick') {
            // Force-kick: clear presence + active PvP session pointers. The player
            // stays logged in but is dropped from active state.
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });
            await kv.del(`presence:${targetName}`).catch(() => 0);
            await kv.set(`reset-signal:${targetName}`, { reason: 'admin-kick', at: Date.now() }, { ex: 60 }).catch(() => null);
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'kick',
                target: targetName,
                detail: typeof reason === 'string' ? reason.slice(0, 200) : undefined,
            });
            return res.status(200).json({ ok: true });
        }

        if (kind === 'ip-lookup' || kind === 'lookup') {
            if (!targetName) return res.status(400).json({ error: 'Missing target.' });

            const [ipRec, fpRec] = await Promise.all([
                kv.get<IpRecord>(ipKey(targetName)),
                kv.get<FpRecord>(fpKey(targetName)),
            ]);

            // Build per-IP reverse listings (capped at 10 IPs to bound work).
            const ipReverse = ipRec?.ips?.length
                ? await Promise.all(
                    ipRec.ips.slice(0, 10).map(ip => kv.get<string[]>(byIpKey(ip)).then(list => ({ ip, names: list ?? [] })))
                  )
                : [];
            const linkedByIpSet = new Set<string>();
            const perIp: Array<{ ip: string; names: string[] }> = [];
            for (const { ip, names } of ipReverse) {
                const others = names.filter(n => n !== targetName);
                perIp.push({ ip, names: others });
                others.forEach(n => linkedByIpSet.add(n));
            }

            // Same for fingerprints. The fp signal survives VPNs, so a match
            // here is much stronger evidence of the same person than a shared IP.
            const fpReverse = fpRec?.fps?.length
                ? await Promise.all(
                    fpRec.fps.slice(0, 10).map(fp => kv.get<string[]>(byFpKey(fp)).then(list => ({ fp, names: list ?? [] })))
                  )
                : [];
            const linkedByFpSet = new Set<string>();
            const perFp: Array<{ fp: string; names: string[] }> = [];
            for (const { fp, names } of fpReverse) {
                const others = names.filter(n => n !== targetName);
                perFp.push({ fp, names: others });
                others.forEach(n => linkedByFpSet.add(n));
            }

            // Accounts linked by BOTH signals are almost certainly the same person.
            const linkedByBoth = Array.from(linkedByIpSet).filter(n => linkedByFpSet.has(n)).sort();

            return res.status(200).json({
                target: targetName,
                ipRecord: ipRec,
                fpRecord: fpRec,
                linkedByIp: Array.from(linkedByIpSet).sort(),
                linkedByFp: Array.from(linkedByFpSet).sort(),
                linkedByBoth,
                perIp,
                perFp,
                // Back-compat for older clients that still read `linked`.
                linked: Array.from(new Set([...linkedByIpSet, ...linkedByFpSet])).sort(),
            });
        }

        if (kind === 'delete-chat-message') {
            // Remove a single message from a village chat. The chat blob is the
            // full message array — we filter out one by author+ts.
            const { village, author, ts } = body as { village?: string; author?: string; ts?: number };
            if (!village || !author || !Number.isFinite(ts)) {
                return res.status(400).json({ error: 'Missing village, author, or ts.' });
            }
            const chatBlobKey = `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
            const list = (await kv.get<Array<{ author: string; ts: number }>>(chatBlobKey)) ?? [];
            const next = list.filter(m => !(m.author === author && m.ts === ts));
            await kv.set(chatBlobKey, next, { ex: 4 * 60 * 60 });
            await appendAudit({
                ts: Date.now(),
                actor: actorName,
                action: 'delete-chat-message',
                target: normalizeName(author),
                detail: `village=${village}`,
            });
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown kind.' });
    } catch (err) {
        console.error('[admin/moderation]', err);
        return res.status(500).json({ error: String(err) });
    }
}
