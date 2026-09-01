import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { LEGACY_BY_ID, LEGACY_MIN_LEVEL } from './_legacy-defs.js';
import { evaluateAllLegacies, getLegacyOverlay, pickSageOffers } from './_legacy-score.js';
import { getLegacyStats, appendLegacyEvent, type LegacyStats } from './_legacy-track.js';
import { legacyAcceptedKey } from './_legacy-core.js';
import { storyKeyFor, type StoryRecord } from './_story-record.js';
import { LEGACY_JUTSU_CATALOG, LEGACY_JUTSU_ID_BY_LEGACY } from './pvp/_legacy-jutsu-catalog.js';

export const SAGE_OFFER_TTL_SECONDS = 7 * 24 * 60 * 60;
export const sageOfferKey = (player: string) => `legacy:sage-offer:${player}`;
export const sagePityKey = (player: string) => `legacy:sage-pity:${player}`;
const sageRollCountKey = (player: string, now: number) =>
    `legacy:sage-roll:${player}:${new Date(now).toISOString().slice(0, 10)}`;

export const sageMetricKey = (field: 'offers' | 'accepts' | 'declines', d = new Date()) =>
    `legacy:metrics:${d.toISOString().slice(0, 10)}:${field}`;
export const bumpSageMetric = (field: 'offers' | 'accepts' | 'declines') =>
    kv.incr(sageMetricKey(field), { ex: 8 * 24 * 60 * 60 }).catch(() => 0);

const VILLAGE_OUTSKIRTS: Record<string, number> = {
    stormveil: 31, 'ashen leaf': 38, frostfang: 47, moonshadow: 11,
};

export type SignaturePreview = { name: string; shape: string; effects: string[]; unlockStage: number };
type SageOfferEntry = {
    legacyId: string; name: string; category: string; flavor: string; title: string;
    villageAffinity: string | null; badge?: string | null; signature?: SignaturePreview | null;
};

export type SageOffer = {
    status: 'spawned' | 'declined' | 'accepted' | 'expired';
    offers: SageOfferEntry[];
    sector: number;
    spawnedAt: number;
    expiresAt: number;
    declinedAt?: number;
    acceptedAt?: number;
    acceptedLegacyId?: string;
};

type StoredSageOffer = Omit<SageOffer, 'offers'> & {
    offers: Array<SageOfferEntry & { rarity?: unknown }>;
};
type PityState = { eligibleSince?: number; lastSpawnAt?: number; declinedUntil?: number };

export type SageRollResult = {
    spawn: boolean;
    offer?: SageOffer;
    reason?: string;
    daysWaiting?: number;
};

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const DAY_MS = 24 * 60 * 60 * 1000;

function signaturePreview(legacyId: string): SignaturePreview | null {
    const jutsuId = LEGACY_JUTSU_ID_BY_LEGACY[legacyId];
    const jutsu = jutsuId ? LEGACY_JUTSU_CATALOG[jutsuId] : undefined;
    if (!jutsu) return null;
    const shape = jutsu.method === 'AOE_BURST'
        ? 'Area nova'
        : jutsu.method === 'AOE_CIRCLE'
            ? 'Dashing strike'
            : jutsu.ap === 40
                ? 'Self technique'
                : 'Focused strike';
    const effects = jutsu.tags.filter((tag) => tag.name !== 'Move').map((tag) => tag.name);
    return { name: jutsu.name, shape, effects, unlockStage: 3 };
}

function homeSector(village: unknown, requested: unknown): number {
    const wanted = Math.floor(num(requested));
    if (wanted >= 1 && wanted <= 99) return wanted;
    const normalizedVillage = String(village ?? '').toLowerCase();
    for (const [name, sector] of Object.entries(VILLAGE_OUTSKIRTS)) {
        if (normalizedVillage.includes(name)) return sector;
    }
    return 56;
}

/** Strip retired/private rank data from old KV offers before any player response. */
export function publicSageOffer(offer: StoredSageOffer | null | undefined): SageOffer | null {
    if (!offer) return null;
    return {
        ...offer,
        offers: offer.offers.map(({ rarity: _privateRarity, ...entry }) => entry),
    };
}

/**
 * One server-owned Sage attempt. Every verified Legacy progress write calls
 * this after releasing its stats lock; the HTTP endpoint exposes it only to
 * admins for controlled recovery. A per-player lock prevents concurrent deeds
 * from consuming multiple attempts or minting competing offers.
 */
