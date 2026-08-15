/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useCallback, useEffect } from "react";
import { starterJutsus } from "../data/jutsu";
import { starterItems } from "../data/starter-items";
import { shinobiTileCards } from "../data/tile-cards";
import {
    PUBLIC_CAPABILITY_IDS,
    type PublicCapabilityId,
    type PublicCapabilityReason,
    type PublicCapabilityState,
    type PublicCapabilities,
    type PublicCapabilitiesResponse,
} from "../../../shared/public-capabilities";

// ─── Admin Diagnostics Panel ──────────────────────────────────────────────────
// Read-only operations/observability surface backing the reliability work:
//   • Battle receipts — paste a battleId, see the durable record (fighters,
//     winner, rounds, settlement, final log) for support / reward-dispute triage.
//   • Asset report — registry metadata + duplicates + hidden, cross-referenced
//     against the built-in catalogs to surface missing images + missing metadata.
//   • Audit log — per-domain action trail (content edits, rewards, sectors).
// Everything here only READS server diagnostics; it never mutates game state.

type BattleReceiptFighter = { name: string; hp: number; maxHp: number; finalStatuses: Array<{ name: string; rounds: number }> };
type BattleSettlement = { settledAt?: number; winnerRyo?: number; winnerXp?: number; ratingDelta?: number; vanguardSeals?: number; vanguardXp?: number; note?: string };
type BattleReceipt = {
    battleId: string; ranked: boolean; rankedKind?: string;
    startedAt: number; endedAt: number; rounds: number;
    p1: BattleReceiptFighter; p2: BattleReceiptFighter;
    winner: "p1" | "p2" | "draw" | null; fleedBy?: "p1" | "p2";
    p1Rating?: number; p2Rating?: number; log: string[]; settlement?: BattleSettlement;
};

type AssetMeta = {
    id: string; category: string; type: string; format: string; bytes: number;
    contentHash: string; createdBy: string; createdAt: number; updatedAt: number;
    hidden: boolean; tags: string[]; frames?: number; animSpeed?: number; sourceNote?: string;
};
type AssetReport = {
    total: number; byCategory: Record<string, number>;
    duplicates: Array<{ contentHash: string; ids: string[] }>;
    hidden: string[]; assets: AssetMeta[];
};

