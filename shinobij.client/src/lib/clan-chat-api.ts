/*
 * Client wrappers for clan chat (api/clan/chat/*). Auth headers are attached by
 * the global fetch interceptor; we pass playerName + clan for the membership
 * check. GET uses a `since` cursor so idle polls transfer an empty list.
 */
export type ClanChatMessage = { id: string; name: string; text: string; ts: number };

export async function fetchClanChat(player: string, clan: string, since = 0): Promise<ClanChatMessage[]> {
    try {
        const r = await fetch(`/api/clan/chat/get?playerName=${encodeURIComponent(player)}&clan=${encodeURIComponent(clan)}&since=${since}`);
        if (!r.ok) return [];
        const data = await r.json().catch(() => ({})) as { messages?: ClanChatMessage[] };
        return Array.isArray(data.messages) ? data.messages : [];
    } catch { return []; }
}

export async function sendClanChat(player: string, clan: string, text: string): Promise<{ ok: boolean; error?: string; messages?: ClanChatMessage[] }> {
    try {
        const r = await fetch("/api/clan/chat/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName: player, clan, text }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${r.status}` };
        return { ok: true, messages: data.messages as ClanChatMessage[] };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
