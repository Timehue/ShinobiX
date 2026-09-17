// Reapply maintained native sources after a Bubblewrap regeneration.
// Usage: node scripts/sync-android-qa.mjs C:\path\to\shinobi-twa
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Supply the existing Bubblewrap project directory.');
const project = resolve(process.argv[2]);
const manifestPath = join(project, 'twa-manifest.json');
const twa = JSON.parse(await readFile(manifestPath, 'utf8'));
if (twa.packageId !== 'com.shinobijourney.app') throw new Error('Target must be the Shinobi Journey Android project.');
const backup = join(project, `.backup-qa-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const written = [];
async function put(relative, data) {
    const target = join(project, relative);
    const original = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (original) { const dest = join(backup, relative); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, original); }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    written.push(relative);
}
async function sources(directory, destination) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) await sources(join(directory, entry.name), join(destination, entry.name));
        else await put(join(destination, entry.name), await readFile(join(directory, entry.name)));
    }
}
await sources(join(root, 'android/twa/src'), 'app/src');
let gradle = await readFile(join(project, 'app/build.gradle'), 'utf8');
for (const dependency of ['com.google.android.play:app-update:2.1.0', 'com.google.android.play:review:2.0.2']) {
    if (!gradle.includes(dependency)) gradle = gradle.replace('dependencies {', `dependencies {\n    implementation '${dependency}'`);
}
if (!gradle.includes("junit:junit:4.13.2")) gradle = gradle.replace('dependencies {', "dependencies {\n    testImplementation 'junit:junit:4.13.2'");
// Bubblewrap 1.25.0's template pins androidbrowserhelper 2.6.2, whose splash
// screen colors the system bars with APIs Android 15 deprecated; 2.7.3 turns on
// edge-to-edge. Raise anything older, never lower a newer version.
gradle = gradle.replace(/(com\.google\.androidbrowserhelper:androidbrowserhelper:)2\.(?:[0-6]\.\d+|7\.[0-2])(?:-[\w.]+)?(?=')/, '$12.7.3');
gradle = gradle.replace(/versionCode\s+3\b/, 'versionCode 4').replace(/versionName\s+"3"/, 'versionName "4"');
await put('app/build.gradle', gradle);
let manifest = await readFile(join(project, 'app/src/main/AndroidManifest.xml'), 'utf8');
if (!manifest.includes('com.shinobijourney.app.PlayReviewActivity')) {
    manifest = manifest.replace('</application>', `    <activity android:name="com.shinobijourney.app.PlayReviewActivity"
            android:exported="true" android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="shinobijourney" android:host="review" />
            </intent-filter>
        </activity>\n    </application>`);
}
await put('app/src/main/AndroidManifest.xml', manifest);
if (twa.appVersionCode === 3) { twa.appVersionCode = 4; twa.appVersionName = '4'; twa.appVersion = '4'; }
const manifestText = JSON.stringify(twa, null, 2) + '\n';
await put('twa-manifest.json', manifestText);
// `bubblewrap build` compares a SHA-1 of twa-manifest.json with this file. On a
// mismatch it offers to regenerate the project, with Yes as the default, which
// discards every source this script applies. Keep the checksum in step.
await put('manifest-checksum.txt', createHash('sha1').update(manifestText).digest('hex'));
const icon = join(root, 'shinobij.client/public/icon-512.png');
const maskable = join(root, 'shinobij.client/public/icon-maskable-512.png');
await put('store_icon.png', await readFile(icon));
for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    await put(`app/src/main/res/mipmap-${density}/ic_launcher.png`, await sharp(icon).resize(Math.round(48 * factor)).png().toBuffer());
    await put(`app/src/main/res/mipmap-${density}/ic_maskable.png`, await sharp(maskable).resize(Math.round(108 * factor)).png().toBuffer());
    await put(`app/src/main/res/drawable-${density}/splash.png`, await sharp(icon).resize(Math.round(300 * factor)).png().toBuffer());
}
await put('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_maskable" />
    <foreground android:drawable="@android:color/transparent" />
</adaptive-icon>\n`);
console.log(`Updated ${written.length} native source/resource files in ${project}. Backups: ${backup}`);
