import { useState, useEffect, type ChangeEvent } from "react";
import type { Character } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline, Stats } from "../types/combat";
import type { JutsuType } from "../types/core";
import { ACHIEVEMENTS, achievementReward, type Achievement } from "../constants/achievements";
import { ANIMATED_MAX_MB, CHARACTER_XP_GAIN_MULTIPLIER, MAX_LEVEL, MAX_STAT } from "../constants/game";
import { ChangePasswordCard } from "../components/ChangePasswordCard";
import { JutsuDropdownList } from "../components/JutsuDropdownList";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { ProfessionRankBar } from "../screens/ProfessionRankBar";
import { MasteryPanel } from "../components/MasteryPanel";
import { auraSphereDustNeeded, getActiveAuraSphereBonuses, hasEquippedAuraSphere } from "../lib/aura-sphere";
import { canEquipElementJutsu } from "../lib/bloodline";
import { capStat, xpNeeded } from "../lib/stats";
import { compressDataUrl, isAnimatedImageFile, publishSharedImage } from "../lib/shared-images";
import { describeJutsuEffects, jutsuDisplayAtLevel } from "../lib/jutsu-effects";
import { getAllItems, getItemById } from "../lib/items";
import { getCharacterElements } from "../lib/elements";
import { getJutsuMastery } from "../lib/jutsu-scaling";
import { itemSectionOptions } from "../lib/equipment";
import { getAllJutsus, playerLensDiscipline } from "../App";

