/*
 * nindo-bbcode — render a player-authored "Nindo" (profile creed) written in a
 * SAFE BBCode subset into React nodes.
 *
 * ── SECURITY BOUNDARY ──────────────────────────────────────────────────────
 * This is the trust boundary for player-authored profile content that is shown
 * to OTHER players. We never emit raw HTML (no dangerouslySetInnerHTML) and
 * never honour a tag/attribute we don't explicitly allow, so player input can
 * only ever produce the fixed, known-safe set of elements below. There is no
 * path for <script>, inline event handlers, javascript:/data: URLs, or CSS
 * injection to reach the DOM. Anything we don't recognise renders as literal
 * text — a malformed creed degrades to plain text, never to markup.
 *
 * Allowed tags:
 *   [b] [i] [u] [s]                 bold / italic / underline / strike
 *   [color=#hex|name] [size=N]      colour (hex or allowlisted name) / size (clamped)
 *   [center] [quote]                layout
 *   [url=https://…]label[/url]      link — http(s) only, opens in a new tab
 *   [url]https://…[/url]
 *   [img]https://…[/img] / [img=…]  image — http(s) only, no-referrer, size-capped
 *   [list] … [*] … [/list]          bullet list
 */
import type { CSSProperties, ReactNode } from "react";

const MAX_SRC = 4000; // hard cap on the source length we will parse
const MAX_NODES = 600; // total rendered nodes — runaway-input backstop
const MAX_DEPTH = 16; // nesting depth backstop
const MIN_SIZE = 11;
const MAX_SIZE = 28;

const NAMED_COLORS = new Set<string>([
    "red", "crimson", "orange", "gold", "yellow", "green", "lime", "teal",
    "cyan", "blue", "navy", "purple", "violet", "magenta", "pink", "white",
    "silver", "gray", "grey", "black", "brown", "maroon", "aqua", "coral",
]);
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HTTP_URL_RE = /^https?:\/\/[^\s<>"'()]+$/i;

const CONTAINER_TAGS = new Set<string>([
    "b", "i", "u", "s", "color", "size", "center", "quote", "url", "img", "list",
]);

// Exported for the security-boundary tests in nindo-bbcode.test.ts — these three
// are the actual XSS gates (URL scheme / colour / size validation).
export function safeColor(v: string | undefined): string | undefined {
    if (!v) return undefined;
    const c = v.trim().toLowerCase();
    if (HEX_RE.test(c)) return c;
    if (NAMED_COLORS.has(c)) return c;
    return undefined;
}
export function safeUrl(v: string | undefined): string | undefined {
    if (!v) return undefined;
    const u = v.trim();
    return HTTP_URL_RE.test(u) ? u : undefined;
}
export function clampSize(v: string | undefined): number | undefined {
    if (!v) return undefined;
    const n = parseInt(v.trim(), 10);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
}

type Token =
    | { t: "text"; v: string }
    | { t: "open"; name: string; arg?: string; raw: string }
    | { t: "close"; name: string; raw: string };

// One regex, deliberately strict: a tag name is 1-8 lowercase letters or `*`,
// and an optional `=arg` of bounded length with no `]` or newline.
const TAG_RE = /\[(\/?)([a-z*]{1,8})(?:=([^\]\n]{0,256}))?\]/gi;

function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(src))) {
        if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
        const name = m[2].toLowerCase();
        if (m[1] === "/") out.push({ t: "close", name, raw: m[0] });
        else out.push({ t: "open", name, arg: m[3], raw: m[0] });
        last = m.index + m[0].length;
    }
    if (last < src.length) out.push({ t: "text", v: src.slice(last) });
    return out;
}

type TextNode = { type: "text"; value: string };
type VoidNode = { type: "void"; name: string };
type TagNode = { type: "tag"; name: string; arg?: string; children: TreeNode[] };
type TreeNode = TextNode | VoidNode | TagNode;

function parse(tokens: Token[]): TreeNode[] {
    const root: TagNode = { type: "tag", name: "#root", children: [] };
    const stack: TagNode[] = [root];
    const top = () => stack[stack.length - 1];
    for (const tk of tokens) {
        if (tk.t === "text") {
            top().children.push({ type: "text", value: tk.v });
            continue;
        }
        if (tk.t === "open") {
            if (tk.name === "*") {
                top().children.push({ type: "void", name: "*" });
                continue;
            }
            // [img=url] shorthand → a tag carrying its src as the text child, so
            // the same renderer path handles [img]url[/img] and [img=url].
            if (tk.name === "img" && tk.arg) {
                top().children.push({ type: "tag", name: "img", children: [{ type: "text", value: tk.arg }] });
                continue;
            }
            if (CONTAINER_TAGS.has(tk.name) && stack.length <= MAX_DEPTH) {
                const node: TagNode = { type: "tag", name: tk.name, arg: tk.arg, children: [] };
                top().children.push(node);
                stack.push(node);
                continue;
            }
            // Unknown tag (or nested too deep) → render the literal source text.
            top().children.push({ type: "text", value: tk.raw });
            continue;
        }
        // close tag
        if (CONTAINER_TAGS.has(tk.name)) {
            let idx = -1;
            for (let i = stack.length - 1; i >= 1; i--) {
                if (stack[i].name === tk.name) { idx = i; break; }
            }
            if (idx >= 1) stack.length = idx; // pop down through the matching open
            else top().children.push({ type: "text", value: tk.raw }); // stray close
        } else {
            top().children.push({ type: "text", value: tk.raw });
        }
    }
    return root.children;
}

