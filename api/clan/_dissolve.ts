import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { clanBareSlug, safeName } from '../_utils.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { releaseTerritory } from '../_territory-lifecycle.js';
import {
    CLAN_WAR_KEY_PREFIX,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    finalizeClanWarEnd,
    type ClanWar,
} from './war/_storage.js';

const TERRITORY_KEY_PREFIX = 'world:territory:';
const ACTIVE_DISSOLUTION_PREFIX = 'clan-dissolution-active:';
const DISSOLUTION_RECEIPT_PREFIX = 'clan-dissolution:';
const DISSOLUTION_RECEIPT_TTL_SEC = 30 * 24 * 60 * 60;

type ClanDissolutionReceipt = {
    id: string;
    clanKey: string;
    clanName: string;
    clanSlug: string;
    founder: string;
    createdAt: number;
    memberNames: string[];
    clanIdentity: { name: string; founder: string; createdAt: number; digest: string };
    status: 'running' | 'complete';
    completedAt?: number;
};

export type ClanDissolutionResult = {
    memberNames: string[];
    membersCleared: number;
    territoriesReleased: number;
    warsForfeited: number;
    finalizedWars: ClanWar[];
    replayed: boolean;
};

export class ClanDissolutionForbiddenError extends Error {
    constructor() {
        super('Only the current clan founder can delete this clan.');
        this.name = 'ClanDissolutionForbiddenError';
    }
}

export function assertClanDissolutionFounder(actualFounder: unknown, expectedFounder?: string | null): void {
    const expected = safeName(String(expectedFounder ?? ''));
    if (expected && safeName(String(actualFounder ?? '')) !== expected) {
        throw new ClanDissolutionForbiddenError();
    }
}

function clanIdentity(record: Record<string, unknown>): ClanDissolutionReceipt['clanIdentity'] {
    return {
        name: clanBareSlug(String(record.name ?? '')),
        founder: safeName(String(record.founderName ?? '')),
        createdAt: Math.max(0, Math.floor(Number(record.createdAt ?? 0))),
        digest: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
    };
}

function sameClanGeneration(record: Record<string, unknown>, receipt: ClanDissolutionReceipt): boolean {
    return isDeepStrictEqual(clanIdentity(record), receipt.clanIdentity);
}

function memberNamesFromClan(record: Record<string, unknown>): string[] {
    const names = new Map<string, string>();
    const add = (value: unknown) => {
        const display = String(value ?? '').trim();
        const slug = safeName(display);
        if (slug && !names.has(slug)) names.set(slug, display);
    };
    if (Array.isArray(record.members)) {
        for (const member of record.members) add((member as Record<string, unknown>)?.name);
    }
    add(record.founderName);
    return [...names.values()];
}

async function loadOrCreateReceipt(
    clanKey: string,
    clanRecord: Record<string, unknown> | null,
): Promise<{ receipt: ClanDissolutionReceipt | null; receiptKey: string | null; replayed: boolean }> {
    const slug = clanKey.slice('save:clan-'.length);
    const activeKey = `${ACTIVE_DISSOLUTION_PREFIX}${slug}`;
    const activeReceiptKey = await kv.get<string>(activeKey);
    if (activeReceiptKey) {
        const active = await kv.get<ClanDissolutionReceipt>(activeReceiptKey);
        if (active && (!clanRecord || sameClanGeneration(clanRecord, active))) {
            return { receipt: active, receiptKey: activeReceiptKey, replayed: true };
        }
    }
    if (!clanRecord) return { receipt: null, receiptKey: null, replayed: false };

    const id = randomUUID();
    const receiptKey = `${DISSOLUTION_RECEIPT_PREFIX}${slug}:${id}`;
    const receipt: ClanDissolutionReceipt = {
        id,
        clanKey,
        clanName: String(clanRecord.name ?? slug),
        clanSlug: slug,
        founder: safeName(String(clanRecord.founderName ?? '')),
        createdAt: Date.now(),
        memberNames: memberNamesFromClan(clanRecord),
        clanIdentity: clanIdentity(clanRecord),
        status: 'running',
    };
    await kv.set(receiptKey, receipt, { ex: DISSOLUTION_RECEIPT_TTL_SEC });
    await kv.set(activeKey, receiptKey, { ex: DISSOLUTION_RECEIPT_TTL_SEC });
    return { receipt, receiptKey, replayed: false };
}

/**
 * Dissolve a clan while the caller holds the clan save lock. Every stage is
 * idempotent so a retry can finish after a process interruption. The founder's
 * player pointer is cleared last, preserving their ability to retry until all
 * other members are detached.
 */
