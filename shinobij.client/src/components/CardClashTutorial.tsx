/*
 * CardClashTutorial — a short, skippable onboarding carousel shown the first
 * time a player opens the Card Hall (gated on character.cardClashTutorialSeen).
 * Explains the 3-location / 6-turn / chakra-ramp loop and how to win, then sets
 * the seen flag on close. The full ruleset always lives in the "Rules" tab.
 */
import { useState } from "react";

type Step = { art: string; title: string; body: string };

const STEPS: Step[] = [
    {
        art: "🎴",
        title: "Welcome to Shinobi Card Clash",
        body: "A fast 3-lane card duel played with your collected shinobi cards. Win 2 of the 3 locations to win the match. Let's cover the basics.",
    },
    {
        art: "🗺️",
        title: "Three Locations",
        body: "Every match opens with 3 random locations, each with its own bonus (Fire boost, low-cost boost, and so on). You and the opponent each place up to 4 cards at each location.",
    },
    {
        art: "🔵",
        title: "Chakra Ramps Each Turn",
        body: "You get 1 Chakra on Turn 1, 2 on Turn 2… up to 6 on Turn 6. Cards cost Chakra to play. Unused Chakra does NOT carry over, so spend wisely each turn.",
    },
    {
        art: "⚔️",
        title: "Power & Abilities",
        body: "A location is won by the side with the most total Power there. Many cards have On-Reveal abilities — buffing allies, weakening enemies, drawing cards, or summoning clones. Watch the location bonuses too!",
    },
    {
        art: "🏆",
        title: "Win the Clash",
        body: "After Turn 6, whoever controls 2 of 3 locations wins. Build a 12-card deck in the Deck Builder, then jump into Play vs AI. First win each day earns bonus ryo. Good luck, shinobi!",
    },
];

export function CardClashTutorial({ onClose }: { onClose: () => void }) {
    const [step, setStep] = useState(0);
    const last = step === STEPS.length - 1;
    const s = STEPS[step];

    return (
        <div className="cc-tut-backdrop" onClick={onClose}>
            <div className="cc-tut" onClick={(e) => e.stopPropagation()}>
                <div className="cc-tut-art">{s.art}</div>
                <div className="cc-tut-body">
                    <h2>{s.title}</h2>
                    <p>{s.body}</p>
                    <div className="cc-tut-dots">
                        {STEPS.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}
                    </div>
                    <div className="cc-tut-foot">
                        <button className="cc-btn ghost" onClick={onClose}>Skip</button>
                        {last
                            ? <button className="cc-btn gold" onClick={onClose}>Got it — Let's play!</button>
                            : <button className="cc-btn primary" onClick={() => setStep((n) => n + 1)}>Next ▶</button>}
                    </div>
                </div>
            </div>
        </div>
    );
}
