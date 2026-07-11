/*
 * WarCacheTurnIn — the war-cache redemption panel (anbuInfiltration.v1).
 *
 * Type-locked (docs/anbu-infiltration-plan.md §8, decision B):
 *   Clan Hall  → War SUPPLY caches  → clan points, 2 : 1
 *   Town Hall  → War RESOURCE caches → village merit, 1 : 1
 *
 * The SERVER owns the conversion (api/village/anbu-infiltration action:'turn-in'
 * — consumes the caches and credits the points under the save lock, clamped to
 * the destination's caps). This panel only mirrors the returned deltas onto the
 * local save via a FUNCTIONAL update so the UI reflects them immediately.
 * Renders nothing unless the flag is on and the player holds the cache type.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import {
    anbuInfiltrationEnabled,
    turnInInfilCaches,
    INFIL_CACHE_ITEM_IDS,
    type InfilCachePool,
} from "../../lib/anbu-infiltration-api";
import type { Character } from "../../types/character";

const DEST_CONFIG = {
    clan: {
        cache: "warSupply" as InfilCachePool,
        icon: "/items/war-supply-cache.webp",
        title: "War Supply Caches",
        blurb: "Skimmed from enemy vaults. 2 caches = 1 clan point.",
        cta: "Donate to the Clan",
    },
    village: {
        cache: "warResources" as InfilCachePool,
        icon: "/items/war-resource-cache.webp",
        title: "War Resource Caches",
        blurb: "Bled from enemy war chests. 1 cache = 1 village merit.",
        cta: "Turn in to the Village",
    },
} as const;

export function WarCacheTurnIn({
    character,
    updateCharacter,
    dest,
}: {
    character: Character;
    updateCharacter: Dispatch<SetStateAction<Character | null>>;
    dest: keyof typeof DEST_CONFIG;
}) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const cfg = DEST_CONFIG[dest];
    const itemId = INFIL_CACHE_ITEM_IDS[cfg.cache];
    const held = (character.itemStacks ?? []).find(s => s.itemId === itemId)?.count ?? 0;

    if (!anbuInfiltrationEnabled() || held <= 0) return null;

    async function turnIn() {
        if (busy) return;
        setBusy(true); setNote(null);
        try {
            const res = await turnInInfilCaches(character.name, cfg.cache);
            if (!res.ok) {
                setNote(res.reason === "cap-reached"
                    ? (dest === "clan" ? "Clan point cap reached for now — try again later this week." : "Turn-in limit reached for now.")
                    : "Nothing to turn in.");
                return;
            }
            // Mirror the server-credited deltas locally (functional — the prop
            // `character` may be stale by the time the request lands).
            updateCharacter(prev => {
                if (!prev) return prev;
                const stacks = (prev.itemStacks ?? [])
                    .map(s => s.itemId === itemId ? { ...s, count: Math.max(0, s.count - res.consumed) } : { ...s })
                    .filter(s => s.count > 0);
                return dest === "clan"
                    ? { ...prev, itemStacks: stacks, clanPoints: (prev.clanPoints ?? 0) + res.points, weeklyClanPoints: (prev.weeklyClanPoints ?? 0) + res.points }
                    : { ...prev, itemStacks: stacks, villageMerit: (prev.villageMerit ?? 0) + res.points };
            });
            setNote(dest === "clan"
                ? `+${res.points} clan point${res.points === 1 ? "" : "s"} (${res.consumed} caches donated).`
                : `+${res.points} village merit (${res.consumed} caches turned in).`);
        } catch (e) {
            setNote(String((e as Error)?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(58,65,80,0.30)", border: "1px solid rgba(120,130,150,0.35)", borderRadius: 12, padding: "10px 14px", margin: "10px 0", flexWrap: "wrap" }}>
            <img src={cfg.icon} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />
            <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                <b>{held.toLocaleString()}× {cfg.title}</b>
                <div style={{ fontSize: 12, opacity: 0.78 }}>{cfg.blurb}</div>
                {note && <div style={{ fontSize: 12, marginTop: 4, color: "#9fd6a0" }}>{note}</div>}
            </div>
            <button onClick={() => void turnIn()} disabled={busy} style={{ padding: "0.5rem 1rem" }}>
                {busy ? "Turning in…" : cfg.cta}
            </button>
        </div>
    );
}
