/*
 * LOCAL DEV TOOL — `npm run server` inside shinobij.client/. NOT a deploy target.
 *
 * Production is the repo-root `server.ts` → `dist/server.js` (Railway); this file
 * is never built, imported, or served by it. What lives here is a standalone
 * Express app with two unrelated halves:
 *
 *   • an in-memory presence mock (/api/player/heartbeat|attack|clear-attack).
 *     `npm run dev` does NOT use these — vite.config.ts carries its own
 *     equivalent middleware in-process. Kept for running the SPA against a plain
 *     static host with no vite dev server.
 *   • /api/generate-image, the gpt-image-1 asset generator used for card/AI art.
 *
 * ⚠ The presence half has NO auth, NO rate limit, and NO identity check: any
 * caller can register as any name and mark anyone as under attack. That is
 * acceptable ONLY because it holds throwaway in-memory state on a loopback
 * socket. It is a deliberately dumb stub, not a second implementation of
 * api/player/* — the real ones are token-authed and presence-gated.
 *
 * The three guards below keep it that way, and exist because this file has the
 * same shape as the unauthenticated .NET API mirror removed in 2026-06:
 *   1. refuses to start in production,
 *   2. binds to loopback only, so it is never reachable off this machine,
 *   3. allows only localhost origins instead of `cors()`'s open default.
 * If you ever need it reachable from another device, put a real authenticating
 * proxy in front — do not relax these.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

if (process.env.NODE_ENV === "production") {
    console.error(
        "[dev-server] Refusing to start: this is the unauthenticated local dev stub, "
        + "not the production API. Run `node dist/server.js` from the repo root instead.",
    );
    process.exit(1);
}

const app = express();
// Loopback origins only. The open `cors()` default let any page the developer
// happened to visit POST to this server through their browser.
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // curl / same-origin / non-browser
        callback(null, /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin));
    },
}));
app.use(express.json({ limit: "2mb" }));

const PORT = parseInt(process.env.API_PORT || "3001");
const HOST = "127.0.0.1";
const PRESENCE_TTL_MS = 60_000;
const MAX_PROMPT_LENGTH = 1_500;
const MAX_LABEL_LENGTH = 120;

// ── Multiplayer presence store ──────────────────────────────────────────────
type PlayerPresence = {
    name: string;
    sector: number;
    character: unknown;
    lastSeen: number;
    pendingAttacker: unknown | null;
};

const presence = new Map<string, PlayerPresence>();

type CharacterSummary = {
    level?: number;
    village?: string;
    specialty?: string;
};

function characterSummary(character: unknown): CharacterSummary {
    return character && typeof character === "object" ? character as CharacterSummary : {};
}

function errorMessage(err: unknown, fallback: string) {
    return err instanceof Error ? err.message : fallback;
}

function safeName(name: string) {
    return name.replace(/[^a-z0-9\-_]/g, "").toLowerCase();
}

function sectorFrom(value: unknown, fallback: number): number {
    const sector = Math.floor(Number(value));
    return Number.isFinite(sector) && sector >= 0 ? sector : fallback;
}

// Evict players that haven't sent a heartbeat recently
setInterval(() => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    for (const [key, p] of presence) {
        if (p.lastSeen < cutoff) presence.delete(key);
    }
}, 10_000).unref();

// Register presence + return sector mates and any pending attack
app.post("/api/player/heartbeat", (req, res) => {
    const { name, sector, character } = req.body as {
        name?: string;
        sector?: number;
        character?: unknown;
    };
    if (!name) { res.status(400).json({ error: "Missing name." }); return; }
    const playerId = safeName(name);
    if (!playerId) { res.status(400).json({ error: "Invalid name." }); return; }

    const existing = presence.get(playerId) ?? { name: name.trim(), sector: sectorFrom(sector, 40), character, lastSeen: 0, pendingAttacker: null };
    const pendingAttacker = existing.pendingAttacker;
    const nextSector = sectorFrom(sector, existing.sector);

    presence.set(playerId, {
        name: name.trim(),
        sector: nextSector,
        character: character ?? existing.character,
        lastSeen: Date.now(),
        pendingAttacker: null, // clear on read
    });

    const sectorMates = [...presence.values()]
        .filter((p) => safeName(p.name) !== playerId && p.sector === nextSector)
        .map(({ name: n, sector: s, character: c }) => {
            const summary = characterSummary(c);
            return {
                name: n,
                sector: s,
                character: c,
                level: summary.level ?? 1,
                village: summary.village ?? "",
                specialty: summary.specialty ?? "Ninjutsu",
            };
        });

    res.json({ sectorMates, pendingAttacker });
});

// Mark a target player as being attacked
app.post("/api/player/attack", (req, res) => {
    const { targetName, attacker } = req.body as {
        targetName?: string;
        attacker?: unknown;
    };
    if (!targetName) { res.status(400).json({ error: "Missing targetName." }); return; }
    const targetId = safeName(targetName);
    if (!targetId) { res.status(400).json({ error: "Invalid targetName." }); return; }

    const target = presence.get(targetId);
    if (!target) { res.status(404).json({ error: "Target not online." }); return; }

    presence.set(targetId, { ...target, pendingAttacker: attacker ?? null });
    res.json({ ok: true });
});

// Clear a pending attack (called after the defender enters combat)
app.post("/api/player/clear-attack", (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "Missing name." }); return; }
    const playerId = safeName(name);
    if (!playerId) { res.status(400).json({ error: "Invalid name." }); return; }
    const p = presence.get(playerId);
    if (p) presence.set(playerId, { ...p, pendingAttacker: null });
    res.json({ ok: true });
});

// ── Image generation ────────────────────────────────────────────────────────
app.post("/api/generate-image", async (req, res) => {
    const { prompt, label } = req.body as { prompt?: string; label?: string };

    if (!prompt?.trim()) {
        res.status(400).json({ error: "Missing image prompt." });
        return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH || (label?.length ?? 0) > MAX_LABEL_LENGTH) {
        res.status(413).json({ error: "Image prompt is too large." });
        return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: "OPENAI_API_KEY is not set on the server." });
        return;
    }

    const finalPrompt = `Create a polished 2D anime shinobi RPG game asset.

User request:
${prompt}

Asset label:
${label ?? ""}

Style rules:
- original shinobi RPG fantasy style
- clean game asset composition
- dramatic lighting
- no text
- no logos
- no UI
- no watermarks
- high detail
- suitable for a browser RPG`;

    try {
        const openai = new OpenAI({ apiKey });
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: finalPrompt,
            size: "1024x1024",
            quality: "low",
            n: 1,
        });

        const b64 = response.data[0]?.b64_json;
        if (!b64) {
            res.status(500).json({ error: "OpenAI did not return image data." });
            return;
        }

        res.json({ image: `data:image/png;base64,${b64}` });
    } catch (err: unknown) {
        const message = errorMessage(err, "Image generation failed.");
        res.status(502).json({ error: message });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Local dev API stub running on http://${HOST}:${PORT} (loopback only, unauthenticated)`);
});
