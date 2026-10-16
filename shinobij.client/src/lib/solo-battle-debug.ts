import type { SoloPveCombatEvent, SoloPveSession } from './solo-pve-api';
export type SoloBattleDebugSource = Pick<SoloPveSession, 'sessionId' | 'eventSeq' | 'events' | 'status' | 'outcome'> & {
    player: { name: string }; enemy: { name: string; character: Record<string, unknown> };
};

/** Local diagnostic journal only: no rewards, save fields, or combat authority.
 * Keeps up to 4,096 rows (1,000 characters each) per fight and three recent
 * fights (seven days), with a 750,000-character persistence budget. Missing
 * history is always identified in the export. */
export const SOLO_DEBUG_MAX_ROWS = 4096;
const STORE_KEY = 'shinobij:solo-battle-debug:v1';
const MAX_STORAGE_CHARS = 750_000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export type SoloBattleDebug = {
    version: 1; sessionId: string; player: string; opponent: string; opponentLevel: number;
    updatedAt: number; lastSequence: number; complete: boolean; omittedRows: number;
    status: string; outcome: string | null; shortenedRows?: number;
    rows: Array<{ seq: number; round: number; text: string }>;
};
const records = new Map<string, SoloBattleDebug>();
const recordKey = (player: string, sessionId: string) => JSON.stringify([player.trim().toLowerCase(), sessionId]);
function isRecentRecord(value: unknown): value is SoloBattleDebug {
    if (!value || typeof value !== 'object') return false;
    const record = value as SoloBattleDebug;
    return record.version === 1 && typeof record.sessionId === 'string' && typeof record.player === 'string'
        && typeof record.opponent === 'string' && typeof record.complete === 'boolean'
        && Number.isSafeInteger(record.lastSequence) && Number.isSafeInteger(record.omittedRows)
        && Number.isFinite(record.updatedAt) && record.updatedAt > Date.now() - MAX_AGE
        && Array.isArray(record.rows) && record.rows.length <= SOLO_DEBUG_MAX_ROWS
        && record.rows.every(row => !!row && Number.isSafeInteger(row.seq) && Number.isFinite(row.round) && typeof row.text === 'string' && row.text.length <= 1000);
}

function resourceSummary(event: SoloPveCombatEvent): string {
    const fighter = (side: 'player' | 'enemy') => {
        const before = event.before?.[side], after = event.after?.[side];
        if (!before || !after) return `${side}: resource snapshot unavailable`;
        return `${side}: HP ${before.hp}→${after.hp}, shield ${before.shield}→${after.shield}, CP ${before.chakra}→${after.chakra}, SP ${before.stamina}→${after.stamina}, AP ${event.before.ap?.[side]}→${event.after.ap?.[side]}, cooldowns ${JSON.stringify(event.after.cooldowns?.[side] ?? {})}`;
    };
    return `${event.actor} ${event.actionName ?? event.action} (${event.actionId ?? event.action}): ${fighter('player')}; ${fighter('enemy')}`;
}

export function mergeSoloBattleDebug(previous: SoloBattleDebug | undefined, session: SoloBattleDebugSource, now = Date.now()): SoloBattleDebug {
    const events = [...(session.events ?? [])].sort((a, b) => a.seq - b.seq);
    const record: SoloBattleDebug = previous && previous.sessionId === session.sessionId && previous.player === session.player.name
        ? { ...previous, rows: [...previous.rows] }
        : { version: 1, sessionId: session.sessionId, player: session.player.name, opponent: session.enemy.name,
            opponentLevel: Number(session.enemy.character.level) || 1, updatedAt: now, lastSequence: 0,
            complete: session.eventSeq === 0 || events[0]?.seq === 1, omittedRows: 0,
            status: session.status, outcome: session.outcome, rows: [] };
    for (const event of events) {
        if (event.seq <= record.lastSequence) continue;
        if (event.seq !== record.lastSequence + 1) record.complete = false;
        const row = (value: unknown) => {
            const raw = String(value ?? '');
            if (raw.length > 1000) { record.complete = false; record.shortenedRows = (record.shortenedRows ?? 0) + 1; }
            return { seq: event.seq, round: event.round, text: raw.slice(0, 1000) };
        };
        record.rows.push(row(resourceSummary(event)), ...(event.log ?? []).map(row));
        record.lastSequence = event.seq;
    }
    if (session.eventSeq > record.lastSequence) record.complete = false;
    if (record.rows.length > SOLO_DEBUG_MAX_ROWS) {
        record.omittedRows += record.rows.length - SOLO_DEBUG_MAX_ROWS;
        record.rows = record.rows.slice(-SOLO_DEBUG_MAX_ROWS);
        record.complete = false;
    }
    record.updatedAt = now;
    record.status = session.status;
    record.outcome = session.outcome;
    return record;
}

/** Accumulate sequence-tagged events before the server's 80-event window rolls.
 * Storage denial never affects the fight; the in-memory journal still works. */
export function captureSoloBattleDebug(session: SoloBattleDebugSource): SoloBattleDebug {
    const key = recordKey(session.player.name, session.sessionId);
    if (!records.has(key)) {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
            if (Array.isArray(saved)) for (const value of saved) {
                if (!isRecentRecord(value)) continue;
                const savedKey = recordKey(value.player, value.sessionId);
                if (!records.has(savedKey)) records.set(savedKey, value);
            }
        } catch { /* Browser storage is optional. */ }
    }
    const previous = records.get(key);
    if (previous && previous.lastSequence === session.eventSeq && previous.status === session.status && previous.outcome === session.outcome) return previous;
    const record = mergeSoloBattleDebug(previous, session);
    records.set(key, record);
    for (const [entryKey, entry] of records) if (entry.updatedAt < Date.now() - MAX_AGE) records.delete(entryKey);
    const recent = [...records.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    for (const [entryKey] of recent.slice(3)) records.delete(entryKey);
    const persisted = recent.slice(0, 3).map(([, entry]) => entry);
    while (JSON.stringify(persisted).length > MAX_STORAGE_CHARS && persisted.length > 1) persisted.pop();
    if (JSON.stringify(persisted).length <= MAX_STORAGE_CHARS) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(persisted)); } catch { /* Memory still preserves this fight. */ }
    }
    return record;
}

export function soloBattleDebugText(record: SoloBattleDebug): string {
    const scope = record.complete ? 'Complete observed action history.'
        : `Partial action history: earlier events were unavailable or the local ${SOLO_DEBUG_MAX_ROWS}-row / 1,000-character line bound was reached. ${record.omittedRows} rows omitted and ${record.shortenedRows ?? 0} rows shortened by this device.`;
    return `${record.player} vs ${record.opponent} (Lv ${record.opponentLevel})\nSession: ${record.sessionId}\n${scope}\nStatus: ${record.status}; outcome: ${record.outcome ?? 'unresolved'}\n\n`
        + record.rows.map(row => `[Round ${row.round} · Event ${row.seq}] ${row.text}`).join('\n');
}

export function downloadSoloBattleDebug(record: SoloBattleDebug): void {
    const url = URL.createObjectURL(new Blob([soloBattleDebugText(record)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `shinobi-battle-${record.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadRecordedSoloBattleDebug(sessionId: string, playerName: string): void {
    const record = [...records.values()].find(entry => entry.sessionId === sessionId && entry.player === playerName);
    if (record) downloadSoloBattleDebug(record);
}
