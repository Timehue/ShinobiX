import { useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import {
    TRANSFER_VILLAGES, VILLAGE_TRANSFER_COST, VILLAGE_TRANSFER_SCROLL_ID,
    VILLAGE_TRANSFER_SCROLL_NAME, VILLAGE_TRANSFER_SCROLL_IMAGE, VILLAGE_TRANSFER_STORY_PROGRESS, villageTransferUnlockError,
} from "../../../shared/village-transfer";
import { Modal } from "./ui/Modal";
import { GameIcon } from "./icons/GameIcon";
import { clearVillageTransferIntent, readVillageTransferIntent, retainVillageTransferIntent, type VillageTransferIntent } from "../lib/village-transfer-intent";
import { countItem } from "../lib/inventory";
import "../styles/village-transfer.css";

export function VillageTransfer({ character, onVersionedCharacter }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit;
}) {
    const [pending, setPending] = useState(() => readVillageTransferIntent(character.name));
    const [open, setOpen] = useState(false);
    const [destination, setDestination] = useState(pending?.kind === "transfer" ? pending.village : "");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const busyRef = useRef(false);
    const intentRef = useRef(pending);
    const retryTransfer = pending?.kind === "transfer";
    const retryPurchase = pending?.kind === "purchase";
    const ownsScroll = countItem(character, VILLAGE_TRANSFER_SCROLL_ID) > 0;
    const unlockError = villageTransferUnlockError(character);

    async function act(action: "purchase" | "transfer") {
        if (busyRef.current) return;
        if (intentRef.current && intentRef.current.kind !== action) return;
        busyRef.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const intent: VillageTransferIntent = intentRef.current ?? (action === "purchase"
                ? { kind: "purchase", requestId: crypto.randomUUID() }
                : { kind: "transfer", requestId: crypto.randomUUID(), fromVillage: character.village, village: destination });
            intentRef.current = intent;
            retainVillageTransferIntent(character.name, intent);
            setPending(intent);
            const body = intent.kind === "purchase"
                ? { playerName: character.name, itemId: VILLAGE_TRANSFER_SCROLL_ID, qty: 1, requestId: intent.requestId }
                : { playerName: character.name, ...intent };
            const response = await fetch(action === "purchase" ? "/api/shop/purchase" : "/api/village/transfer", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
                signal: AbortSignal.timeout(20_000),
            });
            const result = await response.json().catch(() => null) as { error?: string; character?: Character; _saveVersion?: number } | null;
            if (!response.ok || !result?.character) {
                // Preserve the same intent after ambiguous failures; retries cannot
                // spend twice or silently switch the destination of an in-flight transfer.
                const uncertain = response.status >= 500 || response.ok || [401, 408, 429].includes(response.status);
                if (!uncertain) {
                    clearVillageTransferIntent(character.name);
                    intentRef.current = null;
                    setPending(null);
                }
                setError(result?.error || "Could not confirm the action. Please retry.");
                return;
            }
            clearVillageTransferIntent(character.name);
            intentRef.current = null;
            setPending(null);
            if (!onVersionedCharacter(result.character, result._saveVersion)) {
                setError("Your character has a newer update. Refresh to see the confirmed result.");
                return;
            }
            if (action === "purchase") {
                setMessage("Scroll purchased. Choose your new village when you are ready.");
                setDestination("");
                setOpen(true);
            } else {
                setMessage(`Your home is now ${result.character.village}. Your story and character progress are preserved.`);
                setOpen(false);
                setDestination("");
            }
        } catch {
            setError("Could not confirm the action. Retry to recover the same purchase or transfer safely.");
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return <section className="village-transfer" aria-labelledby="village-transfer-title">
        <div className="village-transfer-heading">
            <img src={VILLAGE_TRANSFER_SCROLL_IMAGE} alt="Village Transfer Scroll" width={72} height={72} decoding="async" />
            <div>
                <p className="village-transfer-eyebrow">A new allegiance</p>
                <h3 id="village-transfer-title">{VILLAGE_TRANSFER_SCROLL_NAME}</h3>
                <p>Choose a new home among the four villages.</p>
            </div>
        </div>
        <div className="village-transfer-requirements">
            <span>{character.level >= 100 ? "✓" : "○"} Level 100</span>
            <span>{character.storyProgress >= VILLAGE_TRANSFER_STORY_PROGRESS ? "✓" : "○"} Village story complete</span>
            <strong><GameIcon name="shard" size={16} /> {VILLAGE_TRANSFER_COST} Fate Shards</strong>
        </div>
        <p className="hint">One scroll per transfer. Use it here whenever you are ready. Your character and completed story stay with you.</p>
        <p className="hint">Current home: <strong>{character.village}</strong></p>
        {unlockError && <p className="hint">{unlockError}</p>}
        {!retryPurchase && (ownsScroll || retryTransfer) ? <button type="button" disabled={busy || (!retryTransfer && !!unlockError)} onClick={() => setOpen(true)}>
            {retryTransfer ? "Resume village transfer" : "Use scroll · Choose village"}
        </button> : <button type="button" disabled={busy || (!retryPurchase && (!!unlockError || character.fateShards < VILLAGE_TRANSFER_COST))}
            onClick={() => { void act("purchase"); }}>
            {busy ? "Purchasing…" : retryPurchase ? "Retry scroll purchase" : `Buy scroll · ${VILLAGE_TRANSFER_COST} Fate Shards`}
        </button>}
        {!ownsScroll && !pending && character.fateShards < VILLAGE_TRANSFER_COST && <p className="hint">You need {VILLAGE_TRANSFER_COST - character.fateShards} more Fate Shards.</p>}
        {message && <p role="status">{message}</p>}
        {error && !open && <p role="alert">{error}</p>}
        <Modal open={open} onClose={() => setOpen(false)} title="Choose your new village" size="md" className="village-transfer-modal" disableBackdropClose={busy}>
            <div className="village-transfer-details">
            <p>Your current home is <strong>{character.village}</strong>. Confirming consumes one Village Transfer Scroll.</p>
            <fieldset className="village-transfer-destinations" disabled={busy || retryTransfer}>
                <legend>Destination village</legend>
                {TRANSFER_VILLAGES.filter(village => village !== character.village).map(village => <label key={village}>
                    <input type="radio" name="transfer-village" value={village} checked={destination === village} onChange={() => setDestination(village)} />
                    {village}
                </label>)}
            </fieldset>
            <p className="hint">Your new village's upgrades replace your current village bonuses. Village Merit resets and Elder / ANBU appointments end. If you are Kage, hand over your seat at the Town Hall first.</p>
            {error && <p role="alert">{error}</p>}
            </div>
            <div className="village-transfer-actions">
                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" disabled={busy || (!retryTransfer && (!destination || destination === character.village || !ownsScroll))}
                    onClick={() => { void act("transfer"); }}>
                    {busy ? "Transferring…" : retryTransfer ? "Retry transfer" : destination ? `Transfer to ${destination}` : "Select a village"}
                </button>
            </div>
        </Modal>
    </section>;
}
