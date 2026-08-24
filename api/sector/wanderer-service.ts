import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    naturalWandererClaimOk,
    withWandererUseState,
} from './_wanderer-encounter.js';
import {
    wandererFavorReward,
    wandererFavorTargetSector,
    wandererMedicOffer,
    wandererMerchantOffer,
} from './_wanderer-service.js';
import { bumpEraContribution } from '../_era.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

type FavorRecord = {
    id: string;
    originSector: number;
    targetSector: number;
    giver: string;
    expiresAt: number;
};

const FAVOR_TTL_SECONDS = 24 * 60 * 60;
const favorKeyFor = (playerName: string) => `wanderer-favor:${playerName}`;

function num(v: unknown): number {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function int(v: unknown): number {
    return Math.floor(num(v));
}

function cleanShortText(v: unknown, fallback: string): string {
    const s = String(v ?? '').replace(/[^\w .'-]/g, '').trim().slice(0, 48);
    return s || fallback;
}

function sectorFrom(v: unknown): number {
    return Math.max(1, Math.min(MAX_WILD_SECTOR, int(v) || 1));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `wanderer-service-${action}`, 20, 60_000, identity.name))) return;

        // Same wild-field rule as exploring and attacking: a wanderer service is
        // an in-sector encounter, so the payout requires actually being there
        // (api/_sector-presence-gate.ts). Actions that carry no sector are not
        // gated — the helper ignores anything below sector 1.
        const presenceBlock = sectorPresenceBlock(playerName, body.sector);
        if (presenceBlock && !identity.admin) {
            return res.status(presenceBlock.status).json({ error: presenceBlock.error, reason: presenceBlock.reason });
        }

        if (action === 'merchant' || action === 'medic' || action === 'favor-start') {
            const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
            // Not just the id's SHAPE: the server re-rolls the roster and refuses
            // an id it does not currently put on the road, plus any archetype/
            // verb/level/name the client echoed back that disagrees with that
            // roll. `wandererName` matters here — favor-start seals the claimed
            // name into the favor record the player later delivers.
            if (!naturalWandererClaimOk(wandererId, Date.now(), body)) {
                return res.status(200).json({ ok: false, reason: 'invalid-wanderer' });
            }
            const sector = sectorFrom(body.sector);

            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                const saveCooldownUntil = currentWandererCooldownUntil(char, wandererId, now);
                if (saveCooldownUntil) {
                    return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil: saveCooldownUntil } };
                }

                if (action === 'merchant') {
                    const offer = wandererMerchantOffer(char.level, wandererId);
                    if (num(char.ryo) < offer.cost) {
                        return { status: 200, body: { ok: false, reason: 'no-ryo', offer } };
                    }
                    const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                    }
                    const spent = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        boneCharms: num(char.boneCharms) + offer.boneCharms,
                    };
                    const used = withWandererUseState(spent, wandererId, now, sector);
                    const nextRecord = bumpSaveVersion({ ...rec, character: used.character });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            offer,
                            totals: { ryo: used.character.ryo, boneCharms: used.character.boneCharms },
                            cooldownUntil: used.cooldownUntil,
                            moveToSector: used.moveToSector,
                            _saveVersion: Number(nextRecord._saveVersion ?? 0),
                        },
                    };
                }

                if (action === 'medic') {
                    const offer = wandererMedicOffer(char.level, char.hp, char.maxHp, char.chakra, char.maxChakra, char.stamina, char.maxStamina);
                    if (offer.missingHp + offer.missingChakra + offer.missingStamina <= 0) {
                        return { status: 200, body: { ok: false, reason: 'already-well', offer } };
                    }
                    if (num(char.ryo) < offer.cost) {
                        return { status: 200, body: { ok: false, reason: 'no-ryo', offer } };
                    }
                    const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                    }
                    const healed = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        hp: Math.max(num(char.hp), num(char.maxHp)),
                        chakra: Math.max(num(char.chakra), num(char.maxChakra)),
                        stamina: Math.max(num(char.stamina), num(char.maxStamina)),
                    };
                    const used = withWandererUseState(healed, wandererId, now, sector);
                    const nextRecord = bumpSaveVersion({ ...rec, character: used.character });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            offer,
                            totals: {
                                ryo: used.character.ryo,
                                hp: used.character.hp,
                                chakra: used.character.chakra,
                                stamina: used.character.stamina,
                            },
                            cooldownUntil: used.cooldownUntil,
                            moveToSector: used.moveToSector,
                            _saveVersion: Number(nextRecord._saveVersion ?? 0),
                        },
                    };
                }

                const favorKey = favorKeyFor(playerName);
                const existing = await kv.get<FavorRecord>(favorKey);
                if (existing && num(existing.expiresAt) > now) {
                    return { status: 200, body: { ok: false, reason: 'busy', favor: existing } };
                }
                if (existing) await kv.del(favorKey).catch(() => undefined);

                const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                if (!hardCooldown.ok) {
                    return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                }
                const favor: FavorRecord = {
                    id: `favor-${wandererId}-${now}`,
                    originSector: sector,
                    targetSector: wandererFavorTargetSector(wandererId, sector),
                    giver: cleanShortText(body.wandererName, 'road courier'),
                    expiresAt: now + FAVOR_TTL_SECONDS * 1000,
                };
                await kv.set(favorKey, favor, { ex: FAVOR_TTL_SECONDS });
                const used = withWandererUseState({ ...char, activeWandererFavor: favor }, wandererId, now, sector);
                const nextRecord = bumpSaveVersion({ ...rec, character: used.character });
                await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                return {
                    status: 200,
                    body: {
                        ok: true,
                        favor,
                        cooldownUntil: used.cooldownUntil,
                        moveToSector: used.moveToSector,
                        _saveVersion: Number(nextRecord._saveVersion ?? 0),
                    },
                };
            }, { failClosed: true });

            if (out.status === 200 && (out.body as { ok?: boolean })?.ok === true) {
                await bumpLegacyStats(playerName, { sectorDiscoveries: 1 });
                await bumpEraContribution('discoveries');
            }
            return res.status(out.status).json(out.body);
        }

        if (action === 'favor-claim') {
            const favorId = typeof body.favorId === 'string' ? body.favorId.trim() : '';
            const sector = sectorFrom(body.sector);
            if (!favorId) return res.status(400).json({ error: 'Missing favorId.' });

            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const now = Date.now();
                const favorKey = favorKeyFor(playerName);
                const favor = await kv.get<FavorRecord>(favorKey);
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };
                if (!favor || favor.id !== favorId) {
                    if (!char.activeWandererFavor) {
                        return { status: 200, body: { ok: false, reason: 'none', _saveVersion: Number(rec._saveVersion ?? 0) } };
                    }
                    const cleared = { ...char, activeWandererFavor: null };
                    const nextRecord = bumpSaveVersion({ ...rec, character: cleared });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                    return { status: 200, body: { ok: false, reason: 'none', _saveVersion: Number(nextRecord._saveVersion ?? 0) } };
                }
                if (num(favor.expiresAt) <= now) {
                    await kv.del(favorKey).catch(() => undefined);
                    const cleared = { ...char, activeWandererFavor: null };
                    const nextRecord = bumpSaveVersion({ ...rec, character: cleared });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                    return { status: 200, body: { ok: false, reason: 'expired', _saveVersion: Number(nextRecord._saveVersion ?? 0) } };
                }
                if (sector !== favor.targetSector) {
                    return { status: 200, body: { ok: false, reason: 'wrong-sector', favor } };
                }
                const reward = wandererFavorReward(char.level, favor.id);
                await kv.del(favorKey).catch(() => undefined);
                const updated = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                    activeWandererFavor: null,
                };
                const nextRecord = bumpSaveVersion({ ...rec, character: updated });
                await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                return {
                    status: 200,
                    body: {
                        ok: true,
                        reward,
                        totals: { ryo: updated.ryo, boneCharms: updated.boneCharms },
                        _saveVersion: Number(nextRecord._saveVersion ?? 0),
                    },
                };
            }, { failClosed: true });
            if (out.status === 200 && (out.body as { ok?: boolean })?.ok === true) {
                await bumpLegacyStats(playerName, { sectorDiscoveries: 1 });
                await bumpEraContribution('discoveries');
            }
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The road is busy - please retry.' });
        }
        console.error('[sector/wanderer-service]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
