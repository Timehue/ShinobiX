import { useLayoutEffect, useState } from "react";
import type { Jutsu } from "../types/combat";
import { JUTSU_MAX_LEVEL } from "../constants/game";
import { scaleJutsuByLevel } from "../lib/jutsu-scaling";
import { isZeroDamageFortyApJutsu } from "../lib/combat-math";
import { pvpAffectsOpponent, tagMatchesName } from "../lib/tags";
import { CombatDetailPortal } from "./CombatDetailPortal";
import { JutsuEffectCards } from "./JutsuEffectCards";
import "../styles/academy-jutsu-guide.css";

const OFFENSE_SCALING: Record<string, string> = {
    Ninjutsu: "Ninjutsu offense + Willpower + Speed",
    Taijutsu: "Taijutsu offense + Strength + Speed",
    Genjutsu: "Genjutsu offense + Intelligence + Willpower",
    Bukijutsu: "Bukijutsu offense + Intelligence + Strength",
    Any: "Your strongest offense combination",
};

/** A reading step only: closing this guide never submits a combat action. */
export function AcademyJutsuGuide({ jutsu, masteryLevel, apCost, currentAp, targetHint, targetReady, onClose, onSkip }: {
    jutsu: Jutsu;
    masteryLevel: number;
    apCost: number;
    currentAp: number;
    targetHint: string;
    targetReady: boolean;
    onClose: () => void;
    onSkip: () => void;
}) {
    const [step, setStep] = useState(0);
    // Mirrors the action planner's pureMove distinction; movement attacks can
    // also carry damage/effects and must not be presented as harmless Flicker.
    const pureMove = jutsu.tags.length > 0 && jutsu.tags.every((tag) => tagMatchesName(tag.name, "Move"));
    const utility = isZeroDamageFortyApJutsu(jutsu) || !pvpAffectsOpponent(jutsu) || pureMove;
    const power = utility ? 0 : scaleJutsuByLevel(jutsu, masteryLevel).scaledEffectPower;
    const maxPower = utility ? 0 : scaleJutsuByLevel(jutsu, JUTSU_MAX_LEVEL).scaledEffectPower;
    const additionalEffects = { ...jutsu, tags: jutsu.tags.filter((tag) => !tagMatchesName(tag.name, "Damage")) };
    const titles = ["Read its power", "See what makes it stronger", "Check the cost, then aim"];
    useLayoutEffect(() => {
        // Long effect lists can scroll on phones. Start each lesson at its heading.
        document.getElementById("academy-jutsu-guide")?.scrollTo({ top: 0 });
    }, [step]);
    return (
        <CombatDetailPortal id="academy-jutsu-guide" labelId="academy-jutsu-guide-title"
            triggerId={`mission-jutsu-select-${jutsu.id}`} className="academy-jutsu-guide" onClose={onClose}>
            <header className="academy-guide-header">
                <div><small>Academy lesson · {step + 1} of 3</small><h2 id="academy-jutsu-guide-title">{jutsu.name}</h2></div>
                <button type="button" data-combat-detail-close aria-label="Close jutsu lesson" onClick={onClose}>×</button>
            </header>
            <ol className="academy-guide-progress" aria-label="Jutsu lesson steps">
                {["Power", "Scaling", "Cost & target"].map((label, index) => (
                    <li key={label} aria-current={step === index ? "step" : undefined}>{index + 1}. {label}</li>
                ))}
            </ol>
            <div className="academy-guide-metrics">
                <div className={step === 0 ? "is-spotlight" : ""}><small>Effect power</small><strong>{utility ? "Utility" : `${power} EP`}</strong></div>
                <div className={step === 1 ? "is-spotlight" : ""}><small>Jutsu mastery</small><strong>{masteryLevel} / {JUTSU_MAX_LEVEL}</strong></div>
                <div className={step === 2 ? "is-spotlight" : ""}><small>Action points</small><strong>{apCost} AP</strong></div>
            </div>
            <section className="academy-guide-lesson" aria-live="polite" aria-atomic="true">
                <h3>{titles[step]}</h3>
                {step === 0 && <>
                    <p>{utility
                        ? "This is a utility technique: it deals no direct damage. Read its effects to see how it helps you or disrupts the enemy."
                        : "Effect power is the starting strength of the hit, not the HP it will remove. Defense, shields, terrain, and other effects change the final result."}</p>
                    {additionalEffects.tags.length > 0 && <JutsuEffectCards jutsu={additionalEffects} scaledEffectPower={power} masteryLevel={masteryLevel} />}
                </>}
                {step === 1 && <>
                    {utility ? <p>Train this jutsu to improve its mastery. Some effects grow with mastery; movement and fixed effects keep their own rules. It remains a utility technique.</p> : <>
                        <p className="academy-guide-formula">{OFFENSE_SCALING[jutsu.type] ?? OFFENSE_SCALING.Ninjutsu}</p>
                        <p>These stats are compared with the target’s matching defense. Training this jutsu also raises its effect power.</p>
                        <p className="academy-guide-formula">{power} EP now → {maxPower} EP at mastery {JUTSU_MAX_LEVEL}</p>
                    </>}
                    <p>Character level and jutsu mastery are different. The mastery shown here belongs to this technique.</p>
                </>}
                {step === 2 && <>
                    <p className="academy-guide-formula">{currentAp} AP available − {apCost} AP = {Math.max(0, currentAp - apCost)} AP left</p>
                    <dl className="academy-guide-costs">
                        <div><dt>Chakra</dt><dd>{jutsu.chakraCost ?? 0} CP</dd></div>
                        <div><dt>Stamina</dt><dd>{jutsu.staminaCost ?? 0} SP</dd></div>
                        <div><dt>Range</dt><dd>{jutsu.range ?? 0} tiles</dd></div>
                        <div><dt>Cooldown</dt><dd>{jutsu.cooldown ?? 0} rounds</dd></div>
                    </dl>
                    <p>{targetHint}</p>
                    <p>Selecting the card spent nothing. Choosing a valid target casts it. Afterwards, check the battle log for damage and effects. Wait ends your turn and refills AP for your next turn.</p>
                </>}
            </section>
            <footer className="academy-guide-footer">
                <button type="button" onClick={onSkip}>Skip lessons</button>
                <div>
                    {step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}
                    <button type="button" className="academy-guide-next" onClick={() => step < 2 ? setStep(step + 1) : onClose()}>
                        {step < 2 ? "Next" : targetReady ? "Choose target" : "Return to battle"}
                    </button>
                </div>
            </footer>
        </CombatDetailPortal>
    );
}
