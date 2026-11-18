import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, hash as cryptoHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

// Brand/IP hygiene gate.
//
// ShinobiX has been scrubbed of competitor and borrowed-franchise names
// several times, and each scrub decayed until this test started looking at
// the source. It now reads every tracked text file and every tracked file
// path, guard files included, so the next reintroduction fails CI instead of
// shipping.
//
// Every guarded name is stored as a SHA-256 hash, never as text, so this file
// cannot be read back into the names it blocks. Adding a hash is cheap.
// Removing one needs a reason: the pinned fingerprints below fail on any change
// to either list.

const root = resolve(import.meta.dirname, '..');

const hashWord = typeof cryptoHash === 'function'
    ? (word) => cryptoHash('sha256', word)
    : (word) => createHash('sha256').update(word).digest('hex');

// Names that are guarded as whole words AND when spelled across up to four
// neighbouring words joined by a space or one punctuation mark ("ab cd",
// "Ab-Cd", "ab.cd.ef"). These are competitor games, studios and identifiers,
// stand-in phrases that point at them, and multi-word card-game names. To add
// one, hash its lowercase letters and digits with every separator removed.
const phraseHashes = new Set([
    '6458957a3cb92470bd01d08b9f90a2ff6e7f0f04cd75a25403a04a7e76f28e0f',
    '43e2db62ff6e7a348bb8894301e6bc38b2b1cb71981081e0a1306d3b28d75d47',
    'd5be3e3851cda46ba5d8ff94f275e3bb2db1700ba52c6771173a4f2329225df9',
    'aecb65fc665de53bf70c9af74f4d5a59798ac29bb173597404a5b0346fe6dc04',
    'fb661b2987b2b7d7817d90b61cfb3d4b5e236d150385eaafb162df943f98d571',
    '88c460a41a4dc9e88c2675fc08de828b06b83a20b76074fb52c91b3d983abd33',
    '41c82f757bf311cb6ce019bd382df71d2e9a86736e0e6a6cc5634aeb79572ad6',
    'a772877ac04741fd994cf191f0b8fe5e70cb268785e76609e8709e699e5bafc9',
    '4853fdc36cf483dcb055839b361bf5e5a9823eebd39a3e41803a08939ed666d5',
    '37821cd17d98897c984d4abc944b8445380e633ef1139568651a01bf7fefc789',
    '1de025f8504f922c83f4a602fa75cad593cc9ccc0a7ef010ba8ec31a2402153d',
    'ddbe36e5fe47da6ab64c5425c696294f83bd78cbeca7067c118cb22cf457771d',
    '08523ba889c976d1d8f85af0d906b0904643ae7ce86eae78a7e67914e97381cc',
    '2fe93ebff8af32d75b4de8283b8e2bfecc725336cfc37b09b06a629ea49c24a9',
    '9b99e54a634bc65f1208e8c8fdb79c588a50a554f7360dad8ff02fe6494ae020',
    'ed9cbc5417b4323682fe982f78c2554a4cdcfade31e229aa88b622ae34feeff7',
]);