export async function attemptSageRoll(
    playerName: string,
    opts: {
        sector?: number | null;
        forced?: boolean;
        stats?: LegacyStats;
        character?: Record<string, unknown> | null;
        now?: number;
        random?: () => number;
    } = {},
): Promise<SageRollResult> {
    if (process.env.ENABLE_LEGACY !== '1' || !playerName) return { spawn: false, reason: 'disabled' };
    return withKvLock(`legacy:sage-roll-lock:${playerName}`, async () => {
        const now = opts.now ?? Date.now();
        const accepted = await kv.get(legacyAcceptedKey(playerName));
        if (accepted) return { spawn: false, reason: 'sealed' };

        let storedExisting = await kv.get<StoredSageOffer>(sageOfferKey(playerName));
        if (storedExisting?.status === 'spawned' && num(storedExisting.expiresAt) <= now) {
            // Do not rely solely on backend TTL timing. An overdue row can be
            // visible briefly during cache lag or in a migrated store; treating
            // it as waiting would suppress every new Sage roll indefinitely.
            await kv.del(sageOfferKey(playerName)).catch(() => undefined);
            storedExisting = null;
        }
        if (storedExisting?.status === 'spawned') {
            return { spawn: true, offer: publicSageOffer(storedExisting)!, reason: 'already-waiting' };
        }

        const record = opts.character
            ? null
            : await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = opts.character ?? (record?.character as Record<string, unknown> | null | undefined) ?? null;
        if (!character) return { spawn: false, reason: 'no-save' };
        const level = num(character.level);
        if (level < LEGACY_MIN_LEVEL) return { spawn: false, reason: 'under-level' };

        const overlay = await getLegacyOverlay();
        const cfg = overlay.sage ?? {};
        const baseChance = cfg.baseChance ?? 0.05;
        const pityPerDay = cfg.pityPerDay ?? 0.05;
        const guaranteeDays = cfg.guaranteeDays ?? 7;
        const dailyRollCap = cfg.dailyRollCap ?? 6;
        const forced = opts.forced === true;
        const pity = (await kv.get<PityState>(sagePityKey(playerName))) ?? {};
        if (!forced && pity.declinedUntil && now < pity.declinedUntil) {
            return { spawn: false, reason: 'resting' };
        }
        const [stats, storyRecord] = await Promise.all([
            opts.stats ? Promise.resolve(opts.stats) : getLegacyStats(playerName, character),
            kv.get<StoryRecord>(storyKeyFor(playerName)),
        ]);
        const evaluations = evaluateAllLegacies(stats, {
            level,
            village: typeof character.village === 'string' ? character.village : null,
            overlay,
            storyLanes: storyRecord?.lanes ?? null,
        });
        const selected = pickSageOffers(evaluations);
        if (selected.length === 0) return { spawn: false, reason: 'not-eligible' };
        // The cap counts actual eligible opportunities, not every low-level
        // deed. This is especially important now that verified progress calls
        // the helper automatically: the activity that first crosses a floor
        // must not arrive after six pre-eligibility attempts were burned.
        if (!forced) {
            const rolls = await kv.incr(sageRollCountKey(playerName, now), { ex: 25 * 60 * 60 });
            if (rolls > dailyRollCap) return { spawn: false, reason: 'daily-cap' };
        }

        const eligibleSince = Math.max(pity.eligibleSince ?? now, pity.lastSpawnAt ?? 0);
        const daysWaiting = Math.floor((now - eligibleSince) / DAY_MS);
        const chance = Math.min(1, baseChance + pityPerDay * daysWaiting);
        const guaranteed = daysWaiting >= guaranteeDays;
        if (!forced && !guaranteed && (opts.random ?? Math.random)() >= chance) {
            await kv.set(sagePityKey(playerName), { ...pity, eligibleSince });
            return { spawn: false, reason: 'no-show', daysWaiting };
        }

        const offer: SageOffer = {
            status: 'spawned',
            offers: selected.map((evaluation) => {
                const definition = LEGACY_BY_ID.get(evaluation.legacyId)!;
                return {
                    legacyId: definition.id,
                    name: definition.name,
                    category: definition.category,
                    flavor: definition.flavor,
                    title: definition.title,
                    villageAffinity: definition.villageAffinity ?? null,
                    badge: definition.badge ?? null,
                    signature: signaturePreview(definition.id),
                };
            }),
            sector: homeSector(character.village, opts.sector),
            spawnedAt: now,
            expiresAt: now + SAGE_OFFER_TTL_SECONDS * 1000,
        };
        await kv.set(sageOfferKey(playerName), offer, { ex: SAGE_OFFER_TTL_SECONDS });
        await kv.set(sagePityKey(playerName), { eligibleSince, lastSpawnAt: now });
        await appendLegacyEvent(playerName, {
            type: 'sage-spawned',
            meta: { offers: offer.offers.map((entry) => entry.legacyId), forced },
        });
        await bumpSageMetric('offers');
        return { spawn: true, offer };
    }, { failClosed: true });
}
