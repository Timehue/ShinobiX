import { useState } from "react";
import {
    type Character,
    villages,
    starterBloodlines,
    starterBloodlineOffense,
    starterSavedBloodlines,
    createCharacter,
} from "../App";

function IconUser() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
    );
}

function IconLock() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3" />
        </svg>
    );
}

function IconBuilding() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 21V8l9-5 9 5v13" />
            <path d="M3 21h18" />
            <path d="M9 21v-6h6v6" />
            <path d="M8 11h.01M12 11h.01M16 11h.01" />
        </svg>
    );
}

function IconEye() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3" />
            <path d="M12 4c-4.5 0-8 4-8 4s3.5 4 8 4 8-4 8-4-3.5-4-8-4z" />
            <circle cx="12" cy="20" r="0.8" fill="currentColor" />
        </svg>
    );
}

function IconEyeOpen() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function IconEyeOff() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.55 19.55 0 0 1 4.06-5.06" />
            <path d="M22.54 12.88A19.5 19.5 0 0 0 23 12s-4-7-11-7a10.74 10.74 0 0 0-4.06.76" />
            <path d="M9.9 4.24A9.6 9.6 0 0 1 12 4" />
            <path d="M1 1l22 22" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
        </svg>
    );
}

export { IconUser, IconLock, IconEyeOpen, IconEyeOff };

export function CharacterCreator({ onCreate }: { onCreate: (character: Character, password: string) => void }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [village, setVillage] = useState(villages[0]);
    const [bloodline, setBloodline] = useState(starterBloodlines[0]);

    function submitCharacter() {
        if (name.trim().length < 2) return alert("Enter a ninja name first.");
        if (password.length < 4) return alert("Create a password with at least 4 characters.");
        if (password !== confirmPassword) return alert("Passwords do not match.");
        onCreate(createCharacter(name.trim(), village, starterBloodlineOffense[bloodline] ?? "Ninjutsu", bloodline), password);
    }

    return (
        <div className="card creator-card start-card">
            <h2 className="start-card-title">Character Creator</h2>

            <label className="start-field">
                <span className="start-field-label">
                    <span className="start-field-icon"><IconUser /></span>
                    Name
                </span>
                <input
                    className="start-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your shinobi name"
                />
            </label>

            <label className="start-field">
                <span className="start-field-label">
                    <span className="start-field-icon"><IconLock /></span>
                    Password
                </span>
                <span className="start-input-wrap">
                    <input
                        className="start-input has-toggle"
                        type={showPw ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a login password"
                    />
                    <button
                        type="button"
                        className="start-eye-btn"
                        onClick={() => setShowPw(s => !s)}
                        aria-label={showPw ? "Hide password" : "Show password"}
                    >
                        {showPw ? <IconEyeOff /> : <IconEyeOpen />}
                    </button>
                </span>
            </label>

            <label className="start-field">
                <span className="start-field-label">
                    <span className="start-field-icon"><IconLock /></span>
                    Confirm Password
                </span>
                <span className="start-input-wrap">
                    <input
                        className="start-input has-toggle"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Retype password"
                    />
                    <button
                        type="button"
                        className="start-eye-btn"
                        onClick={() => setShowConfirm(s => !s)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                        {showConfirm ? <IconEyeOff /> : <IconEyeOpen />}
                    </button>
                </span>
            </label>

            <label className="start-field">
                <span className="start-field-label">
                    <span className="start-field-icon"><IconBuilding /></span>
                    Village
                </span>
                <select className="start-input" value={village} onChange={(e) => setVillage(e.target.value)}>
                    {villages.map((v) => <option key={v}>{v}</option>)}
                </select>
            </label>

            <label className="start-field">
                <span className="start-field-label">
                    <span className="start-field-icon"><IconEye /></span>
                    Starter Bloodline
                </span>
                <select className="start-input" value={bloodline} onChange={(e) => setBloodline(e.target.value)}>
                    {starterBloodlines.map((b) => <option key={b} value={b}>{b} ({starterBloodlineOffense[b]})</option>)}
                </select>
            </label>

            <p className="hint" style={{ margin: "-6px 0 10px" }}>
                {(() => {
                    const element = starterSavedBloodlines.find((b) => b.name === bloodline)?.specialElement;
                    const offense = starterBloodlineOffense[bloodline] ?? "Ninjutsu";
                    return `${bloodline}: a ${offense} bloodline${element ? ` (${element} element)` : ""}. You'll start already knowing its jutsu — pick the combat style you want to play.`;
                })()}
            </p>

            <button className="start-primary-btn" onClick={submitCharacter}>Begin Your Journey</button>
        </div>
    );
}
