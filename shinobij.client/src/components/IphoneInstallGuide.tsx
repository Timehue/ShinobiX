import { useEffect, useState } from "react";
import { isPlayApp } from "../lib/surface";
import "./IphoneInstallGuide.css";

function isInstalledOnAppleDevice(): boolean {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false;
    const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return appleMobile && (Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        || window.matchMedia("(display-mode: standalone)").matches);
}

/** Instructions stay available without an intrusive automatic install prompt. */
export function IphoneInstallGuide() {
    const [installed, setInstalled] = useState(isInstalledOnAppleDevice);
    useEffect(() => {
        const displayMode = window.matchMedia("(display-mode: standalone)");
        const update = () => setInstalled(isInstalledOnAppleDevice());
        displayMode.addEventListener("change", update);
        window.addEventListener("pageshow", update);
        return () => {
            displayMode.removeEventListener("change", update);
            window.removeEventListener("pageshow", update);
        };
    }, []);
    if (isPlayApp()) return null;
    return <details className="iphone-install-guide">
        <summary>{installed ? "Playing from your Home Screen" : "Play on iPhone or iPad"}</summary>
        <div className="iphone-install-guide-body">
            {installed ? <p>You’re already using the Home Screen version. Sign in to the same account on any device to continue your shinobi.</p> : <>
                <p>Add Shinobi Journey to your Home Screen for a dedicated game window and a quick way back to your village.</p>
                <ol>
                    <li>Open <a href="https://shinobijourney.com/">shinobijourney.com</a> in <strong>Safari</strong>. If you arrived from Discord or another app, open the link in Safari first.</li>
                    <li>Open Safari’s menu if needed, then tap <strong>Share</strong> <span aria-hidden="true">↥</span>.</li>
                    <li>Choose <strong>Add to Home Screen</strong>. You may need to scroll through the actions or tap <strong>Edit Actions</strong>.</li>
                    <li>If shown, leave <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.</li>
                    <li>Open the new <strong>Shinobi</strong> icon. If asked, sign in with your existing account to keep your progress.</li>
                </ol>
                <p className="iphone-install-guide-note">Free to add. An internet connection is still required to play. Link a guest shinobi to a sign-in method in Settings before switching browsers or devices.</p>
            </>}
        </div>
    </details>;
}
