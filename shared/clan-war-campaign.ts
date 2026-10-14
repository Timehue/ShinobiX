/** Server-owned campaign rules. Clients consume projections, never mutate this state. */
export const CLAN_WAR_RULES = Object.freeze({
    version: 2 as const,
    preparationMs: 24 * 60 * 60_000,
    conflictMs: 72 * 60 * 60_000,
    dayMs: 24 * 60 * 60_000,
    clanSlotsPerDay: 20,
    memberSlotsPerDay: 5,
    pointsPerParticipant: 100,
    shrineCount: 6,
    shrineBlockMs: 12 * 60 * 60_000,
    shrineWindowMs: 2 * 60 * 60_000,
    shrineNoticeMs: 30 * 60_000,
    shrineMatches: 5,
    shrineMemberMatches: 2,
    shrineWinPoints: 100,
    admissionBufferMs: 15 * 60_000,
    readyMs: 30_000,
    queueLeaseMs: 45_000,
    recoveryMs: 3 * 24 * 60 * 60_000,
    pairCooldownMs: 7 * 24 * 60 * 60_000,
    minimumMembers: 4,
    minimumLevel: 15,
    minimumClanAgeMs: 7 * 24 * 60 * 60_000,
    membershipAgeMs: 48 * 60 * 60_000,
    activityAgeMs: 7 * 24 * 60 * 60_000,
    declarationCost: 100,
    participationPoints: 25,
    matchWinPoints: 25,
    victoryPoints: 75,
    winnerClanXp: 1_200,
    otherClanXp: 400,
    provisionCost:30,
    provisionCpBonus:0.1,
    maxQueueEntries: 60,
    maxMatchRecords: 512,
});

export const CLAN_WAR_QUEUE_MODES = ['pvp1v1', 'pvp2v2', 'pet1v1', 'tilecards'] as const;
export type ClanWarQueueMode = typeof CLAN_WAR_QUEUE_MODES[number];
export type ClanWarShrineMode = Exclude<ClanWarQueueMode, 'pvp2v2'>;
export type ClanWarMatchResult = 'from-wins' | 'to-wins' | 'draw';
export type ClanWarMatchScope = 'normal' | 'shrine';
export type ClanWarPhase = 'preparing' | 'active' | 'ended';

export interface ClanWarEligibleMember { name: string; level: number }
export interface ClanWarCampaignRoster { clan: string; members: ClanWarEligibleMember[] }
export interface ClanWarShrineWindow {
    index: number; sector: number; mode: ClanWarShrineMode; opensAt: number; closesAt: number;
    usedMatches: number; memberUses: Record<string, number>;
}
export interface ClanWarDayBudget {
    clanUses: Record<string, number>; memberUses: Record<string, number>;
}
export interface ClanWarQueueEntry {
    id: string; clan: string; mode: ClanWarQueueMode; scope: ClanWarMatchScope;
    windowIndex?: number; players: string[]; joinedAt: number; heartbeat: Record<string, number>;
}
export interface ClanWarCampaignMatch {
    id: string; mode: ClanWarQueueMode; scope: ClanWarMatchScope; windowIndex?: number;
    fromClan: string; toClan: string; fromPlayers: string[]; toPlayers: string[];
    status: 'ready' | 'active' | 'completed' | 'cancelled'; readyPlayers: string[];
    createdAt: number; readyUntil: number; startedAt?: number; day?: number;
    scoringDeadline?: number; completedAt?: number; result?: ClanWarMatchResult;
    scoreEligible?: boolean; points?: number; battleId?: string; cancellation?: string;
    rewardsSettledAt?: number;
    provisionedClans?:string[];
}
export interface ClanWarCampaignContribution {
    name: string; clan: string; played: number; wins: number; teamWins: number;
    normalPoints: number; shrinePoints: number;
}
export interface ClanWarCampaign {
    version: 2; instanceId: string; declaredAt: number; startsAt: number; endsAt: number;
    rosters: [ClanWarCampaignRoster, ClanWarCampaignRoster]; scores: Record<string, number>;
    days: [ClanWarDayBudget, ClanWarDayBudget, ClanWarDayBudget]; shrines: ClanWarShrineWindow[];
    queue: ClanWarQueueEntry[]; matches: Record<string, ClanWarCampaignMatch>;
    contributions: Record<string, ClanWarCampaignContribution>;
    closedAt?: number; winnerClan?: string; closeReason?: 'time' | 'surrender' | 'withdrawal' | 'dissolution' | 'service';
    endRewardsSettledAt?: number;
    provisions?:Record<string,Array<{day:number;activatedAt:number}>>;
    declarationPayment?: { transactionId:string; funding:'personal'|'pool'; amount:number; payerName:string; clan:string };
    serviceCancellation?: { reason:string; requestedAt:number; feeRefundedAt?:number };
}
export type ClanWarCampaignMutation =
    | { ok: true; campaign: ClanWarCampaign; matchId?: string }
    | { ok: false; code: string; error: string };

