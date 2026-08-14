import { useState, type CSSProperties } from "react";

/*
 * Slim, one-time data-storage transparency notice.
 *
 * Shinobi Journey only stores data on the device for sign-in, preferences, and
 * crash/session recovery — all "strictly necessary", which is exempt from the
 * EU ePrivacy / UK PECR consent requirement. So this is a NOTICE, not a consent
 * gate: there is nothing non-essential to opt out of, and no advertising or
 * third-party tracking cookies are used.
 *
 * If analytics or advertising storage is ever added, this must be replaced by a
 * real consent manager that blocks those scripts until the visitor opts in, and
 * the Cookie & Local Storage Notice (/cookies) must be updated to match.
 */

const ACK_KEY = "shinobix:storage-notice-ack";

function readAck(): boolean {
    try {
        return localStorage.getItem(ACK_KEY) === "1";
    } catch {
        // Storage blocked (private mode / disabled). Show once; can't persist.
        return false;
    }
}

const wrap: CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    padding: "10px 14px",
    background: "rgba(2, 6, 23, 0.95)",
    borderTop: "1px solid rgba(250, 204, 21, 0.28)",
    boxShadow: "0 -8px 30px rgba(0, 0, 0, 0.45)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    paddingBottom: "max(10px, env(safe-area-inset-bottom))",
};

const inner: CSSProperties = {
    width: "min(1100px, 100%)",
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px 20px",
};

const text: CSSProperties = {
    margin: 0,
    flex: "1 1 320px",
    minWidth: 0,
    color: "#cdd5e3",
    fontSize: 13,
    lineHeight: 1.5,
};

const link: CSSProperties = {
    color: "#fbbf24",
    fontWeight: 700,
    textDecoration: "underline",
    textUnderlineOffset: 2,
};

const button: CSSProperties = {
    flex: "0 0 auto",
    minHeight: "var(--touch-target-min)",
    padding: "8px 22px",
    borderRadius: 8,
    border: "1px solid rgba(250, 204, 21, 0.6)",
    background: "linear-gradient(180deg, #d98a12, #7a350f)",
    color: "#fff7d6",
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
};

export function StorageNotice() {
    const [dismissed, setDismissed] = useState(readAck);
    if (dismissed) return null;

    function dismiss() {
        try {
            localStorage.setItem(ACK_KEY, "1");
        } catch {
            // Can't persist (private mode) — hide for this session at least.
        }
        setDismissed(true);
    }

    return (
        <div className="storage-notice" role="region" aria-label="Data storage notice" style={wrap}>
            <div style={inner}>
                <p style={text}>
                    Shinobi Journey stores data on your device for sign-in, preferences, and saving your
                    progress. It uses no advertising or third-party tracking cookies.{" "}
                    <a href="/cookies" target="_blank" rel="noopener noreferrer" style={link}>Learn more</a>.
                </p>
                <button type="button" onClick={dismiss} style={button}>Got it</button>
            </div>
        </div>
    );
}
