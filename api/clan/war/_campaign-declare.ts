import { createHash, randomInt } from 'node:crypto';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { clanBareSlug, clanRecordKey, safeName } from '../../_utils.js';
import { REGISTRY_KEY } from '../../player/_public-index.js';
import { clanLeadershipRole } from '../_leadership.js';
import { economyTxKey, type EconomyTxRecord } from '../../_economy-tx.js';
import { runSaveDebitSaga, saveDebitTransactionId, SaveDebitRefusal } from '../../_save-debit-saga.js';
import { CLAN_WAR_DECLARE_SAGA, type ClanWarDeclarePlan } from '../../_save-debit-kinds.js';
import { PLAYABLE_WILD_SECTOR_IDS, OUTSKIRTS_SECTORS } from '../../../shared/sector-geo.js';
import {
    CLAN_WAR_RULES, createClanWarCampaign, type ClanWarCampaignRoster, type ClanWarShrineMode,
} from '../../../shared/clan-war-campaign.js';
import { applyLazyClanWarExpiry, CLAN_WAR_MAX_DURATION_MS, CLAN_WAR_REMATCH_COOLDOWN_SEC, clanWarCooldownKey, clanWarKey, clanWarPairId, isClanWarRowKey, type ClanWar } from './_storage.js';
import { CLAN_DECLARATION_LOCK, claimClanWarReservations, releasePendingClanWarReservations } from './_declaration-reservations.js';