export async function dissolveClanUnderLock(
    clanKey: string,
    clanRecord: Record<string, unknown> | null,
    expectedFounder?: string | null,
): Promise<ClanDissolutionResult> {
    if (clanRecord) assertClanDissolutionFounder(clanRecord.founderName, expectedFounder);
    const loaded = await loadOrCreateReceipt(clanKey, clanRecord);
    if (!loaded.receipt || !loaded.receiptKey) {
        return { memberNames: [], membersCleared: 0, territoriesReleased: 0, warsForfeited: 0, finalizedWars: [], replayed: true };
    }
    const { receipt, receiptKey } = loaded;
    assertClanDissolutionFounder(receipt.founder, expectedFounder);
    const activeKey = `${ACTIVE_DISSOLUTION_PREFIX}${receipt.clanSlug}`;
    if (receipt.status === 'complete') {
        await kv.del(activeKey).catch(() => 0);
        return {
            memberNames: receipt.memberNames,
            membersCleared: 0,
            territoriesReleased: 0,
            warsForfeited: 0,
            finalizedWars: [],
            replayed: true,
        };
    }

    let territoriesReleased = 0;
    const territoryKeys = await kv.keys(`${TERRITORY_KEY_PREFIX}*`);
    for (const territoryKey of territoryKeys) {
        await withKvLock(territoryKey, async () => {
            const territory = await kv.get<Record<string, unknown>>(territoryKey);
            if (!territory || clanBareSlug(String(territory.ownerClan ?? '')) !== receipt.clanSlug) return;
            const released = releaseTerritory(territory, Date.now(), 'clan-dissolved');
            if (!(await kv.compareSet(territoryKey, territory, released))) throw new Error('clan-dissolution-territory-conflict');
            territoriesReleased += 1;
        }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });
    }

    const finalizedWars: ClanWar[] = [];
    const warKeys = (await kv.keys(`${CLAN_WAR_KEY_PREFIX}*`)).filter((key) => !key.startsWith('clan-war:cooldown:'));
    for (const warKey of warKeys) {
        await withKvLock(warKey, async () => {
            const war = await kv.get<ClanWar>(warKey);
            if (!war || war.endedAt || !war.clans.some((name) => clanBareSlug(name) === receipt.clanSlug)) return;
            const winner = war.clans.find((name) => clanBareSlug(name) !== receipt.clanSlug);
            const ended = finalizeClanWarEnd(war, { endedAt: Date.now(), winnerClan: winner, reason: 'dissolution' });
            if (!(await kv.compareSet(warKey, war, ended))) throw new Error('clan-dissolution-war-conflict');
            await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), '1', { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
            finalizedWars.push(ended);
        }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });
    }

    // Delete only the exact clan generation captured in the receipt. A newly
    // created clan that happens to reuse the same display name is never removed.
    const currentClan = await kv.get<Record<string, unknown>>(clanKey);
    if (currentClan) {
        if (!sameClanGeneration(currentClan, receipt)) throw new Error('clan-recreated-during-dissolution');
        if (!(await kv.delIfEqual(clanKey, currentClan))) throw new Error('clan-dissolution-delete-conflict');
    }

    const founder = receipt.founder;
    const orderedMembers = [...receipt.memberNames].sort((a, b) => {
        const aFounder = safeName(a) === founder ? 1 : 0;
        const bFounder = safeName(b) === founder ? 1 : 0;
        return aFounder - bFounder;
    });
    let membersCleared = 0;
    for (const memberName of orderedMembers) {
        const memberSlug = safeName(memberName);
        if (!memberSlug) continue;
        const memberKey = `save:${memberSlug}`;
        await withKvLock(memberKey, async () => {
            const memberRecord = await kv.get<Record<string, unknown>>(memberKey);
            const memberCharacter = (memberRecord?.character ?? null) as Record<string, unknown> | null;
            if (!memberRecord || !memberCharacter || clanBareSlug(String(memberCharacter.clan ?? '')) !== receipt.clanSlug) return;
            const nextCharacter = { ...memberCharacter };
            // Keep explicit JSON values so mergePreservingImages sees the
            // overwrite and every storage adapter persists it. Omitting these
            // keys would make the partial-save merge restore the stored clan.
            nextCharacter.clan = null;
            nextCharacter.clanUpgradeLevels = null;
            nextCharacter.clanDoctrine = null;
            nextCharacter.clanFounder = false;
            nextCharacter.guardQueued = false;
            await writeVersionedPlayerSave(memberKey, memberRecord, nextCharacter);
            await kv.set(`reset-signal:${memberSlug}`, 1, { ex: 300 });
            membersCleared += 1;
        }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });
    }

    const complete: ClanDissolutionReceipt = { ...receipt, status: 'complete', completedAt: Date.now() };
    await kv.set(receiptKey, complete, { ex: DISSOLUTION_RECEIPT_TTL_SEC });
    await kv.del(activeKey);
    return {
        memberNames: receipt.memberNames,
        membersCleared,
        territoriesReleased,
        warsForfeited: finalizedWars.length,
        finalizedWars,
        replayed: loaded.replayed,
    };
}
