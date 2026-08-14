import { useId } from "react";
import {
    petChronicleProgressCopy,
    type PetChronicleProgressReceipt,
} from "../lib/pet-chronicle-ceremony";
import "../styles/pet-chronicle-progress.css";

export function PetChronicleProgress({ receipt }: { receipt: PetChronicleProgressReceipt }) {
    const headingId = useId();
    const entries = receipt.entries.map((entry) => ({
        entry,
        copy: petChronicleProgressCopy(entry),
    }));

    return (
        <section className="pet-chronicle-progress" aria-labelledby={headingId}>
            <p className="pet-chronicle-progress__announcement" role="status" aria-live="polite" aria-atomic="true">
                {entries.map(({ copy }) => copy.announcement).join(" ")}
            </p>
            <div className="pet-chronicle-progress__seal" aria-hidden="true">記</div>
            <div className="pet-chronicle-progress__heading">
                <p>Living Chronicle · witnessed arena deed</p>
                <h3 id={headingId}>Your bond leaves a record</h3>
            </div>
            <ul aria-label="Living Witness progress">
                {entries.map(({ entry, copy }) => (
                    <li key={`${entry.sourceReceipt}:${entry.petId}`}>
                        <div className="pet-chronicle-progress__row">
                            <strong>{copy.label}</strong>
                            <span data-complete={entry.cardPressed || entry.deedRecorded}>{copy.status}</span>
                        </div>
                        <progress
                            aria-label={`${entry.petName} Living Witness progress: ${Math.min(entry.wins, entry.threshold)} of ${entry.threshold}`}
                            max={entry.threshold}
                            value={Math.min(entry.wins, entry.threshold)}
                        />
                        <p>{copy.detail}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