export interface ClanWarCampaignView {
    version: 2; instanceId: string; phase: ClanWarPhase; startsAt: number; endsAt: number;
    declaringClan:string;
    scores: Record<string, number>; winnerClan?: string; closeReason?: ClanWarCampaign['closeReason'];
    eligibleMembers: ClanWarEligibleMember[]; eligible: boolean;
    eligibleRosters:ClanWarCampaignRoster[];
    normal: { day: number | null; clanUsed: number; clanLimit: number; memberUsed: number; memberLimit: number };
    queue: ClanWarQueueEntry[];
    enemyQueueCounts: Partial<Record<ClanWarQueueMode, number>>;
    enemyShrineQueueCounts:Record<string,Partial<Record<ClanWarQueueMode,number>>>;
    matches: ClanWarCampaignMatch[]; contributions: ClanWarCampaignContribution[];
    playerContribution?:ClanWarCampaignContribution;
    provisioned:boolean;
    shrines: Array<{ index: number; opensAt: number; closesAt: number; sector?: number; mode?: ClanWarShrineMode;
        state: 'upcoming' | 'open' | 'closed'; usedMatches: number; matchLimit: number; memberUsed: number; memberLimit: number }>;
}

export function clanWarPlayerKey(name: string): string {
    // Match api/_utils.safeName: underscores and hyphens identify distinct
    // accounts and must never collapse into another member's eligibility.
    return String(name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}
function value<T>(record: Record<string, T>, key: string, next: T): Record<string, T> {
    return { ...record, [key]: next };
}
/** Account and clan names may equal inherited Object property names. */
export function clanWarOwnValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
    return record && Object.hasOwn(record, key) ? record[key] : undefined;
}
function refusal(code: string, error: string): ClanWarCampaignMutation { return { ok: false, code, error }; }
function positiveTime(now: number): void {
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid campaign timestamp.');
}
export function clanWarCampaignPhase(campaign: ClanWarCampaign, now: number): ClanWarPhase {
    if (campaign.closedAt !== undefined || now >= campaign.endsAt) return 'ended';
    return now < campaign.startsAt ? 'preparing' : 'active';
}
export function clanWarCampaignDay(campaign: ClanWarCampaign, now: number): number | null {
    if (now < campaign.startsAt || now >= campaign.endsAt) return null;
    return Math.floor((now - campaign.startsAt) / CLAN_WAR_RULES.dayMs);
}
export function clanWarModeSize(mode: ClanWarQueueMode): number { return mode === 'pvp2v2' ? 2 : 1; }
export function clanWarRoomXpBonus(level: unknown): number { return Math.min(50,Math.max(0,Math.floor(Number(level)||0))) * 0.002; }
export function isClanWarQueueMode(mode: unknown): mode is ClanWarQueueMode {
    return CLAN_WAR_QUEUE_MODES.some(candidate => candidate === mode);
}
export function campaignMember(campaign: ClanWarCampaign, clan: string, name: string): ClanWarEligibleMember | undefined {
    const key = clanWarPlayerKey(name);
    return campaign.rosters.find(roster => roster.clan === clan)?.members.find(member => clanWarPlayerKey(member.name) === key);
}

