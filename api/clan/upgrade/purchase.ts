import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { loadClanContext, canActAsClanLeadership } from '../war/_storage.js';

/*
 * /api/clan/upgrade/purchase — POST only
 *
 * Server-authoritative clan-upgrade purchase. The clan upgrade buildings were
 * scaffolded but never purchasable; this is the spend path. Mirrors the atomic
 * pattern in clan/treasury/donate.ts: the clan save row is locked, the cost is
 * debited from the shared treasury (ryo + warSupply), and the building level is
 * incremented — all under one lock so a credit/debit can't be split.
 *
 * Only clan leadership (founder / Leader / Officer, same gate as declaring a
 * clan war) may purchase. Funded from the clan treasury, NOT the actor's wallet,
 * so we never touch the actor's save here.
 *
 * Body: { playerName, clan, upgradeKey }
 *
 * Cost curve + max level are duplicated from shinobij.client/src/lib/clan-upgrades.ts
 * (separate TS build, no shared import). KEEP IN SYNC with that file.
 */

const VALID_UPGRADE_KEYS = [
    'trainingGrounds', 'warRoom', 'treasury', 'petDen', 'medicalWing', 'blacksmith', 'scoutNetwork',
] as const;
type UpgradeKey = typeof VALID_UPGRADE_KEYS[number];

// KEEP IN SYNC with constants/clan.ts CLAN_UPGRADE_MAX_LEVEL and
// lib/clan-upgrades.ts cost constants.
const MAX_LEVEL = 50;
const COST_RYO_PER_STEP = 2_500;
const COST_WAR_SUPPLY_PER_STEP = 5;

function upgradeCost(currentLevel: number): { ryo: number; warSupply: number } {
    const step = Math.max(0, Math.floor(currentLevel)) + 1;
    return { ryo: COST_RYO_PER_STEP * step, warSupply: COST_WAR_SUPPLY_PER_STEP * step };
}

const AUDIT_LOG_PREFIX = 'audit:clan-upgrade-purchase:';

function clanSlugBare(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const upgradeKey = typeof body.upgradeKey === 'string' ? body.upgradeKey.trim() : '';
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });
        if (!VALID_UPGRADE_KEYS.includes(upgradeKey as UpgradeKey)) {
            return res.status(400).json({ error: 'Invalid upgrade.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-upgrade-purchase', 30, 60_000, identity.name))) return;

        const targetSlug = clanSlugBare(clan);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid clan name.' });

        // Leadership gate (founder / Leader / Officer) — same model as declaring
        // a clan war. Also proves the actor is a member of this clan.
        if (!identity.admin) {
            const ctx = await loadClanContext(playerName);
            if (clanSlugBare(ctx.clan) !== targetSlug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
            if (!canActAsClanLeadership(ctx.role)) {
                return res.status(403).json({ error: 'Only clan leadership can purchase upgrades.' });
            }
        }

        const clanSaveKey = `save:clan-${targetSlug}`;

        const result = await withKvLock(clanSaveKey, async () => {
            const clanRec = await kv.get<Record<string, unknown>>(clanSaveKey);
            if (!clanRec) return { ok: false as const, status: 404, error: 'Clan not found.' };

            const treasury = (clanRec.treasury ?? {}) as Record<string, unknown>;
            const upgrades = { ...((clanRec.upgrades ?? {}) as Record<string, number>) };
            const level = num(upgrades[upgradeKey]);
            if (level >= MAX_LEVEL) return { ok: false as const, status: 400, error: 'This building is already at max level.' };

            const cost = upgradeCost(level);
            const haveRyo = num(treasury.ryo);
            const haveSupply = num(treasury.warSupply);
            if (haveRyo < cost.ryo || haveSupply < cost.warSupply) {
                return { ok: false as const, status: 400, error: `Treasury needs ${cost.ryo.toLocaleString()} ryo + ${cost.warSupply} War Supply to upgrade.` };
            }

            const nextTreasury = { ...treasury, ryo: haveRyo - cost.ryo, warSupply: haveSupply - cost.warSupply };
            upgrades[upgradeKey] = level + 1;

            await kv.set(clanSaveKey, { ...clanRec, treasury: nextTreasury, upgrades });
            return { ok: true as const, treasury: nextTreasury, upgrades, level: level + 1, cost };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });

        await kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            upgradeKey,
            newLevel: result.level,
            cost: result.cost,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({ ok: true, treasury: result.treasury, upgrades: result.upgrades, level: result.level });
    } catch (err) {
        console.error('[clan/upgrade/purchase]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
