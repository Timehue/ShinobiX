/*
 * What a PERMANENT ban releases (owner ruling 2026-11-04).
 *
 * A ban used to write `mod:ban:` and nothing else. A banned Kage held the seat
 * until the 10-day inactivity pass, a banned founder kept the clan's founder
 * gates (dissolve, seal pool, war) locked for everyone, banned Elder and ANBU
 * appointees stayed seated, and the player's Exchange listings stayed buyable.
 *
 * Only a permanent ban does any of this. A timed ban changes nothing, so a
 * short ban can never cost anyone a seat.
 *
 * Unlike account deletion the save stays: an Exchange listing is cancelled
 * through its normal return leg, so the escrow goes back to the banned save,
 * and the banned player stays on the clan roster as an ordinary member, so a
 * ban that is lifted on appeal leaves nobody having to rejoin. Every step is
 * idempotent and runs on its own; a failure is reported, never fatal to the ban.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { applyClanSuccession, resolveClanSuccession, type ClanSuccessionRecord } from '../clan/_succession.js';

export type PermanentBanRelease = { released: string[]; failures: string[] };

function clanSlugBare(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Hand a banned founder's clan to the next in line, as Leave does, keeping the roster. */
async function handOffFoundedClan(slug: string, out: PermanentBanRelease): Promise<void> {
    const save = await kv.get<{ character?: { clan?: unknown } }>(`save:${slug}`);
    const clanSlug = clanSlugBare(String(save?.character?.clan ?? ''));
    if (!clanSlug) return;
    const clanKey = `save:clan-${clanSlug}`;
    await withKvLock(clanKey, async () => {
        const record = await kv.get<ClanSuccessionRecord & Record<string, unknown>>(clanKey);
        if (!record) return;
        const succession = resolveClanSuccession(record, slug);
        if (succession.kind !== 'succeeded') return;
        const { roleOverrides } = applyClanSuccession(record, slug, succession);
        await kv.set(clanKey, { ...record, founderName: succession.nextFounderName, roleOverrides });
        out.released.push(`clan-founder:${clanSlug}->${succession.successorSlug}`);
    }, { failClosed: true });
}

export async function releasePermanentlyBannedStanding(rawName: string): Promise<PermanentBanRelease> {
    const slug = safeName(rawName);
    const out: PermanentBanRelease = { released: [], failures: [] };
    if (!slug) return out;
    const step = async (label: string, run: () => Promise<void>) => {
        try { await run(); } catch (err) { out.failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }
    };
    // Loaded lazily, like account deletion does: these pull in the save pipeline.
    await step('kage seat', async () => {
        const { vacateKageSeatsOf } = await import('../village/_kage-inactivity.js');
        for (const village of await vacateKageSeatsOf(slug)) out.released.push(`kage-seat:${village}`);
    });
    await step('village seats', async () => {
        const { clearAppointments } = await import('../village/_clear-appointments.js');
        for (const village of WAR_VILLAGES) {
            if (await clearAppointments(village, slug)) out.released.push(`village-seats:${village}`);
        }
    });
    await step('clan founder', () => handOffFoundedClan(slug, out));
    await step('exchange', async () => {
        const { pullExchangeListingsOfBannedPlayer } = await import('../festival/_exchange.js');
        const pulled = await pullExchangeListingsOfBannedPlayer(slug);
        for (const id of pulled.closed) out.released.push(`sunscar-exchange:listing:${id}`);
        out.failures.push(...pulled.failures);
    });
    return out;
}
