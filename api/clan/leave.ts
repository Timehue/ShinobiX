import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { clanSlugBare } from './_kick-core.js';
import { applyClanSuccession, resolveClanSuccession } from './_succession.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';

/*
 * /api/clan/leave — POST only
 *
 * Server-authoritative "leave clan", replacing a client-orchestrated flow that
 * did two independent writes with a `.catch(() => {})` between them: it cleared
 * the player's own `character.clan`, then best-effort removed them from the
 * shared roster. A failed second write (or a closed tab) left a ghost member on
 * the roster who was no longer in the clan.
 *
 * It also closes the harder half. `founderName` can otherwise only change by
 * admin action, so a departing FOUNDER left a clan nobody could dissolve,
 * re-doctrine, or distribute the seal pool from — while it could still hold
 * territory, a treasury and war commitments. Leaving now promotes a successor
 * in the same atomic step (api/clan/_succession.ts decides who).
 *
 * Body: { playerName, clan }
 * Locks: clan save row (outer) → departing player's save row (inner), then the
 * successor's — the same ordering clan/kick.ts and clan/treasury/donate.ts use,
 * so the nesting cannot deadlock against them.
 */

const AUDIT_LOG_PREFIX = 'audit:clan-leave:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only leave a clan for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-leave', 10, 60_000, identity.name))) return;

        const slug = clanSlugBare(clan);
        if (!slug) return res.status(400).json({ error: 'Invalid clan name.' });

        const clanSaveKey = `save:clan-${slug}`;
        const leaverSaveKey = `save:${playerName}`;

        const result = await withKvLock(clanSaveKey, async () => {
            const clanRec = await kv.get<Record<string, unknown>>(clanSaveKey);
            if (!clanRec) return { ok: false as const, status: 404, error: 'Clan not found.' };

            const succession = resolveClanSuccession(clanRec, playerName);
            const next = applyClanSuccession(clanRec, playerName, succession);
            // The leaver's own save version, so the client can adopt it. Without
            // it their next autosave echoes a stale base version, takes the 409
            // at api/save/[name].ts, and the conflict recovery discards local
            // progress — a self-inflicted save conflict for pressing Leave.
            let leaverSaveVersion = 0;
            let leaverCharacter: Record<string, unknown> | null = null;

            // The departing player's own save first, exactly as kick.ts argues:
            // if the roster write below never lands, they are already out and the
            // stale members[] entry self-cleans on the next clan write. The
            // reverse order would let them re-add themselves on the next load.
            await withKvLock(leaverSaveKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(leaverSaveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return;
                if (clanSlugBare(String(char.clan ?? '')) !== slug) return;
                // Explicit JSON nulls: dropping the keys makes the save merger
                // preserve — and therefore resurrect — the stored clan fields.
                const written = await writeVersionedPlayerSave(leaverSaveKey, rec, {
                    ...char,
                    clan: null,
                    clanUpgradeLevels: null,
                    clanDoctrine: null,
                    clanFounder: false,
                    guardQueued: false,
                });
                leaverSaveVersion = Number(written._saveVersion ?? 0);
                leaverCharacter = (written.record?.character ?? null) as Record<string, unknown> | null;
            }, { failClosed: true });

            // Hand the successor their founder flag. Best-effort by design: the
            // clan record's `founderName` below is the authority every gate reads
            // (api/_clan-save-validate.ts), so a missed flag costs a cosmetic
            // client hint and self-corrects on their next clan load — it can
            // never leave the clan headless.
            if (succession.kind === 'succeeded') {
                const successorKey = `save:${succession.successorSlug}`;
                await withKvLock(successorKey, async () => {
                    const rec = await kv.get<Record<string, unknown>>(successorKey);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !char) return;
                    if (clanSlugBare(String(char.clan ?? '')) !== slug) return;
                    await writeVersionedPlayerSave(successorKey, rec, { ...char, clanFounder: true });
                }, { failClosed: true }).catch(() => undefined);
            }

            await kv.set(clanSaveKey, {
                ...clanRec,
                members: next.members,
                roleOverrides: next.roleOverrides,
                founderName: next.founderName,
            });

            return { ok: true as const, succession, members: next.members, leaverSaveVersion, leaverCharacter };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });

        await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            left: playerName,
            succession: result.succession.kind,
            successor: result.succession.kind === 'succeeded' ? result.succession.successorSlug : null,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({
            ok: true,
            members: result.members,
            character: result.leaverCharacter,
            _saveVersion: result.leaverSaveVersion,
            succession: result.succession.kind,
            newFounder: result.succession.kind === 'succeeded' ? result.succession.successorName : null,
        });
    } catch (err) {
        console.error('[clan/leave]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
