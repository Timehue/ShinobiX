/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useCallback, useEffect } from "react";
import { starterJutsus } from "../data/jutsu";
import { starterItems } from "../data/starter-items";
import { shinobiTileCards } from "../data/tile-cards";

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
type DiagnosticsSection = "assets" | "receipts" | "audit" | "economy" | "index";

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
    const [section, setSection] = useState<DiagnosticsSection>("assets");

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

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div>
            <h3>🛠️ Diagnostics</h3>
            <p style={{ color: "#9aa", fontSize: "0.85rem", marginTop: 0 }}>
                Read-only operations tools — battle receipts, asset health, and the action audit log.
            </p>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {(["assets", "receipts", "audit", "economy", "index"] as const).map((s) => (
                    <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
                        {s === "assets" ? "Assets" : s === "receipts" ? "Battle Receipts" : s === "audit" ? "Audit Log" : s === "economy" ? "Economy" : "Player Index"}
                    </button>
                ))}
            </div>

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
                    <div style={{ display: "flex", gap: 6 }}>
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