// Single-word names: borrowed franchise characters, clans, techniques, places
// and titles, plus other franchises' names. These match a whole word, or one
// camelCase or digit-separated part of a word ("abcStyle", "abc2"), but are
// NOT joined across words: one of them is also what two ordinary English words
// spell when run together, which would fail on normal prose. Words that are
// also real Japanese vocabulary this game uses (a helmet, a cherry-blossom
// banner) are deliberately not here.
const wordHashes = new Set([
    '846f6a76ffc111552f1c9ca3a06d989d0c9c9b79c4fc25ff67f6207be512955c',
    '5bbad634a53dee0d6f37c9067a232fae9d3069114c41ad4a37660ad8e62c8bb9',
    '666c3c2e48dc88568033c26e02836c0defa2871ee033823d773813e001f3fc59',
    '904537c28db7cb53cea5ca7b5128ce7b9f1fffed836e16e4b776a4622b2bb893',
    '332cde01112429bacd16b06ef342ac283ab78ca5721260fbc919afad3587765f',
    '493cd729a2611ffd8efeb4d59e9340246f5429669f40f7aad01fd025b57ac54d',
    '625a61216a10e6c7d73c097e6669f14238823e8e95ef408bcb718d670469c51b',
    '9951ea9cb0ecb78cda6c87fff75dc1eeca30b3144d9c362f753496f757cd2a24',
    '78b5436cd062d7a0293da26e2c97742e98f44cb99223ab1cd381281ea2657762',
    '6320616aa6b9414abc2ef059bbfae64781f6fdc3cdaf01aaf0e5e4fd5044ab29',
    '3000caca5b94c7e5fc0f9e2f187bb589f925597778832ad59485280ac32be4c1',
    'f2165aee8578818ba1b39db799247225452608ef9f5bff614af49d0b75c6af34',
    'ebb94d815b3c42b5ca6f8275dd8cb707b3e44ca6a2c453abec8cbb17678cf16c',
    'aa634dcfba9fbd627de6de1e302dfb3464d8a8ef678702b3b22fd816b91e7054',
    '968347dded6a8360fd37aa68eb5456f943cd22d00660c36032445e3d3d0b2364',
    'd4055fc8023d4ce384109bd229db3973caab0ec7cc45a8e9db4172428aeddf84',
    'b3f949c2e313360269aaabc6b83071f2bde4bee847070eead043b32039f376ac',
    '60d4ff26bafbd3c6ee4b5fdfc3c323d1262aab3f97b91f9ec2178a43a620e6d7',
    'eba2ead8ff67d87403ceab1202f451edbd61958c85615a1197f5fdf197d0bc15',
    '9d05784afac36a2a0499e50a4345ee6fed252d4d964f942404f253935b195c95',
    '9c466412766035c349dd53f9862eeeff9093d5c3c62ba236e209b7f79af372b4',
    '379ee033aa10b319a18fd2750715bd1bfc483502e2f251347dc22fdc504e0ce0',
    '94b2c66131625ea7122095fb6a29d36e9b4b7b4c0d9229893b798a41fc084921',
    'a78a9d321ba0c6f8039ce9063481a32d62b2929ed294a13265a290769e099705',
    'cc9429a23fc166f28fc8574e018657adaaca7c8617f3b2adc4df93f3414b2e4e',
    '505b16f652663820daf06e2a165d6cd35af0c83a59f344c7c801f5b1f6ef8ed2',
    'ec573e68bce3f7f0421d0b278034d7cc3e88955cb4911692744b40e1c78def4c',
    '3ded2fed5527d81118c02d5d30875082bdc558bb8b85493b5c2bcaae089241e1',
    '90d348a7fbb5de4f77774be3ff84a90bf96aecf6e35390e66205ea4983e42f8a',
    '41d714ef35b93c27b965b76003b67cbb2dfe5edba13cb8410e1d33da03653fa2',
    'c9713ccd3cbbb15b461b22f79fe991ec521a01b6100f8206c9f460f51406c70a',
    'f70c6bc8eed0c6a93e0ede8ce37c47e59e588cbc6c2a43301c4507c7930adba0',
    'f4f04fcdce45e8fe289499c9d762749c8ef422808e7079031c44e6d638f18e20',
    '6730f4c16be5d78e8ca3ecbdc796c1f7cc1293634ad507defa1de9c348e984bd',
    '540b416aeb0f13288759fda02e1584f3730db36f3b28554c2fe8595626d9bbba',
    '0a0af25867f46e629502172f88be9f211969dbfe01931e101ff3ba4f440292f7',
    '7974d09b666c9ee2ffd0c98feeb0e24a4dc09d7610795b40f3903ec997985076',
    '2a2e81adfd9e3dee0f9aa62975a4d70ba40cd9b148f0671ac7a3551e7211973a',
    'af7d1ab6dae3847a439ad52f8e566cde94ecd1f4b3e1f0825c833c0d4dc9c890',
    '3c596eff3b3c04b751719627ce5f67772fc26eeca3e5fa4e1e75e54a98ae038d',
    'e7a116cb42df556b64e8cf5f0b2d33790e133457028cc767a9bfaf7e47aef246',
    '69317c46f0fcd723fa0b297580e916294923f1ccd0ffd49ae7bf30cabd25b6b8',
    '74e6c4c918719811885ab3c50a97a3a53c4a41ab8d5f988d211101063d82cb0a',
    '40567da124b713a62c3e620c566c033675b7f36212df6b9643206ac9eb85bedc',
    '8488e85da88adf09cc958e217f0b470fc7da143a4ff4d45e9d45f71c2c3d2895',
    '683ed894b444e2199b698b918977e79b8d70e3890ad0cd6750d03c2cf2f4b851',
    '40001dbeca138675b65c0bc01dc16933a25904031d98cee04306e96521af79ca',
    'd4376145a59f87054114724b2f3e50c76d4e635fc9a30241e6def9616cc42f0b',
    'eaa2bded32cc585d3f37c5319abe8890ad28a697ed66d5823f10536cc9c0fdb9',
    '43999461d22f67840fcd9b8824293eaa4f18146e57b2c651bcd925e3b3e4e429',
    'd963ebee302d8b4282c76f83735d3b2bee78869a9cb4300952a4f2711c9c4d35',
    'f2423d071f26082d053141bad42a7cb050310a1c0dfc7be5e6333fa76d32328e',
    // The borrowed squad name the Shadowguard replaced (2026-11-18).
    '3e164a1b174a2c4e87eb0de98fa3be14ae0da50c2e82e5e7c762ee4477609af3',
]);