export function createClanWarCampaign(input: {
    instanceId: string; now: number; rosters: [ClanWarCampaignRoster, ClanWarCampaignRoster];
    /** Six valid field sectors and six bounded server random offsets; never client input. */
    sectors: number[]; offsets: number[]; modes: ClanWarShrineMode[];
}): ClanWarCampaign {
    positiveTime(input.now);
    if (!/^[a-z0-9-]{8,80}$/.test(input.instanceId)) throw new Error('Invalid campaign instance.');
    if (input.rosters[0].clan === input.rosters[1].clan || input.rosters.some(roster => !roster.clan.trim())) {
        throw new Error('Two distinct clans are required.');
    }
    const names = input.rosters.flatMap(roster => roster.members.map(member => clanWarPlayerKey(member.name)));
    if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('Campaign members must be distinct.');
    if (input.rosters.some(roster => roster.members.length < CLAN_WAR_RULES.minimumMembers
        || roster.members.some(member => !Number.isSafeInteger(member.level) || member.level < CLAN_WAR_RULES.minimumLevel))) {
        throw new Error('Each clan needs four eligible level-15 members.');
    }
    if ([input.sectors, input.offsets, input.modes].some(list => list.length !== CLAN_WAR_RULES.shrineCount)) {
        throw new Error('Six shrine appearances are required.');
    }
    if (input.sectors.some(sector => !Number.isSafeInteger(sector) || sector <= 0)
        || input.offsets.some(offset => !Number.isSafeInteger(offset) || offset < 0
            || offset > CLAN_WAR_RULES.shrineBlockMs - CLAN_WAR_RULES.shrineWindowMs)) {
        throw new Error('Invalid shrine location or opening offset.');
    }
    for (const start of [0, 3]) {
        const set = input.modes.slice(start, start + 3);
        if (new Set(set).size !== 3 || set.some(mode => mode !== 'pvp1v1' && mode !== 'pet1v1' && mode !== 'tilecards')) {
            throw new Error('Each shrine cycle must contain all three specialties.');
        }
    }
    const startsAt = input.now + CLAN_WAR_RULES.preparationMs;
    const rosters = input.rosters.map(roster => ({ ...roster, members: roster.members.map(member => ({ ...member })) })) as ClanWarCampaign['rosters'];
    const scores = Object.fromEntries(rosters.map(roster => [roster.clan, 0]));
    const makeDay = (): ClanWarDayBudget => ({ clanUses: { ...scores }, memberUses: {} });
    return {
        version: 2, instanceId: input.instanceId, declaredAt: input.now, startsAt,
        endsAt: startsAt + CLAN_WAR_RULES.conflictMs, rosters, scores,
        days: [makeDay(), makeDay(), makeDay()], queue: [], matches: {}, contributions: {},
        shrines: input.sectors.map((sector, index) => {
            const opensAt = startsAt + index * CLAN_WAR_RULES.shrineBlockMs + input.offsets[index];
            return { index, sector, mode: input.modes[index], opensAt,
                closesAt: opensAt + CLAN_WAR_RULES.shrineWindowMs, usedMatches: 0, memberUses: {} };
        }),
    };
}

export function clanWarAdmissionError(campaign: ClanWarCampaign, input: {
    clan: string; players: string[]; mode: ClanWarQueueMode; scope: ClanWarMatchScope; windowIndex?: number; now: number;
}): string | null {
    if (clanWarCampaignPhase(campaign, input.now) !== 'active') return 'This war is not accepting battles.';
    if (!isClanWarQueueMode(input.mode)) return 'That battle mode is unavailable.';
    if (!input.players.length || input.players.length > clanWarModeSize(input.mode)
        || new Set(input.players.map(clanWarPlayerKey)).size !== input.players.length) return 'Choose distinct eligible clanmates.';
    if (input.players.some(name => !campaignMember(campaign, input.clan, name))) return 'A player is not on this war’s eligible roster.';
    if (input.scope === 'shrine') {
        const window = campaign.shrines.find(candidate => candidate.index === input.windowIndex);
        if (!window || input.now < window.opensAt || input.now >= window.closesAt - CLAN_WAR_RULES.admissionBufferMs) {
            return 'The shrine is not accepting new battles.';
        }
        if (input.mode !== window.mode) return 'Use the shrine’s announced battle mode.';
        if (window.usedMatches >= CLAN_WAR_RULES.shrineMatches) return 'All shrine bonus matches have been used.';
        if (input.players.some(name => (clanWarOwnValue(window.memberUses, clanWarPlayerKey(name)) ?? 0) >= CLAN_WAR_RULES.shrineMemberMatches)) {
            return 'A player has used their shrine matches for this appearance.';
        }
    } else if (input.scope === 'normal') {
        if (input.now >= campaign.endsAt - CLAN_WAR_RULES.admissionBufferMs) return 'The war is closing; new battles have stopped.';
        const day = clanWarCampaignDay(campaign, input.now)!;
        const budget = campaign.days[day];
        if ((clanWarOwnValue(budget.clanUses, input.clan) ?? 0) + clanWarModeSize(input.mode) > CLAN_WAR_RULES.clanSlotsPerDay) {
            return 'Your clan has used its normal scored slots for this war day.';
        }
        if (input.players.some(name => (clanWarOwnValue(budget.memberUses, clanWarPlayerKey(name)) ?? 0) >= CLAN_WAR_RULES.memberSlotsPerDay)) {
            return 'A player has used their normal scored slots for this war day.';
        }
    } else return 'Unknown battle queue.';
    return null;
}