function textOf(nodes: TreeNode[]): string {
    let s = "";
    for (const n of nodes) {
        if (n.type === "text") s += n.value;
        else if (n.type === "tag") s += textOf(n.children);
    }
    return s;
}

function renderText(value: string, keyBase: string): ReactNode[] {
    // Preserve author line breaks.
    const parts = value.split("\n");
    const out: ReactNode[] = [];
    parts.forEach((p, i) => {
        if (i > 0) out.push(<br key={`${keyBase}-br-${i}`} />);
        if (p) out.push(p);
    });
    return out;
}

const imgStyle: CSSProperties = {
    maxWidth: "100%", maxHeight: 360, borderRadius: 8, display: "block", margin: "0.4rem 0",
};

function renderListItems(nodes: TreeNode[], keyBase: string, budget: { n: number }): ReactNode[] {
    // Group the list's children into <li>s, split on each [*] marker. Anything
    // before the first [*] is dropped (matches forum BBCode behaviour).
    const items: TreeNode[][] = [];
    let cur: TreeNode[] | null = null;
    for (const n of nodes) {
        if (n.type === "void" && n.name === "*") { cur = []; items.push(cur); continue; }
        if (cur) cur.push(n);
    }
    return items.map((kids, idx) => (
        <li key={`${keyBase}-li-${idx}`} className="nindo-li">{render(kids, `${keyBase}-li-${idx}`, budget)}</li>
    ));
}

function render(nodes: TreeNode[], keyBase: string, budget: { n: number }): ReactNode[] {
    const out: ReactNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
        if (budget.n++ > MAX_NODES) break;
        const node = nodes[i];
        const key = `${keyBase}-${i}`;
        if (node.type === "text") { out.push(...renderText(node.value, key)); continue; }
        if (node.type === "void") {
            if (node.name === "*") out.push(<span key={key}>{"• "}</span>); // stray bullet
            continue;
        }
        const kids = () => render(node.children, key, budget);
        switch (node.name) {
            case "b": out.push(<strong key={key}>{kids()}</strong>); break;
            case "i": out.push(<em key={key}>{kids()}</em>); break;
            case "u": out.push(<span key={key} style={{ textDecoration: "underline" }}>{kids()}</span>); break;
            case "s": out.push(<span key={key} style={{ textDecoration: "line-through" }}>{kids()}</span>); break;
            case "center": out.push(<div key={key} style={{ textAlign: "center" }}>{kids()}</div>); break;
            case "quote": out.push(<blockquote key={key} className="nindo-quote">{kids()}</blockquote>); break;
            case "color": {
                const c = safeColor(node.arg);
                out.push(c ? <span key={key} style={{ color: c }}>{kids()}</span> : <span key={key}>{kids()}</span>);
                break;
            }
            case "size": {
                const sz = clampSize(node.arg);
                out.push(sz ? <span key={key} style={{ fontSize: sz }}>{kids()}</span> : <span key={key}>{kids()}</span>);
                break;
            }
            case "url": {
                const href = safeUrl(node.arg) ?? safeUrl(textOf(node.children));
                if (href) {
                    out.push(
                        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
                            {node.arg ? kids() : href}
                        </a>,
                    );
                } else out.push(<span key={key}>{kids()}</span>);
                break;
            }
            case "img": {
                const src = safeUrl(textOf(node.children));
                if (src) {
                    out.push(
                        <img
                            key={key}
                            src={src}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            style={imgStyle}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />,
                    );
                }
                break;
            }
            case "list": out.push(<ul key={key} className="nindo-list">{renderListItems(node.children, key, budget)}</ul>); break;
            default: out.push(<span key={key}>{kids()}</span>); break;
        }
    }
    return out;
}

/**
 * Render a Nindo BBCode string to safe React nodes. Returns null for empty
 * input; falls back to plain text if anything unexpected happens during parse.
 */
export function renderNindo(src: string): ReactNode {
    if (!src) return null;
    try {
        const clipped = src.length > MAX_SRC ? src.slice(0, MAX_SRC) : src;
        return <>{render(parse(tokenize(clipped)), "n", { n: 0 })}</>;
    } catch {
        return <>{src}</>;
    }
}
