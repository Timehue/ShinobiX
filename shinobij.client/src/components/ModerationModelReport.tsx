import { useRef, useState } from "react";
import { useSectorModelArtBase } from "../lib/sector-obstacles";
import type { PlayerModel } from "../lib/player-model";
import { ProfileModelPreview } from "./ProfileModelPreview";
import { Modal } from "./ui/Modal";
import "../styles/profile-skin.css";

export function ModerationModelReport({ adminPw, owner, model, onClose }: {
    adminPw: string;
    owner: string;
    model: PlayerModel;
    onClose: () => void;
}) {
    const artBase = useSectorModelArtBase();
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [removed, setRemoved] = useState(false);
    const [message, setMessage] = useState("");
    const attempt = useRef<{ reason: string; key: string } | null>(null);
    const inFlight = useRef(false);

    async function remove() {
        const detail = reason.trim();
        if (inFlight.current || removed || detail.length < 3) return;
        inFlight.current = true;
        setBusy(true);
        setMessage("");
        try {
            if (attempt.current?.reason !== detail) attempt.current = { reason: detail, key: crypto.randomUUID() };
            const response = await fetch("/api/admin/avatar-model/remove", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({ slug: owner, assetId: model.assetId, expectedVersion: model.version,
                    reason: detail, idempotencyKey: attempt.current.key }),
                signal: AbortSignal.timeout(20_000),
            });
            const result = await response.json();
            if (!response.ok) {
                setMessage(typeof result.error === "string" ? result.error : "Unable to remove the model.");
                return;
            }
            if (result.assetId !== model.assetId || typeof result.cleanupPending !== "boolean") {
                setMessage("The server did not confirm removal. Try again to check its status.");
                return;
            }
            setRemoved(true);
            setMessage(result.cleanupPending ? "Removed. File cleanup is pending." : "Removed. File cleanup is complete.");
        } catch {
            setMessage("The server did not confirm removal. Try again to check its status.");
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    return <Modal open onClose={() => { if (!inFlight.current) onClose(); }} size="sm" title={`World model for ${owner}`}>
        <div className="profile-model-controls">
            <small style={{ overflowWrap: "anywhere" }}>Asset {model.assetId}<br />Revision {model.version}</small>
            {!removed && <>
                {artBase
                    ? <ProfileModelPreview artBase={artBase} avatar="" model={model} />
                    : <p>Model preview is unavailable.</p>}
                <label>Reason for removal
                    <input type="text" value={reason} maxLength={500} disabled={busy}
                        onChange={event => setReason(event.target.value)} />
                </label>
                <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void remove()}>
                    {busy ? "Removing…" : `Remove ${owner}'s world model`}
                </button>
            </>}
            {message && <p role="status">{message}</p>}
        </div>
    </Modal>;
}
