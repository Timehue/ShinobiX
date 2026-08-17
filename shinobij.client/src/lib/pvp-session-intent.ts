const PVP_CREATE_INTENT_KEY = "pvpSession.createIntent.v1";

type StoredIntent = { fingerprint: string; battleId: string };
let memoryIntent: StoredIntent | null = null;

function uuidBattleId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `pvp-${crypto.randomUUID()}`;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `pvp-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function intentFingerprint(payload: Record<string, unknown>): string {
    const fighterName = (value: unknown) => value && typeof value === "object"
        ? String((value as { name?: unknown }).name ?? "").trim().toLowerCase()
        : "";
    return JSON.stringify({
        p1: fighterName(payload.p1Character),
        p2: fighterName(payload.p2Character),
        challengeId: String(payload.challengeId ?? ""),
        clanWarId: String(payload.clanWarId ?? ""),
        clanWarChallengeId: String(payload.clanWarChallengeId ?? ""),
        rankedMatchId: String(payload.rankedMatchId ?? ""),
        rewardSector: Number(payload.rewardSector ?? 0),
    });
}

export function bindPvpSessionCreateIntent(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const row = payload as Record<string, unknown>;
    if (typeof row.battleId === "string" && row.battleId.trim()) return row;
    const fingerprint = intentFingerprint(row);
    let stored = memoryIntent;
    try {
        const raw = sessionStorage.getItem(PVP_CREATE_INTENT_KEY);
        if (raw) stored = JSON.parse(raw) as StoredIntent;
    } catch { /* storage denied; memory remains authoritative for this mount */ }
    const intent = stored?.fingerprint === fingerprint
        ? stored
        : { fingerprint, battleId: uuidBattleId() };
    memoryIntent = intent;
    try { sessionStorage.setItem(PVP_CREATE_INTENT_KEY, JSON.stringify(intent)); } catch { /* private mode */ }
    return { ...row, battleId: intent.battleId };
}

export function clearPvpSessionCreateIntent(): void {
    memoryIntent = null;
    try { sessionStorage.removeItem(PVP_CREATE_INTENT_KEY); } catch { /* private mode */ }
}
