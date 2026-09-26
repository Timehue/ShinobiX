/**
 * Read-only preflight for a staffed Village/Sector War event
 * (docs/CONTROLLED_WAR_EVENT_RUNBOOK.md).
 *
 *   node --import tsx scripts/war-event-preflight.ts --base-url=https://shinobijourney.com --expect-war=on --plan=war-event-plan.json
 *   node --import tsx scripts/war-event-preflight.ts --json --out=war-preflight-before.json
 *   node --import tsx scripts/war-event-preflight.ts --memory      # hermetic self-check
 *
 * `--plan` names the event: the two villages, the sectors to contest and the
 * participating accounts (see WarEventPlan). The preflight then checks those
 * accounts and sectors too, and reports accounts by ROLE, never by name.
 *
 * It WRITES NOTHING to storage. It never calls a route that settles or scores
 * on read (the sector-war `status` action, GET /world-state and
 * /health?deep=1 all do), and its one HTTP probe of the war route is a body
 * with no player name, which the route refuses before authentication, rate
 * limiting or any storage access: 404 means the war is switched off, 400
 * means it is on.
 *
 * It reads the storage named by the local .env, as scripts/data-integrity-scan
 * does, so production data needs the production .env on the machine that runs
 * it. The report names contests, villages and battle ids, never a player.
 *
 * Exit 0 = no blocker, 1 = at least one blocker, 2 = the preflight itself failed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The staffed event, as the operator plans it. Account values are player
 *  names or slugs; the report refers to them only by role. */
export type WarEventPlan = {
    attackerVillage: string;
    defenderVillage: string;
    sectors: number[];
    accounts: {
        attackerKage: string;
        defenderKage?: string;
        attackerFighters: string[];
        defenderFighters: string[];
    };
};

export type PreflightPlanReport = {
    attackerWarResources: number;
    declarationCost: number;
    sectors: Array<{ sector: number; ownerVillage: string; winCondition: string | null; terrain: string | null; liveContest: string | null }>;
    roles: Array<{ role: string; ok: boolean }>;
};

