import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { clanBareSlug, cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { recordAudit } from '../_audit.js';
import { LockContendedError } from '../_lock.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import {
    cancelCoastContest, coastLandViews, grantCoastClaim, isContestableCoastSector, pauseCoastLand, readCoastClaim, readCoastContest,
    readCoastLandPause, releaseCoastClaim, resumeCoastLand, setCoastClaimImmunity, settleCoastContest,
} from './_land.js';
import { restoreCoastLanding } from './_landing.js';
import { coastLandingTier, type CoastLanding } from './_landing-rules.js';
import { readCoastLanding } from './_landing-store.js';

/*
 * /api/coast/admin: POST { action, sector?, clan?, hours?, reason? }
 *
 * The owner's tools for the coast's land and Landings. Full admin only. Every
 * action that changes anything is written to the audit log with what stood
 * before and after.
 *
 *   overview                        -> { ok, paused, sectors, landings }
 *   force-settle    { sector }      -> { ok, result }    end a contest now, as its score stands
 *   cancel-contest  { sector }      -> { ok, result }    call a contest off; no holder changes
 *   release-claim   { sector }      -> { ok, released }  give a sector back to the Unmoored
 *   grant-claim     { sector, clan } -> { ok, claim }    give a sector to a clan, as a won contest would
 *   set-immunity    { sector, hours } -> { ok, claim }   protect a held sector for this long from now (0 ends it)
 *   restore-landing { clan }        -> { ok, landing }   stand a fallen Landing up on the ground the clan holds
 *   pause           { reason }      -> { ok, paused }    stop declarations, garrison fights, all scoring, settlement and Landing upkeep
 *   resume                          -> { ok, resumed, pausedMs, moved }  lift it; contests get their time back
 *
 * These are for putting right what a fault broke. None of them pays or takes
 * currency, and none can be reached by a player or a content admin.
 */

const ACTIONS = new Set(['overview', 'force-settle', 'cancel-contest', 'release-claim', 'grant-claim', 'set-immunity', 'restore-landing', 'pause', 'resume']);
const SECTOR_ACTIONS = new Set(['force-settle', 'cancel-contest', 'release-claim', 'grant-claim', 'set-immunity']);
const HOUR = 60 * 60_000;
/** A year: long enough for any real protection, short enough that a typo cannot lock a sector for good. */
const MAX_IMMUNITY_HOURS = 24 * 365;

const landingSummary = (landing: CoastLanding) => ({
    clan: landing.clan, clanSlug: landing.clanSlug, sector: landing.sector, status: landing.status,
    tier: landing.tier, tierName: coastLandingTier(landing.tier).name, works: landing.works ?? [],
    stores: landing.stores, dormantWeeks: landing.dormantWeeks, foundedAt: landing.foundedAt,
    ...(landing.status === 'destroyed' ? { destroyedAt: landing.destroyedAt ?? 0, destroyedReason: landing.destroyedReason ?? '' } : {}),
});

async function allLandings() {
    const rows = await Promise.all((await kv.keys('coast:landing:*')).map(key => kv.get<CoastLanding>(key)));
    return rows.filter((row): row is CoastLanding => !!row).map(landingSummary).sort((a, b) => a.sector - b.sector || a.clan.localeCompare(b.clan));
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-coast', 30, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store');

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        if (!ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
        const now = Date.now();

        if (action === 'overview') {
            return res.status(200).json({ ok: true, paused: await readCoastLandPause(), sectors: await coastLandViews(now), landings: await allLandings() });
        }

        if (action === 'pause') {
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!reason) return res.status(400).json({ error: 'Say why the contests are being paused. It is written to the audit log.' });
            const before = await readCoastLandPause();
            const paused = await pauseCoastLand(reason, now);
            await recordAudit({ actor: 'admin', domain: 'sector', action: 'coast-land.pause', entityType: 'coast-land', entityId: 'all', before, after: paused });
            return res.status(200).json({ ok: true, paused });
        }
        if (action === 'resume') {
            const before = await readCoastLandPause();
            const outcome = await resumeCoastLand(now);
            await recordAudit({ actor: 'admin', domain: 'sector', action: 'coast-land.resume', entityType: 'coast-land', entityId: 'all', before, after: outcome });
            return res.status(200).json({ ok: true, ...outcome });
        }

        const clan = typeof body.clan === 'string' ? body.clan.trim().slice(0, 80) : '';
        if (action === 'restore-landing') {
            if (!clan) return res.status(400).json({ error: 'Name the clan.' });
            const before = await readCoastLanding(clanBareSlug(clan));
            const result = await restoreCoastLanding(clan, now);
            if (!result.ok) return res.status(result.status).json({ error: result.error });
            await recordAudit({ actor: 'admin', domain: 'sector', action: 'coast-landing.restore', entityType: 'clan', entityId: clan, before: before ? landingSummary(before) : null, after: landingSummary(result.landing) });
            return res.status(200).json({ ok: true, landing: landingSummary(result.landing) });
        }

        if (!SECTOR_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
        const sector = Math.floor(Number(body.sector));
        if (!isContestableCoastSector(sector)) return res.status(400).json({ error: 'That ground cannot be held.' });
        const before = { claim: await readCoastClaim(sector), contest: await readCoastContest(sector) };
        const audit = (after: unknown, meta?: Record<string, unknown>) => recordAudit({
            actor: 'admin', domain: 'sector', action: `coast-land.${action}`, entityType: 'coast-sector', entityId: String(sector), before, after, ...(meta ? { meta } : {}),
        });

        if (action === 'force-settle') {
            const result = await settleCoastContest(sector, now, { force: true });
            await audit({ result });
            return res.status(200).json({ ok: true, result });
        }
        if (action === 'cancel-contest') {
            const result = await cancelCoastContest(sector, now);
            if (!result) return res.status(404).json({ error: 'No contest is posted there.' });
            await audit({ result });
            return res.status(200).json({ ok: true, result });
        }
        if (action === 'release-claim') {
            const released = await releaseCoastClaim(sector, 'admin-released');
            await audit({ released });
            return res.status(200).json({ ok: true, released });
        }
        if (action === 'grant-claim') {
            if (!clan) return res.status(400).json({ error: 'Name the clan.' });
            const result = await grantCoastClaim({ sector, clanName: clan, now });
            if (!result.ok) return res.status(result.status).json({ error: result.error });
            await audit({ claim: result.claim }, { clan });
            return res.status(200).json({ ok: true, claim: result.claim });
        }
        // set-immunity
        const hours = Number(body.hours);
        if (!Number.isFinite(hours) || hours < 0 || hours > MAX_IMMUNITY_HOURS) return res.status(400).json({ error: `Give the protection in hours, 0 to ${MAX_IMMUNITY_HOURS}.` });
        const claim = await setCoastClaimImmunity(sector, now + Math.round(hours * HOUR));
        if (!claim) return res.status(404).json({ error: 'No clan holds that ground.' });
        await audit({ claim }, { hours });
        return res.status(200).json({ ok: true, claim });
    } catch (err) {
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'The coast is busy. Please retry.' });
        console.error('[coast/admin]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
