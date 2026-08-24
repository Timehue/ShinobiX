import { useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { gameToast } from "../components/GameToast";
import { useCapabilityViewAvailability } from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";
import {
    buyCafeteriaMeal,
    CAFETERIA_MEALS,
    COOK_MATERIAL_IDS,
    COOK_RECIPES,
    DAILY_RATION_COOK_CAP,
    cookMaterialName,
    cookRationsCapLine,
    cookRecipeGate,
    cookRecipeLine,
    cookRations,
    countOwnedItem,
    hasAnyCookMaterial,
    rationsCookedToday,
    RATION_ITEM_ID,
    type CafeteriaMealId,
    type CookRecipeId,
} from "../lib/cafeteria";

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
    const [busyRecipe, setBusyRecipe] = useState<CookRecipeId | null>(null);
    // The kitchen only exists because the Village Stores exist. When the war /
    // stores layer is unavailable the cook endpoint answers a bare 'Not found.'
    // into a modal, so the section is hidden instead — derived from the same
    // capability read the Town Hall's Sector Map door uses, and failing CLOSED:
    // only an explicit "available" shows it, so a cold boot hides it rather
    // than offering a button that cannot work.
    const storesOpen = capabilityAdmissionAllowed(useCapabilityViewAvailability("villageWar"));
    // The stores also have a server-only kill switch (DISABLE_VILLAGE_STORES)
    // that no capability reports, and it answers the cook route with a bare
    // 'Not found.'. If that ever lands, say so in the section once instead of
    // throwing the same modal at every press.
    const [kitchenClosed, setKitchenClosed] = useState(false);

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
        gameToast(`${res.meal?.name ?? meal.name} restored your resources.`, { kind: "success" });
    }

    // Village Stores — cook rations (anyone, any time). The server debits the
    // material + ryo and mints the ration-pack stack; the screen adopts the
    // returned character through the same versioned-commit path as meals.
    async function cook(recipeId: CookRecipeId) {
        if (busyRecipe || busyMeal) return;
        const recipe = COOK_RECIPES.find((r) => r.id === recipeId);
        if (!recipe) return;
        const gate = cookRecipeGate(character, recipe);
        if (!gate.ok) { alert(gate.reason); return; }
        setBusyRecipe(recipeId);
        const res = await cookRations(character.name, recipeId);
        setBusyRecipe(null);
        if (!res.ok || !res.character) {
            if (/not found/i.test(res.error ?? "")) { setKitchenClosed(true); return; }
            alert(res.error ?? "The kitchen is too busy right now.");
            return;
        }
        if (!onVersionedCharacter(res.character, res._saveVersion)) return;
        // Every figure falls back to something we already know — the recipe's
        // own yield, the counter the server just wrote onto the returned save,
        // and the mirrored cap. A server response that omits the daily fields
        // must never put a question mark where a number belongs.
        const cooked = res.cooked ?? recipe.rations;
        const cookedToday = res.dailyCooked ?? rationsCookedToday(res.character);
        const cap = res.dailyCap ?? DAILY_RATION_COOK_CAP;
        gameToast(
            `Cooked ${cooked} rations — ${cookedToday}/${cap} today. Donate them at the Town Hall.`,
            { kind: "success" },
        );
    }

    const rationsOwned = countOwnedItem(character, RATION_ITEM_ID);
    const hasSpoils = hasAnyCookMaterial(character);

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
                            type="button"
                            className="location-button"
                            disabled={Boolean(busyMeal) || character.ryo < meal.cost}
                            onClick={() => void eat(meal.id)}
                        >
                            {meal.id === "small-ramen" ? "Small Ramen" : meal.id === "shinobi-meal" ? "Shinobi Meal" : "Feast"}
                            <br />
                            <small>
                                {busyMeal === meal.id
                                    ? "Ordering…"
                                    : fullRestore
                                        ? `Full restore — ${meal.cost} ryo`
                                        : `+${meal.hpPct}% HP +${meal.chakraPct}% Chakra +${meal.staminaPct}% Stamina — ${meal.cost} ryo`}
                            </small>
                        </button>
                    );
                })}
            </div>

            {storesOpen && <section className="summary-box cafe-kitchen">
                <h3>Cook for the village</h3>
                <p className="hint">Turn hunt spoils into ration packs, then donate them at the Town Hall — they feed your village’s sieges, mercenary bands and garrisons.</p>
                {kitchenClosed ? <p className="hint cafe-kitchen-empty" role="status">The kitchens are closed while the village stores are offline. Try again later.</p> : <>
                <p className="hint cafe-cap-line">{cookRationsCapLine(character)} Resets at midnight UTC.</p>
                <ul className="cafe-stock-grid">
                    {COOK_MATERIAL_IDS.map((id) => (
                        <li key={id} className="cafe-stock-chip">
                            <span>{cookMaterialName(id)}</span>
                            <strong>{countOwnedItem(character, id)}</strong>
                        </li>
                    ))}
                    <li className="cafe-stock-chip cafe-stock-packs">
                        <span>Ration packs</span>
                        <strong>{rationsOwned}</strong>
                    </li>
                </ul>
                {hasSpoils ? (
                    <div className="cafe-recipe-grid">
                        {COOK_RECIPES.map((recipe) => {
                            const gate = cookRecipeGate(character, recipe);
                            const busy = busyRecipe === recipe.id;
                            const reasonId = `cook-reason-${recipe.id}`;
                            return (
                                <article key={recipe.id} className="cafe-recipe">
                                    <button
                                        type="button"
                                        className="location-button"
                                        disabled={Boolean(busyRecipe) || Boolean(busyMeal) || !gate.ok}
                                        aria-describedby={gate.ok ? undefined : reasonId}
                                        onClick={() => void cook(recipe.id)}
                                    >
                                        {recipe.name}
                                        <br />
                                        <small>{busy ? "Cooking…" : cookRecipeLine(recipe)}</small>
                                    </button>
                                    {!gate.ok && <p className="cafe-recipe-reason" id={reasonId}>{gate.reason}</p>}
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <p className="hint cafe-kitchen-empty">You’re carrying no hunt spoils. Beast Meat and pelts drop from hunting beasts in the wilds — bring some back and the kitchen will turn them into rations.</p>
                )}
                </>}
            </section>}
        </div>
    );
}
