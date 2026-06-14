/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import type { Character } from "../types/character";
import type { Jutsu, JutsuTag, SavedBloodline } from "../types/combat";
import type { JutsuElement, JutsuMethod, JutsuTarget, JutsuType, Rank } from "../types/core";
import { JUTSU_MAX_LEVEL } from "../constants/game";
import { allTags, binaryTags, bloodlineUniqueTags, cappedDamageTags, percentageTags, hasFixedEffectPower, normalizeJutsuTags, tagCapForRank } from "../lib/tags";
import { bloodlinePoints, jutsuPoints, jutsuCountForRank, pointBudgetForRank, normalizeBloodlineTagPercent } from "../lib/jutsu-points";
import { compressDataUrl, publishSharedImage, readImageFile } from "../lib/shared-images";
import { formatJutsuResourcePercent, jutsuResourceBackingCost, lockJutsuResourceCosts } from "../lib/jutsu-scaling";
import { normalizeJutsu, blankJutsu } from "../lib/jutsu";
import { makeId } from "../lib/utils";
import { replaceCharacterBloodline } from "../lib/bloodline";
import { specialties, bloodlineJutsuMethods, fortyApBlockedBloodlineTags, instantEffectGroundTags, jutsuTargets } from "../data/jutsu";
import { AiImagePrompt } from "../components/AiImagePrompt";
import { TagPicker } from "../components/TagPicker";

