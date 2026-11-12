/**
 * Client half of admin NPC control (api/admin/npc-possess.ts).
 *
 * Taking control swaps this browser's player session onto the NPC's 2-hour
 * token and remembers the admin's own session so "Return to my account" can put
 * it back. Only identity and a session TOKEN are stashed, never a password, so
 * the token-first rule holds. If the stash is lost (another browser, cleared
 * storage) the admin simply signs in again; nothing is locked out.
 */
import { getSocketAuth, setActivePlayer, setActiveToken } from "../authFetch";

/** main.tsx reads this same key inline to decide whether to load the bar. */
export const STASH_KEY = "shinobix:npcPossession";

type Stash = { npcName: string; npcSlug: string; expiresAt: number; returnName: string | null; returnToken: string | null };

function read(): Stash | null {
    try { return JSON.parse(localStorage.getItem(STASH_KEY) ?? "null"); } catch { return null; }
}

/** Ends the lease with the NPC's own token (allowed for its own control). */
const release = (slug: string) => fetch("/api/admin/npc-possess", {
    method: "POST", headers: { "Content-Type": "application/json", "x-player-token": getSocketAuth().token ?? "" },
    body: JSON.stringify({ npc: slug, action: "release" }),
}).catch(() => null);

/** Called after the server minted the NPC token. Reloads into the NPC's save. */
export async function beginNpcPossession(npc: { name: string; slug: string; token: string; expiresAt: number }): Promise<void> {
    // Switching from one NPC to another keeps the ADMIN's session as the return,
    // and lets the first NPC go (or it would sit out of the world for 2 h).
    // Only the name and token are kept: never the in-memory password.
    const prior = read();
    if (prior && prior.npcSlug !== npc.slug) await release(prior.npcSlug);
    const { name, token } = prior ? { name: prior.returnName, token: prior.returnToken } : getSocketAuth();
    const stash: Stash = { npcName: npc.name, npcSlug: npc.slug, expiresAt: npc.expiresAt, returnName: name, returnToken: token };
    try { localStorage.setItem(STASH_KEY, JSON.stringify(stash)); } catch { /* the bar just won't offer a return */ }
    setActivePlayer(npc.name);
    setActiveToken(npc.token);
    location.reload();
}

/**
 * The "Playing as <NPC>" pill, mounted by main.tsx only while a takeover is
 * active. Plain DOM (no React) to keep it tiny. "Return to my account" ends the
 * lease on the server with the NPC's own token (revoking it at once; if that
 * call fails, the token still expires within two hours), restores the admin's
 * own session or signs out, and reloads. It does that by itself when the lease
 * runs out, so an expired NPC token never strands the admin at a password
 * prompt the NPC cannot answer. A stash whose NPC is no longer the signed-in
 * player (the admin logged out or switched account) is dropped, admin token and all.
 */
export function mountNpcPossessionBar(): void {
    const stash = read();
    if (!stash) return;
    if ((getSocketAuth().name ?? "").toLowerCase() !== stash.npcName.toLowerCase()) { localStorage.removeItem(STASH_KEY); return; }
    const back = () => release(stash.npcSlug).then(() => {
        localStorage.removeItem(STASH_KEY);
        setActivePlayer(stash.returnName); // null signs out cleanly
        if (stash.returnName) setActiveToken(stash.returnToken);
        location.reload();
    });
    if (Date.now() >= stash.expiresAt) { void back(); return; }
    setTimeout(() => void back(), stash.expiresAt - Date.now());
    const bar = document.createElement("div");
    bar.setAttribute("role", "status");
    // A small pill over every screen (combat included), always below the re-auth prompt.
    bar.style.cssText = "position:fixed;left:8px;bottom:8px;max-width:calc(100vw - 16px);z-index:calc(var(--z-reauth) - 1);padding:6px 10px;border-radius:8px;font-size:13px;background:#7c2d12;color:#fff";
    bar.textContent = `Playing as ${stash.npcName} (Cinderhold) until ${new Date(stash.expiresAt).toLocaleTimeString()}. `;
    const button = bar.appendChild(document.createElement("button"));
    button.type = "button";
    button.textContent = "Return to my account";
    button.onclick = () => void back();
    document.body.appendChild(bar);
}
