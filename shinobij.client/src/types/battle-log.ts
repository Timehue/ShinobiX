/*
 * Client-side shapes for the DURABLE battle log — the server-owned record that
 * outlives the 15-minute `pvp:<battleId>` session.
 *
 * These mirror api/_receipts.ts. Everything the server marked optional stays
 * optional here on purpose: 90 days of receipts were written before the
 * presentation metadata existed, so a renderer that assumes `display` is present
 * will crash on real historical data. Prefer the narrowing helpers at the bottom
 * over casting a fetch result.
 */

export type ActionReceiptCategory =
    | "jutsu"
    | "basic"
    | "weapon"
    | "item"
    | "movement"
    | "turn"
    | "system";

export type ActionReceiptResult = "applied" | "blocked" | "expired" | "system" | "battle_end";

export type BattleOutcome = "win" | "loss" | "draw" | "flee";

/** Only the vitals that actually moved — absent keys mean "unchanged". */
export interface ActionVitalsDelta {
    hp?: number;
    chakra?: number;
    stamina?: number;
    shield?: number;
    pos?: number;
}

export interface ActionReceiptDisplay {
    label: string;
    category: ActionReceiptCategory;
    element?: string;
    discipline?: string;
    iconKey?: string;
    /** Already sanitized server-side; never a data: URL. */
    imageRef?: string;
}

/** One committed action, as stored. `display` is absent on legacy receipts. */
export interface DurableActionReceipt {
    battleId: string;
    seq: number;
    round: number;
    actorRole: "p1" | "p2";
    actorName: string;
    targetRole: "p1" | "p2";
    targetName: string;
    actionId: string;
    actionName: string;
    actionType: string;
    result: ActionReceiptResult;
    summaryLines: string[];
    actorDelta: ActionVitalsDelta;
    targetDelta: ActionVitalsDelta;
    apSpent?: number;
    winner?: "p1" | "p2" | "draw" | null;
    createdAt: number;
    display?: ActionReceiptDisplay;
}

export interface DurableBattleFighter {
    name: string;
    hp: number;
    maxHp: number;
    finalStatuses?: Array<{ name: string; rounds: number }>;
}

export interface DurableBattleReceipt {
    battleId: string;
    ranked: boolean;
    startedAt: number;
    endedAt: number;
    rounds: number;
    p1: DurableBattleFighter;
    p2: DurableBattleFighter;
    winner: "p1" | "p2" | "draw" | null;
    fleedBy?: "p1" | "p2";
    log?: string[];
}

/** GET /api/pvp/combat-log?id=… */
export interface DurableBattleLogResponse {
    battleId: string;
    battle: DurableBattleReceipt | null;
    entries: DurableActionReceipt[];
    /** 'legacy-final-log' → render `legacyLog` via buildActionsFromPvpLog instead. */
    source: "receipts" | "legacy-final-log";
    nextCursor?: number;
    legacyLog?: string[];
}

/** One row of the player's own durable battle list, already relative to them. */
export interface BattleHistorySummary {
    battleId: string;
    opponent: string;
    startedAt: number;
    endedAt: number;
    rounds: number;
    mode: string;
    ranked: boolean;
    outcome: BattleOutcome;
    winner: "p1" | "p2" | "draw" | null;
}

/** GET /api/pvp/combat-history */
export interface BattleHistoryResponse {
    entries: BattleHistorySummary[];
    nextCursor?: number;
}

// ─── Narrowing ────────────────────────────────────────────────────────────────
// The server is trusted for VALUES, but a response can still be a legacy shape,
// a partial write, or (in the worst case) an error page. These keep a malformed
// row out of the render tree instead of letting it throw mid-list.

const OUTCOMES = new Set<BattleOutcome>(["win", "loss", "draw", "flee"]);

export function isBattleHistorySummary(v: unknown): v is BattleHistorySummary {
    if (!v || typeof v !== "object") return false;
    const r = v as Record<string, unknown>;
    return typeof r.battleId === "string" && r.battleId.length > 0
        && typeof r.opponent === "string"
        && OUTCOMES.has(r.outcome as BattleOutcome);
}

export function isDurableActionReceipt(v: unknown): v is DurableActionReceipt {
    if (!v || typeof v !== "object") return false;
    const r = v as Record<string, unknown>;
    return typeof r.seq === "number"
        && (r.actorRole === "p1" || r.actorRole === "p2")
        && Array.isArray(r.summaryLines);
}

/**
 * The label to show for an action. Falls back through the server's own fields so
 * a pre-`display` receipt still reads as words — and NEVER surfaces a raw id
 * when a human name exists.
 */
export function actionLabel(entry: DurableActionReceipt): string {
    const fromDisplay = entry.display?.label?.trim();
    if (fromDisplay) return fromDisplay;
    const name = String(entry.actionName ?? "").trim();
    // A legacy jutsu receipt stored the ID in BOTH fields; showing "Jutsu" beats
    // showing "starter-nin-fire-2".
    if (name && name !== entry.actionId) return name;
    if (name && !/[-_:]/.test(name)) return name;
    return LEGACY_TYPE_LABELS[entry.actionType] ?? name ?? "Action";
}

const LEGACY_TYPE_LABELS: Record<string, string> = {
    jutsu: "Jutsu",
    weapon: "Weapon Attack",
    item: "Item",
    basicAttack: "Basic Attack",
    basicHeal: "Basic Heal",
    move: "Move",
    wait: "Wait",
    flee: "Flee",
    clear: "Clear",
    cleanse: "Cleanse",
    "claim-afk-win": "Forfeit Win Claimed",
};

/** Category for grouping/filtering/iconography, inferred when absent. */
export function actionCategory(entry: DurableActionReceipt): ActionReceiptCategory {
    if (entry.display?.category) return entry.display.category;
    return LEGACY_TYPE_CATEGORIES[entry.actionType] ?? "system";
}

const LEGACY_TYPE_CATEGORIES: Record<string, ActionReceiptCategory> = {
    jutsu: "jutsu",
    weapon: "weapon",
    item: "item",
    basicAttack: "basic",
    basicHeal: "basic",
    clear: "basic",
    cleanse: "basic",
    move: "movement",
    wait: "turn",
    flee: "turn",
    "claim-afk-win": "system",
};

/** Low-signal beats the "Hide basic actions" filter removes. */
export const BASIC_CATEGORIES: ReadonlySet<ActionReceiptCategory> = new Set<ActionReceiptCategory>([
    "basic",
    "movement",
    "turn",
]);