type AuditEntry = {
    ts: number; actor: string; domain: string; action: string;
    entityType?: string; entityId?: string; before?: unknown; after?: unknown;
    reason?: string; meta?: Record<string, unknown>;
};
type AuditDomain = "content" | "reward" | "sector" | "combat" | "legacy";
type DiagnosticsSection = "capabilities" | "assets" | "receipts" | "audit" | "economy" | "beta" | "operations" | "index";
type RuntimeCapabilityRow = {
    modeId: string;
    label: string;
    capabilityIds: readonly PublicCapabilityId[];
    blockingCapabilityId: PublicCapabilityId | null;
    state: PublicCapabilityState;
    reason: PublicCapabilityReason;
};
type RuntimeCapabilityProjection = {
    capabilities: PublicCapabilities;
    runtimeModes: readonly RuntimeCapabilityRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicCapabilityId(value: unknown): value is PublicCapabilityId {
    return typeof value === "string" && (PUBLIC_CAPABILITY_IDS as readonly string[]).includes(value);
}

function validCapabilityState(state: unknown, reason: unknown): boolean {
    return (state === "available" && reason === "available")
        || (state === "actions-paused" && reason === "operations-paused")
        || (state === "temporarily-unavailable" && (
            reason === "maintenance" || reason === "temporarily-disabled" || reason === "configuration-unavailable"
        ));
}

function parseRuntimeCapabilityProjection(value: unknown): RuntimeCapabilityProjection | null {
    if (!isRecord(value) || value.ok !== true || !isRecord(value.capabilities) || !Array.isArray(value.runtimeModes)) return null;
    const capabilities = value.capabilities;
    const runtimeModes = value.runtimeModes;
    if (!PUBLIC_CAPABILITY_IDS.every((id) => {
        const capability = capabilities[id];
        return isRecord(capability) && validCapabilityState(capability.state, capability.reason);
    })) return null;
    if (!runtimeModes.every((row) => isRecord(row)
        && typeof row.modeId === "string"
        && typeof row.label === "string"
        && Array.isArray(row.capabilityIds)
        && row.capabilityIds.every(isPublicCapabilityId)
        && (row.blockingCapabilityId === null || isPublicCapabilityId(row.blockingCapabilityId))
        && validCapabilityState(row.state, row.reason))) return null;
    return {
        capabilities: capabilities as PublicCapabilities,
        runtimeModes: runtimeModes as RuntimeCapabilityRow[],
    };
}

type PlayerIndexHealth = {
    version: number;
    generatedAt: number;
    totalRegistryEntries: number;
    publicRegistryEntries: number;
    validEntries: number;
    malformedEntries: number;
    staleEntries: number;
    oldVersionEntries: number;
    missingFieldEntries: number;
    nonPublicEntries: number;
    adminEntries: number;
    clanEntries: number;
    emptyNameEntries: number;
    oldestLastSeen: number;
    newestLastSeen: number;
    scannedSaves: boolean;
    saveKeyCount?: number;
    missingRegistryCount?: number;
    orphanRegistryCount?: number;
    missingRegistryKeys: string[];
    orphanRegistryKeys: string[];
    sampleMalformed: string[];
    sampleStale: string[];
    sampleNonPublic: string[];
    sampleMissingFields: Array<{ key: string; fields: string[] }>;
};

type BetaMetricDay = {
    date: string;
    updatedAt: number;
    events: Record<string, number>;
    levelBands: Record<string, number>;
    sources: Record<string, number>;
    rewardTotals: Record<string, number>;
};
type BetaMetricsSnapshot = {
    generatedAt: number;
    days: number;
    daily: BetaMetricDay[];
    totals: {
        events: Record<string, number>;
        levelBands: Record<string, number>;
        sources: Record<string, number>;
        rewardTotals: Record<string, number>;
    };
};

type ClanBossOperationRow = {
    partyId: string;
    status: string;
    memberCount: number;
    readyCount: number;
    visibility: string;
    version: number;
    ageBucket: string;
    hasRunId: boolean;
    missingSession: boolean;
    staleMembers: number;
};
type ClanBossOperationsSnapshot = {
    generatedAt: number;
    feature: { clanBossEnabled: boolean; partiesEnabled: boolean };
    totals: {
        scope?: "all" | "page";
        registryTotal?: number;
        parties: number;
        byStatus: Record<string, number>;
        publicQueued: number;
        missingSessions: number;
        staleMembers: number;
    };
    page?: {
        cursor: string | null;
        nextCursor: string | null;
        limit: number;
        returned: number;
        registryTotal: number;
        legacyFallback: boolean;
    };
    parties: ClanBossOperationRow[];
};

// Built-in catalogs whose stored image id is `<cat>:<entityId>`. Cross-referenced
// against what's actually in storage to find catalog entries with no image.
// (Player-created creator content isn't in these static lists — noted in the UI.)
const CATALOG_SPECS = [
    { cat: "jutsu", label: "Jutsu", ids: starterJutsus.map((j) => j.id) },
    { cat: "item", label: "Items", ids: starterItems.map((i) => i.id) },
    { cat: "card", label: "Cards", ids: shinobiTileCards.map((c) => c.id) },
];

function fmtTime(ts: number): string {
    if (!ts) return "—";
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

const box: React.CSSProperties = { background: "#1a1a22", border: "1px solid #333", borderRadius: 8, padding: 12, marginTop: 12 };
const pill: React.CSSProperties = { display: "inline-block", background: "#2a2a36", borderRadius: 6, padding: "2px 8px", margin: "2px 4px 2px 0", fontSize: "0.8rem" };
const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: "0.82rem" };

export function AdminDiagnosticsPanel({ adminPw }: { adminPw: string }) {
    const [section, setSection] = useState<DiagnosticsSection>("capabilities");

    // Exact current server projection. One authenticated no-store response owns
    // both public states and the matrix derived from that same point-in-time state.
    const [capabilityResponse, setCapabilityResponse] = useState<PublicCapabilitiesResponse | null>(null);
    const [runtimeCapabilityRows, setRuntimeCapabilityRows] = useState<readonly RuntimeCapabilityRow[]>([]);
    const [capabilityStatus, setCapabilityStatus] = useState("");
    const loadCapabilities = useCallback(async () => {
        setCapabilityResponse(null);
        setRuntimeCapabilityRows([]);
        setCapabilityStatus("Loading...");
        try {
            const response = await fetch("/api/admin/runtime-mode-capabilities", {
                cache: "no-store",
                headers: { Accept: "application/json", "x-admin-password": adminPw },
            });
            const data: unknown = await response.json();
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const projection = parseRuntimeCapabilityProjection(data);
            if (!projection) throw new Error("Invalid runtime capability projection");
            setCapabilityResponse(Object.freeze({ ok: true, capabilities: projection.capabilities }));
            setRuntimeCapabilityRows(projection.runtimeModes);
            setCapabilityStatus("");
        } catch (error) {
            setCapabilityResponse(null);
            setRuntimeCapabilityRows([]);
            setCapabilityStatus(`X ${(error as Error).message}`);
        }
    }, [adminPw]);
    useEffect(() => { if (section === "capabilities") void loadCapabilities(); }, [section, loadCapabilities]);

    // ── Battle receipts ──────────────────────────────────────────────────────
    const [battleId, setBattleId] = useState("");
    const [receipt, setReceipt] = useState<BattleReceipt | null>(null);
    const [receiptStatus, setReceiptStatus] = useState("");

    async function lookupReceipt() {
        const id = battleId.trim();
        if (!id) { setReceiptStatus("Enter a battleId."); return; }
        setReceipt(null); setReceiptStatus("Loading…");
        try {
            const r = await fetch(`/api/admin/battle-receipts?battleId=${encodeURIComponent(id)}`, { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setReceipt(data.receipt as BattleReceipt);
            setReceiptStatus("");
        } catch (e) {
            setReceiptStatus(`❌ ${(e as Error).message}`);
        }
    }

    // ── Asset report ─────────────────────────────────────────────────────────
    const [report, setReport] = useState<AssetReport | null>(null);
    const [missingImages, setMissingImages] = useState<Array<{ cat: string; label: string; missing: string[] }>>([]);
    const [missingMeta, setMissingMeta] = useState<string[]>([]);
    const [assetStatus, setAssetStatus] = useState("");

    const loadAssets = useCallback(async () => {
        if (!adminPw) return;
        setAssetStatus("Loading…");
        try {
            const r = await fetch("/api/admin/asset-report", { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            const rep = data as AssetReport;
            setReport(rep);

            // Public image manifests (id lists) per built-in catalog.
            const manifests = await Promise.all(
                CATALOG_SPECS.map((s) =>
                    fetch(`/api/images?cat=${s.cat}&ids=1`).then((res) => (res.ok ? res.json() : [])).catch(() => [])),
            );
            const storedByCat: Record<string, Set<string>> = {};
            CATALOG_SPECS.forEach((s, i) => { storedByCat[s.cat] = new Set(Array.isArray(manifests[i]) ? manifests[i] : []); });

            setMissingImages(CATALOG_SPECS.map((s) => ({
                cat: s.cat, label: s.label,
                missing: s.ids.filter((id) => !storedByCat[s.cat].has(`${s.cat}:${id}`)),
            })));

            const metaIds = new Set(rep.assets.map((a) => a.id));
            const allStored = new Set<string>();
            Object.values(storedByCat).forEach((set) => set.forEach((id) => allStored.add(id)));
            setMissingMeta([...allStored].filter((id) => !metaIds.has(id)));
            setAssetStatus("");
        } catch (e) {
            setAssetStatus(`❌ ${(e as Error).message}`);
        }
    }, [adminPw]);

    useEffect(() => { if (section === "assets") void loadAssets(); }, [section, loadAssets]);

    // ── Audit log ────────────────────────────────────────────────────────────
    const [auditDomain, setAuditDomain] = useState<AuditDomain>("content");
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
    const [auditStatus, setAuditStatus] = useState("");

    const loadAudit = useCallback(async (domain: AuditDomain) => {
        if (!adminPw) return;
        setAuditStatus("Loading…");
        try {
            const r = await fetch(`/api/admin/audit-log?domain=${domain}&limit=200`, { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setAuditEntries(Array.isArray(data.entries) ? data.entries : []);
            setAuditStatus("");
        } catch (e) {
            setAuditStatus(`❌ ${(e as Error).message}`);
        }
    }, [adminPw]);

    useEffect(() => { if (section === "audit") void loadAudit(auditDomain); }, [section, auditDomain, loadAudit]);

    // Economy telemetry (faucet/sink aggregates + recent currency deltas).
    type EconSnap = {
        aggregates: Record<string, { created: number; destroyed: number; net: number }>;
        recent: Array<{ ts: number; player: string; currency: string; delta: number; source: string }>;
        duplicateTxnIds: string[];
        economyTx: {
            recent: EconomyTxRecord[];
            stuck: EconomyTxRecord[];
        };
    };
    type EconomyTxRecord = {
        id: string;
        kind: string;
        state: "reserved" | "debit-applied" | "credit-applied" | "complete" | "needs-reconcile";
        debitKey: string;
        creditKey: string;
        resource: string;
        amount: number;
        createdAt: number;
        updatedAt: number;
        completedAt?: number;
        error?: string;
        note?: string;
    };
    const [econ, setEcon] = useState<EconSnap | null>(null);
    const [econStatus, setEconStatus] = useState("");
    const [reconcileStatus, setReconcileStatus] = useState("");
    const [reconcilingTxId, setReconcilingTxId] = useState("");
    const loadEconomy = useCallback(async () => {
        if (!adminPw) return;
        setEconStatus("Loading…");
        try {
            const r = await fetch("/api/admin/economy?limit=200", { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setEcon({
                aggregates: data.aggregates ?? {},
                recent: Array.isArray(data.recent) ? data.recent : [],
                duplicateTxnIds: Array.isArray(data.duplicateTxnIds) ? data.duplicateTxnIds : [],
                economyTx: {
                    recent: Array.isArray(data.economyTx?.recent) ? data.economyTx.recent : [],
                    stuck: Array.isArray(data.economyTx?.stuck) ? data.economyTx.stuck : [],
                },
            });
            setEconStatus("");
        } catch (e) {
            setEconStatus(`❌ ${(e as Error).message}`);
        }
    }, [adminPw]);
    useEffect(() => { if (section === "economy") void loadEconomy(); }, [section, loadEconomy]);

    const reconcileEconomyTx = useCallback(async (txId: string) => {
        if (!adminPw) {
            setReconcileStatus("Admin password missing.");
            return;
        }
        setReconcilingTxId(txId);
        setReconcileStatus(`Reconciling ${txId}...`);
        try {
            const r = await fetch("/api/admin/economy-reconcile", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({ txId }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            const credited = Number(data.credited ?? 0);
            setReconcileStatus(data.alreadyComplete
                ? `Already complete: ${txId}`
                : `Reconciled ${txId}${credited ? ` (+${credited.toLocaleString()} ${String(data.tx?.resource ?? "")})` : ""}`);
            await loadEconomy();
        } catch (e) {
            setReconcileStatus(`X ${(e as Error).message}`);
        } finally {
            setReconcilingTxId("");
        }
    }, [adminPw, loadEconomy]);

    // Beta readiness telemetry (new accounts, onboarding claims, reward flow).
    const [betaDays, setBetaDays] = useState(14);
    const [betaMetrics, setBetaMetrics] = useState<BetaMetricsSnapshot | null>(null);
    const [betaStatus, setBetaStatus] = useState("");
    const loadBetaMetrics = useCallback(async () => {
        if (!adminPw) return;
        setBetaStatus("Loading...");
        try {
            const r = await fetch(`/api/admin/beta-metrics?days=${betaDays}`, { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setBetaMetrics({
                generatedAt: Number(data.generatedAt ?? 0),
                days: Number(data.days ?? betaDays),
                daily: Array.isArray(data.daily) ? data.daily : [],
                totals: {
                    events: data.totals?.events ?? {},
                    levelBands: data.totals?.levelBands ?? {},
                    sources: data.totals?.sources ?? {},
                    rewardTotals: data.totals?.rewardTotals ?? {},
                },
            });
            setBetaStatus("");
        } catch (e) {
            setBetaStatus(`X ${(e as Error).message}`);
        }
    }, [adminPw, betaDays]);
    useEffect(() => { if (section === "beta") void loadBetaMetrics(); }, [section, loadBetaMetrics]);

    // Clan Boss operation health and narrowly scoped pre-start recovery.
    const [operations, setOperations] = useState<ClanBossOperationsSnapshot | null>(null);
    const [operationsStatus, setOperationsStatus] = useState("");
    const [operationsCursor, setOperationsCursor] = useState<string | null>(null);
    const [recoveryReason, setRecoveryReason] = useState("session-missing");
    const [recoveringPartyId, setRecoveringPartyId] = useState("");
    const loadOperations = useCallback(async () => {
        if (!adminPw) return;
        setOperationsStatus("Loading...");
        try {
            const params = new URLSearchParams({ limit: "100" });
            if (operationsCursor) params.set("cursor", operationsCursor);
            const r = await fetch(`/api/admin/clan-boss-operations?${params}`, { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setOperations(data as ClanBossOperationsSnapshot);
            setOperationsStatus("");
        } catch (e) {
            setOperationsStatus(`X ${(e as Error).message}`);
        }
    }, [adminPw, operationsCursor]);
    useEffect(() => { if (section === "operations") void loadOperations(); }, [section, loadOperations]);

    const recoverOperation = useCallback(async (party: ClanBossOperationRow) => {
        if (!adminPw || !window.confirm(`Disband ${party.partyId} at version ${party.version}? This cannot recover an active combat session.`)) return;
        setRecoveringPartyId(party.partyId);
        setOperationsStatus(`Recovering ${party.partyId}...`);
        try {
            const r = await fetch("/api/admin/clan-boss-operations", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({
                    action: "recover-disband",
                    partyId: party.partyId,
                    expectedVersion: party.version,
                    reason: recoveryReason,
                    confirm: true,
                }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            await loadOperations();
            setOperationsStatus(`Recovered ${party.partyId}; audit entry recorded.`);
        } catch (e) {
            setOperationsStatus(`X ${(e as Error).message}`);
        } finally {
            setRecoveringPartyId("");
        }
    }, [adminPw, loadOperations, recoveryReason]);

    // Public player index health.
    const [indexHealth, setIndexHealth] = useState<PlayerIndexHealth | null>(null);
    const [indexStatus, setIndexStatus] = useState("");
    const [indexScan, setIndexScan] = useState(false);
    const [indexBackfilled, setIndexBackfilled] = useState(0);
    const [indexStaleBeforeBackfill, setIndexStaleBeforeBackfill] = useState(0);

    const loadIndexHealth = useCallback(async (scan = indexScan) => {
        if (!adminPw) return;
        setIndexStatus("Loading...");
        try {
            const url = scan ? "/api/admin/player-index-health?scan=1" : "/api/admin/player-index-health";
            const r = await fetch(url, { headers: { "x-admin-password": adminPw } });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            if (!data.health) throw new Error("Missing index health payload");
            setIndexHealth(data.health as PlayerIndexHealth);
            setIndexBackfilled(Number(data.backfilled ?? 0));
            setIndexStaleBeforeBackfill(Number(data.staleBeforeBackfill ?? 0));
            setIndexStatus("");
        } catch (e) {
            setIndexStatus(`X ${(e as Error).message}`);
        }
    }, [adminPw, indexScan]);
    useEffect(() => { if (section === "index") void loadIndexHealth(indexScan); }, [section, indexScan, loadIndexHealth]);

    const betaCount = (key: string): number => betaMetrics?.totals.events[key] ?? 0;
    const betaTopEntries = (values: Record<string, number>, limit = 12): Array<[string, number]> =>
        Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, limit);
    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div>
            <h3>🛠️ Diagnostics</h3>
            <p style={{ color: "#9aa", fontSize: "0.85rem", marginTop: 0 }}>
                Read-only operations tools — public capabilities, assets, battle receipts, audit log, economy, beta telemetry, and player index health.
            </p>
            <div className="admin-diagnostics-tabs" role="tablist" aria-label="Diagnostics sections">
                {(["capabilities", "assets", "receipts", "audit", "economy", "beta", "operations", "index"] as const).map((s) => (
                    <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
                        {s === "capabilities" ? "Capabilities" : s === "assets" ? "Assets" : s === "receipts" ? "Battle Receipts" : s === "audit" ? "Audit Log" : s === "economy" ? "Economy" : s === "beta" ? "Beta" : s === "operations" ? "Clan Boss" : "Player Index"}
                    </button>
                ))}
            </div>

            {section === "capabilities" && (
                <div>
                    <button type="button" onClick={() => void loadCapabilities()}>Refresh capability projection</button>
                    {capabilityStatus && <span style={{ marginLeft: 8, color: "#f88" }}>{capabilityStatus}</span>}
                    {!capabilityResponse && !capabilityStatus && (
                        <p style={{ color: "#9aa" }}>Opening this section reads a no-store server projection of current public capability truth.</p>
                    )}
                    {capabilityResponse && (
                        <>
                            <div style={{ ...box, overflowX: "auto" }}>
                                <strong>Exact current public capability projection</strong>
                                <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", ...mono }}>
                                    <thead><tr><th align="left">Capability</th><th align="left">State</th><th align="left">Reason</th></tr></thead>
                                    <tbody>
                                        {PUBLIC_CAPABILITY_IDS.map((id) => {
                                            const capability = capabilityResponse.capabilities[id];
                                            return (
                                                <tr key={id}>
                                                    <td>{id}</td>
                                                    <td>{capability.state}</td>
                                                    <td>{capability.reason}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{ ...box, overflowX: "auto" }}>
                                <strong>Executable runtime-mode admission matrix</strong>
                                <p style={{ color: "#9aa", fontSize: "0.78rem", margin: "4px 0" }}>
                                    Effective state is projected server-side from the executable registry and the same canonical public capability source.
                                </p>
                                <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", ...mono }}>
                                    <thead><tr><th align="left">Mode</th><th align="left">Admission gates</th><th align="left">Effective state</th><th align="left">Reason</th></tr></thead>
                                    <tbody>
                                        {runtimeCapabilityRows.map((row) => (
                                            <tr key={row.modeId}>
                                                <td>{row.label} <small>({row.modeId})</small></td>
                                                <td>{row.capabilityIds.join(", ")}</td>
                                                <td>{row.state}{row.blockingCapabilityId ? ` (${row.blockingCapabilityId})` : ""}</td>
                                                <td>{row.reason}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}

            {section === "assets" && (
                <div>
                    <button onClick={() => void loadAssets()} disabled={!adminPw}>↻ Refresh</button>
                    {assetStatus && <span style={{ marginLeft: 8, color: "#f88" }}>{assetStatus}</span>}
                    {report && (
                        <>
                            <div style={box}>
                                <strong>Registry: {report.total} assets</strong>
                                <div style={{ marginTop: 6 }}>
                                    {Object.entries(report.byCategory).sort().map(([cat, n]) => (
                                        <span key={cat} style={pill}>{cat}: {n}</span>
                                    ))}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Missing images (built-in catalogs)</strong>
                                <p style={{ color: "#9aa", fontSize: "0.78rem", margin: "4px 0" }}>
                                    Catalog entries with no stored image. Player-created creator content isn't cross-referenced here.
                                </p>
                                {missingImages.map((m) => (
                                    <div key={m.cat} style={{ marginTop: 6 }}>
                                        <div>{m.label}: {m.missing.length === 0 ? "✅ all present" : `⚠ ${m.missing.length} missing`}</div>
                                        {m.missing.length > 0 && (
                                            <div style={{ ...mono, color: "#caa", maxHeight: 120, overflow: "auto" }}>
                                                {m.missing.map((id) => <span key={id} style={pill}>{id}</span>)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div style={box}>
                                <strong>Duplicate assets: {report.duplicates.length}</strong>
                                {report.duplicates.map((d) => (
                                    <div key={d.contentHash} style={{ ...mono, marginTop: 6 }}>
                                        <span style={{ color: "#9aa" }}>{d.contentHash.slice(0, 12)}…</span>{" "}
                                        {d.ids.map((id) => <span key={id} style={pill}>{id}</span>)}
                                    </div>
                                ))}
                            </div>

                            <div style={box}>
                                <strong>Hidden / inactive: {report.hidden.length}</strong>
                                <div style={{ ...mono, marginTop: 6 }}>
                                    {report.hidden.map((id) => <span key={id} style={pill}>{id}</span>)}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Stored images without registry metadata: {missingMeta.length}</strong>
                                <p style={{ color: "#9aa", fontSize: "0.78rem", margin: "4px 0" }}>
                                    These existed before the registry shipped. Run <code>scripts/backfill-asset-meta.mjs</code> to populate.
                                </p>
                                <div style={{ ...mono, maxHeight: 120, overflow: "auto" }}>
                                    {missingMeta.slice(0, 200).map((id) => <span key={id} style={pill}>{id}</span>)}
                                    {missingMeta.length > 200 && <span style={{ color: "#9aa" }}>… +{missingMeta.length - 200} more</span>}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {section === "receipts" && (
                <div>
                    <div className="admin-receipt-lookup">
                        <input
                            value={battleId}
                            onChange={(e) => setBattleId(e.target.value)}
                            placeholder="battleId (UUID)"
                            style={{ flex: 1, ...mono }}
                            onKeyDown={(e) => { if (e.key === "Enter") void lookupReceipt(); }}
                        />
                        <button onClick={() => void lookupReceipt()} disabled={!adminPw}>Look up</button>
                    </div>
                    {receiptStatus && <div style={{ color: "#f88", marginTop: 6 }}>{receiptStatus}</div>}
                    {receipt && (
                        <div style={box}>
                            <div><strong>{receipt.p1.name}</strong> vs <strong>{receipt.p2.name}</strong></div>
                            <div style={{ marginTop: 4 }}>
                                <span style={pill}>winner: {receipt.winner ?? "—"}</span>
                                <span style={pill}>rounds: {receipt.rounds}</span>
                                {receipt.ranked && <span style={pill}>ranked {receipt.rankedKind}</span>}
                                {receipt.fleedBy && <span style={pill}>fled: {receipt.fleedBy}</span>}
                            </div>
                            <div style={{ marginTop: 4, color: "#9aa", fontSize: "0.8rem" }}>
                                {fmtTime(receipt.startedAt)} → {fmtTime(receipt.endedAt)}
                            </div>
                            <div style={{ marginTop: 6 }}>
                                <span style={pill}>{receipt.p1.name}: {receipt.p1.hp}/{receipt.p1.maxHp} HP</span>
                                <span style={pill}>{receipt.p2.name}: {receipt.p2.hp}/{receipt.p2.maxHp} HP</span>
                            </div>
                            {receipt.settlement && (
                                <div style={{ marginTop: 6 }}>
                                    <strong>Settlement</strong>{" "}
                                    {receipt.settlement.ratingDelta !== undefined && <span style={pill}>Δrating: {receipt.settlement.ratingDelta}</span>}
                                    {receipt.settlement.winnerRyo !== undefined && <span style={pill}>ryo: {receipt.settlement.winnerRyo}</span>}
                                    {receipt.settlement.winnerXp !== undefined && <span style={pill}>xp: {receipt.settlement.winnerXp}</span>}
                                    {receipt.settlement.note && <span style={pill}>{receipt.settlement.note}</span>}
                                    <span style={{ color: "#9aa", fontSize: "0.78rem", marginLeft: 6 }}>{fmtTime(receipt.settlement.settledAt ?? 0)}</span>
                                </div>
                            )}
                            <div style={{ marginTop: 8 }}>
                                <strong>Combat log</strong>
                                <div style={{ ...mono, background: "#0e0e14", borderRadius: 6, padding: 8, marginTop: 4, maxHeight: 240, overflow: "auto" }}>
                                    {receipt.log.map((line, i) => <div key={i}>{line}</div>)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {section === "audit" && (
                <div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <label>Domain:</label>
                        <select value={auditDomain} onChange={(e) => setAuditDomain(e.target.value as AuditDomain)}>
                            <option value="content">content</option>
                            <option value="reward">reward</option>
                            <option value="sector">sector</option>
                            <option value="combat">combat</option>
                            <option value="legacy">legacy</option>
                        </select>
                        <button onClick={() => void loadAudit(auditDomain)} disabled={!adminPw}>↻ Refresh</button>
                        {auditStatus && <span style={{ color: "#f88" }}>{auditStatus}</span>}
                    </div>
                    <div style={box}>
                        {auditEntries.length === 0 && <span style={{ color: "#9aa" }}>No entries.</span>}
                        {auditEntries.map((e, i) => (
                            <div key={i} style={{ borderBottom: "1px solid #2a2a36", padding: "4px 0", ...mono }}>
                                <span style={{ color: "#9aa" }}>{fmtTime(e.ts)}</span>{" "}
                                <span style={{ color: "#8cf" }}>{e.actor}</span>{" "}
                                <strong>{e.action}</strong>{" "}
                                {e.entityType && <span>{e.entityType}:{e.entityId}</span>}
                                {e.reason && <span style={{ color: "#caa" }}> — {e.reason}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {section === "economy" && (
                <div>
                    <button onClick={() => void loadEconomy()} disabled={!adminPw}>↻ Refresh</button>
                    {econStatus && <span style={{ marginLeft: 8, color: "#f88" }}>{econStatus}</span>}
                    {econ && (
                        <>
                            <div style={box}>
                                <strong>Supply per currency (created − destroyed)</strong>
                                {Object.keys(econ.aggregates).length === 0 && <span style={{ color: "#9aa" }}> — no transactions logged yet.</span>}
                                {Object.entries(econ.aggregates).map(([cur, a]) => (
                                    <div key={cur} style={{ marginTop: 4 }}>
                                        <strong style={{ textTransform: "capitalize" }}>{cur}</strong>{" "}
                                        <span style={pill}>net {a.net.toLocaleString()}</span>
                                        <span style={{ ...pill, color: "#7d7" }}>+{a.created.toLocaleString()} created</span>
                                        <span style={{ ...pill, color: "#e88" }}>−{a.destroyed.toLocaleString()} destroyed</span>
                                    </div>
                                ))}
                            </div>
                            <div style={{ ...box, borderColor: econ.economyTx.stuck.length > 0 ? "#a63" : "#333" }}>
                                <strong>Transaction outbox</strong>
                                <span style={{ color: "#9aa", marginLeft: 6 }}>
                                    {econ.economyTx.stuck.length === 0
                                        ? "clear"
                                        : `${econ.economyTx.stuck.length} needs attention`}
                                </span>
                                {reconcileStatus && <div style={{ color: reconcileStatus.startsWith("X ") ? "#f88" : "#9fd", marginTop: 6 }}>{reconcileStatus}</div>}
                                {econ.economyTx.stuck.length > 0 && (
                                    <div style={{ maxHeight: 260, overflow: "auto", marginTop: 6 }}>
                                        {econ.economyTx.stuck.map((tx) => {
                                            const canReconcile = tx.state === "needs-reconcile" && tx.kind === "clan-territory-collect-supply" && tx.resource === "warSupply";
                                            return (
                                                <div key={tx.id} style={{ borderBottom: "1px solid #2a2a36", padding: "6px 0", ...mono }}>
                                                    <div>
                                                        <span style={pill}>{tx.state}</span>
                                                        <span style={pill}>{tx.kind}</span>
                                                        <span style={pill}>{tx.amount.toLocaleString()} {tx.resource}</span>
                                                        <span style={{ color: "#9aa" }}>{fmtTime(tx.updatedAt)}</span>
                                                    </div>
                                                    <div style={{ marginTop: 4 }}>
                                                        <span style={{ color: "#8cf" }}>{tx.id}</span>
                                                        {tx.error && <span style={{ color: "#f99", marginLeft: 8 }}>{tx.error}</span>}
                                                    </div>
                                                    <div style={{ marginTop: 4, color: "#9aa" }}>
                                                        <span>debit: {tx.debitKey || "n/a"}</span>{" "}
                                                        <span>credit: {tx.creditKey || "n/a"}</span>
                                                    </div>
                                                    {canReconcile && (
                                                        <button
                                                            onClick={() => void reconcileEconomyTx(tx.id)}
                                                            disabled={!adminPw || reconcilingTxId === tx.id}
                                                            style={{ marginTop: 6 }}
                                                        >
                                                            {reconcilingTxId === tx.id ? "Reconciling..." : "Reconcile"}
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            {econ.duplicateTxnIds.length > 0 && (
                                <div style={{ ...box, borderColor: "#a33" }}>
                                    <strong style={{ color: "#f88" }}>⚠ Duplicate txnIds (possible replay): {econ.duplicateTxnIds.length}</strong>
                                    <div style={mono}>{econ.duplicateTxnIds.map((id) => <span key={id} style={pill}>{id}</span>)}</div>
                                </div>
                            )}
                            <div style={box}>
                                <strong>Recent transactions ({econ.recent.length})</strong>
                                <div style={{ maxHeight: 280, overflow: "auto", marginTop: 4 }}>
                                    {econ.recent.map((t, i) => (
                                        <div key={i} style={{ borderBottom: "1px solid #2a2a36", padding: "3px 0", ...mono }}>
                                            <span style={{ color: "#9aa" }}>{fmtTime(t.ts)}</span>{" "}
                                            <span style={{ color: "#8cf" }}>{t.player}</span>{" "}
                                            <span style={{ color: t.delta >= 0 ? "#7d7" : "#e88" }}>{t.delta >= 0 ? "+" : ""}{t.delta.toLocaleString()} {t.currency}</span>{" "}
                                            <span style={{ color: "#caa" }}>{t.source}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {section === "beta" && (
                <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button onClick={() => void loadBetaMetrics()} disabled={!adminPw}>Refresh</button>
                        <label style={{ color: "#9aa", fontSize: "0.85rem" }}>
                            Window
                            <select value={betaDays} onChange={(e) => setBetaDays(Number(e.target.value))} style={{ marginLeft: 6 }}>
                                {[7, 14, 30, 60].map((days) => <option key={days} value={days}>{days} days</option>)}
                            </select>
                        </label>
                        {betaStatus && <span style={{ color: "#f88" }}>{betaStatus}</span>}
                    </div>

                    {betaMetrics && (
                        <>
                            <div style={box}>
                                <strong>Beta funnel ({betaMetrics.days} days)</strong>
                                <div style={{ marginTop: 6 }}>
                                    <span style={pill}>accounts: {betaCount("account.registered").toLocaleString()}</span>
                                    <span style={pill}>academy trial: {betaCount("academy.trial.claimed").toLocaleString()}</span>
                                    <span style={pill}>academy checklist: {betaCount("academy.checklist.claimed").toLocaleString()}</span>
                                    <span style={pill}>missions: {betaCount("mission.claimed").toLocaleString()}</span>
                                    <span style={pill}>hunts: {betaCount("hunt.claimed").toLocaleString()}</span>
                                    <span style={pill}>pvp: {betaCount("pvp.settled").toLocaleString()}</span>
                                    <span style={pill}>bank interest: {betaCount("bank.interest.claimed").toLocaleString()}</span>
                                </div>
                                <div style={{ marginTop: 6, color: "#9aa", fontSize: "0.8rem" }}>
                                    Generated {fmtTime(betaMetrics.generatedAt)}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Level bands</strong>
                                {betaTopEntries(betaMetrics.totals.levelBands).length === 0 && <span style={{ color: "#9aa" }}> - no level data yet.</span>}
                                <div style={{ marginTop: 6 }}>
                                    {betaTopEntries(betaMetrics.totals.levelBands).map(([band, n]) => (
                                        <span key={band} style={pill}>{band}: {n.toLocaleString()}</span>
                                    ))}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Reward totals</strong>
                                {betaTopEntries(betaMetrics.totals.rewardTotals).length === 0 && <span style={{ color: "#9aa" }}> - no rewards logged yet.</span>}
                                <div style={{ marginTop: 6 }}>
                                    {betaTopEntries(betaMetrics.totals.rewardTotals).map(([name, n]) => (
                                        <span key={name} style={pill}>{name}: {n.toLocaleString()}</span>
                                    ))}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Sources</strong>
                                {betaTopEntries(betaMetrics.totals.sources).length === 0 && <span style={{ color: "#9aa" }}> - no source data yet.</span>}
                                <div style={{ marginTop: 6 }}>
                                    {betaTopEntries(betaMetrics.totals.sources).map(([name, n]) => (
                                        <span key={name} style={pill}>{name}: {n.toLocaleString()}</span>
                                    ))}
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Daily activity</strong>
                                <div style={{ maxHeight: 300, overflow: "auto", marginTop: 6 }}>
                                    {betaMetrics.daily.map((day) => {
                                        const totalEvents = Object.values(day.events).reduce((sum, value) => sum + value, 0);
                                        return (
                                            <div key={day.date} style={{ borderBottom: "1px solid #2a2a36", padding: "5px 0", ...mono }}>
                                                <span style={{ color: "#9aa" }}>{day.date}</span>{" "}
                                                <span style={pill}>{totalEvents.toLocaleString()} events</span>
                                                {betaTopEntries(day.events, 6).map(([name, n]) => (
                                                    <span key={name} style={pill}>{name}: {n.toLocaleString()}</span>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {section === "operations" && (
                <div>
                    <button onClick={() => void loadOperations()} disabled={!adminPw}>Refresh</button>{" "}
                    <label>Recovery reason {" "}
                        <select value={recoveryReason} onChange={(e) => setRecoveryReason(e.target.value)}>
                            <option value="session-missing">Session missing</option>
                            <option value="stuck-starting">Stuck starting</option>
                            <option value="operator-request">Operator request</option>
                        </select>
                    </label>
                    {operationsStatus && <p>{operationsStatus}</p>}
                    {operations && (
                        <div style={box}>
                            <strong>Clan Boss operation health</strong>
                            <p>Boss {operations.feature.clanBossEnabled ? "enabled" : "disabled"}; parties {operations.feature.partiesEnabled ? "enabled" : "solo compatibility"}; showing {operations.totals.parties} of {operations.totals.registryTotal ?? operations.page?.registryTotal ?? operations.totals.parties} tracked; {operations.totals.publicQueued} queued; {operations.totals.missingSessions} missing sessions; {operations.totals.staleMembers} stale members on this page.</p>
                            <p>{Object.entries(operations.totals.byStatus).sort().map(([status, count]) => `${status}: ${count}`).join(" · ") || "No status rows"}</p>
                            <p>Recovery is limited to pre-start parties. Active combat and reward values cannot be changed here.</p>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                                <button
                                    type="button"
                                    disabled={!operationsCursor}
                                    onClick={() => setOperationsCursor(null)}
                                >First page</button>
                                <button
                                    type="button"
                                    disabled={!operations.page?.nextCursor}
                                    onClick={() => {
                                        if (!operations.page?.nextCursor) return;
                                        setOperationsCursor(operations.page.nextCursor);
                                    }}
                                >Next page</button>
                                <small>{operations.page?.legacyFallback ? "Migrating legacy party index" : `Page size ${operations.page?.limit ?? operations.totals.parties}`}</small>
                            </div>
                            {operations.parties.length === 0 ? <p>No tracked parties.</p> : operations.parties.map((party) => (
                                <div key={party.partyId} style={{ borderTop: "1px solid #2a2a36", padding: "8px 0", ...mono }}>
                                    <div>{party.partyId} · {party.status} · {party.readyCount}/{party.memberCount} ready · {party.visibility} · v{party.version} · {party.ageBucket}</div>
                                    <small>Session {party.hasRunId ? (party.missingSession ? "missing" : "linked") : "not started"}; {party.staleMembers} stale</small>{" "}
                                    {["forming", "queued", "starting"].includes(party.status) && <button type="button" onClick={() => void recoverOperation(party)} disabled={!adminPw || recoveringPartyId === party.partyId}>{recoveringPartyId === party.partyId ? "Recovering..." : "Confirm recovery disband"}</button>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {section === "index" && (
                <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button onClick={() => void loadIndexHealth(indexScan)} disabled={!adminPw}>Refresh</button>
                        <label style={{ color: "#9aa", fontSize: "0.85rem" }}>
                            <input
                                type="checkbox"
                                checked={indexScan}
                                onChange={(e) => setIndexScan(e.target.checked)}
                                style={{ marginRight: 6 }}
                            />
                            Compare save keys
                        </label>
                        {indexStatus && <span style={{ color: "#f88" }}>{indexStatus}</span>}
                    </div>

                    {indexHealth && (
                        <>
                            <div style={box}>
                                <strong>Public player index v{indexHealth.version}</strong>
                                <div style={{ marginTop: 6 }}>
                                    <span style={pill}>registry rows: {indexHealth.totalRegistryEntries.toLocaleString()}</span>
                                    <span style={pill}>public rows: {indexHealth.publicRegistryEntries.toLocaleString()}</span>
                                    <span style={pill}>valid: {indexHealth.validEntries.toLocaleString()}</span>
                                    <span style={pill}>stale: {indexHealth.staleEntries.toLocaleString()}</span>
                                    <span style={pill}>malformed: {indexHealth.malformedEntries.toLocaleString()}</span>
                                </div>
                                <div style={{ marginTop: 6 }}>
                                    <span style={pill}>backfilled this check: {indexBackfilled.toLocaleString()}</span>
                                    <span style={pill}>stale before backfill: {indexStaleBeforeBackfill.toLocaleString()}</span>
                                    <span style={pill}>old version: {indexHealth.oldVersionEntries.toLocaleString()}</span>
                                    <span style={pill}>missing fields: {indexHealth.missingFieldEntries.toLocaleString()}</span>
                                </div>
                            </div>

                            <div style={box}>
                                <strong>Non-public registry rows</strong>
                                <div style={{ marginTop: 6 }}>
                                    <span style={pill}>non-public: {indexHealth.nonPublicEntries.toLocaleString()}</span>
                                    <span style={pill}>admin: {indexHealth.adminEntries.toLocaleString()}</span>
                                    <span style={pill}>clan records: {indexHealth.clanEntries.toLocaleString()}</span>
                                    <span style={pill}>empty keys: {indexHealth.emptyNameEntries.toLocaleString()}</span>
                                </div>
                                {indexHealth.sampleNonPublic.length > 0 && (
                                    <div style={{ ...mono, marginTop: 6 }}>
                                        {indexHealth.sampleNonPublic.map((key) => <span key={key} style={pill}>{key}</span>)}
                                    </div>
                                )}
                            </div>

                            <div style={box}>
                                <strong>Freshness</strong>
                                <div style={{ marginTop: 6 }}>
                                    <span style={pill}>oldest seen: {fmtTime(indexHealth.oldestLastSeen)}</span>
                                    <span style={pill}>newest seen: {fmtTime(indexHealth.newestLastSeen)}</span>
                                    <span style={pill}>generated: {fmtTime(indexHealth.generatedAt)}</span>
                                </div>
                            </div>

                            {indexHealth.scannedSaves && (
                                <div style={box}>
                                    <strong>Save key comparison</strong>
                                    <div style={{ marginTop: 6 }}>
                                        <span style={pill}>save keys: {(indexHealth.saveKeyCount ?? 0).toLocaleString()}</span>
                                        <span style={pill}>missing registry: {(indexHealth.missingRegistryCount ?? 0).toLocaleString()}</span>
                                        <span style={pill}>orphan registry: {(indexHealth.orphanRegistryCount ?? 0).toLocaleString()}</span>
                                    </div>
                                    {indexHealth.missingRegistryKeys.length > 0 && (
                                        <div style={{ ...mono, marginTop: 6 }}>
                                            <strong>Missing:</strong>{" "}
                                            {indexHealth.missingRegistryKeys.map((key) => <span key={key} style={pill}>{key}</span>)}
                                        </div>
                                    )}
                                    {indexHealth.orphanRegistryKeys.length > 0 && (
                                        <div style={{ ...mono, marginTop: 6 }}>
                                            <strong>Orphan:</strong>{" "}
                                            {indexHealth.orphanRegistryKeys.map((key) => <span key={key} style={pill}>{key}</span>)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {(indexHealth.sampleMalformed.length > 0 || indexHealth.sampleStale.length > 0 || indexHealth.sampleMissingFields.length > 0) && (
                                <div style={{ ...box, borderColor: "#a63" }}>
                                    <strong>Samples needing attention</strong>
                                    {indexHealth.sampleMalformed.length > 0 && (
                                        <div style={{ ...mono, marginTop: 6 }}>
                                            malformed: {indexHealth.sampleMalformed.map((key) => <span key={key} style={pill}>{key}</span>)}
                                        </div>
                                    )}
                                    {indexHealth.sampleStale.length > 0 && (
                                        <div style={{ ...mono, marginTop: 6 }}>
                                            stale: {indexHealth.sampleStale.map((key) => <span key={key} style={pill}>{key}</span>)}
                                        </div>
                                    )}
                                    {indexHealth.sampleMissingFields.map((sample) => (
                                        <div key={sample.key} style={{ ...mono, marginTop: 6 }}>
                                            {sample.key}: {sample.fields.join(", ")}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