export function pruneClanWarQueue(campaign: ClanWarCampaign, now: number): ClanWarCampaign {
    const queue = campaign.queue.flatMap(entry => {
        const players = entry.players.filter(name => now - (entry.heartbeat[clanWarPlayerKey(name)] ?? 0) < CLAN_WAR_RULES.queueLeaseMs);
        if (!players.length || clanWarAdmissionError(campaign, { ...entry, players, now })) return [];
        return [{ ...entry, players, heartbeat: Object.fromEntries(players.map(name => [clanWarPlayerKey(name), entry.heartbeat[clanWarPlayerKey(name)]])) }];
    });
    const matches = Object.fromEntries(Object.entries(campaign.matches)
        // An unstarted ready check has no budget, outcome or payout receipt.
        // Retain brief feedback, then discard it so repeated declines cannot
        // permanently exhaust the bounded campaign match journal.
        .filter(([, match]) => !(match.status === 'cancelled' && match.startedAt === undefined
            && now - (match.completedAt ?? now) >= 2 * CLAN_WAR_RULES.readyMs))
        .map(([id, match]) => [id, match.status === 'ready' && now >= match.readyUntil
            ? { ...match, status: 'cancelled' as const, completedAt: now, cancellation: 'ready-expired' } : match]));
    return { ...campaign, queue, matches };
}

/** Identity/current membership, legal loadouts and physical shrine presence are checked by the server service first. */
export function joinClanWarQueue(campaign0: ClanWarCampaign, input: {
    entryId: string; clan: string; name: string; mode: ClanWarQueueMode; scope: ClanWarMatchScope;
    windowIndex?: number; partnerEntryId?: string; now: number;
}): ClanWarCampaignMutation {
    positiveTime(input.now);
    const campaign = pruneClanWarQueue(campaign0, input.now);
    const error = clanWarAdmissionError(campaign, { ...input, players: [input.name] });
    if (error) return refusal('admission', error);
    const playerKey = clanWarPlayerKey(input.name);
    if (Object.values(campaign.matches).some(match => (match.status === 'ready' || match.status === 'active')
        && [...match.fromPlayers, ...match.toPlayers].some(name => clanWarPlayerKey(name) === playerKey))) {
        return refusal('in-match', 'Finish or leave your current match first.');
    }
    const existing = campaign.queue.find(entry => entry.players.some(name => clanWarPlayerKey(name) === playerKey));
    if (existing) {
        if (existing.mode !== input.mode || existing.scope !== input.scope || existing.windowIndex !== input.windowIndex) {
            return refusal('already-queued', 'Leave your current queue before changing battle mode.');
        }
        return { ok: true, campaign: { ...campaign, queue: campaign.queue.map(entry => entry.id === existing.id
            ? { ...entry, heartbeat: value(entry.heartbeat, playerKey, input.now) } : entry) } };
    }
    if (input.partnerEntryId) {
        const partner = campaign.queue.find(entry => entry.id === input.partnerEntryId);
        if (!partner || partner.clan !== input.clan || partner.mode !== 'pvp2v2' || input.mode !== 'pvp2v2'
            || partner.scope !== input.scope || partner.windowIndex !== input.windowIndex || partner.players.length !== 1) {
            return refusal('partner', 'That partner slot is no longer available.');
        }
        return { ok: true, campaign: { ...campaign, queue: campaign.queue.map(entry => entry.id === partner.id
            ? { ...entry, players: [...entry.players, input.name], heartbeat: value(entry.heartbeat, playerKey, input.now) } : entry) } };
    }
    if (campaign.queue.length >= CLAN_WAR_RULES.maxQueueEntries) return refusal('queue-full', 'The queue is busy. Please retry shortly.');
    if (!input.entryId || campaign.queue.some(entry => entry.id === input.entryId)) return refusal('entry-id', 'Invalid queue request.');
    return { ok: true, campaign: { ...campaign, queue: [...campaign.queue, {
        id: input.entryId, clan: input.clan, players: [input.name], mode: input.mode,
        scope: input.scope, windowIndex: input.windowIndex, joinedAt: input.now, heartbeat: { [playerKey]: input.now },
    }] } };
}

