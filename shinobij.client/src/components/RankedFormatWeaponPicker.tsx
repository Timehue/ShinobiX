import { useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { starterItems } from "../data/starter-items";

/*
 * Ranked Format's one player choice: which legendary weapon to bring into
 * ranked 1v1 / ranked 2v2 (api/pvp/_ranked-format.ts). Every other stat and
 * gear slot is equalized for both fighters — this is shown wherever a player
 * can queue for either mode, and the choice is shared between both.
 *
 * The id whitelist is duplicated from RANKED_FORMAT_LEGENDARY_WEAPON_IDS
 * (api/pvp/_ranked-format.ts) — client and server are separate builds, so
 * this mirrors the existing MAX_STAT-style duplication elsewhere in the repo.
 * Keep the two lists in sync if the ranked weapon pool ever changes. Names/
 * images/descriptions are pulled from the real catalog entry so this never
 * drifts from what the weapon actually does.
 */
const RANKED_FORMAT_WEAPON_IDS = [
    "black-lotus-dagger",
    "elderbranch-katana",
    "tempest-fang-blade",
    "frostfang-oathblade",
] as const;

const RANKED_FORMAT_WEAPONS = RANKED_FORMAT_WEAPON_IDS
    .map((id) => starterItems.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

const DEFAULT_RANKED_FORMAT_WEAPON_ID: string = RANKED_FORMAT_WEAPON_IDS[0];

function isRankedFormatWeaponId(value: unknown): value is string {
    return typeof value === "string" && (RANKED_FORMAT_WEAPON_IDS as readonly string[]).includes(value);
}

export function RankedFormatWeaponPicker({
    character,
    onVersionedCharacter,
}: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    // The server (character.rankedFormatWeaponId) is the source of truth.
    // `pending` supplies immediate feedback while the request is in flight;
    // the versioned response then replaces the parent snapshot and clears it.
    const [pending, setPending] = useState<string | null>(null);
    // A second server response can arrive first (heartbeat, achievement sync,
    // or an autosave).  The weapon mutation still committed, but its now-stale
    // snapshot is correctly rejected by the global version authority.  Retain
    // that confirmed server choice locally until the newer parent snapshot
    // reflects it instead of falsely telling the player to refresh.
    const [savedChoice, setSavedChoice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const confirmed = isRankedFormatWeaponId(character.rankedFormatWeaponId)
        ? character.rankedFormatWeaponId
        : DEFAULT_RANKED_FORMAT_WEAPON_ID;
    // Once the parent snapshot reaches this choice, `confirmed` already owns
    // the display. Keep the stale-race fallback out of the render without a
    // synchronizing setState effect (which would cause a cascading render).
    const pendingServerSync = savedChoice === character.rankedFormatWeaponId ? null : savedChoice;
    const selected = pending ?? pendingServerSync ?? confirmed;

    async function choose(weaponId: string) {
        if (weaponId === selected || busy) return;
        setBusy(true);
        setError(null);
        setPending(weaponId);
        try {
            const response = await fetch("/api/pvp/ranked-format-weapon", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, weaponId }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.ok) {
                setPending(null);
                setError(typeof data?.error === "string" ? data.error : "Couldn't save your ranked weapon choice.");
                return;
            }
            if (!data.character) {
                setPending(null);
                setError("The server didn't return your ranked weapon choice. Try again.");
                return;
            }
            // The server has already committed this specific weapon. If a
            // newer snapshot won the client-side version race, it is unsafe to
            // replace that snapshot, but it is also wrong to report a failed
            // choice. Its preference is server-owned and ordinary autosaves
            // preserve it, so display the committed choice until the next
            // parent snapshot catches up.
            const adopted = onVersionedCharacter(data.character, data._saveVersion);
            setPending(null);
            if (!adopted) setSavedChoice(weaponId);
        } catch {
            setPending(null);
            setError("Couldn't reach the server. Try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="ranked-format-weapon-picker" data-testid="ranked-format-weapon-picker">
            <p className="act-label">Ranked Weapon</p>
            <p className="hint">
                Ranked fighters enter with maxed stats and identical neutral gear — your weapon is the one thing you choose.
            </p>
            <p className="hint" role="status">Selected weapon: <strong>{RANKED_FORMAT_WEAPONS.find((weapon) => weapon.id === selected)?.name}</strong></p>
            {error && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                {RANKED_FORMAT_WEAPONS.map((weapon) => (
                    <button
                        key={weapon.id}
                        type="button"
                        className={weapon.id === selected ? "active" : ""}
                        aria-pressed={weapon.id === selected}
                        aria-label={`${weapon.name}${weapon.id === selected ? ", selected" : ""}`}
                        disabled={busy}
                        onClick={() => void choose(weapon.id)}
                        style={{ textAlign: "left", display: "flex", gap: 8, alignItems: "center", padding: 8 }}
                    >
                        {weapon.image && (
                            <img src={weapon.image} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                        )}
                        <span>
                            <strong>{weapon.name}</strong>
                            {weapon.id === selected && <span style={{ display: "block", color: "var(--gold-300)", fontSize: 12, fontWeight: 700 }}>Selected</span>}
                            <div className="hint">{weapon.description}</div>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
