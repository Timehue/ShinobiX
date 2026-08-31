import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("./PetYard.tsx", import.meta.url), "utf8");
const board = readFileSync(new URL("../components/PetExpeditionBoard.tsx", import.meta.url), "utf8");
const contract = readFileSync(new URL("../../../shared/pet-expedition-contract.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const collectStart = source.indexOf("async function collectExpedition(");
const collectEnd = source.indexOf("async function collectTraining()", collectStart);
const collect = source.slice(collectStart, collectEnd);
const launchStart = source.indexOf("async function startExpedition()");
const launchEnd = source.indexOf("async function collectExpedition(", launchStart);
const launch = source.slice(launchStart, launchEnd);

test("expedition success renders only after an authoritative settled pet is returned", () => {
  const request = collect.indexOf("const response = await fetch('/api/missions/report-pet-event'");
  const success = collect.indexOf("setExpeditionResult({");
  assert.ok(request >= 0 && success > request, "the success ceremony must be created after the server request");
  assert.match(collect, /if \(!data\.character\) throw new Error/);
  assert.match(collect, /if \(!settledPet \|\| settledPet\.expedition\)/);
  assert.match(collect, /authoritativePetExpeditionGains\(expeditionPet, settledPet\)/);
  assert.match(collect, /xp: Math\.max\(0, Number\(data\.petXpEarned \?\? gains\.xp\)\)/);
  assert.doesNotMatch(collect.slice(0, request), /setExpeditionResult\(\{/);
});

test("an expedition failure remains visible and retryable", () => {
  assert.match(collect, /catch \(error\)[\s\S]*?setExpeditionResult\(null\)/);
  assert.match(collect, /Your expedition remains ready; retry when the connection is stable\./);
  assert.match(board, /role="alert">\{error\}<\/p>/);
  assert.match(board, /onCollect\("secure"\)/);
  assert.match(board, /onCollect\("investigate"\)/);
});

test("Pet Yard primary controls and expedition receipt are keyboard accessible", () => {
  assert.match(source, /<button[\s\S]*?className=\{`pet-slot-card/);
  assert.match(source, /aria-pressed=\{pet \? selectedPet\?\.id === pet\.id : undefined\}/);
  assert.match(source, /expedition ready to claim/);
  assert.doesNotMatch(source, /<span className="pet-ready-tag" onClick=/);

  assert.match(source, /<Modal[\s\S]*?ariaLabelledBy="pet-expedition-result-title"[\s\S]*?ariaDescribedBy="pet-expedition-result-story"/);
  assert.match(source, /backdropClassName="expedition-result-backdrop"/);
  assert.match(source, /const fallbackFocus = selectedPetSlotRef\.current/);
  assert.match(source, /if \(trigger\?\.isConnected\) trigger\.focus\(\);\s*else fallbackFocus\?\.focus\(\)/);
  assert.match(source, /ref=\{pet && selectedPet\?\.id === pet\.id \? selectedPetSlotRef : undefined\}/);
  assert.match(source, /role="progressbar"[\s\S]*?aria-valuenow=\{selectedPetHappiness\}/);
});

test("Pet Yard form labels are programmatically associated", () => {
  for (const id of [
    "pet-nickname-input",
    "pet-pvp-gear",
    "pet-pve-gear",
    "pet-consumable",
    "pet-training-duration",
    "pet-expedition-provision",
  ]) {
    const owner = id === "pet-expedition-provision" ? board : source;
    assert.ok(owner.includes(`htmlFor="${id}"`), `${id} needs an explicit label`);
    assert.ok(owner.includes(`id="${id}"`), `${id} needs the matching control id`);
  }
  assert.doesNotMatch(source, /id="pet-training-type"/, "training focus was removed so XP sources cannot alter stat growth");
  assert.doesNotMatch(
    source,
    /<label htmlFor="pet-pvp-gear">PVP Gear<\/label>\s*\{ownedGear\.length === 0/,
    "the PVP label must not point at a select that is absent in the empty state",
  );
});

test("Growth Point drafts follow the selected pet and latest committed allocation without an effect reset", () => {
  assert.match(source, /const growthDraftBaseKey = `\$\{selectedPet\?\.id \?\? ""\}:\$\{committedGrowth\.vitality\}:\$\{committedGrowth\.power\}:\$\{committedGrowth\.guard\}:\$\{committedGrowth\.agility\}`/);
  assert.match(source, /growthDraftState\.baseKey === growthDraftBaseKey[\s\S]*?growthDraftState\.allocation[\s\S]*?: committedGrowth/);
  assert.match(source, /const activeDraft = current\.baseKey === growthDraftBaseKey[\s\S]*?: \{ \.\.\.committedGrowth \}/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*setGrowthDraft\(/);
});

test("expedition launch is single-flight, idempotent, and fenced to its mounted account", () => {
  assert.match(launch, /if \(expeditionLaunchBusyRef\.current\) return;/);
  assert.match(launch, /expeditionLaunchRef\.current\?\.accountKey === originAccount[\s\S]*?expeditionLaunchRef\.current\.petId === selectedPet\.id[\s\S]*?launchId:/);
  assert.match(launch, /body: JSON\.stringify\(\{[\s\S]*?risk: expeditionRisk,[\s\S]*?provision: expeditionProvision,[\s\S]*?launchId: launch\.launchId \}\)/);
  assert.doesNotMatch(launch, /petLevel:/, "the server must seal the saved pet level");
  assert.match(launch, /const request = \+\+expeditionLaunchRequestRef\.current;/);
  assert.match(launch, /const requestIsCurrent = \(\) => mountedRef\.current && activeAccountRef\.current === originAccount;/);
  assert.match(launch, /if \(expeditionLaunchRequestRef\.current === request\) \{[\s\S]*?expeditionLaunchBusyRef\.current = false;[\s\S]*?if \(requestIsCurrent\(\)\) setExpeditionLaunchBusy\(false\)/);
  assert.match(source, /mountedRef\.current = true;[\s\S]*?activeAccountRef\.current = character\.name\.trim\(\)\.toLowerCase\(\);[\s\S]*?expeditionLaunchRequestRef\.current \+= 1;/);
  assert.match(app, /<PetYard key=\{character\.name\.trim\(\)\.toLowerCase\(\)\}/);
  assert.match(board, /role="radiogroup" aria-label="Expedition route"/);
  assert.match(board, /aria-busy=\{launchBusy\}/);
  assert.match(board, /Launch expedition/);
});

test("Expedition Board exposes caps, real non-Tamer rules, universal risk, and every return choice", () => {
  assert.match(board, /Started today/);
  assert.match(board, /Collected today/);
  assert.match(board, /UTC reset/);
  assert.match(board, /Non-Tamer growing pets earn pet XP only; no ryo or drops\./);
  assert.match(board, /Non-Tamer max-level pets earn half base ryo and find odds\./);
  assert.match(board, /Next collection today · 2× XP & ryo \+ boosted finds/);
  assert.match(contract, /label: 'Bold route'/);
  assert.match(board, /Investigate has a 60% enhanced haul and a 40% setback\./);
  assert.doesNotMatch(board, /element|subRole|role affinity/i);
});
