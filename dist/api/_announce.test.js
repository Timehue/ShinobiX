"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _announce_js_1 = require("./_announce.js");
(0, node_test_1.describe)('Discord announcement webhook destination', () => {
    const id = '123456789012345678';
    const token = 'A'.repeat(68);
    (0, node_test_1.it)('accepts only the canonical HTTPS Discord webhook shape', () => {
        node_assert_1.strict.equal((0, _announce_js_1.validatedDiscordWebhookUrl)(`https://discord.com/api/webhooks/${id}/${token}`), `https://discord.com/api/webhooks/${id}/${token}`);
    });
    (0, node_test_1.it)('rejects SSRF, credential, port, query, and path variants', () => {
        for (const url of [
            `http://discord.com/api/webhooks/${id}/${token}`,
            `https://evil.example/api/webhooks/${id}/${token}`,
            `https://discord.com.evil.example/api/webhooks/${id}/${token}`,
            `https://user:pass@discord.com/api/webhooks/${id}/${token}`,
            `https://discord.com:444/api/webhooks/${id}/${token}`,
            `https://discord.com/api/webhooks/${id}/${token}?next=evil`,
            'https://discord.com/api/webhooks/not-an-id/not-a-token',
            'file:///etc/passwd',
        ]) {
            node_assert_1.strict.equal((0, _announce_js_1.validatedDiscordWebhookUrl)(url), null, url);
        }
    });
});
