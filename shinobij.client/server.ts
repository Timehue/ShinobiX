import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = parseInt(process.env.API_PORT || "3001");

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

// Evict players that haven't sent a heartbeat in 30 seconds
setInterval(() => {
    const cutoff = Date.now() - 30_000;
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

    const existing = presence.get(name) ?? { name, sector: sector ?? 40, character, lastSeen: 0, pendingAttacker: null };
    const pendingAttacker = existing.pendingAttacker;

    presence.set(name, {
        name,
        sector: sector ?? existing.sector,
        character: character ?? existing.character,
        lastSeen: Date.now(),
        pendingAttacker: null, // clear on read
    });

    const sectorMates = [...presence.values()]
        .filter((p) => p.name !== name && p.sector === (sector ?? existing.sector))
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

    const target = presence.get(targetName);
    if (!target) { res.status(404).json({ error: "Target not online." }); return; }

    presence.set(targetName, { ...target, pendingAttacker: attacker ?? null });
    res.json({ ok: true });
});

// Clear a pending attack (called after the defender enters combat)
app.post("/api/player/clear-attack", (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "Missing name." }); return; }
    const p = presence.get(name);
    if (p) presence.set(name, { ...p, pendingAttacker: null });
    res.json({ ok: true });
});

// ── Image generation ────────────────────────────────────────────────────────
app.post("/api/generate-image", async (req, res) => {
    const { prompt, label } = req.body as { prompt?: string; label?: string };

    if (!prompt?.trim()) {
        res.status(400).json({ error: "Missing image prompt." });
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

app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
});
