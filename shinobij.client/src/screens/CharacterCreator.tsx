import { useState } from "react";
import {
    type Character,
    villages,
    starterBloodlines,
    starterBloodlineOffense,
    createCharacter,
} from "../App";

export function CharacterCreator({ onCreate }: { onCreate: (character: Character, password: string) => void }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [village, setVillage] = useState(villages[0]);
    const [bloodline, setBloodline] = useState(starterBloodlines[0]);

    function submitCharacter() {
        if (name.trim().length < 2) return alert("Enter a ninja name first.");
        if (password.length < 4) return alert("Create a password with at least 4 characters.");
        if (password !== confirmPassword) return alert("Passwords do not match.");
        onCreate(createCharacter(name.trim(), village, starterBloodlineOffense[bloodline] ?? "Ninjutsu", bloodline), password);
    }

    return (
        <div className="card creator-card">
            <h2>Character Creator</h2>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your shinobi name" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a login password" />
            <label>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Retype password" />
            <label>Village</label>
            <select value={village} onChange={(e) => setVillage(e.target.value)}>{villages.map((v) => <option key={v}>{v}</option>)}</select>
            <label>Starter Bloodline</label>
            <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>{starterBloodlines.map((b) => <option key={b} value={b}>{b} ({starterBloodlineOffense[b]})</option>)}</select>
            <button onClick={submitCharacter}>Begin Your Shinobi Path</button>
        </div>
    );
}