/** Validate a plan file's contents. Throws with the first problem found. */
export function parseWarEventPlan(raw: unknown): WarEventPlan {
    const fail = (why: string): never => { throw new Error(`Invalid war event plan: ${why}`); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('expected a JSON object');
    const plan = raw as Record<string, unknown>;
    const text = (value: unknown, name: string) => {
        if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`);
        return (value as string).trim();
    };
    const names = (value: unknown, name: string) => {
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) fail(`${name} must be a list of names`);
        return (value as string[]).map((entry) => entry.trim());
    };
    const accounts = plan.accounts as Record<string, unknown> | undefined;
    if (!accounts || typeof accounts !== 'object') fail('accounts is required');
    if (!Array.isArray(plan.sectors) || !plan.sectors.length || plan.sectors.some((s) => !Number.isSafeInteger(s) || (s as number) <= 0)) {
        fail('sectors must be a non-empty list of sector numbers');
    }
    return {
        attackerVillage: text(plan.attackerVillage, 'attackerVillage'),
        defenderVillage: text(plan.defenderVillage, 'defenderVillage'),
        sectors: plan.sectors as number[],
        accounts: {
            attackerKage: text(accounts!.attackerKage, 'accounts.attackerKage'),
            ...(accounts!.defenderKage !== undefined ? { defenderKage: text(accounts!.defenderKage, 'accounts.defenderKage') } : {}),
            attackerFighters: names(accounts!.attackerFighters, 'accounts.attackerFighters'),
            defenderFighters: names(accounts!.defenderFighters, 'accounts.defenderFighters'),
        },
    };
}

export type PreflightLevel = 'blocker' | 'warn' | 'info';
export type PreflightFinding = { level: PreflightLevel; code: string; detail: string };

export type PreflightContest = {
    id: string;
    instance: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: string;
    status: 'active' | 'due' | 'funding' | 'captured' | 'defended' | 'abandoned' | 'pending';
    attackerPoints: number;
    defenderPoints: number;
    startedAt: number;
    endsAt: number;
    receipts: number;
    pendingReceipts: number;
};

export type PreflightReport = {
    at: string;
    eventId: string | null;
    flags: { disableVillageWar: boolean; freezeEconomyRewards: boolean; note: string };
    http: { baseUrl: string; health: number | null; warRoute: 'enabled' | 'disabled' | 'unknown' } | null;
    contests: PreflightContest[];
    tokens: { total: number; wedged: string[] };
    counts: { resolutionReceipts: number; battleReceipts: number; sectorAuditEntries: number };
    plan: PreflightPlanReport | null;
    findings: PreflightFinding[];
    ready: boolean;
};

export type PreflightOptions = {
    now?: number;
    env?: NodeJS.ProcessEnv;
    baseUrl?: string | null;
    expectWar?: 'on' | 'off' | null;
    fetchImpl?: typeof fetch;
    plan?: WarEventPlan | null;
};

const CONTEST_PREFIX = 'shared:sector-war:';
const TOKEN_PREFIX = 'shared:sector-war-token:';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function runWarEventPreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
    const now = options.now ?? Date.now();
    const env = options.env ?? process.env;
    const [{ kv }, war, { villageHasActiveWar }, { warEventId }] = await Promise.all([
        import('../api/_storage.js'),
        import('../api/_sector-war.js'),
        import('../api/world-state.js'),
        import('../api/_war-event-log.js'),
    ]);

    const findings: PreflightFinding[] = [];
    const add = (level: PreflightLevel, code: string, detail: string) => findings.push({ level, code, detail });

    // ── flags (as this machine sees them; the HTTP probe is the live truth) ──
    const flags = {
        disableVillageWar: env.DISABLE_VILLAGE_WAR === '1',
        freezeEconomyRewards: env.FREEZE_ECONOMY_REWARDS === '1',
        note: 'Read from the environment running this script. Railway\'s own values decide; use --base-url to probe them.',
    };
    const eventId = warEventId(env);
    if (!eventId) add('info', 'no-event-id', 'WAR_EVENT_ID is not set here; set it on Railway for the event so every [war-event] line carries it.');

    // ── contests ─────────────────────────────────────────────────────────────
    const contests: PreflightContest[] = [];
    const contestKeys = (await kv.keys(`${CONTEST_PREFIX}*`)).filter((key) => key.startsWith(CONTEST_PREFIX));
    for (const key of contestKeys.sort()) {
        const raw = await kv.get<Record<string, unknown>>(key);
        if (!raw) continue;
        let session;
        try {
            session = war.normalizeSectorWarSession(raw as never);
        } catch (error) {
            add('blocker', 'contest-row-unreadable', `${key}: ${errorText(error)}. Play skips it, but declarations and captures fail closed until it is repaired.`);
            continue;
        }
        if (!session) {
            add('warn', 'contest-row-ignored', `${key}: the normalizer returns nothing for it (no villages), so every scan ignores it.`);
            continue;
        }
        const ledger = war.sectorWarLedgerOf(session);
        const funding = session.declarationFunding?.status === 'funding';
        const active = war.isSectorWarActive(session, now);
        const status: PreflightContest['status'] = funding ? 'funding'
            : active ? 'active'
                : session.flipped ? 'captured'
                    : session.expiredAt ? (session.expiredReason === 'abandoned' ? 'abandoned' : 'defended')
                        : now >= session.endsAt ? 'due'
                            : 'pending';
        contests.push({
            id: session.id,
            instance: war.sectorWarInstanceTag(session),
            sector: session.sector,
            attackerVillage: session.attackerVillage,
            defenderVillage: session.defenderVillage,
            winCondition: session.winCondition,
            status,
            attackerPoints: session.attackerPoints,
            defenderPoints: session.defenderPoints,
            startedAt: session.startedAt,
            endsAt: session.endsAt,
            receipts: ledger.count,
            pendingReceipts: ledger.pending.length,
        });
        if (funding) add('warn', 'declaration-in-flight', `${session.id}: a declaration is still funding; the next declare or poll finishes or aborts it.`);
        if (status === 'due') add('warn', 'war-due-unsettled', `${session.id}: its 72 hours are over; it settles on the next war-map poll or the 03:00 UTC daily pass.`);
        if (ledger.pending.length > 0) add('warn', 'receipt-copies-pending', `${session.id}: ${ledger.pending.length} battle receipt copies are deferred; the next write to the contest finishes them.`);
    }

    const bySector = new Map<number, PreflightContest[]>();
    for (const contest of contests.filter((c) => c.status === 'active' || c.status === 'due')) {
        bySector.set(contest.sector, [...(bySector.get(contest.sector) ?? []), contest]);
    }
    for (const [sector, list] of bySector) {
        if (list.length > 1) add('blocker', 'two-contests-on-sector', `Sector ${sector} has ${list.length} live contests: ${list.map((c) => c.id).join(', ')}.`);
        for (const contest of list) {
            const territory = await kv.get<{ ownerVillage?: string }>(`world:territory:${sector}`);
            const owner = String(territory?.ownerVillage ?? '').trim();
            if (owner !== contest.defenderVillage) {
                add('blocker', 'territory-owner-mismatch', `${contest.id}: sector ${sector} is owned by "${owner || 'nobody'}", not the defender ${contest.defenderVillage}.`);
            }
        }
    }
    const warringVillages = new Set(contests.filter((c) => c.status === 'active').flatMap((c) => [c.attackerVillage, c.defenderVillage]));
    for (const village of warringVillages) {
        if (await villageHasActiveWar(village)) {
            add('blocker', 'village-war-overlap', `${village} is in an all-out village war and a sector war at once.`);
        }
    }

    // ── battle tokens: a token bound to another sector wedges its battle ─────
    const tokenKeys = (await kv.keys(`${TOKEN_PREFIX}*`)).filter((key) => key.startsWith(TOKEN_PREFIX));
    const wedged: string[] = [];
    for (const key of tokenKeys) {
        const battleId = key.slice(TOKEN_PREFIX.length);
        const raw = await kv.get<Record<string, unknown>>(key);
        if (!raw) continue;
        const token = war.normalizeSectorWarBattleToken(raw as never);
        if (!token || token.battleId !== battleId) {
            add('blocker', 'token-unreadable', `${key}: the battle's terminal step will refuse it.`);
            continue;
        }
        const battle = await kv.get<{ rewardSector?: unknown }>(`pvp:${battleId}`);
        if (battle && Math.floor(Number(battle.rewardSector)) !== token.sector) {
            wedged.push(battleId);
            add('blocker', 'wedged-battle', `pvp:${battleId} was fought in sector ${String(battle.rewardSector)} but its token names sector ${token.sector}; its fighters cannot finish or claim until the token expires.`);
        }
    }

    // ── the planned event: villages, sectors and accounts ────────────────────
    let planReport: PreflightPlanReport | null = null;
    if (options.plan) {
        planReport = await checkWarEventPlan(options.plan, contests, add);
    }

    // ── baselines for the event record ───────────────────────────────────────
    const counts = {
        resolutionReceipts: (await kv.keys('shared:sector-war-resolution:*')).length,
        battleReceipts: (await kv.keys('shared:sector-war-battle:*')).length,
        sectorAuditEntries: ((await kv.get<unknown[]>('audit:sector')) ?? []).length,
    };

    // ── the live kill switch ─────────────────────────────────────────────────
    let http: PreflightReport['http'] = null;
    if (options.baseUrl) {
        const base = options.baseUrl.replace(/\/+$/, '');
        const fetchImpl = options.fetchImpl ?? fetch;
        http = { baseUrl: base, health: null, warRoute: 'unknown' };
        try {
            http.health = (await fetchImpl(`${base}/health`)).status;
            if (http.health !== 200) add('blocker', 'health', `${base}/health answered ${http.health}.`);
        } catch (error) {
            add('blocker', 'health', `${base}/health is unreachable: ${errorText(error)}.`);
        }
        try {
            const probe = await fetchImpl(`${base}/api/village/sector-war`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            // Only the route's own refusal counts as "on": a 400 from anything
            // in front of it (a proxy, a body parser) proves nothing.
            const text = await probe.text().catch(() => '');
            http.warRoute = probe.status === 404 ? 'disabled'
                : probe.status === 400 && text.includes('Missing playerName') ? 'enabled'
                    : 'unknown';
            if (http.warRoute === 'unknown') add('warn', 'war-route-unknown', `The war route answered ${probe.status} to the probe.`);
        } catch (error) {
            add('blocker', 'war-route-unreachable', `The war route probe failed: ${errorText(error)}.`);
        }
        if (options.expectWar && http.warRoute !== 'unknown') {
            const expected = options.expectWar === 'on' ? 'enabled' : 'disabled';
            if (http.warRoute !== expected) {
                add('blocker', 'kill-switch-mismatch', `Expected the war to be ${options.expectWar}, but the live route is ${http.warRoute}. Check DISABLE_VILLAGE_WAR on Railway and redeploy.`);
            }
        }
    } else if (options.expectWar) {
        add('warn', 'kill-switch-unprobed', '--expect-war needs --base-url to check the live route.');
    }

    return {
        at: new Date(now).toISOString(),
        eventId,
        flags,
        http,
        contests,
        tokens: { total: tokenKeys.length, wedged },
        counts,
        plan: planReport,
        findings,
        ready: !findings.some((finding) => finding.level === 'blocker'),
    };
}

/**
 * Check the planned event against live state, read-only. Every finding names a
 * role ("attacker fighter 2"), never the account behind it.
 */
async function checkWarEventPlan(
    plan: WarEventPlan,
    contests: PreflightContest[],
    add: (level: PreflightLevel, code: string, detail: string) => void,
): Promise<PreflightPlanReport> {
    const [{ kv }, sectorsModule, warState, { seatedKageOf }, { pvpPendingSessionKey }, { SECTOR_WAR_WR }, { safeName }, war, { villageHasActiveWar }] = await Promise.all([
        import('../api/_storage.js'),
        import('../api/_war-map-sectors.js'),
        import('../api/_war-state.js'),
        import('../api/_sector-war-garrison-defender.js'),
        import('../api/pvp/_pending-session.js'),
        import('../api/_war-economy.js'),
        import('../api/_utils.js'),
        import('../api/_sector-war.js'),
        import('../api/world-state.js'),
    ]);
    const { attackerVillage, defenderVillage } = plan;

    // Villages.
    for (const [side, village] of [['attacking', attackerVillage], ['defending', defenderVillage]] as const) {
        if (!sectorsModule.isWarVillage(village)) add('blocker', 'plan-village-invalid', `The ${side} village "${village}" is not a war village.`);
        else if (await villageHasActiveWar(village)) add('blocker', 'plan-village-at-war', `The ${side} village ${village} is in an all-out village war; it cannot also fight a sector war.`);
    }
    if (attackerVillage === defenderVillage) add('blocker', 'plan-village-invalid', 'The attacking and defending villages are the same.');

    // Sectors.
    const defenderRecord = warState.normalizeVillageWarRecord(defenderVillage, (await kv.get<Record<string, unknown>>(warState.villageWarKey(defenderVillage))) ?? undefined);
    const sectorRows: PreflightPlanReport['sectors'] = [];
    for (const sector of plan.sectors) {
        const territory = await kv.get<{ ownerVillage?: string }>(`world:territory:${sector}`);
        const ownerVillage = String(territory?.ownerVillage ?? '').trim();
        const live = contests.find((c) => c.sector === sector && (c.status === 'active' || c.status === 'funding'));
        const setup = defenderRecord.sectors[String(sector)];
        sectorRows.push({
            sector,
            ownerVillage,
            winCondition: setup?.winCondition ?? null,
            terrain: setup?.terrain ?? null,
            liveContest: live?.id ?? null,
        });
        if (!sectorsModule.isWarSector(sector)) add('blocker', 'plan-sector-invalid', `Sector ${sector} is not a war sector.`);
        else if (sectorsModule.isProtectedWarSector(sector)) add('blocker', 'plan-sector-invalid', `Sector ${sector} is a village gate and cannot be conquered.`);
        if (ownerVillage !== defenderVillage) add('blocker', 'plan-sector-owner', `Sector ${sector} is owned by "${ownerVillage || 'nobody'}", not ${defenderVillage}.`);
        if (live) add('warn', 'plan-sector-contested', `Sector ${sector} already has a live contest (${live.id}); a new declaration there will be refused.`);
        if (!setup) add('warn', 'plan-sector-unconfigured', `${defenderVillage} has no win condition or terrain set for sector ${sector}; it defaults to Combat.`);
    }
    const liveSieges = contests.filter((c) => c.attackerVillage === attackerVillage && c.status === 'active').length;
    if (liveSieges + plan.sectors.length > war.MAX_ACTIVE_ATTACK_SIEGES) {
        add('blocker', 'plan-siege-limit', `${attackerVillage} already attacks ${liveSieges} sector(s); ${plan.sectors.length} more would pass the limit of ${war.MAX_ACTIVE_ATTACK_SIEGES}.`);
    }

    // War Resources. Intel and the comeback discount can lower the real cost,
    // so a shortfall against the base price is a warning, not a blocker.
    const attackerRecord = warState.normalizeVillageWarRecord(attackerVillage, (await kv.get<Record<string, unknown>>(warState.villageWarKey(attackerVillage))) ?? undefined);
    const declarationCost = SECTOR_WAR_WR * plan.sectors.length;
    if (attackerRecord.warResources < declarationCost) {
        add('warn', 'plan-war-resources', `${attackerVillage} holds ${attackerRecord.warResources} War Resources; declaring ${plan.sectors.length} sector(s) costs up to ${declarationCost}.`);
    }

    // Accounts, by role.
    const roles: PreflightPlanReport['roles'] = [];
    const checkAccount = async (role: string, name: string, village: string, requireSeat: 'blocker' | 'warn' | null) => {
        const slug = safeName(name);
        const save = slug ? await kv.get<{ character?: { village?: string } }>(`save:${slug}`) : null;
        let ok = true;
        if (!save?.character) {
            add('blocker', 'plan-account-missing', `The ${role} account does not exist.`);
            ok = false;
        } else {
            if (String(save.character.village ?? '').trim() !== village) {
                add('blocker', 'plan-account-village', `The ${role} account is not in ${village}.`);
                ok = false;
            }
            if (requireSeat && (await seatedKageOf(village)) !== slug) {
                add(requireSeat, 'plan-kage-not-seated', `The ${role} account is not the seated Kage of ${village}.`);
                ok = ok && requireSeat !== 'blocker';
            }
            if (await kv.get(pvpPendingSessionKey(slug))) {
                add('warn', 'plan-account-in-battle', `The ${role} account has a PvP battle in flight; it must finish or lapse before the event.`);
            }
        }
        roles.push({ role, ok });
    };
    await checkAccount('attacker Kage', plan.accounts.attackerKage, attackerVillage, 'blocker');
    if (plan.accounts.defenderKage) await checkAccount('defender Kage', plan.accounts.defenderKage, defenderVillage, 'warn');
    for (const [index, name] of plan.accounts.attackerFighters.entries()) await checkAccount(`attacker fighter ${index + 1}`, name, attackerVillage, null);
    for (const [index, name] of plan.accounts.defenderFighters.entries()) await checkAccount(`defender fighter ${index + 1}`, name, defenderVillage, null);
    for (const [side, list] of [['attacking', plan.accounts.attackerFighters], ['defending', plan.accounts.defenderFighters]] as const) {
        if (list.length < 2) add('warn', 'plan-too-few-fighters', `The ${side} side has ${list.length} fighter(s); the runbook calls for at least two.`);
    }

    return { attackerWarResources: attackerRecord.warResources, declarationCost, sectors: sectorRows, roles };
}

export function formatPreflightReport(report: PreflightReport): string {
    const lines = [
        `War event preflight at ${report.at}${report.eventId ? ` (event ${report.eventId})` : ''}`,
        `Local flags: DISABLE_VILLAGE_WAR=${report.flags.disableVillageWar ? '1' : 'unset'}, FREEZE_ECONOMY_REWARDS=${report.flags.freezeEconomyRewards ? '1' : 'unset'} (${report.flags.note})`,
    ];
    if (report.http) lines.push(`Live: ${report.http.baseUrl} health=${report.http.health ?? 'unreachable'} war route=${report.http.warRoute}`);
    lines.push(`Contests: ${report.contests.length}`);
    for (const c of report.contests) {
        lines.push(`  ${c.status.padEnd(9)} ${c.id} [${c.instance}] ${c.winCondition} ${c.attackerPoints}:${c.defenderPoints} ends ${new Date(c.endsAt).toISOString()} receipts=${c.receipts}${c.pendingReceipts ? ` pending=${c.pendingReceipts}` : ''}`);
    }
    lines.push(`Battle tokens: ${report.tokens.total} (${report.tokens.wedged.length} wedged)`);
    if (report.plan) {
        lines.push(`Plan: War Resources ${report.plan.attackerWarResources} (declarations cost up to ${report.plan.declarationCost})`);
        for (const s of report.plan.sectors) {
            lines.push(`  sector ${s.sector}: owner ${s.ownerVillage || 'nobody'}, ${s.winCondition ?? 'combat (default)'}, terrain ${s.terrain ?? 'none'}${s.liveContest ? `, live contest ${s.liveContest}` : ''}`);
        }
        lines.push(`  accounts: ${report.plan.roles.map((r) => `${r.role} ${r.ok ? 'ok' : 'NOT OK'}`).join('; ')}`);
    }
    lines.push(`Receipts: ${report.counts.resolutionReceipts} resolutions, ${report.counts.battleReceipts} battle copies; audit:sector entries: ${report.counts.sectorAuditEntries}`);
    for (const f of report.findings) lines.push(`  [${f.level.toUpperCase()}] ${f.code}: ${f.detail}`);
    lines.push(report.ready ? 'RESULT: no blocker found.' : 'RESULT: BLOCKED — resolve every blocker above before the event.');
    return lines.join('\n');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
    const memory = args.includes('--memory');
    if (memory) {
        process.env.NODE_ENV = 'test';
        process.env.SHINOBIX_QA_MEMORY_KV = '1';
    } else {
        // A plain-JS helper shared with the .mjs ops scripts, typed here by hand.
        const envHelper = './_load-env.mjs';
        const { loadProjectEnv } = await import(envHelper) as { loadProjectEnv: () => Promise<boolean> };
        await loadProjectEnv();
    }
    const expectWar = value('expect-war');
    if (expectWar !== null && expectWar !== 'on' && expectWar !== 'off') throw new Error('--expect-war must be on or off');
    const planPath = value('plan');
    const plan = planPath ? parseWarEventPlan(JSON.parse(readFileSync(planPath, 'utf8'))) : null;
    const report = await runWarEventPreflight({ baseUrl: value('base-url'), expectWar, plan });
    const out = value('out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatPreflightReport(report));
    process.exitCode = report.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`War event preflight failed: ${errorText(error)}`);
        process.exitCode = 2;
    });
}
