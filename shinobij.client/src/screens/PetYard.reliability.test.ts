import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("./PetYard.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const collectStart = source.indexOf("async function collectExpedition()");
const collectEnd = source.indexOf("async function collectTraining()", collectStart);
const collect = source.slice(collectStart, collectEnd);
const launchStart = source.indexOf("async function startExpedition()");
const launchEnd = source.indexOf("async function collectExpedition()", launchStart);
const launch = source.slice(launchStart, launchEnd);

test("expedition success renders only after an authoritative settled pet is returned", () => {
  const request = collect.indexOf("const response = await fetch('/api/missions/report-pet-event'");
  const success = collect.indexOf("setExpeditionResult({");
  assert.ok(request >= 0 && success > request, "the success ceremony must be created after the server request");
  assert.match(collect, /if \(!data\.character\) throw new Error/);
  assert.match(collect, /if \(!settledPet \|\| settledPet\.expedition\)/);
  assert.match(collect, /authoritativePetExpeditionGains\(expeditionPet, settledPet\)/);
  assert.doesNotMatch(collect.slice(0, request), /setExpeditionResult\(\{/);
});

test("an expedition failure remains visible and retryable", () => {
  assert.match(collect, /catch \(error\)[\s\S]*?setExpeditionResult\(null\)/);
  assert.match(collect, /Your expedition remains ready; retry when the connection is stable\./);
  assert.match(source, /role="alert">\{expeditionError\}<\/p>/);
  assert.match(source, /expeditionError \? "Retry Expedition Claim" : "Collect Expedition"/);
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
  assert.match(source, /role="progressbar"[\s\S]*?aria-valuenow=\{petHappiness\(selectedPet\)\}/);
});

test("Pet Yard form labels are programmatically associated", () => {
  for (const id of [
    "pet-nickname-input",
    "pet-pvp-gear",
    "pet-pve-gear",
    "pet-consumable",
    "pet-training-type",
    "pet-training-duration",
    "pet-expedition-type",
  ]) {
    assert.ok(source.includes(`htmlFor="${id}"`), `${id} needs an explicit label`);
    assert.ok(source.includes(`id="${id}"`), `${id} needs the matching control id`);
  }
  assert.doesNotMatch(
    source,
    /<label htmlFor="pet-pvp-gear">PVP Gear<\/label>\s*\{ownedGear\.length === 0/,
    "the PVP label must not point at a select that is absent in the empty state",
  );
});

test("expedition launch is single-flight, idempotent, and fenced to its mounted account", () => {
  assert.match(launch, /if \(expeditionLaunchBusyRef\.current\) return;/);
  assert.match(launch, /expeditionLaunchRef\.current\?\.accountKey === originAccount[\s\S]*?expeditionLaunchRef\.current\.petId === selectedPet\.id[\s\S]*?launchId:/);
  assert.match(launch, /body: JSON\.stringify\(\{[\s\S]*?launchId: launch\.launchId \}\)/);
  assert.match(launch, /const request = \+\+expeditionLaunchRequestRef\.current;/);
  assert.match(launch, /const requestIsCurrent = \(\) => mountedRef\.current && activeAccountRef\.current === originAccount;/);
  assert.match(launch, /if \(expeditionLaunchRequestRef\.current === request\) \{[\s\S]*?expeditionLaunchBusyRef\.current = false;[\s\S]*?if \(requestIsCurrent\(\)\) setExpeditionLaunchBusy\(false\)/);
  assert.match(source, /mountedRef\.current = true;[\s\S]*?activeAccountRef\.current = character\.name\.trim\(\)\.toLowerCase\(\);[\s\S]*?expeditionLaunchRequestRef\.current \+= 1;/);
  assert.match(app, /<PetYard key=\{character\.name\.trim\(\)\.toLowerCase\(\)\}/);
  assert.match(source, /<select id="pet-expedition-type"[^>]*disabled=\{expeditionLaunchBusy(?: \|\| selectedPetIsOverflow)?\}/);
  assert.match(source, /<button type="button" className="admin-button" onClick=\{startExpedition\} disabled=\{expeditionLaunchBusy(?: \|\| selectedPetIsOverflow)?\} aria-busy=\{expeditionLaunchBusy\}>\{expeditionLaunchBusy \? "Sending…" : [^}]*"Send Exploring"\}<\/button>/);
});
