import { useEffect, useState } from "react";
import { type Character } from "../App";
import { villageLore } from "../data/village-lore";

export function VillageLoreScreen({
    character,
    onBack,
    onContinue,
}: {
    character: Character;
    onBack: () => void;
    onContinue: () => void;
}) {
    const loreData = villageLore[character.village] ?? {
        icon: "⚔",
        theme: "The Shinobi Path",
        lore: "Your shinobi journey begins here.",
    };

    const [shownText, setShownText] = useState("");
    // Tap-to-reveal: a ~30s forced typewriter is a top churn driver (text-wall).
    // Tapping the lore (or it finishing) fills the full text immediately so the
    // player is never trapped waiting to reach the "Begin Journey" button.
    const [skipped, setSkipped] = useState(false);

    useEffect(() => {
        if (skipped) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- show full text immediately when the player taps to skip
            setShownText(loreData.lore);
            return;
        }
        setShownText("");

        let index = 0;
        const timer = setInterval(() => {
            index++;
            setShownText(loreData.lore.slice(0, index));

            if (index >= loreData.lore.length) {
                clearInterval(timer);
            }
        }, 12);
        return () => clearInterval(timer);
    }, [character.village, loreData.lore, skipped]);

    const isComplete = shownText.length >= loreData.lore.length;

    return (
        <div className="card cinematic-card village-lore-screen">
            <h1>{loreData.icon} {character.village}</h1>
            <h3><em>{loreData.theme}</em></h3>

            <div
                className="village-lore-text"
                onClick={() => { if (!isComplete) setSkipped(true); }}
                style={{ cursor: isComplete ? "default" : "pointer" }}
            >
                {shownText.split("\n").map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
                {!isComplete && (
                    <p className="hint" style={{ opacity: 0.6, marginTop: 8 }}>(tap to reveal)</p>
                )}
            </div>

            <div className="menu">
                <button onClick={onBack}>Choose Another Village</button>
                <button onClick={onContinue} className="admin-button">
                    Begin Journey
                </button>
            </div>
        </div>
    );
}