export function leaveClanWarQueue(campaign: ClanWarCampaign, name: string): ClanWarCampaign {
    const key = clanWarPlayerKey(name);
    return { ...campaign, queue: campaign.queue.flatMap(entry => {
        const players = entry.players.filter(player => clanWarPlayerKey(player) !== key);
        return players.length ? [{ ...entry, players, heartbeat: Object.fromEntries(players.map(player => [clanWarPlayerKey(player), entry.heartbeat[clanWarPlayerKey(player)]])) }] : [];
    }) };
}

export function matchClanWarQueue(campaign0: ClanWarCampaign, matchId: string, now: number): ClanWarCampaignMutation {
    const campaign = pruneClanWarQueue(campaign0, now);
    if (Object.keys(campaign.matches).length >= CLAN_WAR_RULES.maxMatchRecords) return refusal('match-ledger-full', 'War match history needs reconciliation.');
    if (!matchId || clanWarOwnValue(campaign.matches, matchId)) return refusal('match-id', 'Invalid match request.');
    const readyEntries = campaign.queue.filter(entry => entry.players.length === clanWarModeSize(entry.mode))
        .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    for (const from of readyEntries) {
        const to = readyEntries.find(entry => entry.clan !== from.clan && entry.mode === from.mode
            && entry.scope === from.scope && entry.windowIndex === from.windowIndex);
        if (!to) continue;
        const match: ClanWarCampaignMatch = {
            id: matchId, mode: from.mode, scope: from.scope, windowIndex: from.windowIndex,
            fromClan: from.clan, toClan: to.clan, fromPlayers: [...from.players], toPlayers: [...to.players],
            status: 'ready', readyPlayers: [], createdAt: now, readyUntil: now + CLAN_WAR_RULES.readyMs,
        };
        return { ok: true, matchId, campaign: {
            ...campaign, queue: campaign.queue.filter(entry => entry.id !== from.id && entry.id !== to.id),
            matches: value(campaign.matches, matchId, match),
        } };
    }
    return { ok: true, campaign };
}

export function readyClanWarMatch(campaign: ClanWarCampaign, matchId: string, name: string, now: number): ClanWarCampaignMutation {
    const match = clanWarOwnValue(campaign.matches, matchId);
    if (!match || match.status !== 'ready' || now >= match.readyUntil) return refusal('ready-expired', 'That ready check has ended.');
    const key = clanWarPlayerKey(name);
    if (![...match.fromPlayers, ...match.toPlayers].some(player => clanWarPlayerKey(player) === key)) {
        return refusal('not-participant', 'You are not in this match.');
    }
    return { ok: true, matchId, campaign: { ...campaign, matches: value(campaign.matches, matchId, {
        ...match, readyPlayers: [...new Set([...match.readyPlayers, key])],
    }) } };
}

