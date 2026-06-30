/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import type { Character } from "../types/character";
import type { Jutsu, JutsuTag, SavedBloodline } from "../types/combat";
import type { JutsuElement, JutsuMethod, JutsuTarget, JutsuType, Rank } from "../types/core";
import { JUTSU_MAX_LEVEL } from "../constants/game";
import { allTags, binaryTags, bloodlineUniqueTags, cappedDamageTags, percentageTags, hasFixedEffectPower, normalizeJutsuTags, tagCapForRank } from "../lib/tags";
import { bloodlinePoints, jutsuPoints, jutsuPointBreakdown, jutsuCountForRank, pointBudgetForRank, normalizeBloodlineTagPercent } from "../lib/jutsu-points";
import { describeJutsuEffects } from "../lib/jutsu-effects";
import { bloodlineArchetypes, bloodlineTemplateJutsus } from "../lib/bloodline-templates";
import { compactImage, compressDataUrl, publishSharedImage, readImageFile } from "../lib/shared-images";
import { formatJutsuResourcePercent, jutsuResourceBackingCost, lockJutsuResourceCosts } from "../lib/jutsu-scaling";
import { gameConfirm } from "../components/GameAlert";
import { normalizeJutsu, blankJutsu } from "../lib/jutsu";
import { makeId } from "../lib/utils";
import { replaceCharacterBloodline } from "../lib/bloodline";
import { bloodlineWizardStepCount, bloodlineWizardStepKind, bloodlineWizardJutsuIndex, bloodlineWizardStepLabel, canLeaveBloodlineDetails, clampBloodlineWizardStep } from "../lib/bloodline-wizard";
import { specialties, jutsuElements, bloodlineJutsuMethods, fortyApBlockedBloodlineTags, instantEffectGroundTags, jutsuTargets } from "../data/jutsu";
import { AiImagePrompt } from "../components/AiImagePrompt";
import { TagPicker } from "../components/TagPicker";

// The five base elements that interact with the weather system. A bloodline's
// special element can behave as one of these (weather buff/debuff) or as "None".
const BASE_WEATHER_ELEMENTS = ["Earth", "Wind", "Lightning", "Fire", "Water"];

// Default weather affinity for a bloodline: the saved choice if present, else
// the special element when it's a real base element (preserves legacy behavior,
// where the special-element text WAS the combat element), else "None".
function defaultWeatherElement(bloodline: SavedBloodline | null | undefined, special: string): JutsuElement {
    if (bloodline?.weatherElement) return bloodline.weatherElement;
    const source = (bloodline?.specialElement ?? special ?? "").trim();
    return (BASE_WEATHER_ELEMENTS.includes(source) ? source : "None") as JutsuElement;
}

