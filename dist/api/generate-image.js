"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Require a logged-in player or admin — this endpoint burns OpenAI credits
    // and would be trivially abused if left open.
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel environment variables.' });
    }
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { prompt, label } = body;
        if (!prompt?.trim()) {
            return res.status(400).json({ error: 'Missing image prompt.' });
        }
        const finalPrompt = `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label ?? ''}\n\nStyle rules:\n- original ninja RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
        const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-image-1',
                prompt: finalPrompt,
                size: '1024x1024',
                quality: 'low',
                n: 1,
            }),
        });
        const data = await openaiRes.json();
        if (!openaiRes.ok) {
            return res.status(502).json({ error: data?.error?.message ?? `OpenAI error ${openaiRes.status}` });
        }
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) {
            return res.status(502).json({ error: 'OpenAI did not return image data.' });
        }
        return res.status(200).json({ image: `data:image/png;base64,${b64}` });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