// Fingerprints of the two lists. A hash cannot quietly disappear: removing or
// changing one fails 'pins both hash lists' until these are updated too, which
// is a visible, reviewable edit. Recompute with fingerprint() below.
const PINNED = {
    phrases: { count: 16, fingerprint: '73de102a5c5bcf361ee3737c4dbaafcc7346eea528e5e2a5b952d25ff1825f20' },
    words: { count: 53, fingerprint: '4bf8d865bc90ca7c4cb28272cab5f50309795b5ee33ce3ea0c37381ab05c3996' },
};

// The seven hashes the gate has carried since its first version. They must
// stay in the phrase list whatever else changes.
const ORIGINAL_COMPETITOR_HASHES = [
    '6458957a3cb92470bd01d08b9f90a2ff6e7f0f04cd75a25403a04a7e76f28e0f',
    'aecb65fc665de53bf70c9af74f4d5a59798ac29bb173597404a5b0346fe6dc04',
    '88c460a41a4dc9e88c2675fc08de828b06b83a20b76074fb52c91b3d983abd33',
    'fb661b2987b2b7d7817d90b61cfb3d4b5e236d150385eaafb162df943f98d571',
    '43e2db62ff6e7a348bb8894301e6bc38b2b1cb71981081e0a1306d3b28d75d47',
    'd5be3e3851cda46ba5d8ff94f275e3bb2db1700ba52c6771173a4f2329225df9',
    '41c82f757bf311cb6ce019bd382df71d2e9a86736e0e6a6cc5634aeb79572ad6',
];

const GUARDS = { phrases: phraseHashes, words: wordHashes };

function fingerprint(hashes) {
    return hashWord([...hashes].sort().join('\n'));
}