type ClanRecord = Record<string, unknown>;
function storedDate(raw: unknown, fallback: number): number {
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
export function clanWarEstablishedAt(record: ClanRecord, now: number): number {
    return storedDate(record.serverCreatedAt, storedDate(record.createdAt, now - CLAN_WAR_RULES.minimumClanAgeMs));
}

/** Eligibility comes from authoritative saves/registry, not roster display levels or client dates. */
export async function loadClanWarEligibleRoster(record: ClanRecord, registry: Record<string, { lastSeen?: unknown }>, now: number): Promise<ClanWarCampaignRoster> {
    const clan = String(record.name ?? '').trim();
    const established = clanWarEstablishedAt(record, now);
    const joined = record.memberJoinedAt && typeof record.memberJoinedAt === 'object' ? record.memberJoinedAt as Record<string, unknown> : {};
    const members = Array.isArray(record.members) ? record.members : [];
    const names = [...new Set(members.map(member => safeName(String(typeof member === 'string' ? member
        : member && typeof member === 'object' ? member.name ?? '' : ''))).filter(Boolean))];
    const saves = names.length ? await kv.mget<Record<string, unknown>[]>(...names.map(name => `save:${name}`)) : [];
    const eligible = names.flatMap((name, index) => {
        const character = saves[index]?.character as Record<string, unknown> | undefined;
        const joinedAt = storedDate(joined[name], established);
        const lastSeen = Number(registry[name]?.lastSeen ?? 0);
        const level = Number(character?.level ?? 0);
        if (!character || clanBareSlug(String(character.clan ?? '')) !== clanBareSlug(clan)
            || !Number.isSafeInteger(level) || level < CLAN_WAR_RULES.minimumLevel
            || joinedAt > now - CLAN_WAR_RULES.membershipAgeMs
            || !Number.isFinite(lastSeen) || lastSeen > now || lastSeen < now - CLAN_WAR_RULES.activityAgeMs) return [];
        return [{ name, level }];
    });
    return { clan, members: eligible };
}
async function strictWars(): Promise<ClanWar[]> {
    const keys = (await kv.keys('clan-war:*')).filter(isClanWarRowKey);
    return keys.length ? (await kv.mget<ClanWar[]>(...keys)).filter((war): war is ClanWar => war !== null) : [];
}
/** An elapsed legacy war must not indefinitely block the new declaration door. */
async function settleElapsedLegacyWar(war: ClanWar, now: number): Promise<void> {
    const rowKey = clanWarKey(...war.clans);
    const ended = await withKvLock(rowKey, async () => {
        const current = await kv.get<ClanWar>(rowKey);
        if (!current || current.campaign || current.endedAt || now - current.startedAt <= CLAN_WAR_MAX_DURATION_MS) return null;
        const next = applyLazyClanWarExpiry(current, now).war;
        const cooldownKey = clanWarCooldownKey(...current.clans);
        const cooldown = await kv.get<number>(cooldownKey);
        const remaining = Math.ceil((Number(next.endedAt) + CLAN_WAR_REMATCH_COOLDOWN_SEC * 1000 - now) / 1000);
        if (!kv.compareSetMany || !await kv.compareSetMany([
            { op: 'cas', key: rowKey, expected: current, value: next },
            ...(remaining > 0 && Number(cooldown ?? 0) < Number(next.endedAt)
                ? [{ op: 'cas' as const, key: cooldownKey, expected: cooldown, value: next.endedAt!, ex: remaining }] : []),
        ])) throw new Error('Legacy clan war closure changed. Retry the same declaration.');
        return next;
    }, { failClosed: true });
    if (ended) { const { awardWarEndClanXp } = await import('./_war-xp.js'); await awardWarEndClanXp(ended); }
}
function shuffledModes(): ClanWarShrineMode[] {
    const result: ClanWarShrineMode[] = [];
    for (let cycle = 0; cycle < 2; cycle++) {
        const modes: ClanWarShrineMode[] = ['pvp1v1', 'pet1v1', 'tilecards'];
        for (let i = modes.length - 1; i > 0; i--) { const j = randomInt(i + 1); [modes[i], modes[j]] = [modes[j], modes[i]]; }
        result.push(...modes);
    }
    return result;
}
export function createDeclaredClanWar(input: {
    rosters: [ClanWarCampaignRoster, ClanWarCampaignRoster]; instanceId: string; declaredBy: string;
    villages: Record<string, string>; now: number;
}): ClanWar {
    // Ordinary traversable field sectors only. Town gates and special realms
    // are excluded before a location is sealed, never substituted at entry.
    const fields = PLAYABLE_WILD_SECTOR_IDS.filter(sector => !OUTSKIRTS_SECTORS.includes(sector)
        && ![46, 51, 54, 60, 99].includes(sector));
    if (!fields.length) throw new Error('No valid clan shrine sectors are configured.');
    const campaign = createClanWarCampaign({ ...input,
        sectors: Array.from({ length: CLAN_WAR_RULES.shrineCount }, () => fields[randomInt(fields.length)]),
        offsets: Array.from({ length: CLAN_WAR_RULES.shrineCount }, () => randomInt(CLAN_WAR_RULES.shrineBlockMs - CLAN_WAR_RULES.shrineWindowMs + 1)),
        modes: shuffledModes() });
    const clans = input.rosters.map(roster => roster.clan).sort((a, b) => a.localeCompare(b)) as [string, string];
    const id = clanWarPairId(...clans);
    return { id, campaign, clans, villages: input.villages, hp: Object.fromEntries(clans.map(clan => [clan, 1000])),
        startedAt: input.now, updatedAt: input.now, declaredBy: input.declaredBy,
        pendingChallenges: [], completedChallenges: [], warCrateId: `clan-war-crate-${id}-g${input.instanceId}` };
}

export async function declareClanWarCampaign(input: { playerName: string; toClan: string; requestId: string;funding?:'personal'|'pool' }): Promise<{
    war: ClanWar; character: Record<string, unknown>; _saveVersion: number;
}> {
    const player = safeName(input.playerName);
    if (!player || !input.requestId) throw new SaveDebitRefusal(400, 'A retained declaration request is required. Refresh and try again.');
    return withKvLock(CLAN_DECLARATION_LOCK, async () => {
        const transactionId = saveDebitTransactionId(CLAN_WAR_DECLARE_SAGA.kind, player, input.requestId);
        const journal = await kv.get<EconomyTxRecord>(economyTxKey(transactionId));
        if (journal && journal.state !== 'refunded') {
            const from = String(journal.meta?.fromClan ?? ''); const to = String(journal.meta?.toClan ?? '');
            if (!from || to.toLowerCase() !== input.toClan.toLowerCase()) throw new SaveDebitRefusal(409, 'That declaration request was used for another rival.');
            const funding=journal.meta?.funding==='pool'?'pool':'personal';
            if(funding!==(input.funding??'personal'))throw new SaveDebitRefusal(409,'Retry this declaration with its original funding choice.');
            if(funding==='pool'){
                const [war,save]=await Promise.all([kv.get<ClanWar>(clanWarKey(from,to)),kv.get<Record<string,unknown>>(`save:${player}`)]);
                if(journal.state!=='complete'||!war?.campaign||war.campaign.instanceId!==journal.meta?.instanceId||!save?.character)
                    throw new SaveDebitRefusal(409,'This paid declaration needs reconciliation before another can start.');
                return {war,character:save.character as Record<string,unknown>,_saveVersion:Number(save._saveVersion??0)};
            }
            const replay = await runSaveDebitSaga<Record<string, unknown>, ClanWarDeclarePlan, Record<string, never>>({
                definition: CLAN_WAR_DECLARE_SAGA, playerName: player, requestId: input.requestId,
                identity: { war: clanWarPairId(from, to) }, sharedKey: clanWarKey(from, to),
                resource: 'honorSeals', amount: journal.amount, meta: { fromClan: from, toClan: to },
                decide: () => ({ ok: false, status: 409, error: 'This paid declaration needs reconciliation before another can start.' }),
            });
            return { war: replay.shared as unknown as ClanWar, character: replay.character, _saveVersion: replay._saveVersion };
        }
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = save?.character as Record<string, unknown> | undefined;
        const requestedFrom = String(character?.clan ?? '').trim();
        if (!requestedFrom) throw new SaveDebitRefusal(400, 'Join a clan before declaring war.');
        const [fromRecord, toRecord, registry] = await Promise.all([
            kv.get<ClanRecord>(clanRecordKey(requestedFrom)), kv.get<ClanRecord>(clanRecordKey(input.toClan)),
            kv.get<Record<string, { lastSeen?: unknown }>>(REGISTRY_KEY),
        ]);
        if (!fromRecord || !toRecord) throw new SaveDebitRefusal(404, 'Clan record not found.');
        const from = String(fromRecord.name ?? '').trim(), to = String(toRecord.name ?? '').trim();
        if (!from || !to || to.toLowerCase() !== input.toClan.toLowerCase()) throw new SaveDebitRefusal(409, 'The rival clan name does not match its canonical record.');
        if (clanBareSlug(from) === clanBareSlug(to)) throw new SaveDebitRefusal(400, 'Choose a different clan.');
        if (!clanLeadershipRole(fromRecord, player)) throw new SaveDebitRefusal(403, 'Only clan leadership can declare war.');
        const now = Date.now();
        for (const record of [fromRecord, toRecord]) if (now - clanWarEstablishedAt(record, now) < CLAN_WAR_RULES.minimumClanAgeMs) {
            throw new SaveDebitRefusal(409, `${String(record.name)} must be seven days old before entering a clan war.`);
        }
        let wars = await strictWars();
        for (const existing of wars) if (!existing.campaign && !existing.endedAt && now - existing.startedAt > CLAN_WAR_MAX_DURATION_MS
            && existing.clans.some(clan=>clan===from||clan===to)) await settleElapsedLegacyWar(existing,now);
        for (const existing of wars) if (existing.campaign && !existing.endedAt && existing.campaign.endsAt <= now
            && existing.clans.some(clan=>clan===from||clan===to)) {
            const {reconcileClanWarCampaign}=await import('./_campaign-reconcile.js');
            await reconcileClanWarCampaign(existing.id,now);
        }
        wars = await strictWars();
        for (const clan of [from, to]) {
            if (wars.some(war => war.clans.includes(clan) && (!war.endedAt || (war.campaign &&
                (war.campaign.closeReason==='service' ? !war.campaign.serviceCancellation?.feeRefundedAt : war.endedAt + CLAN_WAR_RULES.recoveryMs > now))))) {
                throw new SaveDebitRefusal(409, `${clan} already has a war or is recovering from one.`);
            }
        }
        if (await kv.get(clanWarCooldownKey(from, to))) throw new SaveDebitRefusal(409, 'These clans fought within the last seven days.');
        const rosters = await Promise.all([loadClanWarEligibleRoster(fromRecord, registry ?? {}, now), loadClanWarEligibleRoster(toRecord, registry ?? {}, now)]) as [ClanWarCampaignRoster, ClanWarCampaignRoster];
        for (const roster of rosters) if (roster.members.length < CLAN_WAR_RULES.minimumMembers) throw new SaveDebitRefusal(409,
            `${roster.clan} needs four level-15 members who have belonged for 48 hours and played within the last seven days.`);
        const cost = fromRecord.doctrine === 'warmonger' ? Math.floor(CLAN_WAR_RULES.declarationCost * 0.9) : CLAN_WAR_RULES.declarationCost;
        const instanceId = `cw2-${createHash('sha256').update(transactionId).digest('hex').slice(0, 24)}`;
        const war = createDeclaredClanWar({ rosters, instanceId, now, declaredBy: player,
            villages: { [from]: String(fromRecord.village ?? ''), [to]: String(toRecord.village ?? '') } });
        war.campaign!.declarationPayment={transactionId,funding:input.funding??'personal',amount:cost,payerName:player,clan:from};
        try {
            await claimClanWarReservations({ clans: war.clans, warId: war.id, instanceId, transactionId, now });
            if(input.funding==='pool'){
                const {publishPoolDeclaration}=await import('./_pool-declaration.js');
                return await publishPoolDeclaration({war,fromClan:from,playerName:player,cost,transactionId});
            }
            const outcome = await runSaveDebitSaga<Record<string, unknown>, ClanWarDeclarePlan, Record<string, never>>({
                definition: CLAN_WAR_DECLARE_SAGA, playerName: player, requestId: input.requestId,
                identity: { war: war.id }, sharedKey: clanWarKey(from, to), resource: 'honorSeals', amount: cost,
                meta: { fromClan: from, toClan: to,funding:'personal' },
                decide: async ({ character: live, shared }) => {
                    const clan = await kv.get<ClanRecord>(clanRecordKey(from));
                    if (!clan || !clanLeadershipRole(clan, player) || clanBareSlug(String(live.clan ?? '')) !== clanBareSlug(from)) {
                        return { ok: false, status: 403, error: 'Your clan leadership changed before payment.' };
                    }
                    if (shared?.startedAt && !shared.endedAt) return { ok: false, status: 409, error: 'A war already stands between these clans.' };
                    const balance = Number(live.honorSeals ?? 0);
                    if (!Number.isSafeInteger(balance) || balance < cost) return { ok: false, status: 400, error: `Declaring war costs ${cost} Honor Seals.`, details: { cost, balance } };
                    return { ok: true, character: { ...live, honorSeals: balance - cost }, plan: { war: war as unknown as Record<string, unknown>, cost }, result: {} };
                },
                messages: { refunded: 'The war could not open; your Honor Seals were returned.', pending: 'The payment is recorded. Retry this declaration to finish it without another charge.' },
            });
            return { war: outcome.shared as unknown as ClanWar, character: outcome.character, _saveVersion: outcome._saveVersion };
        } catch (error) {
            const proof = await kv.get<EconomyTxRecord>(economyTxKey(transactionId)).catch(() => undefined);
            // No journal means the debit never started; refunded is explicit
            // compensation. Unknown/pending outcomes retain both clan claims.
            if (proof === null || proof?.state === 'refunded') await releasePendingClanWarReservations(war.clans, transactionId);
            if (error instanceof SaveDebitRefusal) throw error;
            if(proof===undefined||proof?.state==='complete')throw new SaveDebitRefusal(503,'The declaration outcome is being checked. Retry with the same funding choice; no second payment will be taken.',{reconcile:true,retryable:true});
            throw new SaveDebitRefusal(409, (error as Error).message);
        }
    }, { failClosed: true, ttlSec: 30 });
}
