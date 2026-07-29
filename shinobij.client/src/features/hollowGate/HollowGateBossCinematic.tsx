import { playPetSfx, primePetSfx } from "../../lib/pet-sfx";

type HollowGateBossCinematicProps = {
    mode: "entrance" | "victory";
    title: string;
    eyebrow: string;
    body: string;
    image: string;
    actionLabel: string;
    onContinue: () => void;
    onEmergencyForfeit: () => void;
    exitPending?: boolean;
};

export function HollowGateBossCinematic({
    mode,
    title,
    eyebrow,
    body,
    image,
    actionLabel,
    onContinue,
    onEmergencyForfeit,
    exitPending = false,
}: HollowGateBossCinematicProps) {
    const continueWithSting = () => {
        primePetSfx();
        playPetSfx(mode === "victory" ? "victory" : "crit");
        onContinue();
    };

    return (
        <div className="hg-boss-cinematic-backdrop" data-mode={mode}>
            <section
                className="hg-boss-cinematic"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`hg-boss-${mode}-title`}
                aria-describedby={`hg-boss-${mode}-body`}
            >
                <img className="hg-boss-cinematic__art" src={image} alt="" />
                <div className="hg-boss-cinematic__veil" aria-hidden="true" />
                <div className="hg-boss-cinematic__embers" aria-hidden="true" />
                <div className="hg-boss-cinematic__copy">
                    <p className="hg-boss-cinematic__eyebrow">{eyebrow}</p>
                    <h2 id={`hg-boss-${mode}-title`}>{title}</h2>
                    <p id={`hg-boss-${mode}-body`}>{body}</p>
                    <div className="hg-boss-cinematic__actions">
                        <button autoFocus className="hg-boss-cinematic__primary" onClick={continueWithSting}>
                            {actionLabel}
                        </button>
                        <button
                            className="danger-button"
                            type="button"
                            disabled={exitPending}
                            onClick={onEmergencyForfeit}
                            title="Ends the run as a defeat if the encounter cannot continue."
                        >
                            {exitPending ? "Settling Run..." : "Emergency Forfeit"}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
