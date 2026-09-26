/**
 * Read-only preflight for a staffed Village/Sector War event
 * (docs/CONTROLLED_WAR_EVENT_RUNBOOK.md).
 *
 *   node --import tsx scripts/war-event-preflight.ts --base-url=https://shinobijourney.com --expect-war=on
 *   node --import tsx scripts/war-event-preflight.ts --json --out=war-preflight-before.json
 *   node --import tsx scripts/war-event-preflight.ts --memory      # hermetic self-check
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
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
    findings: PreflightFinding[];
    ready: boolean;
};

export type PreflightOptions = {
    now?: number;
    env?: NodeJS.ProcessEnv;
    baseUrl?: string | null;
    expectWar?: 'on' | 'off' | null;
    fetchImpl?: typeof fetch;
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
        findings,
        ready: !findings.some((finding) => finding.level === 'blocker'),
    };
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
        const { loadProjectEnv } = await import('./_load-env.mjs');
        await loadProjectEnv();
    }
    const expectWar = value('expect-war');
    if (expectWar !== null && expectWar !== 'on' && expectWar !== 'off') throw new Error('--expect-war must be on or off');
    const report = await runWarEventPreflight({ baseUrl: value('base-url'), expectWar });
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