// Neighbouring words may be joined by whitespace or by exactly one of these.
// "ab. cd" (a sentence break) is not a join.
const JOINER = /^(?:[ \t]+|[-_.'\u2019\u00b7/])$/;
const MAX_PARTS = 4;
// No guarded name is anywhere near this long once its separators are gone, so
// longer joins are not hashed. This keeps the full-tree scan fast.
const MAX_JOINED_CHARS = 40;
const MIXED_CASE_OR_DIGITS = /[a-z][A-Z]|[A-Za-z][0-9]|[0-9][A-Za-z]|[A-Z]{2}[a-z]/;
const CAMEL_PART = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g;
const WORD = /[a-z0-9]+/gi;

// Shared across files: the same words recur through the whole tree, and a map
// lookup is far cheaper than a hash. Only hits keep their hash; a miss is
// stored as false. Bounded so a huge tree cannot exhaust memory.
const lookupCaches = new WeakMap();
const LOOKUP_CACHE_LIMIT = 1_500_000;

// Accented letters fold to their base letter, so an accented spelling of a
// name is caught too. NFKD never adds or removes a newline, so line numbers
// stay exact; a column can shift by the folded marks before it on its line.
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;
function foldAccents(source) {
    return NON_ASCII.test(source) ? source.normalize('NFKD').replace(/[̀-ͯ]/g, '') : source;
}

function findGuarded(rawSource, guards = GUARDS) {
    const source = foldAccents(rawSource);
    let cache = lookupCaches.get(guards);
    if (!cache) lookupCaches.set(guards, (cache = new Map()));
    const cachedHash = (text) => {
        let result = cache.get(text);
        if (result === undefined) {
            const hash = hashWord(text);
            result = guards.words.has(hash) || guards.phrases.has(hash) ? hash : false;
            if (cache.size < LOOKUP_CACHE_LIMIT) cache.set(text, result);
        }
        return result || '';
    };
    const found = [];
    // The last few words, for joining a phrase spelled across them.
    const window = [];
    WORD.lastIndex = 0;
    for (let match = WORD.exec(source); match !== null; match = WORD.exec(source)) {
        const word = match[0];
        const lower = word.toLowerCase();
        const offset = match.index;
        const end = offset + word.length;

        const previous = window[window.length - 1];
        if (previous && !JOINER.test(source.slice(previous.end, offset))) window.length = 0;
        window.push({ lower, offset, end });
        if (window.length > MAX_PARTS) window.shift();

        const whole = lower.length <= MAX_JOINED_CHARS ? cachedHash(lower) : null;
        if (whole && (guards.words.has(whole) || guards.phrases.has(whole))) {
            found.push({ offset, hash: whole });
            window.length = 0;
            continue;
        }
        if (MIXED_CASE_OR_DIGITS.test(word)) {
            let partHit = null;
            for (const part of word.match(CAMEL_PART) ?? []) {
                const hash = cachedHash(part.toLowerCase());
                if (guards.words.has(hash)) { partHit = hash; break; }
            }
            if (partHit) {
                found.push({ offset, hash: partHit });
                window.length = 0;
                continue;
            }
        }
        // Phrases ending at this word, longest first so a hit is reported at
        // the earliest word it spans.
        let joined = lower;
        let hit = null;
        for (let k = window.length - 2; k >= 0; k--) {
            joined = window[k].lower + joined;
            if (joined.length > MAX_JOINED_CHARS) break;
            const hash = cachedHash(joined);
            if (guards.phrases.has(hash)) hit = { offset: window[k].offset, hash };
        }
        if (hit) {
            found.push(hit);
            window.length = 0;
        }
    }
    return found;
}

// Files that cannot hold readable text. Everything else is read and sniffed
// for a NUL byte, so an unlisted binary type is still skipped safely.
const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.bmp', '.tif', '.tiff', '.psd',
    '.mp4', '.webm', '.mov', '.mkv', '.avi', '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
    '.glb', '.gltf', '.bin', '.fbx', '.obj', '.blend', '.ktx2', '.hdr', '.exr',
    '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.7z', '.tar', '.br', '.pdf',
    '.keystore', '.jks', '.aab', '.apk', '.jar', '.dll', '.exe', '.so', '.dylib', '.wasm', '.node',
    '.safetensors', '.ckpt', '.pt', '.onnx', '.npy', '.npz', '.pkl', '.sqlite', '.db',
]);
const MAX_TEXT_BYTES = 64 * 1024 * 1024;

function trackedFiles() {
    try {
        const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
        const files = out.toString('utf8').split('\0').filter(Boolean);
        if (files.length > 0) return files;
    } catch {
        // No git (an exported tree): fall back to walking the source roots.
    }
    const files = [];
    const walk = (directory) => {
        if (!existsSync(directory)) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
            const full = join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else files.push(relative(root, full).split('\\').join('/'));
        }
    };
    walk(root);
    return files;
}

function readText(path) {
    if (binaryExtensions.has(extname(path).toLowerCase())) return null;
    const full = join(root, path);
    // Sparse CI checkouts leave some tracked files off disk.
    if (!existsSync(full)) return null;
    const stat = statSync(full);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;
    const buffer = readFileSync(full);
    if (buffer.subarray(0, 8000).includes(0)) return null;
    return buffer.toString('utf8');
}

function locate(source, offset) {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    return `${line}:${column}`;
}

// A failure names the file, line, column and the first 12 hex digits of the
// hash that matched. That is enough to find and fix the text without the
// test output ever printing the name itself.
function describeHit(path, source, { offset, hash }) {
    return `${path}:${locate(foldAccents(source), offset)} (guarded term ${hash.slice(0, 12)})`;
}