export function BloodlineMaker({ initialRank, initialSpecialElement, character, updateCharacter, savedBloodlines, setSavedBloodlines, lockedRank, editingBloodline, onSaveBloodlines }: { initialRank: Rank; initialSpecialElement?: string; character: Character; updateCharacter: (character: Character) => void; savedBloodlines: SavedBloodline[]; setSavedBloodlines: (bloodlines: SavedBloodline[]) => void; lockedRank?: boolean; editingBloodline?: SavedBloodline | null; onSaveBloodlines?: (bloodlines: SavedBloodline[], character?: Character) => void; onClose?: () => void }) {
    const [rank, setRank] = useState<Rank>(editingBloodline?.rank ?? initialRank);
    const [bloodlineName, setBloodlineName] = useState(editingBloodline?.name ?? "Custom Bloodline");
    const [bloodlineLore, setBloodlineLore] = useState(editingBloodline?.lore ?? "");
    const [bloodlineImage, setBloodlineImage] = useState(editingBloodline?.image ?? "");
    const [specialElement, setSpecialElement] = useState(editingBloodline?.specialElement ?? initialSpecialElement ?? "");
    const [bloodlineOffense, setBloodlineOffense] = useState<JutsuType>((editingBloodline?.jutsus[0]?.type ?? "Ninjutsu") as JutsuType);
    const [jutsus, setJutsus] = useState<Jutsu[]>(editingBloodline?.jutsus ?? Array.from({ length: jutsuCountForRank(initialRank) }).map((_, i) => blankJutsu(i, initialRank)));
    const recommendedMax = pointBudgetForRank(rank);

    useEffect(() => {
        if (editingBloodline) {
            setRank(editingBloodline.rank);
            setBloodlineName(editingBloodline.name);
            setBloodlineLore(editingBloodline.lore ?? "");
            setBloodlineImage(editingBloodline.image ?? "");
            setSpecialElement(editingBloodline.specialElement ?? "");
            setBloodlineOffense((editingBloodline.jutsus[0]?.type ?? "Ninjutsu") as JutsuType);
            setJutsus(editingBloodline.jutsus.map((j) =>
                j.ap === 40
                    ? { ...j, effectPower: 0 }
                    // Fixed-effect 60-AP jutsu deal standard damage (40) — clamp away
                    // any legacy EP-100 sentinel so the editor shows the real value.
                    : hasFixedEffectPower(j)
                    ? { ...j, effectPower: 40 }
                    : j.ap === 60 && ![40, 50].includes(j.effectPower)
                    ? { ...j, effectPower: 40 }
                    : j
            ));
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
        setJutsus(Array.from({ length: jutsuCountForRank(newRank) }).map((_, i) => normalizeJutsu({
            ...blankJutsu(i, newRank),
            element: (specialElement || "Fire") as JutsuElement,
        })));
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
            const next = normalizeJutsu(lockJutsuResourceCosts({ ...jutsu, ...updated }));
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
                if (jutsu.ap === 40 && fortyApBlockedBloodlineTags.includes(tag.name)) return false;
                if (seenJutsuTags.has(tag.name)) return false;
                seenJutsuTags.add(tag.name);
                if (bloodlineUniqueTags.includes(tag.name)) {
                    if (usedUniqueTags.has(tag.name)) return false;
                    usedUniqueTags.add(tag.name);
                }
                return true;
            });
            return normalizeJutsu({
            ...lockJutsuResourceCosts(jutsu),
            type: bloodlineOffense,
            element: finalElement,
            method: finalMethod,
            range: jutsu.target === "SELF" ? 0 : jutsu.range,
            cooldown: 7,
            effectPower: jutsu.ap === 40 ? 0 : hasFixedEffectPower(jutsu) ? 40 : jutsu.ap === 60 ? (jutsu.effectPower === 50 ? 50 : 40) : jutsu.effectPower,
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
        const newBloodline = { id: finalId, name: bloodlineName, rank, image: bloodlineImage, specialElement: specialElement.trim(), lore: bloodlineLore.trim(), jutsus: finalizedJutsus, totalPoints: bloodlinePoints(finalizedJutsus) };
        // When creating a NEW bloodline (not editing), discard every other
        // user-saved bloodline — players keep at most one custom bloodline
        // at a time, and the new one auto-equips below via
        // replaceCharacterBloodline. Editing replaces the existing entry
        // in place, preserving the previous id.
        const nextBloodlines = editingBloodline
            ? savedBloodlines.map((b) => b.id === finalId ? newBloodline : b)
            : [newBloodline];
        const nextCharacter = replaceCharacterBloodline(character, newBloodline, savedBloodlines);
        setSavedBloodlines(nextBloodlines);
        updateCharacter(nextCharacter);
        onSaveBloodlines?.(nextBloodlines, nextCharacter);
        alert(imageSaveFailed ? `${bloodlineName} saved, but one or more images did not upload to shared storage.` : `${bloodlineName} saved.`);
    }
    return (
        <div className="card bloodline-maker-screen global-menu-panel">
            <h2>Bloodline Maker</h2>
            <label>Name</label><input value={bloodlineName} onChange={(e) => setBloodlineName(e.target.value)} />
            <label>Bloodline Text / Lore</label><textarea rows={3} value={bloodlineLore} onChange={(e) => setBloodlineLore(e.target.value)} placeholder="Describe what this bloodline is, where it comes from, or what makes it special." />
            <label>Special Element</label><input value={specialElement} onChange={(e) => setBloodlineSpecialElement(e.target.value)} placeholder="Example: Crystal, Lava, Storm, Shadow Flame" />
            <label>Offense Choice</label>
            <select value={bloodlineOffense} onChange={(e) => setBloodlineOffenseChoice(e.target.value as JutsuType)}>{specialties.map((s) => <option key={s}>{s}</option>)}</select>
            <small className="tag-effect-help">Applies to 60 AP damage jutsu. 40 AP utility jutsu are element-only (Any) — their buffs/debuffs affect all offenses.</small>
            <label>Bloodline Image</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) readImageFile(file, setBloodlineImage, 100); }} />
            <AiImagePrompt label="Bloodline Image" suggestedPrompt={`${bloodlineName}, ${specialElement || "chakra"} bloodline symbol`} onImage={async (image) => setBloodlineImage(await compressDataUrl(image, 512, 0.82))} />
            {bloodlineImage && <div className="admin-event-list-preview"><img src={bloodlineImage} alt={bloodlineName} /></div>}
            <label>Rank</label>
            {lockedRank
                ? <div className="bloodline-rank-locked">{rank} <span className="rank-lock-badge">🔒 Locked</span></div>
                : <select value={rank} onChange={(e) => changeRank(e.target.value as Rank)}><option>B Rank</option><option>A Rank</option><option>S Rank</option></select>
            }
            <div className="summary-box"><p>Total Points: {totalPoints} / {recommendedMax}</p>{specialElement.trim() && <p>Special Element: {specialElement.trim()}</p>}</div>
            {jutsus.map((jutsu, jutsuIndex) => (
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
                            {bloodlineJutsuMethods.map((method) => <option key={method} value={method}>{method === "AOE_CIRCLE" ? "AOE_CIRCLE (Move + Ring Damage)" : method === "INSTANT_EFFECT" ? "Instant Effect (Ground Burst)" : method}</option>)}
                        </select>
                    </div>
                    {jutsu.method === "AOE_CIRCLE" && <div className="summary-box bloodline-element-lock">AOE Circle: you move to a chosen tile, then deal damage to every hex surrounding your destination. Move tag is required and auto-added. If the opponent is adjacent to your landing tile, they take the hit.</div>}
                    {jutsu.method === "INSTANT_EFFECT" && <div className="summary-box bloodline-element-lock">Instant Effect: target is locked to GROUND. Click an open ground tile in battle; that tile and its surrounding hexes become a 2-round defensive zone. Decrease Damage Given, Recoil, or Poison apply immediately if the enemy is caught and again while they stand in it. Costs +1 jutsu point.</div>}
                    <label>AP Type</label>
                    <div className="admin-ap-toggle">
                        <button className={jutsu.ap === 40 ? "active" : ""} onClick={() => updateJutsuAp(jutsuIndex, 40)}>40 AP Utility</button>
                        <button className={jutsu.ap === 60 ? "active" : ""} onClick={() => updateJutsuAp(jutsuIndex, 60)}>60 AP Damage</button>
                    </div>
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
                            : jutsu.ap === 40
                                ? allTags.filter((tagName) => !fortyApBlockedBloodlineTags.includes(tagName))
                                : undefined;
                        return <TagPicker key={tagIndex} rank={rank} jutsuTarget={jutsu.target} allowedTags={allowedTags} tag={currentTag} disabledTags={disabledTags} setTag={(name) => updateTag(jutsuIndex, tagIndex, { name })} percent={jutsu.tags[tagIndex]?.percent ?? 30} setPercent={(percent) => updateTag(jutsuIndex, tagIndex, { percent })} />;
                    })}
                    <p>Jutsu Points: {jutsuPoints(jutsu)}</p>
                </div>
            ))}
            <div style={{ margin: "8px 0", padding: "8px 12px", borderRadius: 8, background: overLimit ? "rgba(220,50,50,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${overLimit ? "rgba(220,50,50,0.5)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 600, color: overLimit ? "#ff6b6b" : "inherit" }}>Total Points: {currentTotalPoints} / {pointLimit}</span>
                {overLimit && <span style={{ color: "#ff6b6b", fontSize: "0.85em" }}>⚠️ Over the {rank} limit — reduce tags to save.</span>}
            </div>
            <button onClick={saveBloodline} disabled={overLimit} style={overLimit ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>Save Bloodline</button>
            <h3>Saved</h3>{savedBloodlines.map((b) => <div className="summary-box" key={b.id}>{b.image && <div className="admin-event-list-preview"><img src={b.image} alt={b.name} /></div>}{b.name} | {b.rank} | {b.specialElement ? `${b.specialElement} | ` : ""}Points {b.totalPoints}{b.lore && <p className="hint">{b.lore}</p>}</div>)}
        </div>
    );
}
