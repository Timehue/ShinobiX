import { useEffect, useState } from "react";
import { type Character, villageLore } from "../App";

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

    useEffect(() => {
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
    }, [character.village, loreData.lore]);

    return (
        <div className="card cinematic-card village-lore-screen">
            <h1>{loreData.icon} {character.village}</h1>
            <h3><em>{loreData.theme}</em></h3>

            <div className="village-lore-text">
                {shownText.split("\n").map((line, index) => (
                    <p key={index}>{line}</p>
                ))}
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
