import { useState, useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import "../styles/profile-skin.css";
import "../styles/training-skin.css";
import type { Character, VersionedCharacterCommit } from "../types/character";
// Currency lines reuse the game's own emblem set so they match the HUD.
import { GameIcon } from "../components/icons/GameIcon";
const PF_COST = { verticalAlign: "-2px", marginRight: "3px" } as const;
import type { GameItem, Jutsu, SavedBloodline, Stats } from "../types/combat";
import { ACHIEVEMENTS, achievementReward, type Achievement } from "../constants/achievements";
import { ANIMATED_MAX_MB, MAX_LEVEL, MAX_STAT } from "../constants/game";
import { ChangePasswordCard } from "../components/ChangePasswordCard";
import { PatreonLink } from "../components/PatreonLink";
import { maxLoadout, canCustomAvatar } from "../lib/entitlements";
import { gameConfirm } from "../components/GameAlert";
import { JutsuLoadoutPanel } from "../components/JutsuLoadoutPanel";
import { NindoEditor } from "../components/NindoEditor";
import { ProgressionPanel } from "../components/ProgressionPanel";
import { ShinobiIdentityCard } from "../components/ShinobiIdentityCard";
import { LegacyPanel } from "./LegacyPanel";
import { BattleLogHistoryPanel } from "../components/BattleLogHistoryPanel";
import { TITLE_STYLES, TITLE_ICONS, TITLE_STYLE_COST, TITLE_ICON_COST, titleStyleColor, isLegacyServerLive, useLegacyAvailability } from "../lib/legacy";
import { auraSphereDustNeeded, getActiveAuraSphereBonuses, hasEquippedAuraSphere } from "../lib/aura-sphere";
import { feedAuraSphereServer } from "../lib/aura-feed-api";
import { canEquipElementJutsu } from "../lib/bloodline";
import { allocatedStatPoints, capStat, earnedForLevel, earnedStatPoints } from "../lib/stats";
import { compressDataUrl, isAnimatedImageFile, publishSharedImage } from "../lib/shared-images";
import { getAllItems, getItemById } from "../lib/items";
import { getCharacterElements } from "../lib/elements";
import { getJutsuMastery } from "../lib/jutsu-scaling";
import { getAllJutsus, playerLensDiscipline } from "../App";
import { settleProfileAction, type ProfileSettlementAction } from "../lib/profile-settlement";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";

type ProfileDossierRow = {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    tone?: "neutral" | "gold" | "danger" | "village" | "legacy";
};

type ProfileDossierSection = {
    title: string;
    rows: ProfileDossierRow[];
};

export function Profile({
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    onDeleteCharacter,
    onOpenBattle,
    onVersionedCharacter,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorItems: GameItem[];
    onDeleteCharacter?: () => void;
    /** Opens the durable read-only battle record (Screen "battleLog"). */
    onOpenBattle?: (battleId: string) => void;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    const legacyAvailable = useLegacyAvailability();
    const [feedingAura, setFeedingAura] = useState(false);
    const feedingAuraRef = useRef(false);
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const allItems = getAllItems(creatorItems);
    // Every distinct equipped id across all slots (weapon, armor pieces, the
    // three combat-item slots, throwable, potion, aura, …). Deduped so legacy
    // alias keys (weapon/armor/accessory) don't double-count.
    const equippedItems = Array.from(
        new Set(Object.values(character.equipment ?? {}).filter((id): id is string => Boolean(id)))
    )
        .map((id) => getItemById(allItems, id))
        .filter((item): item is GameItem => Boolean(item));
    const equippedBloodline = savedBloodlines.find((b) => b.id === character.equippedBloodlineId);
    const auraSphereEquipped = hasEquippedAuraSphere(character);
    const auraBonuses = getActiveAuraSphereBonuses(character);
    const auraDustNeeded = auraSphereDustNeeded(character.auraSphereLevel);
    const ownedElements = getCharacterElements(character);
    async function feedAuraSphere() {
        if (character.auraSphereLevel >= 300) return alert("Your Aura Sphere is already eternal.");
        if ((character.auraDust ?? 0) < auraDustNeeded) return alert(`You need ${auraDustNeeded} Aura Dust.`);
        if (feedingAuraRef.current) return;
        feedingAuraRef.current = true;
        setFeedingAura(true);
        try {
            updateCharacter(await feedAuraSphereServer(character.name));
        } catch (error) {
            alert(error instanceof Error ? error.message : "Aura Sphere feed failed.");
        } finally {
            feedingAuraRef.current = false;
            setFeedingAura(false);
        }
    }

    function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
        if (!canCustomAvatar(character)) {
            event.target.value = "";
            return alert("Custom avatars are a Shinobi Supporter perk. Link your Patreon to unlock custom avatars.");
        }

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
                    updateCharacter((prev) => prev ? ({ ...prev, avatarImage: img }) : prev);
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
    const [profileMutationBusy, setProfileMutationBusy] = useState(false);
    const profileMutationBusyRef = useRef(false);
    // Title style/icon pickers are a Legacy-wave feature: shown only once the
    // SERVER's ENABLE_LEGACY is confirmed live (session-cached probe), so a
    // player can never spend shards on a cosmetic the save sanitizer would
    // strip while the flag is still off.
    const [legacyLive, setLegacyLive] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void isLegacyServerLive().then((live) => { if (!cancelled) setLegacyLive(live); });
        return () => { cancelled = true; };
    }, []);
    const TITLE_COST = 10;
    const [mobileTab, setMobileTab] = useState<'overview' | 'stats' | 'jutsu' | 'achievements' | 'battlelogs' | 'legacy'>('overview');
    const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
    async function runPaidProfileAction(action: ProfileSettlementAction): Promise<boolean> {
        const result = await settleProfileAction(character.name, action);
        if (!result.ok) {
            alert(result.error);
            return false;
        }
        return onVersionedCharacter(result.character, result._saveVersion) !== false;
    }

    async function runProfileMutation(action: () => Promise<boolean>): Promise<boolean> {
        if (profileMutationBusyRef.current) return false;
        profileMutationBusyRef.current = true;
        setProfileMutationBusy(true);
        try {
            return await action();
        } finally {
            profileMutationBusyRef.current = false;
            setProfileMutationBusy(false);
        }
    }

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

    // Pay Fate Shards to reset all 12 stats to base and refund EVERY earned point
    // (from training + combat) into the allocatable unspent pool to re-spend as you
    // wish. Two-axis model: nothing is lost, only rearranged — a respec never nukes
    // hard-earned training time. The save sanitizer allows stat DECREASES freely
    // (only gains are clamped), so this client write persists cleanly. HP/Chakra/
    // Stamina pools are untouched (they are not allocatable stats).
    async function respecStats() {
        if (!requireServerSettlement("profileStatRespec")) return;
        const RESPEC_COST = 50;
        if ((character.fateShards ?? 0) < RESPEC_COST) {
            setStatWarning(`Respec costs ${RESPEC_COST} 🔮 Fate Shards — you have ${character.fateShards ?? 0}.`);
            setTimeout(() => setStatWarning(""), 4000);
            return;
        }
        const refund = allocatedStatPoints(character.stats);
        if (refund <= 0) {
            setStatWarning("Nothing to respec — all stats are already at base.");
            setTimeout(() => setStatWarning(""), 4000);
            return;
        }
        await runProfileMutation(async () => {
            if (!(await gameConfirm(`Reset all 12 stats to base and refund every earned point (${refund}) into your allocatable pool for ${RESPEC_COST} 🔮 Fate Shards? Nothing is lost — you re-allocate as you wish.`))) return false;
            setStatWarning("");
            return runPaidProfileAction({ type: 'respec-stats' });
        });
    }

    async function mutateProfileTitle(action: 'title' | 'style' | 'icon', value: string): Promise<boolean> {
        try {
            const response = await fetch('/api/player/profile-title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, action, value }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.character) { alert(String(data?.error ?? AMBIGUOUS_ACTION_MESSAGE)); return false; }
            return onVersionedCharacter(data.character as Character, data._saveVersion) !== false;
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
            return false;
        }
    }

    async function purchaseTitle() {
        if (!requireServerSettlement("profileFateShardTitle")) return;
        const trimmed = titleInput.trim().slice(0, 15);
        if (!trimmed) return alert("Enter a title first.");
        if ((character.fateShards ?? 0) < TITLE_COST) return alert(`You need ${TITLE_COST} 🔮 Fate Shards.`);
        await runProfileMutation(async () => {
            if (!(await gameConfirm(`Set your custom title to “${trimmed}” for ${TITLE_COST} 🔮 Fate Shards?`, { title: "Custom Title", confirmLabel: "Set Title" }))) return false;
            return runPaidProfileAction({ type: 'purchase-title', title: trimmed });
        });
    }

    async function clearTitle() {
        await runProfileMutation(async () => {
            const changed = await mutateProfileTitle('title', '');
            if (changed) setTitleInput("");
            return changed;
        });
    }

    // Title cosmetics (handoff pricing tiers): style color + icon are paid
    // once per change; both are server-allowlisted at save time so nothing
    // outside the pickers ever persists. Cosmetic only — never stats.
    async function purchaseTitleStyle(styleId: string) {
        if (!requireServerSettlement("profileFateShardTitle")) return;
        if ((character.customTitleStyle ?? "") === styleId) return;
        if (styleId !== "" && (character.fateShards ?? 0) < TITLE_STYLE_COST) {
            return alert(`Title styles cost ${TITLE_STYLE_COST} 🔮 Fate Shards.`);
        }
        const cost = styleId === "" ? 0 : TITLE_STYLE_COST;
        await runProfileMutation(async () => {
            if (cost > 0 && !(await gameConfirm(`Restyle your title for ${cost} 🔮 Fate Shards?`, { title: "Title Style", confirmLabel: "Restyle" }))) return false;
            return styleId === ''
                ? mutateProfileTitle('style', styleId)
                : runPaidProfileAction({ type: 'purchase-title-style', styleId });
        });
    }
    async function purchaseTitleIcon(icon: string) {
        if (!requireServerSettlement("profileFateShardTitle")) return;
        if ((character.customTitleIcon ?? "") === icon) return;
        if (icon !== "" && (character.fateShards ?? 0) < TITLE_ICON_COST) {
            return alert(`Title icons cost ${TITLE_ICON_COST} 🔮 Fate Shards.`);
        }
        const cost = icon === "" ? 0 : TITLE_ICON_COST;
        await runProfileMutation(async () => {
            if (cost > 0 && !(await gameConfirm(`Add ${icon} to your title for ${cost} 🔮 Fate Shards?`, { title: "Title Icon", confirmLabel: "Add Icon" }))) return false;
            return icon === ''
                ? mutateProfileTitle('icon', icon)
                : runPaidProfileAction({ type: 'purchase-title-icon', icon });
        });
    }

    // Wear an earned title (free) — earned titles come from title-granting
    // achievements (see TITLE_ACHIEVEMENT_IDS), distinct from the paid free-text
    // custom title below.
    async function equipTitle(title: string) {
        await runProfileMutation(async () => {
            const changed = await mutateProfileTitle('title', title);
            if (changed) setTitleInput(title);
            return changed;
        });
    }

    function unequipJutsu(id: string) {
        if (!character.equippedJutsuIds.includes(id)) return;
        updateCharacter({
            ...character,
            equippedJutsuIds: character.equippedJutsuIds.filter((jutsuId) => jutsuId !== id),
        });
    }

    function placeJutsuInLoadout(id: string, slotIndex = character.equippedJutsuIds.length) {
        const equippedIndex = character.equippedJutsuIds.indexOf(id);
        if (equippedIndex >= 0) {
            const ids = character.equippedJutsuIds.filter((jutsuId) => jutsuId !== id);
            ids.splice(Math.min(Math.max(0, slotIndex), ids.length), 0, id);
            updateCharacter({ ...character, equippedJutsuIds: ids });
            return;
        }

        const mastery = getJutsuMastery(character, id);
        if (mastery.level < 1) {
            alert("Train this jutsu to level 1 before equipping it.");
            return;
        }

        const jutsu = allJutsus.find((candidate) => candidate.id === id);
        if (jutsu && !canEquipElementJutsu(character, jutsu, savedBloodlines)) {
            alert(`You need the ${jutsu.element} element to equip this jutsu.`);
            return;
        }

        const loadoutCap = maxLoadout(character);
        if (character.equippedJutsuIds.length >= loadoutCap) {
            alert(loadoutCap < 15
                ? `You can only equip ${loadoutCap} jutsu. Link your Patreon (Shinobi Supporter) to equip 15.`
                : "You can only equip 15 jutsu.");
            return;
        }

        const ids = [...character.equippedJutsuIds];
        ids.splice(Math.min(Math.max(0, slotIndex), ids.length), 0, id);
        updateCharacter({
            ...character,
            equippedJutsuIds: ids,
            jutsuMastery: character.jutsuMastery.some((m) => m.jutsuId === id)
                ? character.jutsuMastery
                : [...character.jutsuMastery, { jutsuId: id, level: 1, xp: 0 }],
        });
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

    const formatAmount = (value: number | undefined) => (
        Number.isFinite(value) ? Math.max(0, Math.floor(value as number)).toLocaleString() : "0"
    );
    const equippedBloodlineName = equippedBloodline?.name || character.bloodline || "No bloodline";
    const disciplineLabel = playerLensDiscipline(character);
    const elementsLabel = ownedElements.length ? ownedElements.join(" / ") : "Not awakened";
    const currentTitleLabel = character.customTitle || character.storyTitle || "";
    // XP is retired: level progress is earned stat points vs the next threshold.
    const xpLabel = character.level >= MAX_LEVEL
        ? "MAX"
        : `${formatAmount(earnedStatPoints(character))}/${formatAmount(earnedForLevel(character.level + 1))}`;
    const profileSummary = [
        `${equippedBloodlineName} defines this shinobi's combat identity.`,
        `${disciplineLabel}-focused build${ownedElements.length ? ` with ${elementsLabel} element access` : ""}.`,
        character.clan ? `Clan standing: ${character.clan}${character.clanFounder ? " founder" : " member"}.` : "",
    ].filter(Boolean).join(" ");
    const identityExtraChips = [
        { id: "specialty", label: disciplineLabel, detail: "Specialty" },
        ...(equippedBloodline?.specialElement
            ? [{ id: "bloodline-element", label: equippedBloodline.specialElement, detail: "Bloodline element", tone: "legacy" as const }]
            : []),
    ];
    const profileDossierSections: ProfileDossierSection[] = [
        {
            title: "Progress",
            rows: [
                { label: "Growth", value: xpLabel, detail: character.level >= MAX_LEVEL ? "level cap reached" : "stat points toward next level", tone: "gold" },
                { label: "Jutsu", value: `${formatAmount(character.equippedJutsuIds.length)}/${maxLoadout(character)}`, detail: "equipped loadout", tone: character.equippedJutsuIds.length > 0 ? "village" : "neutral" },
                { label: "Equipment", value: formatAmount(equippedItems.length), detail: "equipped items" },
            ],
        },
        {
            title: "Economy",
            rows: [
                { label: "Ryo", value: formatAmount(character.ryo), detail: "on hand", tone: "gold" },
                { label: "Bank", value: formatAmount(character.bankRyo), detail: "stored ryo" },
                { label: "Honor Seals", value: <><GameIcon name="medal" size={14} style={PF_COST} />{formatAmount(character.honorSeals)}</>, detail: "village currency", tone: "gold" },
                { label: "Fate Shards", value: <><GameIcon name="shard" size={14} style={PF_COST} />{formatAmount(character.fateShards)}</>, detail: "legacy currency", tone: "legacy" },
                { label: "Aura Dust", value: <><GameIcon name="sparkle" size={14} style={PF_COST} />{formatAmount(character.auraDust)}</>, detail: "aura growth", tone: "gold" },
            ],
        },
        {
            title: "Combat Pools",
            rows: [
                { label: "HP", value: `${formatAmount(character.hp)}/${formatAmount(character.maxHp)}`, detail: "health" },
                { label: "Chakra", value: `${formatAmount(character.chakra)}/${formatAmount(character.maxChakra)}`, detail: "jutsu resource", tone: "village" },
                { label: "Stamina", value: `${formatAmount(character.stamina)}/${formatAmount(character.maxStamina)}`, detail: "action resource", tone: "gold" },
                { label: "Regen", value: `+${formatAmount(1 + auraBonuses.regen)}/sec`, detail: "outside battle", tone: auraBonuses.regen > 0 ? "gold" : "neutral" },
            ],
        },
        {
            title: "Build",
            rows: [
                { label: "Bloodline", value: equippedBloodlineName, detail: equippedBloodline?.rank ? `${equippedBloodline.rank} rank` : "active identity", tone: "legacy" },
                { label: "Specialty", value: disciplineLabel, detail: "effect lens" },
                { label: "Elements", value: elementsLabel, detail: ownedElements.length ? `${ownedElements.length} awakened` : "not awakened" },
                ...(equippedBloodline?.specialElement
                    ? [{ label: "Bloodline Element", value: equippedBloodline.specialElement, detail: "special affinity", tone: "legacy" as const }]
                    : []),
            ],
        },
    ];

    function renderStatCard(stat: keyof Stats) {
        const value = character.stats[stat];
        const pct = Math.round((value / MAX_STAT) * 100);
        const statLabel = formatStatLabel(stat);
        const inputId = `stat-points-${stat}`;
        return (
            <div className="stat-card" key={stat}>
                <div className="stat-card-label" id={`${inputId}-label`}>{statLabel}</div>
                <div className="stat-card-values">
                    <span className="stat-current">{value}</span>
                    <span className="stat-max">/ {MAX_STAT}</span>
                </div>
                <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="stat-card-input-row">
                    <input
                        id={inputId}
                        type="number"
                        min={1}
                        max={character.unspentStats}
                        value={statInputs[stat] ?? 1}
                        onChange={(e) => setStatInputs((prev) => ({ ...prev, [stat]: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="stat-input"
                        aria-label={`Points to add to ${statLabel}`}
                        aria-describedby={`${inputId}-label`}
                    />
                    <button
                        type="button"
                        className="stat-add-btn"
                        onClick={() => addStat(stat)}
                        disabled={character.unspentStats === 0}
                        aria-label={`Add selected points to ${statLabel}`}
                    >Add to {statLabel}</button>
                </div>
            </div>
        );
    }

    return (
        <div className="profile-page-card">
            {/* Mobile-only tab navigation — hidden on desktop via CSS */}
            <nav className="profile-mobile-tabs">
                {([
                    { id: 'overview', label: 'Profile' },
                    { id: 'stats',    label: 'Stats'   },
                    { id: 'jutsu',    label: 'Jutsu'   },
                    { id: 'achievements', label: 'Achievements' },
                    { id: 'battlelogs', label: 'Battles' },
                    { id: 'legacy',   label: 'Legacy'  },
                ] as const).filter((t) => t.id !== 'legacy' || legacyAvailable).map(({ id, label }) => (
                    <button
                        type="button"
                        key={id}
                        className={`pmtab${mobileTab === id ? ' pmtab-active' : ''}`}
                        aria-current={mobileTab === id ? 'page' : undefined}
                        onClick={() => setMobileTab(id)}
                    >{label}</button>
                ))}
            </nav>

            {/* ── Overview tab ─────────────────────────── */}
            <div className={mobileTab !== 'overview' ? 'profile-tab-hidden' : ''}>
            <ShinobiIdentityCard
                character={character}
                avatarSrc={character.avatarImage}
                avatarClassName={auraBonuses.avatarAura ? "aura-sphere-avatar" : ""}
                bloodlineName={equippedBloodline?.name || character.bloodline}
                elements={ownedElements}
                summary={profileSummary}
                extraChips={identityExtraChips}
                showIdentityChips={false}
                metricIds={["ranked", "pvp", "bounty", "war", "tower", "pets", "clan"]}
                showTitleBadges={false}
                showRivalry={Boolean(character.wandererNemesis)}
                avatarAction={(
                    <label className="sic-avatar-upload-button">
                        Upload Avatar
                        <input type="file" accept="image/*" onChange={uploadAvatar} />
                    </label>
                )}
            />

            <PatreonLink character={character} />

            <section className="profile-overview-panel profile-dossier-panel" aria-label="Profile dossier">
                <div className="profile-dossier-grid">
                    {profileDossierSections.map((section) => (
                        <section className="profile-dossier-section" key={section.title}>
                            <h3>{section.title}</h3>
                            <div className="profile-dossier-rows">
                                {section.rows.map((row) => (
                                    <div className={`profile-dossier-row tone-${row.tone ?? "neutral"}`} key={`${section.title}-${row.label}`}>
                                        <span>{row.label}</span>
                                        <strong>{row.value}</strong>
                                        {row.detail ? <small>{row.detail}</small> : null}
                                    </div>
                                ))}
                            </div>
                            {section.title === "Build" && equippedBloodline?.image && (
                                <div className="profile-lineage-preview">
                                    <img src={equippedBloodline.image} alt={equippedBloodline.name} />
                                </div>
                            )}
                        </section>
                    ))}

                    <div className="profile-dossier-legacy-hide">
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
                                    disabled={feedingAura || character.auraSphereLevel >= 300 || character.auraDust < auraDustNeeded}
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

                {auraSphereEquipped && (
                    <div className="aura-sphere-inline profile-dossier-aura">
                        <div>
                            <p className="act-label">Aura Sphere</p>
                            <h4>{auraBonuses.rankName}</h4>
                            <p className="aura-sphere-inline-level">
                                Level {character.auraSphereLevel}/300 · Aura Dust {formatAmount(character.auraDust)}/{formatAmount(auraDustNeeded)}
                            </p>
                        </div>
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
                            disabled={feedingAura || character.auraSphereLevel >= 300 || character.auraDust < auraDustNeeded}
                        >
                            {character.auraSphereLevel >= 300 ? "Eternal Aura Reached" : `Feed ${auraDustNeeded} Aura Dust`}
                        </button>
                        <p className="hint aura-sphere-inline-hint">
                            Aura Dust drops from PvP, village raids, boss wins, war contribution, and ancient chests.
                        </p>
                    </div>
                )}
            </section>

            <details className="summary-box profile-title-panel profile-title-manager">
                <summary className="profile-title-manager-summary">
                    <span>
                        <strong>Title Manager</strong>
                        <small>Wear earned titles or edit the title shown beside your name.</small>
                    </span>
                    <em>
                        {character.customTitle
                            ? <>Current: <span style={{ color: titleStyleColor(character.customTitleStyle) }}>{character.customTitleIcon ? `${character.customTitleIcon} ` : ""}{character.customTitle}</span></>
                            : currentTitleLabel ? <>Current: <span>{currentTitleLabel}</span></> : "No public title selected"}
                    </em>
                </summary>
                <div className="profile-title-manager-body">
                    {(character.earnedTitles?.length ?? 0) > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <p className="act-label">Earned Titles</p>
                            <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: "0.2rem 0 0.6rem" }}>
                                Earned from achievements — tap one to wear it (free).
                            </p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {character.earnedTitles!.map((t) => {
                                    const active = character.customTitle === t;
                                    return (
                                        <button
                                            key={t}
                                            onClick={() => equipTitle(t)}
                                            title={active ? "Currently worn" : `Wear "${t}"`}
                                            style={{
                                                padding: "3px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                                                cursor: "pointer", whiteSpace: "nowrap",
                                                color: active ? "#0b1020" : "#facc15",
                                                background: active ? "#facc15" : "rgba(250,204,21,.12)",
                                                border: "1px solid rgba(250,204,21,.45)",
                                            }}
                                        >
                                            {active ? "★ " : ""}{t}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <p className="act-label">Custom Title</p>
                    <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: "0.2rem 0 0.75rem" }}>
                        {character.customTitle
                            ? <>Current: <span style={{ color: titleStyleColor(character.customTitleStyle), fontWeight: 700 }}>{character.customTitleIcon ? `${character.customTitleIcon} ` : ""}{character.customTitle}</span></>
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
                            disabled={profileMutationBusy || (character.fateShards ?? 0) < TITLE_COST || !titleInput.trim()}
                        >
                            Set Title — <GameIcon name="shard" size={14} style={PF_COST} />{TITLE_COST}
                        </button>
                        {character.customTitle && (
                            <button className="danger-button" onClick={clearTitle} disabled={profileMutationBusy}>Clear</button>
                        )}
                    </div>
                    {/* Title cosmetics — style color + icon (handoff pricing tiers).
                        Server-allowlisted; cosmetic only. Gated on the server's
                        ENABLE_LEGACY being live (see legacyLive above). */}
                    {character.customTitle && legacyLive && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                            <label style={{ fontSize: ".78rem", color: "#94a3b8" }}>
                                Style (<GameIcon name="shard" size={12} style={PF_COST} />{TITLE_STYLE_COST}):{" "}
                                <select
                                    value={character.customTitleStyle ?? ""}
                                    onChange={(e) => void purchaseTitleStyle(e.target.value)}
                                    disabled={profileMutationBusy}
                                >
                                    {TITLE_STYLES.map((s) => (
                                        <option key={s.id} value={s.id}>{s.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ fontSize: ".78rem", color: "#94a3b8" }}>
                                Icon (<GameIcon name="shard" size={12} style={PF_COST} />{TITLE_ICON_COST}):{" "}
                                <select
                                    value={character.customTitleIcon ?? ""}
                                    onChange={(e) => void purchaseTitleIcon(e.target.value)}
                                    disabled={profileMutationBusy}
                                >
                                    {TITLE_ICONS.map((i) => (
                                        <option key={i || "none"} value={i}>{i || "— none —"}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}
                </div>
            </details>

            {/* Nindo — the player's customizable profile creed. Replaces the old
                Profession/Mastery panel, which now lives solely on the Professions
                tab (right menu → profession hub). */}
            <NindoEditor
                value={{ nindo: character.nindo ?? "", nindoBg: character.nindoBg }}
                onSave={(v) => updateCharacter((prev) => prev ? { ...prev, ...v } : prev)}
            />

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
            <ProgressionPanel character={character} />
            <section className="profile-build-panel">
                <div className="stat-header">
                    <h2>User Stats</h2>
                    <span className={`stat-points-badge ${character.unspentStats === 0 ? "stat-points-empty" : ""}`}>
                        {character.unspentStats} point{character.unspentStats !== 1 ? "s" : ""} available
                    </span>
                    <button type="button" onClick={respecStats} disabled={profileMutationBusy} title="Reset all 12 stats to base and refund your points to re-allocate (costs 50 Fate Shards)" style={{ marginLeft: 8, fontSize: "0.8rem", padding: "4px 10px" }}>🔄 Reallocate Stats — 50 🔮</button>
                </div>
                <p className="hint">Spend available points below. Changed your mind? <strong>Reallocate Stats</strong> resets all 12 stats to base and refunds every earned point—your training progress is not lost.</p>
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
            {(() => {
                const learnedAnyJutsus = allJutsus.filter((jutsu) => getJutsuMastery(character, jutsu.id).level >= 1);
                const learnedJutsus = learnedAnyJutsus.filter((jutsu) => canEquipElementJutsu(character, jutsu, savedBloodlines));
                if (learnedJutsus.length === 0) {
                    return (
                        <section className="profile-build-panel jutsu-workbench-empty">
                            <h2>Jutsu Loadout</h2>
                            <p className="hint">{learnedAnyJutsus.length
                                ? "Your learned jutsu are locked behind elements you do not currently have."
                                : "You haven't trained any jutsu yet. Visit the Training Grounds to learn them."}</p>
                        </section>
                    );
                }
                return (
                    <JutsuLoadoutPanel
                        character={character}
                        learnedJutsus={learnedJutsus}
                        onPlaceJutsu={placeJutsuInLoadout}
                        onUnequip={unequipJutsu}
                        onUnequipAll={() => updateCharacter({ ...character, equippedJutsuIds: [] })}
                    />
                );
            })()}
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

            {/* ── Battle Logs tab ──────────────────────── */}
            <div className={mobileTab !== 'battlelogs' ? 'profile-tab-hidden' : ''}>
                <BattleLogHistoryPanel character={character} onOpenBattle={onOpenBattle} />
            </div>{/* end battle logs tab */}

            {/* ── Legacy tab (fully gated: no empty tab/heading when the
                 server flag is off, keeping "off = byte-identical") ──────── */}
            {legacyAvailable && (
            <div className={mobileTab !== 'legacy' ? 'profile-tab-hidden' : ''}>
            <section className="profile-overview-panel" style={{ display: 'block' }}>
                <h3 style={{ marginTop: 0 }}>Legacy</h3>
                <LegacyPanel
                    key={character.name.trim().toLowerCase()}
                    character={character}
                    onVersionedCharacter={onVersionedCharacter}
                />
            </section>
            </div>
            )}{/* end legacy tab */}

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