describe('brand and IP hygiene', () => {
    const canaries = {
        phrases: new Set([hashWord('canaryname'), hashWord('abcdefghi')]),
        // 'tenant' stands in for a single-word name that two ordinary words
        // ("ten ant") also spell when run together.
        words: new Set([hashWord('velmora'), hashWord('tenant')]),
    };

    it('detects phrase hashes in every spelling', () => {
        for (const spelling of [
            'CanaryName', 'canaryname', 'canary name', 'Canary-Name', 'canary_name', 'canary.name',
            "canary'name", 'canary/name', 'canary  name', 'The Canary Name!', 'Ca-na-ry-name', '"canary name"',
            'abc def ghi', 'Abc-Def-Ghi', 'abc.def.ghi', 'Cánary Námé',
        ]) {
            assert.equal(findGuarded(`before ${spelling} after`, canaries).length, 1, `${spelling} should be detected`);
        }
    });

    it('does not join a phrase across a sentence break, a line or a longer word', () => {
        for (const text of ['canary. name', 'canary\nname', 'canary - name', 'canarynames', 'xcanary name', 'abc def ghij']) {
            assert.deepEqual(findGuarded(text, canaries), [], `${JSON.stringify(text)} should not be detected`);
        }
    });

    it('detects word hashes as whole words and camelCase or digit parts only', () => {
        for (const spelling of ['Velmora', 'VELMORA', 'velmora_style', 'velmoraStyle', 'TheVelmoraCut', 'velmora2', 'velmora-born', 'Vélmorà']) {
            assert.equal(findGuarded(`before ${spelling} after`, canaries).length, 1, `${spelling} should be detected`);
        }
        for (const text of ['velmoras', 'xvelmora', 'vel mora', 'Vel-Mora', 'ten ant hills', 'ten-ant']) {
            assert.deepEqual(findGuarded(text, canaries), [], `${text} should not be detected`);
        }
    });

    it('stores guarded names as hashes only', () => {
        for (const hash of [...phraseHashes, ...wordHashes]) assert.match(hash, /^[0-9a-f]{64}$/);
        const overlap = [...phraseHashes].filter((hash) => wordHashes.has(hash));
        assert.deepEqual(overlap, [], 'a hash belongs in one list, not both');
    });

    it('pins both hash lists so a guarded name cannot silently disappear', () => {
        for (const hash of ORIGINAL_COMPETITOR_HASHES) {
            assert.equal(phraseHashes.has(hash), true, `original guard ${hash.slice(0, 12)} was removed`);
        }
        assert.deepEqual(
            {
                phrases: { count: phraseHashes.size, fingerprint: fingerprint(phraseHashes) },
                words: { count: wordHashes.size, fingerprint: fingerprint(wordHashes) },
            },
            PINNED,
            'a guarded hash was added or removed: update PINNED in the same change and say why in review',
        );
    });

    it('guards every hashed reserved title the moderation filter blocks', async () => {
        const { RESERVED_TITLE_TERM_HASHES } = await import('../api/_text-moderation.ts');
        assert.ok(RESERVED_TITLE_TERM_HASHES.size > 0);
        for (const hash of RESERVED_TITLE_TERM_HASHES) {
            assert.equal(wordHashes.has(hash), true, `moderation hash ${hash.slice(0, 12)} is not guarded here`);
        }
    });

    it('failure output names the place, not the term', () => {
        const source = 'line one\nsee VelmoraStyle here';
        const [hit] = findGuarded(source, canaries);
        const message = describeHit('docs/example.md', source, hit);
        assert.match(message, /^docs\/example\.md:2:5 \(guarded term [0-9a-f]{12}\)$/);
        assert.doesNotMatch(message, /velmora/i);
    });

    it('contains no competitor or borrowed-franchise names in any tracked file or path', () => {
        const failures = [];
        let scanned = 0;
        for (const path of trackedFiles()) {
            for (const hit of findGuarded(path)) failures.push(`${describeHit(path, path, hit)} in the file path`);
            const source = readText(path);
            if (source === null) continue;
            scanned++;
            for (const hit of findGuarded(source)) failures.push(describeHit(path, source, hit));
        }
        assert.ok(scanned > 100, `only ${scanned} text files were scanned; the file list is wrong`);
        assert.deepEqual(
            failures,
            [],
            `competitor or borrowed-franchise names found:\n${failures.join('\n')}\n\n` +
                'Rename or remove the text. There is no allowlist: guard files store hashes, and art\n' +
                "prompts describe Shinobi Journey's own look instead of naming what to avoid.",
        );
    });
});
