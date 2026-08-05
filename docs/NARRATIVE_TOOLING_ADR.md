# ADR: Narrative authoring and Arcweave boundary

- Status: Accepted — defer Arcweave integration
- Date: 2026-08-05
- Decision owners: project owner plus gameplay/server maintainers

## Context

The live narrative is TypeScript data and server logic: `shinobij.client/src/data/storylines.ts`, `src/types/vn.ts`, `api/_story-*.ts`, `api/story/**`, and `shared/story-card-sources.ts`. `scripts/gen-story-pdf.mjs` imports that live data and produces a review PDF with source edit locators. The authoritative settlement path advances server-owned `character.storyProgress`; server receipts and seals protect rewards, while `storyTraits` is a narrative/display mirror used for branching.

There is no Arcweave project or real Arcweave export in the repository. Its export schema, stable identifiers, asset references, and round-trip behavior therefore cannot be validated without guessing. Uploading proprietary story text would also require an explicit account/ownership decision.

## Decision

Code remains authoritative. Do not add an Arcweave runtime, importer, SDK, credential, or automated upload in this pass. Continue the code → PDF review loop.

If an owner-approved sample export is later committed, the only acceptable first pilot is a build-time, one-way compiler into a generated artifact. Production must never fetch Arcweave at runtime. The generated artifact may become runtime input only after parity tests prove it is equivalent to the current code authority and the owner separately approves the authority change.

## Required interchange contract

Before an importer exists, publish a versioned intermediate schema with these concepts:

```text
project(schemaVersion, sourceRevision)
  node(id, kind, village, prerequisites, pages, outcomes)
  page(id, titleKey, sceneKey, lines, choices, cinematic, assets)
  choice(id, textKey, targetNodeId/targetPageId, requires, forbids, grants, battleRef)
```

- IDs are lowercase stable slugs created once. They never derive from a mutable title, array index, or Arcweave internal database ID alone.
- Existing milestones receive a permanent mapping such as `story:<village-slug>:level:<level>`. Existing `storyAiId(village, level)`, trait IDs, interlude IDs, road-event IDs, settlement receipt IDs, and asset paths must remain unchanged.
- Prerequisites are declarative allowlisted fields: village, minimum level/progress, all/any/forbidden trait IDs, and prior node IDs. No executable expressions cross the boundary.
- Choices contain stable IDs, explicit targets, trait requirements/grants, and an optional reference to a code-owned battle definition. Reward amounts and authoritative outcomes are never imported from narrative prose or trusted from a client.

## Import validation

A future compiler must fail closed before the client build when any of these are invalid:

- unknown schema version, field, enum, node kind, prerequisite operator, or battle reference;
- missing/duplicate/renamed ID, dangling target, target outside its story lane, or page index outside bounds;
- unreachable required node, accidental cycle, or a cycle not explicitly marked and bounded;
- unbounded node/page/line/choice counts or text/asset path length;
- non-local asset URL, missing asset, path traversal, inline executable content, or unsupported markup;
- a change to milestone order/count, `storyProgress` mapping, trait semantics, AI IDs, rewards, or settlement references without an approved compatibility migration;
- client-authored currency/reward data or any attempt to bypass the existing story start/settle endpoints.

Validation output must identify external node ID, generated node ID, source file/location, and the exact rule. A failed import/build leaves the last deployed application untouched; it must not silently drop nodes, reroute to page zero, or ship a partially generated graph.

## Localization

Current prose is inline English, so Arcweave would not create localization support by itself. The intermediate schema must separate stable text keys from default English text before a multilingual workflow begins. Translator output must never change node/choice IDs, branches, conditions, battle references, or reward authority. Placeholder tokens such as `%name` require an allowlist and per-locale validation. This ADR authorizes no localization storage or save-schema change.

## Round trip and ownership

There is no bidirectional merge. Code helpers, comments, cinematic types, server references, and Arcweave graph metadata are not losslessly interchangeable. Choose one direction per pilot:

- Current/default: code is edited; PDF is generated for review.
- Possible pilot: Arcweave sample → validated intermediate JSON → generated TypeScript/JSON. The generated file is never hand-edited.

Changes return through source review and regenerated output; importing edited generated code back into Arcweave is out of scope. The owner must decide where canonical prose is edited before any pilot.

## Save compatibility and failure behavior

`storyProgress` currently indexes an ordered nine-milestone village lane and is server-owned. Reordering or inserting before an existing milestone can reinterpret every save, so it requires an explicit migration and owner approval. `storyTraits`, `redeemedStoryBattles`, active story seals, interlude/road-event records, and AI IDs are also compatibility surfaces. Safe content changes preserve these IDs and append only where existing progression semantics permit.

At runtime there is no external dependency and therefore no Arcweave outage mode. If a future generated artifact is absent, stale, or fails its checksum/parity test, the build fails. The server continues to validate starts, combat, settlements, and rewards through existing code; narrative tooling can never fail open into client authority.

## Adoption gates

Revisit only when the repository contains an owner-approved real export, rights to upload/store the text are confirmed, a named authoring authority is chosen, stable IDs can be demonstrated across two revisions, the intermediate schema is reviewed, and parity/save-compatibility tests can be written without changing rewards or saves. Until then, an importer would add risk without evidence.
