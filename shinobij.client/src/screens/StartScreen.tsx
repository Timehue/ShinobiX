import { useState } from "react";
import { type Character } from "../App";
import { CharacterCreator } from "./CharacterCreator";

export function StartScreen({ onCreate, onLogin, onAdmin }: { onCreate: (character: Character, password: string) => void; onLogin: (name: string, password: string) => void; onAdmin: () => void }) {
    const [loginName, setLoginName] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginStatus, setLoginStatus] = useState("");

    async function submitLogin() {
        if (loginName.trim().length < 2) return alert("Enter your player name.");
        if (!loginPassword) return alert("Enter your password.");
        setLoginStatus("Loading…");
        try {
            await onLogin(loginName.trim(), loginPassword);
        } finally {
            setLoginStatus("");
        }
    }

    return (
        <div className="start-grid">
            <CharacterCreator onCreate={onCreate} />
            <div className="card creator-card">
                <h2>Player Login</h2>
                <label>Name</label>
                <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Enter your shinobi name" />
                <label>Password</label>
                <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitLogin()} placeholder="Enter your password" />
                <button onClick={submitLogin} disabled={!!loginStatus}>{loginStatus || "Log Back In"}</button>
                <p className="hint" style={{ marginTop: 8 }}>Logging in automatically restores your full save including images.</p>
            </div>

        </div>
    );
}
