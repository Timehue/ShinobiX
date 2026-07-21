import { useState, type CSSProperties } from "react";
import { Modal } from "./ui/Modal";

/*
 * Minimal in-app abuse/content report control (EU DSA notice-and-action + UK
 * Online Safety Act in-service reporting). Renders ONE small, muted flag icon;
 * clicking it opens a compact dialog (reason + optional note) that POSTs to
 * /api/report. Deliberately unobtrusive — a tiny trigger, not another prominent
 * action button — so it adds a report path without cluttering the UI.
 *
 * Auth is attached automatically by the global fetch interceptor (authFetch.ts)
 * for /api/ calls, so this just calls plain fetch. The server (api/report.ts)
 * identifies the reporter from their session — never from the body.
 */

export type ReportTargetType = "player" | "message" | "profile" | "clan-chat" | "other";

// value MUST match the server's CATEGORIES allowlist in api/report.ts.
const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
    { value: "harassment", label: "Harassment or bullying" },
    { value: "hate", label: "Hate speech" },
    { value: "sexual", label: "Sexual or explicit content" },
    { value: "threats", label: "Threats or self-harm" },
    { value: "spam", label: "Spam" },
    { value: "scam", label: "Scam or phishing" },
    { value: "cheating", label: "Cheating or exploits" },
    { value: "impersonation", label: "Impersonation" },
    { value: "other", label: "Something else" },
];

const NOTE_MAX = 1000;

const triggerBase: CSSProperties = {
    background: "transparent",
    border: "none",
    color: "#8b98ad",
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
    padding: 4,
    opacity: 0.65,
};
const fieldLabel: CSSProperties = {
    display: "flex", flexDirection: "column", gap: 5,
    fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
    textTransform: "uppercase", color: "#9fb0c8",
};
const inputStyle: CSSProperties = {
    width: "100%", padding: "9px 10px", borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.3)", background: "rgba(2,6,23,0.6)",
    color: "#f1f5f9", font: "inherit",
};
const primaryBtn: CSSProperties = {
    minHeight: 38, padding: "8px 16px", borderRadius: 8,
    border: "1px solid rgba(250,204,21,0.6)", background: "linear-gradient(180deg,#d98a12,#7a350f)",
    color: "#fff7d6", fontWeight: 800, cursor: "pointer",
};
const secondaryBtn: CSSProperties = {
    minHeight: 38, padding: "8px 16px", borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.3)", background: "rgba(2,6,23,0.5)",
    color: "#cbd5e1", fontWeight: 700, cursor: "pointer",
};

export function ReportControl({
    targetType,
    targetName,
    targetId,
    context,
    style,
}: {
    targetType: ReportTargetType;
    targetName?: string;
    targetId?: string;
    context?: string;
    /** Merged onto the default muted-icon trigger style (e.g. marginLeft:"auto"). */
    style?: CSSProperties;
}) {
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState("");
    const [note, setNote] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
    const [errorMsg, setErrorMsg] = useState("");

    const label = targetName ? `"${targetName}"` : "this content";

    function close() {
        setOpen(false);
        setCategory(""); setNote(""); setStatus("idle"); setErrorMsg("");
    }

    async function submit() {
        if (!category || status === "sending") return;
        setStatus("sending"); setErrorMsg("");
        try {
            const r = await fetch("/api/report", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetType, targetName, targetId, context, category, note }),
            });
            if (r.ok) { setStatus("done"); return; }
            setStatus("error");
            if (r.status === 429) setErrorMsg("You've filed several reports recently. Please try again later.");
            else if (r.status === 401) setErrorMsg("Please sign in to submit a report.");
            else setErrorMsg("Could not submit your report. Please try again.");
        } catch {
            setStatus("error"); setErrorMsg("Network error. Please try again.");
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title={`Report ${targetName ?? "content"}`}
                aria-label={`Report ${targetName ?? "content"}`}
                style={{ ...triggerBase, ...style }}
            >
                ⚑
            </button>

            <Modal open={open} onClose={close} size="sm" title="Report">
                {status === "done" ? (
                    <div style={{ textAlign: "center" }}>
                        <p style={{ margin: "4px 0 16px", color: "#cdd5e3", lineHeight: 1.5 }}>
                            Thanks — our moderation team will review this. Thank you for helping keep the community safe.
                        </p>
                        <button type="button" style={primaryBtn} onClick={close}>Close</button>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <p style={{ margin: 0, color: "#cdd5e3", fontSize: 13.5, lineHeight: 1.5 }}>
                            Reporting {label}. Reports are private and reviewed by staff. If someone is in
                            immediate danger, contact local emergency services.
                        </p>
                        <label style={fieldLabel}>
                            Reason
                            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                                <option value="">Choose a reason…</option>
                                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </label>
                        <label style={fieldLabel}>
                            Details (optional)
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                                maxLength={NOTE_MAX}
                                rows={3}
                                placeholder="Add anything that helps us understand the problem."
                                style={{ ...inputStyle, resize: "vertical" }}
                            />
                        </label>
                        {errorMsg && <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{errorMsg}</p>}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button type="button" style={secondaryBtn} onClick={close}>Cancel</button>
                            <button
                                type="button"
                                style={{ ...primaryBtn, opacity: !category || status === "sending" ? 0.6 : 1 }}
                                disabled={!category || status === "sending"}
                                onClick={() => void submit()}
                            >
                                {status === "sending" ? "Submitting…" : "Submit report"}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );
}
