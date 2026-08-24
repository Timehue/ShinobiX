import { useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { buyCafeteriaMeal, CAFETERIA_MEALS, type CafeteriaMealId } from "../lib/cafeteria";
import { FacilityHero } from "../components/FacilityHero";
import { GameIcon, ShinobiCurrencyIcon } from "../components/icons/GameIcon";

const MEAL_COPY: Record<CafeteriaMealId, { label: string; description: string; tag: string }> = {
    "small-ramen": { label: "Quick bowl", description: "A light broth for patching up after training or a short patrol.", tag: "Light recovery" },
    "shinobi-meal": { label: "Field plate", description: "A balanced village meal built to restore a working shinobi.", tag: "Best value" },
    feast: { label: "Victory feast", description: "The full spread. Restores every vital resource to maximum.", tag: "Full restore" },
};

function poolPercent(current: number, max: number) {
    return Math.max(0, Math.min(100, max > 0 ? (current / max) * 100 : 0));
}

export function Cafeteria({
    character,
    onVersionedCharacter,
    onBack,
}: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
    onBack: () => void;
}) {
    const [busyMeal, setBusyMeal] = useState<CafeteriaMealId | null>(null);
    const hpPercent = poolPercent(character.hp, character.maxHp);
    const chakraPercent = poolPercent(character.chakra, character.maxChakra);
    const staminaPercent = poolPercent(character.stamina, character.maxStamina);

    async function eat(mealId: CafeteriaMealId) {
        if (busyMeal) return;
        const meal = CAFETERIA_MEALS.find((m) => m.id === mealId);
        if (!meal) return;
        if (character.ryo < meal.cost) {
            alert("Not enough ryo.");
            return;
        }

        setBusyMeal(mealId);
        const res = await buyCafeteriaMeal(character.name, mealId);
        setBusyMeal(null);
        if (!res.ok || !res.character) {
            alert(res.error ?? "The cafeteria is too busy right now.");
            return;
        }
        if (!onVersionedCharacter(res.character, res._saveVersion)) return;
        alert(`${res.meal?.name ?? meal.name} restored your resources.`);
    }

    return (
        <div className="card civic-facility-screen cafeteria-screen">
            <FacilityHero
                facility="cafeteria"
                eyebrow={`${character.village} · Commons`}
                title="Cafeteria"
                description="Hot food, fast recovery, and a place to reset before the next mission."
                onBack={onBack}
                metrics={[
                    { label: "Wallet", value: `${character.ryo.toLocaleString()} ryo` },
                    { label: "Lowest vital", value: `${Math.round(Math.min(hpPercent, chakraPercent, staminaPercent))}%`, tone: Math.min(hpPercent, chakraPercent, staminaPercent) < 50 ? "warning" : "good" },
                    { label: "Service", value: "Open", tone: "good" },
                ]}
            />

            <section className="cafeteria-vitals" aria-label="Current vital resources">
                <div>
                    <span><GameIcon name="hp" size={17} /> HP</span>
                    <div className="facility-resource-track facility-resource-track--hp"><span style={{ width: `${hpPercent}%` }} /></div>
                    <strong>{character.hp.toLocaleString()} / {character.maxHp.toLocaleString()}</strong>
                </div>
                <div>
                    <span><GameIcon name="chakra" size={17} /> Chakra</span>
                    <div className="facility-resource-track facility-resource-track--chakra"><span style={{ width: `${chakraPercent}%` }} /></div>
                    <strong>{character.chakra.toLocaleString()} / {character.maxChakra.toLocaleString()}</strong>
                </div>
                <div>
                    <span><GameIcon name="bolt" size={17} /> Stamina</span>
                    <div className="facility-resource-track facility-resource-track--stamina"><span style={{ width: `${staminaPercent}%` }} /></div>
                    <strong>{character.stamina.toLocaleString()} / {character.maxStamina.toLocaleString()}</strong>
                </div>
            </section>

            <div className="facility-section-heading">
                <div>
                    <p className="facility-eyebrow">Tonight's service</p>
                    <h3>Choose a meal</h3>
                </div>
                <p>Meals restore immediately. Recovery never exceeds your maximum vitals.</p>
            </div>
            <div className="cafeteria-menu-grid">
                {CAFETERIA_MEALS.map((meal) => {
                    const fullRestore = meal.id === "feast";
                    const copy = MEAL_COPY[meal.id];
                    const affordable = character.ryo >= meal.cost;
                    return (
                        <article key={meal.id} className={`cafeteria-meal-card cafeteria-meal-card--${meal.id}`} data-affordable={affordable}>
                            <div className="cafeteria-meal-art" aria-hidden="true">
                                <span className="cafeteria-steam cafeteria-steam--one" />
                                <span className="cafeteria-steam cafeteria-steam--two" />
                                <span className="cafeteria-bowl" />
                            </div>
                            <span className="cafeteria-meal-tag">{copy.tag}</span>
                            <p className="facility-eyebrow">{copy.label}</p>
                            <h3>{meal.name}</h3>
                            <p>{copy.description}</p>
                            <div className="cafeteria-recovery-list">
                                {fullRestore ? (
                                    <span className="cafeteria-full-restore"><GameIcon name="sparkle" size={18} /> All vitals to 100%</span>
                                ) : (
                                    <>
                                        <span><GameIcon name="hp" size={16} /> +{meal.hpPct}% HP</span>
                                        <span><GameIcon name="chakra" size={16} /> +{meal.chakraPct}% Chakra</span>
                                        <span><GameIcon name="bolt" size={16} /> +{meal.staminaPct}% Stamina</span>
                                    </>
                                )}
                            </div>
                            <button
                                className={meal.id === "shinobi-meal" ? "facility-primary-action" : "facility-secondary-action"}
                                disabled={Boolean(busyMeal) || !affordable}
                                onClick={() => void eat(meal.id)}
                            >
                                <span>{busyMeal === meal.id ? "Preparing…" : affordable ? `Order ${meal.name}` : "Not enough ryo"}</span>
                                <strong><ShinobiCurrencyIcon name="ryo" size={19} /> {meal.cost}</strong>
                            </button>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