export function Profile({
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    onDeleteCharacter,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorItems: GameItem[];
    onDeleteCharacter?: () => void;
}) {
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const allItems = getAllItems(creatorItems);
    const equippedItems = itemSectionOptions
        .map(({ value }) => getItemById(allItems, character.equipment[value]))
        .filter((item): item is GameItem => Boolean(item));
    const equippedBloodline = savedBloodlines.find((b) => b.id === character.equippedBloodlineId);
    const auraSphereEquipped = hasEquippedAuraSphere(character);
    const auraBonuses = getActiveAuraSphereBonuses(character);
    const auraDustNeeded = auraSphereDustNeeded(character.auraSphereLevel);
    const ownedElements = getCharacterElements(character);
    function feedAuraSphere() {
        if (character.auraSphereLevel >= 300) return alert("Your Aura Sphere is already eternal.");
        if ((character.auraDust ?? 0) < auraDustNeeded) return alert(`You need ${auraDustNeeded} Aura Dust.`);
        updateCharacter({
            ...character,
            auraDust: character.auraDust - auraDustNeeded,
            auraSphereLevel: character.auraSphereLevel + 1,
        });
    }

    function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return alert("Please upload an image file.");

        void (async () => {
            const animated = await isAnimatedImageFile(file);
            if (animated && file.size > ANIMATED_MAX_MB * 1024 * 1024) {
                return alert(`Animated avatars must be under ${ANIMATED_MAX_MB} MB so animation is preserved (compressing would flatten it). Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
            }
            const reader = new FileReader();
            reader.onload = () => {
                // Publish to shared storage FIRST and only adopt the avatar
                // locally if the server accepted it. Otherwise the character
                // would carry an avatarImage no other player can load — and a
                // later autosave could ship a too-large image the save endpoint
                // rejects (server enforces a 2 MB decoded cap + data-URL-only).
                // Fail closed. (#15)
                const apply = async (img: string) => {
                    const ok = await publishSharedImage('avatar:' + character.name.toLowerCase(), img);
                    if (!ok) {
                        alert("Your avatar couldn't be saved to the server — it may be too large. Please try a smaller image.");
                        return;
                    }
                    updateCharacter({ ...character, avatarImage: img });
                };
                const dataUrl = String(reader.result);
                if (animated) {
                    // Skip canvas compression — it would strip every frame
                    // after the first and turn the avatar back into a still.
                    void apply(dataUrl);
                } else {
                    // Compress to 256px — avatars are displayed at ≤84px so 512 is wasteful
                    void compressDataUrl(dataUrl, 256, 0.80).then(apply);
                }
            };
            reader.readAsDataURL(file);
        })();
    }

    const [statInputs, setStatInputs] = useState<Partial<Record<keyof Stats, number>>>({});
    const [statWarning, setStatWarning] = useState("");
    const [titleInput, setTitleInput] = useState(character.customTitle ?? "");
    const TITLE_COST = 10;
    const [mobileTab, setMobileTab] = useState<'overview' | 'stats' | 'jutsu' | 'achievements'>('overview');
    const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
    // Display-only lens for jutsu effect descriptions — names a discipline so
    // damage tags read e.g. "Taijutsu damage given". Defaults to the player's
    // bloodline/specialty discipline. Purely cosmetic — does not touch stats.
    const [tagLensDiscipline, setTagLensDiscipline] = useState<JutsuType>(() => playerLensDiscipline(character));

    useEffect(() => {
        if (!selectedAchievement) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedAchievement(null); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedAchievement]);

    function formatStatLabel(name: string) {
        return name
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase());
    }

    function addStat(stat: keyof Stats) {
        const amount = Math.max(0, Math.floor(statInputs[stat] ?? 1));
        if (amount === 0) return;
        if (amount > character.unspentStats) {
            setStatWarning(`Not enough points — only ${character.unspentStats} remaining.`);
            setTimeout(() => setStatWarning(""), 3000);
            return;
        }
        const newValue = capStat(character.stats[stat] + amount);
        const actualAdded = newValue - character.stats[stat];
        setStatWarning("");
        setStatInputs((prev) => ({ ...prev, [stat]: 1 }));
        updateCharacter({
            ...character,
            unspentStats: character.unspentStats - actualAdded,
            totalStatsTrained: (character.totalStatsTrained ?? 0) + actualAdded,
            stats: { ...character.stats, [stat]: newValue },
        });
    }

    function purchaseTitle() {
        const trimmed = titleInput.trim().slice(0, 15);
        if (!trimmed) return alert("Enter a title first.");
        if ((character.fateShards ?? 0) < TITLE_COST) return alert(`You need ${TITLE_COST} 🔮 Fate Shards.`);
        updateCharacter({ ...character, customTitle: trimmed, fateShards: character.fateShards - TITLE_COST });
    }

    function clearTitle() {
        updateCharacter({ ...character, customTitle: undefined });
        setTitleInput("");
    }

    function toggleJutsu(id: string) {
        const equipped = character.equippedJutsuIds.includes(id);
        const mastery = getJutsuMastery(character, id);

        if (equipped) {
            updateCharacter({
                ...character,
                equippedJutsuIds: character.equippedJutsuIds.filter((j) => j !== id),
            });
            return;
        }

        if (mastery.level < 1) {
            alert("Train this jutsu to level 1 before equipping it.");
            return;
        }

        const jutsu = allJutsus.find((candidate) => candidate.id === id);
        if (jutsu && !canEquipElementJutsu(character, jutsu, savedBloodlines)) {
            alert(`You need the ${jutsu.element} element to equip this jutsu.`);
            return;
        }

        if (character.equippedJutsuIds.length >= 15) {
            alert("You can only equip 15 jutsu.");
            return;
        }

        updateCharacter({
            ...character,
            equippedJutsuIds: [...character.equippedJutsuIds, id],
            jutsuMastery: character.jutsuMastery.some((m) => m.jutsuId === id)
                ? character.jutsuMastery
                : [...character.jutsuMastery, { jutsuId: id, level: 1, xp: 0 }],
        });
    }

    // Nudge an equipped jutsu one slot left (-1) or right (+1) in the loadout
    // order. The order persists in equippedJutsuIds and drives the combat
    // action-bar order, so this lets players arrange their slots.
    function moveEquippedJutsu(id: string, dir: -1 | 1) {
        const ids = [...character.equippedJutsuIds];
        const from = ids.indexOf(id);
        if (from < 0) return;
        const to = from + dir;
        if (to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        updateCharacter({ ...character, equippedJutsuIds: ids });
    }

    const statGroups: Array<{ title: string; description: string; stats: Array<keyof Stats> }> = [
        {
            title: "General",
            description: "Core stats used across combat and progression.",
            stats: ["speed", "strength", "intelligence", "willpower"],
        },
        {
            title: "Offense",
            description: "Damage scaling by jutsu style.",
            stats: ["bukijutsuOffense", "taijutsuOffense", "genjutsuOffense", "ninjutsuOffense"],
        },
        {
            title: "Defense",
            description: "Damage resistance checks by incoming style.",
            stats: ["bukijutsuDefense", "taijutsuDefense", "genjutsuDefense", "ninjutsuDefense"],
        },
    ];

    function renderStatCard(stat: keyof Stats) {
        const value = character.stats[stat];
        const pct = Math.round((value / MAX_STAT) * 100);
        return (
            <div className="stat-card" key={stat}>
                <div className="stat-card-label">{formatStatLabel(stat)}</div>
                <div className="stat-card-values">
                    <span className="stat-current">{value}</span>
                    <span className="stat-max">/ {MAX_STAT}</span>
                </div>
                <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="stat-card-input-row">
                    <input
                        type="number"
                        min={1}
                        max={character.unspentStats}
                        value={statInputs[stat] ?? 1}
                        onChange={(e) => setStatInputs((prev) => ({ ...prev, [stat]: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="stat-input"
                    />
                    <button
                        className="stat-add-btn"
                        onClick={() => addStat(stat)}
                        disabled={character.unspentStats === 0}
                    >Add</button>
                </div>
            </div>
        );
    }

    return (
        <div className="profile-page-card">
            {/* Mobile-only tab navigation — hidden on desktop via CSS */}
            <nav className="profile-mobile-tabs">
                {([
                    { id: 'overview', label: '👤 Profile' },
                    { id: 'stats',    label: '💪 Stats'   },
                    { id: 'jutsu',    label: '⚡ Jutsu'   },
                    { id: 'achievements', label: '🏆 Achievements' },
                ] as const).map(({ id, label }) => (
                    <button
                        key={id}
                        className={`pmtab${mobileTab === id ? ' pmtab-active' : ''}`}
                        onClick={() => setMobileTab(id)}
                    >{label}</button>
                ))}
            </nav>

            {/* ── Overview tab ─────────────────────────── */}
            <div className={mobileTab !== 'overview' ? 'profile-tab-hidden' : ''}>
            <div className="profile-page-header">
                <div>
                    <h2>Profile</h2>
                    <p>An overview of your shinobi.</p>
                </div>
            </div>

            <section className="profile-overview-panel">
                <div className="profile-avatar-upload-box">
                    <div className={`profile-big-avatar ${auraBonuses.avatarAura ? "aura-sphere-avatar" : ""}`}>
                        {character.avatarImage ? (
                            <img src={character.avatarImage} alt="Avatar" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                            <span>{character.name.slice(0, 2).toUpperCase()}</span>
                        )}
                    </div>

                    <label className="avatar-upload-button">
                        Upload Avatar
                        <input type="file" accept="image/*" onChange={uploadAvatar} />
                    </label>
                </div>

                <div className="profile-info-grid">
                    <div>
                        <h3>General</h3>
                        <p><strong>Name:</strong> {character.name}</p>
                        <p><strong>Village:</strong> {character.village}</p>
                        <p><strong>Rank:</strong> {character.rankTitle}</p>
                        {character.customTitle && <p><strong>Title:</strong> <span style={{ color: "#facc15" }}>{character.customTitle}</span></p>}
                        <p><strong>Level:</strong> {character.level}/100</p>
                        <p><strong>Bloodline:</strong> {equippedBloodline?.name || character.bloodline}</p>
                        <p><strong>Specialty:</strong> {playerLensDiscipline(character)}</p>
                        <p><strong>Elements:</strong> {ownedElements.length ? ownedElements.join(" / ") : "Not awakened"}</p>
                        {character.profession && (
                            <p>
                                <strong>Profession:</strong>{" "}
                                {character.profession === "healer" ? "✚ Healer" : character.profession === "vanguard" ? "⚔ Vanguard" : "🐾 Pet Tamer"}
                                <span style={{ marginLeft: 6, color: "#94a3b8" }}>· Rank {character.professionRank ?? 1} · {(character.professionXp ?? 0).toLocaleString()} XP</span>
                            </p>
                        )}
                        {equippedBloodline?.specialElement && <p><strong>Bloodline Element:</strong> {equippedBloodline.specialElement}</p>}
                        {equippedBloodline?.image && <div className="admin-event-list-preview"><img src={equippedBloodline.image} alt={equippedBloodline.name} /></div>}
                    </div>

                    <div>
                        <h3>Activity</h3>
                        <p><strong>XP:</strong> {character.level >= MAX_LEVEL ? "MAX" : `${character.xp}/${xpNeeded(character.level)}`}</p>
                        {CHARACTER_XP_GAIN_MULTIPLIER !== 1 && <p><strong>Testing XP:</strong> {CHARACTER_XP_GAIN_MULTIPLIER}x active</p>}
                        <p><strong>Ryo:</strong> {character.ryo}</p>
                        <p><strong style={{ color: "#facc15" }}>🛡 Honor Seals:</strong> <span style={{ color: "#facc15" }}>{character.honorSeals ?? 0}</span></p>
                        <p><strong style={{ color: "#fef3c7" }}>✨ Aura Dust:</strong> <span style={{ color: "#fef3c7" }}>{character.auraDust ?? 0}</span></p>
                        <p><strong>Bank:</strong> {character.bankRyo}</p>
                        <p><strong style={{ color: "#ce93d8" }}>🔮 Fate Shards:</strong> <span style={{ color: "#ce93d8" }}>{character.fateShards}</span></p>
                        <p><strong>Jutsu:</strong> {character.equippedJutsuIds.length}/15</p>
                        <p><strong>Equipment:</strong> {equippedItems.length}/3</p>
                    </div>

                    <div>
                        <h3>Resources</h3>
                        <p><strong>HP:</strong> {character.hp}/{character.maxHp}</p>
                        <p><strong>Chakra:</strong> {character.chakra}/{character.maxChakra}</p>
                        <p><strong>Stamina:</strong> {character.stamina}/{character.maxStamina}</p>
                        <p><strong>Regen:</strong> +{1 + auraBonuses.regen} per second outside battle</p>

                        {auraSphereEquipped && (
                            <div className="aura-sphere-inline">
                                <p className="act-label">Aura Sphere</p>
                                <h4>{auraBonuses.rankName}</h4>
                                <p className="aura-sphere-inline-level">
                                    Level {character.auraSphereLevel}/300 · Aura Dust {character.auraDust}/{auraDustNeeded}
                                </p>
                                <div className="aura-sphere-inline-buffs">
                                    {auraBonuses.regen > 0 && <span>Regen +{auraBonuses.regen}</span>}
                                    {auraBonuses.missionRewardPercent > 0 && <span>Mission Rewards +{auraBonuses.missionRewardPercent}%</span>}
                                    {auraBonuses.jutsuTrainingSpeedPercent > 0 && <span>Jutsu Training +{auraBonuses.jutsuTrainingSpeedPercent}%</span>}
                                    {auraBonuses.jutsuXpPercent > 0 && <span>Jutsu XP +{auraBonuses.jutsuXpPercent}%</span>}
                                    {auraBonuses.avatarAura && <span>Golden Avatar Aura</span>}
                                    {auraBonuses.pveDamagePercent > 0 && <span>PvE Damage +{auraBonuses.pveDamagePercent}%</span>}
                                </div>
                                <button
                                    className="aura-sphere-inline-button"
                                    onClick={feedAuraSphere}
                                    disabled={character.auraSphereLevel >= 300 || character.auraDust < auraDustNeeded}
                                >
                                    {character.auraSphereLevel >= 300 ? "Eternal Aura Reached" : `Feed ${auraDustNeeded} Aura Dust`}
                                </button>
                                <p className="hint aura-sphere-inline-hint">
                                    Aura Dust drops from PvP, village raids, boss wins, war contribution, and ancient chests.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="summary-box profile-title-panel">
                <div>
                    <p className="act-label">Custom Title</p>
                    <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: "0.2rem 0 0.75rem" }}>
                        {character.customTitle
                            ? <>Current: <span style={{ color: "#facc15", fontWeight: 700 }}>{character.customTitle}</span></>
                            : "No title set."}
                    </p>
                    <div className="profile-title-row">
                        <input
                            className="profile-title-input"
                            value={titleInput}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitleInput(e.target.value.slice(0, 15))}
                            placeholder="Up to 15 characters"
                            maxLength={15}
                        />
                        <span className="profile-title-counter">{titleInput.length}/15</span>
                        <button
                            className="profile-title-btn"
                            onClick={purchaseTitle}
                            disabled={(character.fateShards ?? 0) < TITLE_COST || !titleInput.trim()}
                        >
                            Set Title — 🔮 {TITLE_COST}
                        </button>
                        {character.customTitle && (
                            <button className="danger-button" onClick={clearTitle}>Clear</button>
                        )}
                    </div>
                </div>
            </section>

            {character.profession && (
                <section className="profile-build-panel">
                    <h2>Profession</h2>
                    <ProfessionRankBar character={character} />
                    <MasteryPanel character={character} updateCharacter={updateCharacter} />
                </section>
            )}

            {onDeleteCharacter && (
                <section className="profile-build-panel">
                    <h2>Account</h2>
                    <ChangePasswordCard playerName={character.name} />
                    <button className="danger-button" onClick={onDeleteCharacter}>Delete Character</button>
                    <p className="hint">Permanently deletes your character and save data. This cannot be undone.</p>
                </section>
            )}

            </div>{/* end overview tab */}

            {/* ── Stats tab ────────────────────────────── */}
            <div className={mobileTab !== 'stats' ? 'profile-tab-hidden' : ''}>
            <section className="profile-build-panel">
                <div className="stat-header">
                    <h2>User Stats</h2>
                    <span className={`stat-points-badge ${character.unspentStats === 0 ? "stat-points-empty" : ""}`}>
                        {character.unspentStats} point{character.unspentStats !== 1 ? "s" : ""} available
                    </span>
                </div>
                {statWarning && <p className="stat-warning">{statWarning}</p>}

                <div className="stat-group-list">
                    {statGroups.map((group) => (
                        <section className="stat-group" key={group.title}>
                            <div className="stat-group-heading">
                                <h3>{group.title}</h3>
                                <span>{group.description}</span>
                            </div>
                            <div className="stat-grid">
                                {group.stats.map(renderStatCard)}
                            </div>
                        </section>
                    ))}
                </div>
            </section>
            </div>{/* end stats tab */}

            {/* ── Jutsu tab ────────────────────────────── */}
            <div className={mobileTab !== 'jutsu' ? 'profile-tab-hidden' : ''}>
            <section className="profile-build-panel">
                <div className="stat-header">
                    <h2>Jutsu Loadout: {character.equippedJutsuIds.length}/15</h2>
                    <button
                        className="danger-button"
                        onClick={() => updateCharacter({ ...character, equippedJutsuIds: [] })}
                        disabled={character.equippedJutsuIds.length === 0}
                    >
                        Unequip All
                    </button>
                </div>
                <div className="jutsu-lens-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 10px" }}>
                    <label htmlFor="jutsu-lens-discipline" style={{ fontSize: "0.82rem", color: "#94a3b8" }}>Read effects as:</label>
                    <select
                        id="jutsu-lens-discipline"
                        value={tagLensDiscipline}
                        onChange={(e) => setTagLensDiscipline(e.target.value as JutsuType)}
                    >
                        {(["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"] as JutsuType[]).map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                    <span className="hint" style={{ fontSize: "0.74rem" }}>Display only — labels damage effects with this discipline. Does not change your stats.</span>
                </div>
                {(() => {
                    const learnedAnyJutsus = allJutsus.filter((j) => getJutsuMastery(character, j.id).level >= 1);
                    const learnedJutsus = allJutsus.filter((j) => getJutsuMastery(character, j.id).level >= 1 && canEquipElementJutsu(character, j, savedBloodlines));
                    if (learnedJutsus.length === 0) {
                        return <p className="hint">{learnedAnyJutsus.length ? "Your learned jutsu are locked behind elements you do not currently have." : "You haven't trained any jutsu yet. Visit the Training Grounds to learn them."}</p>;
                    }
                    // Order by equippedJutsuIds (the saved loadout order) — not allJutsus
                    // order — so the reorder arrows visibly move slots and the grid mirrors
                    // the in-battle action-bar order.
                    const equippedJutsus = character.equippedJutsuIds
                        .map((id) => learnedJutsus.find((j) => j.id === id))
                        .filter((j): j is Jutsu => Boolean(j));
                    const availableJutsus = learnedJutsus.filter((j) => !character.equippedJutsuIds.includes(j.id));
                    const jutsuDetails = (jutsu: Jutsu) => {
                        const mastery = getJutsuMastery(character, jutsu.id);
                        const displayJutsu = jutsuDisplayAtLevel(jutsu, mastery.level);
                        return (
                            <>
                                <p>Level {mastery.level}/50 | {jutsu.type} | {jutsu.element} | {jutsu.ap} AP | R{jutsu.range} | EP {displayJutsu.effectPower}</p>
                                <p>Tags: {displayJutsu.tags.map((tag) => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ""}`).join(", ") || "None"}</p>
                                <p><strong>Effects:</strong> {describeJutsuEffects(jutsu, mastery.level, tagLensDiscipline)}</p>
                                <JutsuEffectCards jutsu={jutsu} masteryLevel={mastery.level} lensDiscipline={tagLensDiscipline} />
                            </>
                        );
                    };
                    return (
                        <>
                            {equippedJutsus.length > 0 && (
                                <>
                                    <h4 style={{ margin: "8px 0 4px", color: "#86efac", fontSize: "0.82rem" }}>✅ Equipped ({equippedJutsus.length})</h4>
                                    <JutsuDropdownList
                                        jutsus={equippedJutsus}
                                        label="Equipped Jutsu"
                                        renderDetails={jutsuDetails}
                                        renderActions={(jutsu) => <button className="danger-button" onClick={() => toggleJutsu(jutsu.id)}>Unequip</button>}
                                        onReorder={moveEquippedJutsu}
                                    />
                                </>
                            )}
                            {availableJutsus.length > 0 && (
                                <>
                                    <h4 style={{ margin: "10px 0 4px", color: "#94a3b8", fontSize: "0.82rem" }}>📚 Not Equipped ({availableJutsus.length})</h4>
                                    <JutsuDropdownList
                                        jutsus={availableJutsus}
                                        label="Available Jutsu"
                                        renderDetails={jutsuDetails}
                                        renderActions={(jutsu) => <button onClick={() => toggleJutsu(jutsu.id)}>Equip</button>}
                                    />
                                </>
                            )}
                        </>
                    );
                })()}
            </section>
            </div>{/* end jutsu tab */}

            {/* ── Achievements tab ─────────────────────── */}
            <div className={mobileTab !== 'achievements' ? 'profile-tab-hidden' : ''}>
            <section className="achievements-panel">
                <div className="achievements-heading">
                    <h3>Achievements</h3>
                    <span className="achievements-count">
                        {ACHIEVEMENTS.filter(a => a.check(character)).length}/{ACHIEVEMENTS.length} unlocked
                    </span>
                </div>
                {(() => {
                    const unlocked = ACHIEVEMENTS.filter(a => a.check(character));
                    if (unlocked.length === 0) {
                        return <p className="hint">No achievements unlocked yet. Earn one to see it appear here.</p>;
                    }
                    return (
                        <div className="achievements-grid">
                            {unlocked.map(a => {
                                const unlockedAt = character.achievementUnlockedAt?.[a.id];
                                const unlockedAtLabel = unlockedAt ? new Date(unlockedAt).toLocaleDateString() : null;
                                const classes = [
                                    "achievement-badge",
                                    "unlocked",
                                    a.hidden ? "is-secret" : "",
                                ].filter(Boolean).join(" ");
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        className={classes}
                                        onClick={() => setSelectedAchievement(a)}
                                        title={`${a.name} — click for details`}
                                    >
                                        <div className="achievement-icon">
                                            <img
                                                src={`/badges/${a.id}.png`}
                                                alt=""
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                                            />
                                            <span className="achievement-emoji" aria-hidden>{a.icon}</span>
                                        </div>
                                        <div className="achievement-meta">
                                            <strong>{a.name}</strong>
                                            <small>{a.desc}</small>
                                            {unlockedAtLabel && <small className="achievement-unlocked-at">Unlocked {unlockedAtLabel}</small>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    );
                })()}
            </section>
            </div>{/* end achievements tab */}

            {selectedAchievement && (
                <div className="achievement-detail-overlay" onClick={() => setSelectedAchievement(null)}>
                    <div
                        className={`achievement-detail-card ${selectedAchievement.hidden ? "is-secret" : ""}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="achievement-detail-close"
                            type="button"
                            onClick={() => setSelectedAchievement(null)}
                            aria-label="Close"
                        >×</button>

                        <div className="achievement-detail-badge">
                            <img
                                src={`/badges/${selectedAchievement.id}.png`}
                                alt=""
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                            />
                            <span className="achievement-detail-emoji" aria-hidden>{selectedAchievement.icon}</span>
                        </div>

                        <p className="achievement-detail-category">
                            {selectedAchievement.hidden ? "Secret · " : ""}{selectedAchievement.category}
                        </p>
                        <h2 className="achievement-detail-name">{selectedAchievement.name}</h2>
                        <p className="achievement-detail-desc">{selectedAchievement.desc}</p>
                        {(() => {
                            const r = achievementReward(selectedAchievement);
                            return <p className="achievement-detail-desc"><strong>Reward:</strong> {r.ryo.toLocaleString()} ryo{r.fateShards ? ` · ${r.fateShards} Fate Shard${r.fateShards > 1 ? "s" : ""}` : ""}</p>;
                        })()}
                        {(() => {
                            const at = character.achievementUnlockedAt?.[selectedAchievement.id];
                            return at ? (
                                <p className="achievement-detail-date">
                                    Unlocked {new Date(at).toLocaleString()}
                                </p>
                            ) : null;
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}
// UserHub moved to ./screens/UserHub.

// UserView moved to ./screens/UserView.