export function startClanWarMatch(campaign: ClanWarCampaign, matchId: string, now: number): ClanWarCampaignMutation {
    const match = clanWarOwnValue(campaign.matches, matchId);
    if (match?.status === 'active') return { ok: true, campaign, matchId };
    if (!match || match.status !== 'ready' || now >= match.readyUntil) return refusal('ready-expired', 'That ready check has ended.');
    const players = [...match.fromPlayers, ...match.toPlayers];
    if (!players.every(name => match.readyPlayers.includes(clanWarPlayerKey(name)))) return refusal('not-ready', 'Waiting for every player to confirm.');
    for (const [clan, side] of [[match.fromClan, match.fromPlayers], [match.toClan, match.toPlayers]] as const) {
        const error = clanWarAdmissionError(campaign, { clan, players: side, mode: match.mode, scope: match.scope, windowIndex: match.windowIndex, now });
        if (error) return refusal('admission', error);
    }
    const day = clanWarCampaignDay(campaign, now)!;
    let next = campaign;
    let deadline = campaign.endsAt;
    if (match.scope === 'normal') {
        const budget = campaign.days[day];
        let clanUses = budget.clanUses, memberUses = budget.memberUses;
        for (const clan of [match.fromClan, match.toClan]) clanUses = value(clanUses, clan, (clanWarOwnValue(clanUses, clan) ?? 0) + clanWarModeSize(match.mode));
        for (const player of players) { const key = clanWarPlayerKey(player); memberUses = value(memberUses, key, (clanWarOwnValue(memberUses, key) ?? 0) + 1); }
        const days = [...campaign.days] as ClanWarCampaign['days']; days[day] = { clanUses, memberUses };
        next = { ...campaign, days };
    } else {
        const window = campaign.shrines.find(entry => entry.index === match.windowIndex)!;
        let memberUses = window.memberUses;
        for (const player of players) { const key = clanWarPlayerKey(player); memberUses = value(memberUses, key, (clanWarOwnValue(memberUses, key) ?? 0) + 1); }
        deadline = window.closesAt;
        next = { ...campaign, shrines: campaign.shrines.map(entry => entry.index === window.index
            ? { ...entry, memberUses, usedMatches: entry.usedMatches + 1 } : entry) };
    }
    return { ok: true, matchId, campaign: { ...next, matches: value(next.matches, matchId, {
        ...match, status: 'active', startedAt: now, day, scoringDeadline: deadline,
        provisionedClans:campaign.rosters.filter(roster=>clanWarOwnValue(campaign.provisions,roster.clan)?.some(entry=>entry.day===day&&entry.activatedAt<=now)).map(roster=>roster.clan),
    }) } };
}

/** Call only with an authoritative terminal result, never a player-submitted winner. */
export function completeClanWarMatch(campaign: ClanWarCampaign, matchId: string, result: ClanWarMatchResult, terminalAt: number): ClanWarCampaignMutation {
    positiveTime(terminalAt);
    if (!['from-wins', 'to-wins', 'draw'].includes(result)) return refusal('result', 'Invalid battle result.');
    const match = clanWarOwnValue(campaign.matches, matchId);
    if (match?.status === 'completed') {
        return match.result === result && match.completedAt === terminalAt ? { ok: true, campaign, matchId }
            : refusal('result-conflict', 'This battle already has a different result.');
    }
    if (!match || match.status !== 'active' || !match.startedAt || terminalAt < match.startedAt) {
        return refusal('inactive-match', 'This battle was not admitted.');
    }
    const eligible = campaign.closedAt === undefined && terminalAt <= (match.scoringDeadline ?? 0);
    const winningClan = result === 'from-wins' ? match.fromClan : result === 'to-wins' ? match.toClan : undefined;
    const points = eligible && winningClan ? match.scope === 'shrine' ? CLAN_WAR_RULES.shrineWinPoints
        : CLAN_WAR_RULES.pointsPerParticipant * clanWarModeSize(match.mode) : 0;
    let contributions = campaign.contributions;
    if (eligible) for (const [clan, side] of [[match.fromClan, match.fromPlayers], [match.toClan, match.toPlayers]] as const) {
        const won = winningClan === clan;
        for (const name of side) {
            const key = clanWarPlayerKey(name);
            const prior = clanWarOwnValue(contributions, key) ?? { name, clan, played: 0, wins: 0, teamWins: 0, normalPoints: 0, shrinePoints: 0 };
            contributions = value(contributions, key, { ...prior, played: prior.played + 1,
                wins: prior.wins + Number(won), teamWins: prior.teamWins + Number(won && match.mode === 'pvp2v2'),
                normalPoints: prior.normalPoints + (won && match.scope === 'normal' ? CLAN_WAR_RULES.pointsPerParticipant : 0),
                shrinePoints: prior.shrinePoints + (won && match.scope === 'shrine' ? CLAN_WAR_RULES.shrineWinPoints : 0) });
        }
    }
    return { ok: true, campaign: { ...campaign, contributions,
        scores: winningClan && points ? value(campaign.scores, winningClan, (campaign.scores[winningClan] ?? 0) + points) : campaign.scores,
        matches: value(campaign.matches, matchId, { ...match, status: 'completed', result, completedAt: terminalAt, scoreEligible: eligible, points }),
    }, matchId };
}