export function BloodlineMaker({ initialRank, initialSpecialElement, character, updateCharacter, savedBloodlines, setSavedBloodlines, lockedRank, editingBloodline, onSaveBloodlines }: { initialRank: Rank; initialSpecialElement?: string; character: Character; updateCharacter: (character: Character) => void; savedBloodlines: SavedBloodline[]; setSavedBloodlines: (bloodlines: SavedBloodline[]) => void; lockedRank?: boolean; editingBloodline?: SavedBloodline | null; onSaveBloodlines?: (bloodlines: SavedBloodline[], character?: Character) => void; onClose?: () => void }) {
    const [rank, setRank] = useState<Rank>(editingBloodline?.rank ?? initialRank);
    const [bloodlineName, setBloodlineName] = useState(editingBloodline?.name ?? "Custom Bloodline");
    const [bloodlineLore, setBloodlineLore] = useState(editingBloodline?.lore ?? "");
    const [bloodlineImage, setBloodlineImage] = useState(editingBloodline?.image ?? "");
    const [specialElement, setSpecialElement] = useState(editingBloodline?.specialElement ?? initialSpecialElement ?? "");
    const [weatherElement, setWeatherElement] = useState<JutsuElement>(defaultWeatherElement(editingBloodline, initialSpecialElement ?? ""));
    const [bloodlineOffense, setBloodlineOffense] = useState<JutsuType>((editingBloodline?.jutsus[0]?.type ?? "Ninjutsu") as JutsuType);
    const [jutsus, setJutsus] = useState<Jutsu[]>(editingBloodline?.jutsus ?? Array.from({ length: jutsuCountForRank(initialRank) }).map((_, i) => blankJutsu(i, initialRank)));
    // Wizard step: 0 = details, 1..N = one jutsu each, final = review & save.
    const [step, setStep] = useState(0);
    const [templateMsg, setTemplateMsg] = useState("");
    const recommendedMax = pointBudgetForRank(rank);
    const elementSuggestions = ["Crystal", "Lava", "Storm", "Shadow Flame", "Ice", "Sand", "Steel", "Blood", "Magnet", "Light"];

    useEffect(() => {
        setStep(0);
        setWeatherElement(defaultWeatherElement(editingBloodline, initialSpecialElement ?? ""));
        if (editingBloodline) {
            setRank(editingBloodline.rank);
            setBloodlineName(editingBloodline.name);
            setBloodlineLore(editingBloodline.lore ?? "");
            setBloodlineImage(editingBloodline.image ?? "");
            setSpecialElement(editingBloodline.specialElement ?? "");
            setBloodlineOffense((editingBloodline.jutsus[0]?.type ?? "Ninjutsu") as JutsuType);
            setJutsus(editingBloodline.jutsus.map((j0) => {
                // AOE Movement (ground nova) is locked to 60 AP — correct any
                // legacy 40-AP entry on load so the editor shows the real state.
                const j = j0.method === "AOE_SPIRAL" && j0.ap !== 60 ? { ...j0, ap: 60 as const } : j0;
                return j.ap === 40
                    ? { ...j, effectPower: 0 }
                    // Fixed-effect 60-AP jutsu deal standard damage (40) — clamp away
                    // any legacy EP-100 sentinel so the editor shows the real value.
                    : hasFixedEffectPower(j)
                    ? { ...j, effectPower: 40 }
                    : j.ap === 60 && ![40, 50].includes(j.effectPower)
                    ? { ...j, effectPower: 40 }
                    : j;
            }));
            return;
        }
        setRank(initialRank);
        setSpecialElement(initialSpecialElement ?? "");
        setJutsus(Array.from({ length: jutsuCountForRank(initialRank) }).map((_, i) => normalizeJutsu({
            ...blankJutsu(i, initialRank),
            element: (initialSpecialElement || "Fire") as JutsuElement,
        })));
    }, [initialRank, initialSpecialElement, editingBloodline]);

    function changeRank(newRank: Rank) {
        setRank(newRank);
        setStep((s) => clampBloodlineWizardStep(s, newRank));
        setJutsus(Array.from({ length: jutsuCountForRank(newRank) }).map((_, i) => normalizeJutsu({
            ...blankJutsu(i, newRank),
            element: (specialElement || "Fire") as JutsuElement,
        })));
    }
    // Load a balanced starter set for an archetype, themed to the current
    // element + offense. Behavior-preserving: only pre-fills editable jutsu,
    // always within budget (guaranteed by bloodline-templates.test.ts).
    async function applyTemplate(key: string) {
        const hasContent = jutsus.some((jutsu) => jutsu.tags.some((tag) => tag.name));
        if (hasContent && !(await gameConfirm("Replace your current jutsu with this template? Your name, lore, element and image are kept."))) return;
        const generated = bloodlineTemplateJutsus(key, rank, specialElement || "Fire", bloodlineOffense);
        setJutsus(generated);
        const arch = bloodlineArchetypes.find((a) => a.key === key);
        setTemplateMsg(`Loaded ${arch?.name ?? "template"} — ${generated.length} jutsu created. Rename & tweak them in the next steps.`);
    }
    const totalPoints = bloodlinePoints(jutsus);
    function setBloodlineSpecialElement(value: string) {
        setSpecialElement(value);
        setJutsus((current) => current.map((jutsu) => normalizeJutsu({ ...jutsu, element: (value.trim() || "Fire") as JutsuElement })));
    }
    function setBloodlineOffenseChoice(value: JutsuType) {
        setBloodlineOffense(value);
        setJutsus((current) => current.map((jutsu) => normalizeJutsu({ ...jutsu, type: value })));
    }
    function updateJutsu(index: number, updated: Partial<Jutsu>) {
        setJutsus((current) => current.map((jutsu, i) => {
            if (i !== index) return jutsu;
            const merged = { ...jutsu, ...updated };
            // AOE Movement (ground nova) is locked to the 60-AP damage tier — it
            // can never be a 40-AP utility. Force the AP before deriving resource
            // costs so chakra/stamina backing and effect power resolve at 60-AP.
            if (merged.method === "AOE_SPIRAL") merged.ap = 60;
            const next = normalizeJutsu(lockJutsuResourceCosts(merged));
            if (!bloodlineJutsuMethods.includes(next.method)) next.method = "SINGLE";
            if (next.method === "INSTANT_EFFECT") next.target = "EMPTY_GROUND";
            if (next.target === "SELF") next.range = 0;
            else if (![4, 5].includes(next.range)) next.range = 4;
            next.cooldown = 7;
            if (next.ap === 40) next.effectPower = 0;
            // Fixed-effect (control/movement) jutsu deal STANDARD 60-AP damage (40)
            // plus their always-on effect — not the old EP-100 (~3200) sentinel.
            if (next.ap === 60 && hasFixedEffectPower(next)) next.effectPower = 40;
            // Strip "Increase Damage Taken" tag if the move targets the ground
            if (next.target === "EMPTY_GROUND") {
                next.tags = next.tags.filter((t) => t.name !== "Increase Damage Taken");
            }
            // AOE_CIRCLE method requires Move tag in the first slot — they are tied
            if (next.method === "AOE_CIRCLE") {
                const hasMoveTag = next.tags.some((t) => t.name === "Move");
                if (!hasMoveTag) {
                    const slots = next.tags.filter((t) => t.name !== "Move");
                    next.tags = [{ name: "Move", percent: 0 }, ...slots].slice(0, next.ap === 60 ? 2 : 3);
                }
                next.target = "EMPTY_GROUND";
            }
            if (next.method === "INSTANT_EFFECT") {
                next.tags = next.tags.filter((t) => instantEffectGroundTags.includes(t.name));
            }
            // AOE_SPIRAL — tied to BOTH movement (Move tag, slot 0) and the
            // instant-effect ground tags: you dash to a tile and erupt a spiral
            // ground nova. Lock target to GROUND, force Move into slot 0, and keep
            // only the ground tags in the remaining slots.
            if (next.method === "AOE_SPIRAL") {
                next.target = "EMPTY_GROUND";
                const groundTags = next.tags.filter((t) => t.name !== "Move" && instantEffectGroundTags.includes(t.name));
                next.tags = [{ name: "Move", percent: 0 }, ...groundTags].slice(0, next.ap === 60 ? 2 : 3);
            }
            if (next.ap === 40) {
                next.tags = next.tags.filter((t) => !fortyApBlockedBloodlineTags.includes(t.name));
            }
            return next;
        }));
    }
    function updateJutsuAp(index: number, ap: 40 | 60) {
        const currentJutsu = jutsus[index];
        const fixedEffectPower = currentJutsu ? hasFixedEffectPower(currentJutsu) : false;
        updateJutsu(index, {
            ap,
            chakraCost: jutsuResourceBackingCost({ ap }),
            staminaCost: jutsuResourceBackingCost({ ap }),
            chakraCostReducePerLvl: 0,
            staminaCostReducePerLvl: 0,
            tags: (currentJutsu?.tags ?? []).filter((tag) => ap === 60 || !fortyApBlockedBloodlineTags.includes(tag.name)).slice(0, ap === 60 ? 2 : 3),
            effectPower: fixedEffectPower ? (ap === 60 ? 40 : 0) : ap === 60 ? ([40, 50].includes(currentJutsu?.effectPower ?? 0) ? currentJutsu!.effectPower : 40) : 0,
        });
    }
    function updateTag(jutsuIndex: number, tagIndex: number, updated: Partial<JutsuTag>) {
        setJutsus((current) => current.map((jutsu, i) => {
            if (i !== jutsuIndex) return jutsu;
            const tags = [...jutsu.tags];
            const merged = { ...tags[tagIndex], ...updated };
            if (merged.name) {
                const duplicateOnJutsu = tags.some((tag, index) => index !== tagIndex && tag.name === merged.name);
                const duplicateOnBloodline = bloodlineUniqueTags.includes(merged.name) && current.some((candidate, candidateIndex) =>
                    candidateIndex !== jutsuIndex && candidate.tags.some((tag) => tag.name === merged.name)
                );
                if (duplicateOnJutsu || duplicateOnBloodline) return jutsu;
            }
            // When the tag name changes, auto-set percent to the correct value for that tag type.
            if ('name' in updated) {
                if (!merged.name || binaryTags.includes(merged.name) || merged.name === "Pierce") {
                    merged.percent = 0;
                } else if (cappedDamageTags.includes(merged.name)) {
                    merged.percent = tagCapForRank(rank);
                } else if (percentageTags.includes(merged.name)) {
                    merged.percent = 40; // max Wound tier → +1 pt
                } else {
                    merged.percent = 100;
                }
            }
            tags[tagIndex] = merged;
            const next = normalizeJutsu({ ...jutsu, tags: normalizeJutsuTags(tags) });
            if (next.method === "INSTANT_EFFECT") {
                next.tags = next.tags.filter((tag) => instantEffectGroundTags.includes(tag.name));
            }
            if (next.method === "AOE_SPIRAL") {
                const groundTags = next.tags.filter((tag) => tag.name !== "Move" && instantEffectGroundTags.includes(tag.name));
                next.tags = [{ name: "Move", percent: 0 }, ...groundTags].slice(0, next.ap === 60 ? 2 : 3);
            }
            if (next.ap === 40) {
                next.tags = next.tags.filter((tag) => !fortyApBlockedBloodlineTags.includes(tag.name));
            }
            return hasFixedEffectPower(next) ? { ...next, effectPower: next.ap === 60 ? 40 : 0 } : next;
        }));
    }
    const currentTotalPoints = bloodlinePoints(jutsus);
    const pointLimit = pointBudgetForRank(rank);
    const overLimit = currentTotalPoints > pointLimit;

    async function saveBloodline() {
        const finalElement = (specialElement.trim() || "Fire") as JutsuElement;
        const usedUniqueTags = new Set<string>();
        const finalizedJutsus = jutsus.map((jutsu) => {
            const seenJutsuTags = new Set<string>();
            const finalMethod = bloodlineJutsuMethods.includes(jutsu.method) ? jutsu.method : "SINGLE";
            const tags = normalizeJutsuTags(jutsu.tags).map((tag) => (
                tag.name && !binaryTags.includes(tag.name) && tag.name !== "Pierce"
                    ? { ...tag, percent: normalizeBloodlineTagPercent(tag.percent, rank) }
                    : tag
            )).filter((tag) => {
                if (finalMethod === "INSTANT_EFFECT" && !instantEffectGroundTags.includes(tag.name)) return false;
                if (finalMethod === "AOE_SPIRAL" && tag.name !== "Move" && !instantEffectGroundTags.includes(tag.name)) return false;
                if (jutsu.ap === 40 && fortyApBlockedBloodlineTags.includes(tag.name)) return false;
                if (seenJutsuTags.has(tag.name)) return false;
                seenJutsuTags.add(tag.name);
                if (bloodlineUniqueTags.includes(tag.name)) {
                    if (usedUniqueTags.has(tag.name)) return false;
                    usedUniqueTags.add(tag.name);
                }
                return true;
            });
            // AOE Movement (ground nova) is locked to the 60-AP damage tier;
            // force it here too so a legacy 40-AP entry is corrected on save.
            const finalAp = finalMethod === "AOE_SPIRAL" ? 60 : jutsu.ap;
            return normalizeJutsu({
            ...lockJutsuResourceCosts({ ...jutsu, ap: finalAp }),
            type: bloodlineOffense,
            element: finalElement,
            // Mechanical weather affinity — chosen on the details step, stamped on
            // every jutsu so the weather system reads it (the cosmetic `element`
            // above stays the special-element flavor name).
            weatherElement,
            method: finalMethod,
            range: jutsu.target === "SELF" ? 0 : jutsu.range,
            cooldown: 7,
            effectPower: finalAp === 40 ? 0 : hasFixedEffectPower(jutsu) ? 40 : finalAp === 60 ? (jutsu.effectPower === 50 ? 50 : 40) : jutsu.effectPower,
            tags,
        });
        });
        // Enforce point limit before doing any async work.
        const finalPoints = bloodlinePoints(finalizedJutsus);
        const finalLimit = pointBudgetForRank(rank);
        if (finalPoints > finalLimit) {
            alert(`${bloodlineName} is over the ${rank} point limit (${finalPoints}/${finalLimit} points). Remove or simplify jutsu tags before saving.`);
            return;
        }
        const finalId = editingBloodline?.id ?? makeId();
        // Publish bloodline image and jutsu images to shared KV so they survive
        // stripImages on save and are restored for all players via hydrateImages.
        const imageResults = await Promise.all([
            bloodlineImage ? publishSharedImage('bloodline:' + finalId, bloodlineImage) : Promise.resolve(),
            ...finalizedJutsus.map((jutsu) => jutsu.image ? publishSharedImage('jutsu:' + jutsu.id, jutsu.image) : Promise.resolve()),
        ]);
        const imageSaveFailed = imageResults.some((result) => result === false);
        const newBloodline = { id: finalId, name: bloodlineName, rank, image: bloodlineImage, specialElement: specialElement.trim(), weatherElement, lore: bloodlineLore.trim(), jutsus: finalizedJutsus, totalPoints: bloodlinePoints(finalizedJutsus) };
        // When creating a NEW bloodline (not editing), discard every other
        // user-saved bloodline — players keep at most one custom bloodline
        // at a time, and the new one auto-equips below via
        // replaceCharacterBloodline. Editing replaces the existing entry
        // in place, preserving the previous id.
        const nextBloodlines = editingBloodline
            ? savedBloodlines.map((b) => b.id === finalId ? newBloodline : b)
            : [newBloodline];
        const swapped = replaceCharacterBloodline(character, newBloodline, savedBloodlines);
        // Auto-grant level-1 mastery to the new bloodline's jutsu so they are
        // immediately equippable + usable. replaceCharacterBloodline strips their
        // mastery (the "retrain from scratch" rule) and the loadout picker only
        // lists jutsu with mastery level >= 1 — so without this a freshly-made
        // bloodline's jutsu are invisible in the picker until retrained, which
        // reads as "my bloodline didn't load". Only add entries for ids that
        // lack one (never reset existing progress). The save endpoint clamps
        // mastery level to [0,50], so a level-1 grant is always accepted.
        const masteredIds = new Set((swapped.jutsuMastery ?? []).map((m) => m.jutsuId));
        const grantedMastery = finalizedJutsus
            .filter((j) => !masteredIds.has(j.id))
            .map((j) => ({ jutsuId: j.id, level: 1, xp: 0 }));
        const nextCharacter = grantedMastery.length
            ? { ...swapped, jutsuMastery: [...(swapped.jutsuMastery ?? []), ...grantedMastery] }
            : swapped;
        setSavedBloodlines(nextBloodlines);
        updateCharacter(nextCharacter);
        onSaveBloodlines?.(nextBloodlines, nextCharacter);
        alert(imageSaveFailed ? `${bloodlineName} saved, but one or more images did not upload to shared storage.` : `${bloodlineName} saved.`);
    }
    const stepCount = bloodlineWizardStepCount(rank);
    const stepKind = bloodlineWizardStepKind(step, rank);
    const activeJutsuIndex = bloodlineWizardJutsuIndex(step, rank);
    const jutsuCount = jutsuCountForRank(rank);

    function renderPointTotal() {
        return (
            <div style={{ margin: "8px 0", padding: "8px 12px", borderRadius: 8, background: overLimit ? "rgba(220,50,50,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${overLimit ? "rgba(220,50,50,0.5)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 600, color: overLimit ? "#ff6b6b" : "inherit" }}>Total Points: {currentTotalPoints} / {pointLimit}</span>
                {overLimit && <span style={{ color: "#ff6b6b", fontSize: "0.85em" }}>⚠️ Over the {rank} limit — reduce tags to save.</span>}
            </div>
        );
    }

    // The per-jutsu editor card (one shown per wizard step). Behavior-preserving
    // verbatim move of the former jutsus.map() body — same handlers, same rules.
    function renderJutsuCard(jutsu: Jutsu, jutsuIndex: number) {
        return (
                <div className="jutsu-card maker-card" key={jutsu.id}>
                    <h3>{jutsu.name}</h3>
                    <label>Name</label><input value={jutsu.name} onChange={(e) => updateJutsu(jutsuIndex, { name: e.target.value })} />
                    <label>Battle Description</label><textarea rows={2} value={jutsu.battleDescription} onChange={(e) => updateJutsu(jutsuIndex, { battleDescription: e.target.value, description: e.target.value })} />
                    <label>Jutsu Image</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, (image) => updateJutsu(jutsuIndex, { image }), 100); }} />
                    <AiImagePrompt label="Jutsu Image" suggestedPrompt={`${jutsu.name}, ${specialElement || jutsu.element} ${jutsu.ap === 40 ? "Any" : bloodlineOffense} bloodline technique`} onImage={async (image) => updateJutsu(jutsuIndex, { image: await compressDataUrl(image, 512, 0.82) })} />
                    {jutsu.image && <div className="admin-jutsu-preview"><img src={jutsu.image} alt={jutsu.name} /></div>}
                    <div className="summary-box bloodline-element-lock">Offense: {jutsu.ap === 40 ? "Any — element-only utility" : bloodlineOffense}</div>
                    <div className="summary-box bloodline-element-lock">Element: {specialElement.trim() || "Type a special element above"}</div>
                    <label>Target / Method</label>
                    <div className="inline-grid">
                        <select value={jutsu.target} onChange={(e) => updateJutsu(jutsuIndex, { target: e.target.value as JutsuTarget })}>{jutsuTargets.map((target) => <option key={target} value={target}>{target === "EMPTY_GROUND" ? "GROUND" : target}</option>)}</select>
                        <select value={bloodlineJutsuMethods.includes(jutsu.method) ? jutsu.method : "SINGLE"} onChange={(e) => updateJutsu(jutsuIndex, { method: e.target.value as JutsuMethod })}>
                            {bloodlineJutsuMethods.map((method) => <option key={method} value={method}>{method === "AOE_CIRCLE" ? "Circle Movement (Ring Damage)" : method === "INSTANT_EFFECT" ? "Instant Effect (Ground Burst)" : method === "AOE_SPIRAL" ? "AOE Movement (Ground Nova)" : method}</option>)}
                        </select>
                    </div>
                    {jutsu.method === "AOE_CIRCLE" && <div className="summary-box bloodline-element-lock">Circle Movement: you move to a chosen tile, then deal damage to every hex surrounding your destination. Move tag is required and auto-added. If the opponent is adjacent to your landing tile, they take the hit.</div>}
                    {jutsu.method === "INSTANT_EFFECT" && <div className="summary-box bloodline-element-lock">Instant Effect: target is locked to GROUND. Click an open ground tile in battle; that tile and its surrounding hexes become a 2-round defensive zone. Decrease Damage Given, Recoil, or Poison apply immediately if the enemy is caught and again while they stand in it. Costs +1 jutsu point.</div>}
                    {jutsu.method === "AOE_SPIRAL" && <div className="summary-box bloodline-element-lock">AOE Movement: you dash to a chosen ground tile, then erupt a spiral ground nova — a filled hex disk (radius 2) around your landing tile becomes a 2-round zone. Move tag is required and auto-added; the other slots take Decrease Damage Given, Recoil, or Poison. The effect hits the enemy immediately if they're inside the burst and again while they stand in it. A bigger footprint than Instant Effect. Locked to 60 AP. Costs +1 jutsu point.</div>}
                    <label>AP Type</label>
                    <div className="admin-ap-toggle">
                        <button className={jutsu.ap === 40 ? "active" : ""} disabled={jutsu.method === "AOE_SPIRAL"} title={jutsu.method === "AOE_SPIRAL" ? "AOE Movement is locked to 60 AP" : undefined} onClick={() => updateJutsuAp(jutsuIndex, 40)}>40 AP Utility</button>
                        <button className={jutsu.ap === 60 ? "active" : ""} onClick={() => updateJutsuAp(jutsuIndex, 60)}>60 AP Damage</button>
                    </div>
                    {jutsu.method === "AOE_SPIRAL" && <small className="tag-effect-help">AOE Movement is locked to 60 AP — it cannot be a 40 AP utility jutsu.</small>}
                    {jutsu.ap === 60 && !hasFixedEffectPower(jutsu) && (() => {
                        const strongUsedElsewhere = jutsus.some((j, i) => i !== jutsuIndex && j.ap === 60 && j.effectPower === 50 && !hasFixedEffectPower(j));
                        const pierceUsedElsewhere = jutsus.some((j, i) => i !== jutsuIndex && j.tags.some((t) => t.name === "Pierce"));
                        const hasPierceTag = jutsu.tags.some((t) => t.name === "Pierce");
                        const damageMode = hasPierceTag ? "pierce" : jutsu.effectPower === 50 ? "nuke" : "standard";
                        function handleDamageMode(mode: string) {
                            if (mode === "pierce") {
                                updateJutsu(jutsuIndex, {
                                    effectPower: 40,
                                    tags: [...jutsu.tags.filter((t) => t.name !== "Pierce"), { name: "Pierce", percent: 0 }],
                                });
                            } else if (mode === "nuke") {
                                updateJutsu(jutsuIndex, { effectPower: 50, tags: jutsu.tags.filter((t) => t.name !== "Pierce") });
                            } else {
                                updateJutsu(jutsuIndex, { effectPower: 40, tags: jutsu.tags.filter((t) => t.name !== "Pierce") });
                            }
                        }
                        return (
                            <div className="summary-box bloodline-damage-section">
                                <h4>Damage</h4>
                                <label>Effect Power (Lv.50 max · Lv.1 ˜ value - 9.8)</label>
                                <select value={damageMode} onChange={(e) => handleDamageMode(e.target.value)}>
                                    <option value="standard">40 — Standard · Lv.1 ˜ 30.2</option>
                                    <option value="nuke" disabled={strongUsedElsewhere}>50 — Nuke · Lv.1 ˜ 40.2{strongUsedElsewhere ? " [already used]" : " (+1 pt)"}</option>
                                    <option value="pierce" disabled={pierceUsedElsewhere}>Pierce — 900 true damage{pierceUsedElsewhere ? " [already used]" : " (+1 pt)"}</option>
                                </select>
                                <small className="tag-effect-help">Standard 60 AP is 0 points. Nuke (+1 pt) scales with level. Pierce (+1 pt) deals 900 unblockable damage — ignores shields, armor, and all damage modifiers. Only one Nuke and one Pierce allowed per bloodline.</small>
                            </div>
                        );
                    })()}
                    {hasFixedEffectPower(jutsu) && <div className="summary-box bloodline-damage-section">Prevent / stun / movement effect always applies. 60 AP jutsu also deal standard damage; 40 AP deal none.</div>}
                    <label>Range</label>
                    {jutsu.target !== "SELF" ? (
                        <select value={jutsu.range === 5 ? 5 : 4} onChange={(e) => updateJutsu(jutsuIndex, { range: Number(e.target.value) })}>
                            <option value={4}>Range 4</option>
                            <option value={5}>Range 5 (+0.5 points)</option>
                        </select>
                    ) : (
                        <div className="summary-box bloodline-element-lock">Range: Self target</div>
                    )}
                    <div className="summary-box bloodline-element-lock">Cooldown: 7</div>
                    <div className="summary-box bloodline-element-lock">
                        Chakra/Stamina Cost: {formatJutsuResourcePercent(jutsu, "chakra")} each · Level 50: {formatJutsuResourcePercent(jutsu, "chakra", JUTSU_MAX_LEVEL)} each · Reduction: -1% at mastery 50.
                    </div>
                    <label>Tags</label>{Array.from({ length: jutsu.ap === 60 ? 2 : 3 }).map((_, tagIndex) => {
                        const currentTag = jutsu.tags[tagIndex]?.name ?? "";
                        const disabledTags = allTags.filter((tagName) => {
                            if (tagName === currentTag) return false;
                            const usedOnThisJutsu = jutsu.tags.some((tag, index) => index !== tagIndex && tag.name === tagName);
                            const usedOnAnotherJutsu = bloodlineUniqueTags.includes(tagName) && jutsus.some((candidate, candidateIndex) =>
                                candidateIndex !== jutsuIndex && candidate.tags.some((tag) => tag.name === tagName)
                            );
                            return usedOnThisJutsu || usedOnAnotherJutsu;
                        });
                        const allowedTags = jutsu.method === "INSTANT_EFFECT"
                            ? instantEffectGroundTags
                            : jutsu.method === "AOE_SPIRAL"
                                ? ["Move", ...instantEffectGroundTags]
                                : jutsu.ap === 40
                                    ? allTags.filter((tagName) => !fortyApBlockedBloodlineTags.includes(tagName))
                                    : undefined;
                        return <TagPicker key={tagIndex} rank={rank} jutsuTarget={jutsu.target} allowedTags={allowedTags} tag={currentTag} disabledTags={disabledTags} setTag={(name) => updateTag(jutsuIndex, tagIndex, { name })} percent={jutsu.tags[tagIndex]?.percent ?? 30} setPercent={(percent) => updateTag(jutsuIndex, tagIndex, { percent })} />;
                    })}
                    <div className="summary-box bloodline-effect-preview"><strong>What it does:</strong> {describeJutsuEffects(jutsu)}</div>
                    {(() => {
                        const items = jutsuPointBreakdown(jutsu);
                        return (
                            <div className="summary-box bloodline-points-breakdown">
                                <div className="bloodline-points-total">Jutsu Points: {jutsuPoints(jutsu)}</div>
                                {items.length === 0
                                    ? <small className="tag-effect-help">Free — a standard 60 AP damage jutsu costs no points.</small>
                                    : <ul>{items.map((it, k) => <li key={k}><span>{it.label}</span><span>+{it.points}</span></li>)}</ul>}
                            </div>
                        );
                    })()}
                </div>
        );
    }

    return (
        <div className="card bloodline-maker-screen global-menu-panel">
            <h2>Bloodline Maker</h2>
            <div className="bloodline-wizard-steps">
                {Array.from({ length: stepCount }).map((_, s) => (
                    <button
                        key={s}
                        type="button"
                        className={`bloodline-wizard-step${s === step ? " active" : ""}${s < step ? " done" : ""}`}
                        onClick={() => setStep(s)}
                    >
                        {bloodlineWizardStepLabel(s, rank)}
                    </button>
                ))}
            </div>

            {stepKind === "details" && (
                <div className="bloodline-wizard-panel">
                    <h3>Bloodline Details</h3>
                    <label>Name</label><input value={bloodlineName} onChange={(e) => setBloodlineName(e.target.value)} />
                    <label>Bloodline Text / Lore</label><textarea rows={3} value={bloodlineLore} onChange={(e) => setBloodlineLore(e.target.value)} placeholder="Describe what this bloodline is, where it comes from, or what makes it special." />
                    <label>Special Element</label><input value={specialElement} onChange={(e) => setBloodlineSpecialElement(e.target.value)} placeholder="Example: Crystal, Lava, Storm, Shadow Flame" />
                    <div className="bloodline-chip-row">
                        {elementSuggestions.map((el) => (
                            <button type="button" key={el} className="bloodline-chip" onClick={() => setBloodlineSpecialElement(el)}>{el}</button>
                        ))}
                    </div>
                    <label>Weather Element</label>
                    <select value={weatherElement} onChange={(e) => setWeatherElement(e.target.value as JutsuElement)}>
                        {jutsuElements.map((el) => <option key={el} value={el}>{el}</option>)}
                    </select>
                    <small className="tag-effect-help">How this bloodline reacts to battlefield weather. Pick one of the five elements to gain damage when the weather favors it (and lose a little when it opposes it), or <strong>None</strong> for a flavor-only element with no weather buff or debuff.</small>
                    <label>Offense Choice</label>
                    <select value={bloodlineOffense} onChange={(e) => setBloodlineOffenseChoice(e.target.value as JutsuType)}>{specialties.map((s) => <option key={s}>{s}</option>)}</select>
                    <small className="tag-effect-help">Applies to 60 AP damage jutsu. 40 AP utility jutsu are element-only (Any) — their buffs/debuffs affect all offenses.</small>
                    <div className="bloodline-template-section">
                        <label>Quick Start (optional)</label>
                        <small className="tag-effect-help">Load a balanced, in-budget jutsu set you can rename and tweak in the next steps. Uses your element &amp; offense above.</small>
                        <div className="bloodline-template-grid">
                            {bloodlineArchetypes.map((a) => (
                                <button type="button" key={a.key} className="bloodline-template-card" onClick={() => applyTemplate(a.key)}>
                                    <strong>{a.name}</strong>
                                    <span>{a.blurb}</span>
                                </button>
                            ))}
                        </div>
                        {templateMsg && <div className="bloodline-template-msg">{templateMsg}</div>}
                    </div>
                    <label>Bloodline Image</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, setBloodlineImage, 25); }} />
                    <AiImagePrompt label="Bloodline Image" suggestedPrompt={`${bloodlineName}, ${specialElement || "chakra"} bloodline symbol`} onImage={async (image) => setBloodlineImage(await compactImage(image))} />
                    {bloodlineImage && <div className="admin-event-list-preview"><img src={bloodlineImage} alt={bloodlineName} /></div>}
                    <label>Rank</label>
                    {lockedRank
                        ? <div className="bloodline-rank-locked">{rank} <span className="rank-lock-badge">🔒 Locked</span></div>
                        : <select value={rank} onChange={(e) => changeRank(e.target.value as Rank)}><option>B Rank</option><option>A Rank</option><option>S Rank</option></select>
                    }
                    <div className="summary-box"><p>Total Points: {totalPoints} / {recommendedMax}</p>{specialElement.trim() && <p>Special Element: {specialElement.trim()}</p>}</div>
                </div>
            )}

            {stepKind === "jutsu" && activeJutsuIndex >= 0 && jutsus[activeJutsuIndex] && (
                <div className="bloodline-wizard-panel">
                    <h3>Jutsu {activeJutsuIndex + 1} of {jutsuCount}</h3>
                    {renderJutsuCard(jutsus[activeJutsuIndex], activeJutsuIndex)}
                    {renderPointTotal()}
                </div>
            )}

            {stepKind === "review" && (
                <div className="bloodline-wizard-panel">
                    <h3>Review &amp; Save</h3>
                    <div className="summary-box">
                        {bloodlineImage && <div className="admin-event-list-preview"><img src={bloodlineImage} alt={bloodlineName} /></div>}
                        <p><strong>{bloodlineName || "Unnamed Bloodline"}</strong> · {rank}</p>
                        <p>Element: {specialElement.trim() || "Fire (default)"} · Offense: {bloodlineOffense}</p>
                        <p>Weather: {weatherElement === "None" ? "None — no weather buff or debuff" : `acts as ${weatherElement}`}</p>
                        {bloodlineLore.trim() && <p className="hint">{bloodlineLore.trim()}</p>}
                    </div>
                    <div className="bloodline-checklist">
                        {[
                            { ok: bloodlineName.trim().length > 0, label: "Bloodline named" },
                            { ok: specialElement.trim().length > 0, label: "Special element set" },
                            { ok: jutsus.every((jj) => jj.name.trim().length > 0), label: `All ${jutsuCount} jutsu named` },
                            { ok: !overLimit, label: `Within ${rank} budget (${currentTotalPoints}/${pointLimit} pts)` },
                        ].map((c, i) => (
                            <div key={i} className={`bloodline-check ${c.ok ? "ok" : "warn"}`}>{c.ok ? "✓" : "•"} {c.label}</div>
                        ))}
                    </div>
                    {jutsus.map((j, i) => (
                        <div className="summary-box bloodline-element-lock" key={j.id}>Jutsu {i + 1}: <strong>{j.name}</strong> — {j.ap} AP · {jutsuPoints(j)} pts<br /><small>{describeJutsuEffects(j)}</small></div>
                    ))}
                    {renderPointTotal()}
                    <button onClick={saveBloodline} disabled={overLimit} style={overLimit ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>Save Bloodline</button>
                    {savedBloodlines.length > 0 && <><h3>Saved</h3>{savedBloodlines.map((b) => <div className="summary-box" key={b.id}>{b.image && <div className="admin-event-list-preview"><img src={b.image} alt={b.name} /></div>}{b.name} | {b.rank} | {b.specialElement ? `${b.specialElement} | ` : ""}Points {b.totalPoints}{b.lore && <p className="hint">{b.lore}</p>}</div>)}</>}
                </div>
            )}

            <div className="bloodline-wizard-nav">
                {step > 0 && <button type="button" className="bloodline-wizard-back" onClick={() => setStep((s) => clampBloodlineWizardStep(s - 1, rank))}>← Back</button>}
                {stepKind !== "review" && (
                    <button
                        type="button"
                        className="bloodline-wizard-next"
                        disabled={stepKind === "details" && !canLeaveBloodlineDetails(bloodlineName)}
                        onClick={() => setStep((s) => clampBloodlineWizardStep(s + 1, rank))}
                    >
                        Next →
                    </button>
                )}
            </div>
        </div>
    );
}
