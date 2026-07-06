import { useMemo, useState } from "react";
import {
    type Character,
    createCharacter,
    starterBloodlineOffense,
    starterBloodlines,
    starterSavedBloodlines,
} from "../../App";
import { villages } from "../../data/sectors";
import { BLOODLINE_PRESENTATION, CREATOR_STEPS, STARTER_AVATARS, getVillageTheme } from "./characterCreatorCopy";
import type { CreatorStep, IdentityErrors, StarterAvatarId } from "./characterCreatorTypes";
import { hasIdentityErrors, validateIdentity } from "./characterCreatorUtils";
import "./character-creator.css";

const STEP_ORDER = CREATOR_STEPS.map((step) => step.id);

type TouchedFields = Record<keyof IdentityErrors, boolean>;

const EMPTY_TOUCHED: TouchedFields = {
    name: false,
    password: false,
    confirmPassword: false,
};

const ALL_TOUCHED: TouchedFields = {
    name: true,
    password: true,
    confirmPassword: true,
};

export function CharacterCreatorFlow({ onCreate, onBack, compact = false }: {
    onCreate: (character: Character, password: string) => void | Promise<void>;
    onBack?: () => void;
    compact?: boolean;
}) {
    const [step, setStep] = useState<CreatorStep>("welcome");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [village, setVillage] = useState(villages[0]);
    const [bloodline, setBloodline] = useState(starterBloodlines[0]);
    const [avatarId, setAvatarId] = useState<StarterAvatarId>("avatar-one");
    const [touched, setTouched] = useState<TouchedFields>(EMPTY_TOUCHED);
    const [submitting, setSubmitting] = useState(false);

    const stepIndex = Math.max(0, STEP_ORDER.indexOf(step));
    const selectedAvatar = STARTER_AVATARS.find((avatar) => avatar.id === avatarId) ?? STARTER_AVATARS[0];
    const selectedBloodline = starterSavedBloodlines.find((b) => b.name === bloodline) ?? starterSavedBloodlines[0];
    const identityErrors = validateIdentity({ name, password, confirmPassword });
    const canSubmitIdentity = !hasIdentityErrors(identityErrors);
    const selectedJutsuNames = useMemo(() => selectedBloodline.jutsus.map((jutsu) => jutsu.name), [selectedBloodline]);

    function goToStep(nextStep: CreatorStep) {
        setStep(nextStep);
        window.setTimeout(() => document.querySelector(".cc-flow")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }

    function previousStep() {
        if (stepIndex <= 0) {
            onBack?.();
            return;
        }
        goToStep(STEP_ORDER[stepIndex - 1]);
    }

    function nextStep() {
        if (step === "identity" && !canSubmitIdentity) {
            setTouched(ALL_TOUCHED);
            return;
        }
        const next = STEP_ORDER[Math.min(STEP_ORDER.length - 1, stepIndex + 1)];
        goToStep(next);
    }

    async function submitCharacter() {
        const errors = validateIdentity({ name, password, confirmPassword });
        if (hasIdentityErrors(errors)) {
            setTouched(ALL_TOUCHED);
            goToStep("identity");
            return;
        }

        setSubmitting(true);
        try {
            const character = createCharacter(
                name.trim(),
                village,
                starterBloodlineOffense[bloodline] ?? "Ninjutsu",
                bloodline,
            );
            await Promise.resolve(onCreate({ ...character, avatarImage: selectedAvatar.image }, password));
        } finally {
            setSubmitting(false);
        }
    }

    function identityErrorFor(field: keyof IdentityErrors) {
        return touched[field] ? identityErrors[field] : "";
    }

    function renderStep() {
        switch (step) {
            case "welcome":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Academy Gate</p>
                        <h2>Begin as a Shinobi</h2>
                        <p>
                            This is the first record in your journey: the village you answer to,
                            the name other players see, and the starter look that follows you into the world.
                        </p>
                        <div className="cc-promise-grid" aria-label="Creator steps">
                            <span><strong>Village</strong> Choose the home that fits your style.</span>
                            <span><strong>Bloodline</strong> Pick the starter jutsu kit you want.</span>
                            <span><strong>Avatar</strong> Pick one of two masked starter portraits.</span>
                            <span><strong>Account</strong> Name your shinobi and secure the save last.</span>
                        </div>
                    </div>
                );

            case "village":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Choose Your Village</p>
                        <h2>Where Your Record Begins</h2>
                        <p>Village choice defines your origin and story flavor. It does not add hidden stat bonuses.</p>
                        <div className="cc-village-grid">
                            {villages.map((v) => {
                                const theme = getVillageTheme(v);
                                const selected = village === v;
                                return (
                                    <button
                                        key={v}
                                        type="button"
                                        className={`cc-village-card ${selected ? "is-selected" : ""}`}
                                        aria-pressed={selected}
                                        onClick={() => setVillage(v)}
                                    >
                                        <span className="cc-village-card-kicker">{theme.tone}</span>
                                        <span className="cc-village-card-name">{v}</span>
                                        <span className="cc-village-card-record">{theme.record}</span>
                                        <span className="cc-village-card-summary">{theme.summary}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );

            case "identity":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Shape Your Identity</p>
                        <h2>Name and Enter the Village</h2>
                        <p>
                            Your village, bloodline, and portrait are set. Add the name other players see
                            and the password that protects this save.
                        </p>

                        <div className="cc-form-grid">
                            <label className="cc-field" htmlFor="cc-name">
                                <span>Name</span>
                                <input
                                    id="cc-name"
                                    value={name}
                                    onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Enter your shinobi name"
                                    autoComplete="username"
                                    aria-invalid={Boolean(identityErrorFor("name"))}
                                    aria-describedby={identityErrorFor("name") ? "cc-name-error" : undefined}
                                />
                                {identityErrorFor("name") && <em id="cc-name-error">{identityErrorFor("name")}</em>}
                            </label>

                            <label className="cc-field" htmlFor="cc-password">
                                <span>Password</span>
                                <span className="cc-password-wrap">
                                    <input
                                        id="cc-password"
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Create a login password"
                                        autoComplete="new-password"
                                        aria-invalid={Boolean(identityErrorFor("password"))}
                                        aria-describedby={identityErrorFor("password") ? "cc-password-error" : undefined}
                                    />
                                    <button type="button" onClick={() => setShowPassword((show) => !show)}>
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </span>
                                {identityErrorFor("password") && <em id="cc-password-error">{identityErrorFor("password")}</em>}
                            </label>

                            <label className="cc-field" htmlFor="cc-confirm-password">
                                <span>Confirm Password</span>
                                <span className="cc-password-wrap">
                                    <input
                                        id="cc-confirm-password"
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Retype password"
                                        autoComplete="new-password"
                                        aria-invalid={Boolean(identityErrorFor("confirmPassword"))}
                                        aria-describedby={identityErrorFor("confirmPassword") ? "cc-confirm-error" : undefined}
                                    />
                                    <button type="button" onClick={() => setShowConfirmPassword((show) => !show)}>
                                        {showConfirmPassword ? "Hide" : "Show"}
                                    </button>
                                </span>
                                {identityErrorFor("confirmPassword") && <em id="cc-confirm-error">{identityErrorFor("confirmPassword")}</em>}
                            </label>
                        </div>
                    </div>
                );

            case "bloodline":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Choose Your Bloodline</p>
                        <h2>Your First Jutsu Kit</h2>
                        <p>Each starter bloodline begins with four learned jutsu. Choose the combat flavor you want to start with.</p>
                        <div className="cc-bloodline-grid" aria-label="Starter bloodline choices">
                            {starterBloodlines.map((bloodlineName) => {
                                const bloodlineData = starterSavedBloodlines.find((b) => b.name === bloodlineName);
                                const art = BLOODLINE_PRESENTATION[bloodlineName];
                                const selected = bloodline === bloodlineName;
                                const offense = starterBloodlineOffense[bloodlineName] ?? "Ninjutsu";
                                return (
                                    <button
                                        key={bloodlineName}
                                        type="button"
                                        className={`cc-bloodline-card ${selected ? "is-selected" : ""}`}
                                        aria-pressed={selected}
                                        onClick={() => setBloodline(bloodlineName)}
                                    >
                                        <span className="cc-bloodline-art">
                                            <img src={art.image} alt={art.alt} />
                                            <span>{offense} / {bloodlineData?.specialElement ?? "Element"}</span>
                                        </span>
                                        <span className="cc-bloodline-body">
                                            <strong>{bloodlineName}</strong>
                                            <span>{art.tagline}</span>
                                            <small>{art.flavor}</small>
                                            <span className="cc-jutsu-list">
                                                {(bloodlineData?.jutsus ?? []).map((jutsu) => <i key={jutsu.id}>{jutsu.name}</i>)}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );

            case "avatar":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Choose Your Look</p>
                        <h2>Two Starter Shinobi Portraits</h2>
                        <p>Pick the masked portrait that should represent your first save. You can still build the character however you want.</p>
                        <div className="cc-avatar-grid" aria-label="Starter avatar choices">
                            {STARTER_AVATARS.map((avatar) => {
                                const selected = avatar.id === avatarId;
                                return (
                                    <button
                                        key={avatar.id}
                                        type="button"
                                        className={`cc-avatar-card ${selected ? "is-selected" : ""}`}
                                        aria-pressed={selected}
                                        onClick={() => setAvatarId(avatar.id)}
                                    >
                                        <span className="cc-avatar-frame">
                                            <img src={avatar.image} alt={avatar.alt} />
                                        </span>
                                        <span className="cc-avatar-meta">
                                            <strong>{avatar.label}</strong>
                                            <span>{avatar.stance}</span>
                                            <small>{avatar.hook}</small>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );

            case "preview":
                return (
                    <div className="cc-copy-stack">
                        <p className="cc-kicker">Preview Your Shinobi</p>
                        <h2>Check the First Record</h2>
                        <p>
                            This is the shinobi record so far. Review the village, starter bloodline,
                            combat type, jutsu kit, and portrait before naming the save.
                        </p>
                        <dl className="cc-review-list">
                            <div><dt>Village</dt><dd>{village}</dd></div>
                            <div><dt>Rank</dt><dd>Academy Student</dd></div>
                            <div><dt>Starter Bloodline</dt><dd>{bloodline}</dd></div>
                            <div><dt>Combat Type</dt><dd>{starterBloodlineOffense[bloodline] ?? "Ninjutsu"}</dd></div>
                            <div><dt>Starter Jutsu</dt><dd>{selectedJutsuNames.slice(0, 2).join(", ")} +{Math.max(0, selectedJutsuNames.length - 2)} more</dd></div>
                        </dl>
                    </div>
                );
        }
    }

    const primaryLabelByStep: Partial<Record<CreatorStep, string>> = {
        welcome: "Choose Village",
        village: "Choose Bloodline",
        bloodline: "Choose Avatar",
        avatar: "Preview Shinobi",
        preview: "Name and Password",
        identity: submitting ? "Creating..." : "Enter the Village",
    };

    function handlePrimaryAction() {
        if (step === "identity") {
            void submitCharacter();
            return;
        }
        nextStep();
    }

    return (
        <section className={`cc-flow ${compact ? "is-compact" : ""}`}>
            <div className="cc-shell">
                <div className="cc-topline">
                    <button type="button" className="cc-back-link" onClick={previousStep}>
                        {stepIndex === 0 ? "Back to Landing" : "Back"}
                    </button>
                    <div className="cc-progress" aria-label="Character creation progress">
                        {CREATOR_STEPS.map((progressStep, index) => (
                            <span
                                key={progressStep.id}
                                className={`cc-progress-step ${index <= stepIndex ? "is-active" : ""}`}
                            >
                                <i aria-hidden="true" />
                                <span>{progressStep.label}</span>
                            </span>
                        ))}
                    </div>
                </div>

                <div className="cc-layout">
                    <main className="cc-stage">
                        {renderStep()}
                        <div className="cc-actions">
                            {stepIndex > 0 && (
                                <button type="button" className="cc-secondary" onClick={previousStep}>
                                    Back
                                </button>
                            )}
                            <button type="button" className="cc-primary" onClick={handlePrimaryAction} disabled={step === "identity" && submitting}>
                                {primaryLabelByStep[step]}
                            </button>
                        </div>
                    </main>

                    <aside className="cc-preview" aria-label="Selected shinobi preview">
                        <div className="cc-preview-art">
                            <img src={selectedAvatar.image} alt="" />
                        </div>
                        <div className="cc-preview-body">
                            <p className="cc-preview-rank">Academy Student</p>
                            <h3>{name.trim() || "Preview Shinobi"}</h3>
                            <dl>
                                <div><dt>Village</dt><dd>{village}</dd></div>
                                <div><dt>Bloodline</dt><dd>{bloodline}</dd></div>
                                <div><dt>Combat Type</dt><dd>{starterBloodlineOffense[bloodline] ?? "Ninjutsu"}</dd></div>
                                <div><dt>Starter Jutsu</dt><dd>{selectedJutsuNames.slice(0, 3).join(", ")}</dd></div>
                            </dl>
                        </div>
                    </aside>
                </div>
            </div>
        </section>
    );
}
