import { useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
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
