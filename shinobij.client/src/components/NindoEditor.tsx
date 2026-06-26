/*
 * NindoEditor — the owner-only editor for a player's Nindo (profile creed),
 * shown on the player's own Profile screen where the Profession panel used to
 * live. A BBCode textarea with a formatting toolbar, a banner-background picker,
 * and a live, safe preview.
 *
 * Saving flows through `onSave` → updateCharacter, the same path customTitle
 * uses; the server (api/save) caps length + moderates the visible text and
 * allowlists the background id.
 */
import { useRef, useState, type ReactNode } from "react";
import { renderNindo } from "../lib/nindo-bbcode";
import { NINDO_BACKGROUNDS, nindoBgStyle } from "../lib/nindo-backgrounds";

const NINDO_MAX = 1500;

const TOOLBAR: { label: ReactNode; open: string; close: string; title: string }[] = [
    { label: <strong>B</strong>, open: "[b]", close: "[/b]", title: "Bold" },
    { label: <em>I</em>, open: "[i]", close: "[/i]", title: "Italic" },
    { label: <span style={{ textDecoration: "underline" }}>U</span>, open: "[u]", close: "[/u]", title: "Underline" },
    { label: "Colour", open: "[color=gold]", close: "[/color]", title: "Coloured text" },
    { label: "Size", open: "[size=22]", close: "[/size]", title: "Text size" },
    { label: "Center", open: "[center]", close: "[/center]", title: "Center" },
    { label: "Quote", open: "[quote]", close: "[/quote]", title: "Quote block" },
    { label: "Link", open: "[url=https://]", close: "[/url]", title: "Link" },
    { label: "Image", open: "[img]https://", close: "[/img]", title: "Image (paste a direct image URL)" },
    { label: "List", open: "[list]\n[*] ", close: "\n[/list]", title: "Bullet list" },
];

type NindoValue = { nindo: string; nindoBg?: string };

export function NindoEditor({ value, onSave }: { value: NindoValue; onSave: (v: NindoValue) => void }) {
    const [draft, setDraft] = useState(value.nindo ?? "");
    const [bg, setBg] = useState(value.nindoBg ?? "");
    const [dirty, setDirty] = useState(false);
    const ref = useRef<HTMLTextAreaElement>(null);

    function applyDraft(next: string, caret: number) {
        setDraft(next.slice(0, NINDO_MAX));
        setDirty(true);
        requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            el.focus();
            const pos = Math.min(caret, NINDO_MAX);
            el.selectionStart = el.selectionEnd = pos;
        });
    }

    function wrap(open: string, close: string) {
        const el = ref.current;
        if (!el) { applyDraft(draft + open + close, (draft + open).length); return; }
        const s = el.selectionStart;
        const e = el.selectionEnd;
        const next = draft.slice(0, s) + open + draft.slice(s, e) + close + draft.slice(e);
        // Drop the caret just after the opening tag so the user can type the value.
        applyDraft(next, s + open.length + (e - s));
    }

    function pickBg(id: string) {
        setBg(id);
        setDirty(true);
    }

    function save() {
        onSave({ nindo: draft.trim(), nindoBg: bg });
        setDirty(false);
    }
    function clear() {
        setDraft("");
        onSave({ nindo: "", nindoBg: bg });
        setDirty(false);
    }

    const previewBg = nindoBgStyle(bg);
    const hasBg = Object.keys(previewBg).length > 0;

    return (
        <section className="profile-build-panel nindo-editor">
            <h2>Nindo</h2>
            <p className="hint" style={{ marginTop: "-0.4rem" }}>
                Your shinobi creed — shown on your profile to everyone who views it. Safe BBCode only:
                {" "}<code>[b] [i] [u] [color=gold] [size=22] [center] [quote] [url] [img]</code>. Scripts and raw HTML
                are stripped; images and links must be <code>https://</code> URLs.
            </p>

            <div className="nindo-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0.5rem 0" }}>
                {TOOLBAR.map((b, i) => (
                    <button
                        key={i}
                        type="button"
                        className="profile-action-btn"
                        title={b.title}
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                        onClick={() => wrap(b.open, b.close)}
                    >
                        {b.label}
                    </button>
                ))}
            </div>

            <p className="act-label" style={{ margin: "0.4rem 0 0.25rem" }}>Banner</p>
            <div className="nindo-bg-picker" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "0.6rem" }}>
                {NINDO_BACKGROUNDS.map((b) => (
                    <button
                        key={b.id || "none"}
                        type="button"
                        title={b.label}
                        aria-label={b.label}
                        onClick={() => pickBg(b.id)}
                        style={{
                            width: 58, height: 34, borderRadius: 8, cursor: "pointer",
                            background: b.background || "transparent",
                            backgroundSize: "cover", backgroundPosition: "center",
                            border: bg === b.id ? "2px solid #facc15" : "1px solid rgba(255,255,255,.25)",
                            color: "#cbd5e1", fontSize: "0.68rem", lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                    >
                        {b.id ? "" : "None"}
                    </button>
                ))}
            </div>

            <textarea
                ref={ref}
                className="nindo-textarea"
                value={draft}
                maxLength={NINDO_MAX}
                onChange={(e) => { setDraft(e.target.value.slice(0, NINDO_MAX)); setDirty(true); }}
                placeholder={"Write your ninja way…\n[center][size=24][color=gold]Never retreat. Never explain.[/color][/size][/center]\nSworn blade of [b]Frostfang[/b]."}
                rows={6}
                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "0.95rem", lineHeight: 1.5 }}
            />

            <div className="nindo-editor-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "0.5rem 0" }}>
                <span className="hint">{draft.length}/{NINDO_MAX}</span>
                <div style={{ display: "flex", gap: 8 }}>
                    {(draft.trim() || bg) && <button type="button" className="danger-button" onClick={clear}>Clear</button>}
                    <button type="button" className="profile-title-btn" disabled={!dirty} onClick={save}>
                        {dirty ? "Save Nindo" : "Saved"}
                    </button>
                </div>
            </div>

            <div className="nindo-preview">
                <p className="act-label">Preview</p>
                <div
                    className="nindo-body"
                    style={hasBg ? { ...previewBg, padding: "14px 16px", borderRadius: 8, border: "1px solid rgba(250,204,21,.22)" } : undefined}
                >
                    {draft.trim() ? renderNindo(draft) : <span className="hint">Nothing yet — your creed will appear here.</span>}
                </div>
            </div>
        </section>
    );
}
