import { useState } from "react";
import type { Character } from "../types/character";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { buyCafeteriaMeal, CAFETERIA_MEALS, type CafeteriaMealId } from "../lib/cafeteria";

export function Cafeteria({
    character,
    updateCharacter,
    onBack,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    onBack: () => void;
}) {
    const [busyMeal, setBusyMeal] = useState<CafeteriaMealId | null>(null);

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
        updateCharacter(res.character);
        alert(`${res.meal?.name ?? meal.name} restored your resources.`);
    }

    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} />
            <h2>Cafeteria</h2>
            <p>Ryo: {character.ryo}</p>
            <div className="location-grid">
                {CAFETERIA_MEALS.map((meal) => {
                    const fullRestore = meal.id === "feast";
                    return (
                        <button
                            key={meal.id}
                            className="location-button"
                            disabled={Boolean(busyMeal) || character.ryo < meal.cost}
                            onClick={() => void eat(meal.id)}
                        >
                            {meal.id === "small-ramen" ? "Small Ramen" : meal.id === "shinobi-meal" ? "Shinobi Meal" : "Feast"}
                            <br />
                            <small>
                                {busyMeal === meal.id
                                    ? "Ordering..."
                                    : fullRestore
                                        ? `Full restore - ${meal.cost} ryo`
                                        : `+${meal.hp} HP +${meal.chakra} Chakra +${meal.stamina} Stamina - ${meal.cost} ryo`}
                            </small>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