/** Service cancellations release both sides atomically; voluntary forfeits must settle as a battle result. */
export function cancelClanWarMatch(campaign: ClanWarCampaign, matchId: string, now: number, reason: string): ClanWarCampaignMutation {
    const match = clanWarOwnValue(campaign.matches, matchId);
    if (!match) return refusal('not-found', 'Match not found.');
    if (match.status === 'completed') return refusal('completed', 'A completed battle cannot be canceled.');
    if (match.status === 'cancelled') return { ok: true, campaign, matchId };
    let next = campaign;
    const players = [...match.fromPlayers, ...match.toPlayers];
    if (match.status === 'active') {
        if (match.scope === 'normal') {
            const day = match.day!; const budget = campaign.days[day];
            let clanUses = budget.clanUses, memberUses = budget.memberUses;
            for (const clan of [match.fromClan, match.toClan]) clanUses = value(clanUses, clan, Math.max(0, (clanWarOwnValue(clanUses, clan) ?? 0) - clanWarModeSize(match.mode)));
            for (const player of players) { const key = clanWarPlayerKey(player); memberUses = value(memberUses, key, Math.max(0, (clanWarOwnValue(memberUses, key) ?? 0) - 1)); }
            const days = [...campaign.days] as ClanWarCampaign['days']; days[day] = { clanUses, memberUses }; next = { ...campaign, days };
        } else {
            next = { ...campaign, shrines: campaign.shrines.map(window => {
                if (window.index !== match.windowIndex) return window;
                let memberUses = window.memberUses;
                for (const player of players) { const key = clanWarPlayerKey(player); memberUses = value(memberUses, key, Math.max(0, (clanWarOwnValue(memberUses, key) ?? 0) - 1)); }
                return { ...window, usedMatches: Math.max(0, window.usedMatches - 1), memberUses };
            }) };
        }
    }
    return { ok: true, matchId, campaign: { ...next, matches: value(next.matches, matchId,
        { ...match, status: 'cancelled', completedAt: now, cancellation: reason }) } };
}

/** Caller must reconcile admitted terminal battle records before freezing the score. */
export function closeClanWarCampaign(campaign: ClanWarCampaign, now: number,
    reason: NonNullable<ClanWarCampaign['closeReason']> = 'time', surrenderingClan?: string): ClanWarCampaign {
    positiveTime(now);
    if (campaign.closedAt !== undefined) return campaign;
    if (reason === 'time' && now < campaign.endsAt) throw new Error('Cannot close an unfinished campaign.');
    if ((reason === 'surrender' || reason === 'dissolution') && !campaign.rosters.some(roster => roster.clan === surrenderingClan)) {
        throw new Error('Surrender requires a participant clan.');
    }
    const [from, to] = campaign.rosters.map(roster => roster.clan);
    const winnerClan = reason === 'withdrawal' || reason === 'service' ? undefined
        : reason === 'surrender' || reason === 'dissolution' ? (from === surrenderingClan ? to : from)
            : campaign.scores[from] > campaign.scores[to] ? from : campaign.scores[to] > campaign.scores[from] ? to : undefined;
    return { ...campaign, closedAt: now, closeReason: reason, winnerClan, queue: [],
        matches: Object.fromEntries(Object.entries(campaign.matches).map(([id, match]) => [id,
            match.status === 'ready' || match.status === 'active'
                ? { ...match, status: 'cancelled' as const, completedAt: now, cancellation: 'war-closed' } : match])) };
}

