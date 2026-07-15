import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadArtifactBytes, trustedDownloadUrl, trustedPublishOrigin, writeTrustedArtifact } from './_trusted-tool-io.mjs';

test('trustedDownloadUrl accepts provider HTTPS and rejects arbitrary or credentialed origins', () => {
    assert.equal(trustedDownloadUrl('https://v3.fal.media/files/example.png').hostname, 'v3.fal.media');
    assert.throws(() => trustedDownloadUrl('http://v3.fal.media/files/example.png'), /HTTPS/);
    assert.throws(() => trustedDownloadUrl('https://example.com/example.png'), /Untrusted/);
    assert.throws(() => trustedDownloadUrl('https://user:pass@fal.media/example.png'), /credentials/);
});

test('downloadArtifactBytes bounds trusted inline provider artifacts', async () => {
    const bytes = await downloadArtifactBytes('data:image/png;base64,aGVsbG8=', { maxBytes: 5 });
    assert.equal(bytes.toString(), 'hello');
    await assert.rejects(
        downloadArtifactBytes('data:image/png;base64,aGVsbG8=', { maxBytes: 4 }),
        /exceeds/,
    );
    await assert.rejects(
        downloadArtifactBytes('data:text/plain;base64,aGVsbG8=', { maxBytes: 10 }),
        /HTTPS|Invalid URL/,
    );
});

test('trustedPublishOrigin permits known game and local origins only', () => {
    assert.equal(trustedPublishOrigin('https://shinobijourney.com/'), 'https://shinobijourney.com');
    assert.equal(trustedPublishOrigin('http://localhost:5173'), 'http://localhost:5173');
    assert.equal(
        trustedPublishOrigin('https://qa.example.com', { SHINOBIX_TOOL_ALLOWED_ORIGINS: 'https://qa.example.com' }),
        'https://qa.example.com',
    );
    assert.throws(() => trustedPublishOrigin('https://evil.example'), /Untrusted/);
    assert.throws(() => trustedPublishOrigin('http://shinobijourney.com'), /HTTPS/);
});

test('writeTrustedArtifact confines output path, extension, and size', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobix-artifact-'));
    try {
        const output = path.join(root, 'asset.png');
        writeTrustedArtifact(root, output, Buffer.from('png'), { extensions: ['.png'], maxBytes: 3 });
        assert.equal(fs.readFileSync(output, 'utf8'), 'png');
        assert.throws(
            () => writeTrustedArtifact(root, path.join(root, '..', 'escape.png'), Buffer.from('x'), { extensions: ['.png'], maxBytes: 3 }),
            /inside/,
        );
        assert.throws(
            () => writeTrustedArtifact(root, path.join(root, 'asset.txt'), Buffer.from('x'), { extensions: ['.png'], maxBytes: 3 }),
            /extension/,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
