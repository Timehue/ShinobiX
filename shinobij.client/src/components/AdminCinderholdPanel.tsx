import { useEffect, useState } from "react";
import { beginNpcPossession } from "../lib/npc-possession";
import { gameConfirm } from "./GameAlert";

type Listing = {
    error?: string;
    notice?: string;
    leaders?: { seat: string; name: string }[];
    npcs?: { id: string; name: string; rank: string; level: number; seeded: boolean; possessedUntil: number | null }[];
    war?: {
        proposal: { id: string; village: string; sector: number; aggression: number; expiresAt: number } | null;
        last: { village: string; sector: number; at: number } | null;
        aggression: { village: string; value: number; band: string }[];
    };
};
type Reply = Listing & { token?: string; name?: string; expiresAt?: number; seeded?: string[]; rescaled?: string[]; failures?: string[]; warnings?: string[] };

/**
 * World Events → Cinderhold. Shows the NPC village's Kage and elder seats, and
 * lets a full admin take control of one of its 30 shinobi: this browser signs in
 * as that NPC for up to two hours, and the pill at the bottom left of the screen
 * returns to the admin's account. The server explains any refusal (for example,
 * no session tokens on this server). It also shows Cinderhold's aggression toward
 * each village, and a pending war proposal to approve or reject: nothing
 * Cinderhold proposes starts without an admin's approval. Its three clans never
 * start a clan war; player clans declare on them. Rebuild runs the daily NPC
 * seed pass now and lists any warnings it returns.
 */
export function AdminCinderholdPanel({ credential }: { credential: string }) {
    const [data, setData] = useState<Listing>({});
    const [pick, setPick] = useState("");
    const [busy, setBusy] = useState(false);
    const api = (body?: object): Promise<Reply> => fetch("/api/admin/npc-possess", {
        method: body ? "POST" : "GET", body: body && JSON.stringify(body),
        headers: { "Content-Type": "application/json", "x-admin-password": credential },
    }).then((r) => r.json()).catch(() => ({ error: "Network error." }));

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { void api().then(setData); }, [credential]);

    const take = async () => {
        setBusy(true);
        const r = await api({ npc: pick, action: "take" });
        setBusy(false);
        if (r.token) beginNpcPossession({ name: r.name!, slug: pick, token: r.token, expiresAt: r.expiresAt! });
        else setData({ ...data, error: r.error ?? "Could not take control." });
    };

    // One request at a time; approving a war cannot be undone, so it asks first.
    const decide = async (action: string, proposalId?: string, kind?: "sector" | "village") => {
        if (busy || (kind && !(await gameConfirm(`Start a ${kind} war between Cinderhold and ${data.war?.proposal?.village}? This cannot be undone.`, { title: "Approve war?", confirmLabel: "Approve", danger: true })))) return;
        setBusy(true);
        const r = await api({ action, proposalId, ...(kind ? { kind } : {}) });
        const next = await api();
        setBusy(false);
        const notice = r.seeded && `Rebuilt: ${r.seeded.length} new, ${r.rescaled?.length} rescaled, ${r.failures?.length} failed. ${r.warnings?.join(" ") ?? ""}`;
        setData(r.error ? { ...next, error: r.error } : { ...next, notice: notice || undefined });
    };
    const proposal = data.war?.proposal;

    return (
        <section className="summary-box">
            <h3>Cinderhold (NPC village)</h3>
            {data.war && <p>Aggression: {data.war.aggression.map((a) => `${a.village.replace(/ Village$/, "")} ${a.value} (${a.band})`).join(", ")}.
                {data.war.last && ` Last war: Sector ${data.war.last.sector} (${data.war.last.village}), ${new Date(data.war.last.at).toLocaleDateString()}.`}</p>}
            {proposal && <p>
                Cinderhold wants war with {proposal.village} (aggression {proposal.aggression}): a sector war on Sector {proposal.sector}, or a five-day village war. The proposal lapses {new Date(proposal.expiresAt).toLocaleString()}.{" "}
                <button type="button" disabled={busy} onClick={() => void decide("war-approve", proposal.id, "sector")}>Approve sector war</button>{" "}
                <button type="button" disabled={busy} onClick={() => void decide("war-approve", proposal.id, "village")}>Approve village war</button>{" "}
                <button type="button" disabled={busy} onClick={() => void decide("war-reject", proposal.id)}>Reject</button>
            </p>}
            <p>{data.leaders?.map((l) => `${l.seat === "kage" ? "Kage" : "Elder"} ${l.name}`).join(", ")
                || "The seats stay empty until a village Kage falls."}</p>
            <p>Control lasts two hours and is logged.</p>
            {data.error && <p role="alert">{data.error}</p>}
            {data.notice && <p role="status">{data.notice}</p>}
            <select aria-label="Cinderhold shinobi" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a shinobi</option>
                {data.npcs?.map((n) => (
                    <option key={n.id} value={n.id} disabled={!n.seeded}>
                        {n.name}, {n.rank}, Lv {n.level}{n.possessedUntil ? " (controlled)" : n.seeded ? "" : " (not seeded)"}
                    </option>
                ))}
            </select>{" "}
            <button type="button" disabled={!pick || busy} onClick={() => void take()}>Take control</button>{" "}
            <button type="button" disabled={busy} onClick={() => void decide("rebuild")}>Rebuild NPCs</button>
        </section>
    );
}
