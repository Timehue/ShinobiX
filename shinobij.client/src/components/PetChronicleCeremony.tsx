import { useId } from "react";
import { ChronicleCardView } from "./ChronicleCardView";
import { getChronicleCard } from "../lib/chronicle-duel";
import {
    petChronicleCeremonyCopy,
    type PetChronicleCeremonyReceipt,
} from "../lib/pet-chronicle-ceremony";
import "../styles/chronicle-duel.css";
import "../styles/pet-chronicle-ceremony.css";

export function PetChronicleCeremony({
    receipt,
    onDismiss,
    onOpenCardHall,
}: {
    receipt: PetChronicleCeremonyReceipt;
    onDismiss: () => void;
    onOpenCardHall: () => void;
}) {
    const headingId = useId();
    const copy = petChronicleCeremonyCopy(receipt);
    const granted = new Set(receipt.grantedCardIds);
    const cards = receipt.cardIds
        .map((id) => ({ id, card: getChronicleCard(id) }))
        .filter((entry) => entry.card);

    return (
        <section className="pet-chronicle-ceremony" aria-labelledby={headingId}>
            <p className="pet-chronicle-ceremony__announcement" role="status" aria-live="polite" aria-atomic="true">
                {copy.announcement}
            </p>
            <div className="pet-chronicle-ceremony__seal" aria-hidden="true">記</div>
            {cards.length ? (
                <div className="pet-chronicle-ceremony__cards" role="list" aria-label="Living Witness Chronicle cards">
                    {cards.map(({ id, card }) => (
                        <div key={id} role="listitem" className="pet-chronicle-ceremony__card">
                            <ChronicleCardView card={card} compact />
                            <span>{granted.has(id) ? "New card" : "Record sealed"}</span>
                        </div>
                    ))}
                </div>
            ) : null}
            <div className="pet-chronicle-ceremony__copy">
                <p className="pet-chronicle-ceremony__kicker">LIVING CHRONICLE · DEED SEALED</p>
                <h3 id={headingId}>{copy.title}</h3>
                <p>{copy.witnessLine}</p>
                <p>{copy.recordLine}</p>
                <div className="pet-chronicle-ceremony__actions">
                    <button type="button" className="primary" onClick={onOpenCardHall}>Open Card Hall</button>
                    <button type="button" onClick={onDismiss}>Continue</button>
                </div>
            </div>
        </section>
    );
}
