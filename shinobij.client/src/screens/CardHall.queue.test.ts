import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("./CardHall.tsx", import.meta.url), "utf8");
const duelCss = readFileSync(new URL("../styles/chronicle-duel.css", import.meta.url), "utf8");

test("Free-Play queue exposes cancellation and releases its lease on navigation", () => {
  assert.match(source, /useEffect\(\(\) => \{\s*mountedRef\.current = true;\s*return \(\) => \{ mountedRef\.current = false; \};\s*\}, \[\]\);/);
  assert.match(source, /<button onClick=\{\(\) => void cancel\(\)\}[\s\S]*?Cancel Search[\s\S]*?<\/button>/);
  assert.match(source, /window\.addEventListener\("pagehide", leaveOwnedQueue\)/);
  assert.match(source, /return \(\) => \{[\s\S]*?void leaveLease\(lease\);[\s\S]*?\};/);
  assert.match(source, /requestFreePlayQueue\(lease\.authority\.accountKey, "leave", \{ keepalive: true \}\)/);
  assert.match(source, /<FreePlayQueue key=\{normalizeFreePlayQueueAccount\(character\.name\)\}/);
});

test("ambiguous queue failures stay visible and retryable", () => {
  assert.match(source, /freePlayPollOutcome\(body\)/);
  assert.match(source, /outcome\.kind === "expired"[\s\S]*?setSearching\(false\)/);
  assert.match(source, /Your search is still active; retrying automatically\./);
  assert.match(source, /The join could not be canceled, so the search remains active/);
  assert.match(source, /Your search remains active; retry Cancel Search\./);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test("Card Hall syncs and ceremonies server-authoritative Living Chronicle records", () => {
  assert.match(source, /syncChronicleProgression\(playerName\)/);
  assert.match(source, /if \(!alive \|\| activeProgressionPlayerRef\.current !== syncKey\) return;/);
  assert.match(source, /const versionedHandler = progressionVersionedCharacterHandlerRef\.current;/);
  assert.match(source, /versionedHandler\(result\.character, result\._saveVersion\)/);
  assert.match(source, /if \(!versionedHandler\) progressionCharacterHandlerRef\.current\(result\.character\);/);
  assert.match(source, /if \(result\.granted\.length\) setProgressionReceipt\(result\.granted\);/);
  assert.match(source, /chronicleRecordSource\(id\)/);
  assert.match(source, /cardId\.startsWith\("story-"\).*Story victory/);
  assert.match(source, /cardId\.startsWith\("legacy-"\).*Legacy awakening/);
  assert.match(source, /cardId\.startsWith\("pet-witness-"\).*Companion witness/);
  assert.match(source, /A living witness carried it beyond the moment\. Ihara has pressed that truth/);
  assert.match(source, /role="status"[\s\S]*?aria-live="polite"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(source, /progressionReceiptRef\.current\?\.focus\(\)/);
  assert.match(source, /collectionTabRef\.current\?\.focus\(\)/);
});

test("Card Hall gates AI settlement paint by mounted origin and save version", () => {
  assert.match(source, /presentSession\(result: ChronicleAiResult, originatingPlayerName: string\)/);
  assert.match(source, /const authority = chronicleResponseAuthority\(\{[\s\S]*?mounted: cardHallMountedRef\.current,[\s\S]*?originatingPlayerName,[\s\S]*?responsePlayerName: result\.character\?\.name,[\s\S]*?saveVersion: result\._saveVersion/);
  assert.match(source, /if \(authority === "discard"\) return;/);
  assert.match(source, /onServerVersion: \(version\) => result\.character && progressionVersionedCharacterHandlerRef\.current[\s\S]*?progressionVersionedCharacterHandlerRef\.current\(result\.character, version\)/);
  assert.match(source, /if \(authority === "authoritative"\) \{[\s\S]*?if \(result\.reward\) setReward\(result\.reward\);[\s\S]*?if \(result\.character && !progressionVersionedCharacterHandlerRef\.current\) progressionCharacterHandlerRef\.current\(result\.character\)/);
  assert.doesNotMatch(source, /if \(result\.character\) updateCharacter\(result\.character\)/);
});

test("Card Hall section navigation exposes button state rather than incomplete tab semantics", () => {
  assert.match(source, /<nav className="chronicle-tabs" aria-label="Card Hall sections">/);
  assert.match(source, /type="button"[\s\S]*?aria-pressed=\{tab === item\}/);
  assert.doesNotMatch(source, /aria-selected=\{tab === item\}/);
  assert.match(duelCss, /\.chronicle-tabs button\[aria-pressed="true"\]/);
  assert.doesNotMatch(duelCss, /\.chronicle-tabs button\[aria-selected="true"\]/);
});

test("Card Hall explains the complete story-companion-Chronicle-Legacy loop", () => {
  assert.match(source, /aria-labelledby="living-chronicle-spine-title"/);
  assert.match(source, /The Ancients were people of the Sunken Court's age/);
  assert.match(source, /The Withheld refused to surrender their defining choices/);
  assert.match(source, /Your eligible active companion can answer your call in story combat/);
  assert.match(source, /After ten arena victories, that companion earns a Living Witness record/);
  assert.match(source, /Chronicle victories are part of your path/);
  assert.match(source, /pattern you chose, never a bloodline/);
  const spine = source.slice(source.indexOf('<section className="living-chronicle-spine"'), source.indexOf("{progressionReceipt.length"));
  assert.doesNotMatch(spine, /server-recorded|authoritative|client-side|duplicate reward/i);
  assert.doesNotMatch(source, /The authoritative result is final|The server can deal|remain server-private|server-enforced|The server did not confirm/);
});