/** The wire view deliberately omits raw future locations, private counters and rival queue identities. */
export function projectClanWarCampaign(campaign: ClanWarCampaign, viewerClan: string, viewerName: string, now: number,
    scoutLevel = 0): ClanWarCampaignView {
    const ownRoster = campaign.rosters.find(roster => roster.clan === viewerClan);
    const player = clanWarPlayerKey(viewerName);
    const day = clanWarCampaignDay(campaign, now);
    const budget = day === null ? undefined : campaign.days[day];
    const ownContribution = clanWarOwnValue(campaign.contributions, player);
    const level = ownRoster ? Math.min(50, Math.max(0, Math.floor(scoutLevel))) : 0;
    const locationNotice = level >= 30 ? 90 * 60_000 : level >= 1 ? 60 * 60_000 : CLAN_WAR_RULES.shrineNoticeMs;
    const modeNotice = level >= 15 ? locationNotice : CLAN_WAR_RULES.shrineNoticeMs;
    const enemyQueueCounts: Partial<Record<ClanWarQueueMode, number>> = {};
    const enemyShrineQueueCounts:Record<string,Partial<Record<ClanWarQueueMode,number>>>={};
    for (const entry of campaign.queue) if (entry.clan !== viewerClan) {
        if(entry.scope==='normal')enemyQueueCounts[entry.mode] = (enemyQueueCounts[entry.mode] ?? 0) + entry.players.length;
        else {const key=String(entry.windowIndex),counts=enemyShrineQueueCounts[key]??{};counts[entry.mode]=(counts[entry.mode]??0)+entry.players.length;enemyShrineQueueCounts[key]=counts;}
    }
    return {
        version: 2, instanceId: campaign.instanceId, phase: clanWarCampaignPhase(campaign, now),
        startsAt: campaign.startsAt, endsAt: campaign.endsAt, scores: { ...campaign.scores },
        declaringClan:campaign.rosters[0].clan,
        winnerClan: campaign.winnerClan, closeReason: campaign.closeReason,
        eligibleMembers: ownRoster?.members.map(member => ({ ...member })) ?? [],
        eligibleRosters:ownRoster?campaign.rosters.map(roster=>({...roster,members:roster.members.map(member=>({...member}))})):[],
        eligible: !!ownRoster?.members.some(member => clanWarPlayerKey(member.name) === player),
        normal: { day, clanUsed: ownRoster ? clanWarOwnValue(budget?.clanUses, viewerClan) ?? 0 : 0,
            clanLimit: CLAN_WAR_RULES.clanSlotsPerDay, memberUsed: clanWarOwnValue(budget?.memberUses, player) ?? 0, memberLimit: CLAN_WAR_RULES.memberSlotsPerDay },
        queue: ownRoster ? campaign.queue.filter(entry => entry.clan === viewerClan).map(entry => ({ ...entry, players: [...entry.players], heartbeat: {} })) : [],
        enemyQueueCounts: ownRoster ? enemyQueueCounts : {},
        enemyShrineQueueCounts:ownRoster?enemyShrineQueueCounts:{},
        matches: Object.values(campaign.matches).filter(match => [...match.fromPlayers, ...match.toPlayers]
            .some(name => clanWarPlayerKey(name) === player)).map(match => ({ ...match,
                fromPlayers: [...match.fromPlayers], toPlayers: [...match.toPlayers], readyPlayers: [...match.readyPlayers] })),
        contributions: ownRoster ? Object.values(campaign.contributions).filter(entry => entry.clan === viewerClan).map(entry => ({ ...entry })) : [],
        ...(ownContribution?{playerContribution:{...ownContribution}}:{}),
        provisioned:day!==null&&!!clanWarOwnValue(campaign.provisions,viewerClan)?.some(entry=>entry.day===day),
        shrines: campaign.shrines.map(window => ({ index: window.index, opensAt: window.opensAt, closesAt: window.closesAt,
            ...(now >= window.opensAt - locationNotice ? { sector: window.sector } : {}),
            ...(now >= window.opensAt - modeNotice ? { mode: window.mode } : {}),
            state: now < window.opensAt ? 'upcoming' : now < window.closesAt && campaign.closedAt === undefined ? 'open' : 'closed',
            usedMatches: window.usedMatches, matchLimit: CLAN_WAR_RULES.shrineMatches,
            memberUsed: clanWarOwnValue(window.memberUses, player) ?? 0, memberLimit: CLAN_WAR_RULES.shrineMemberMatches })),
    };
}
