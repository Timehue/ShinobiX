# AGENTS.md

Project rules live in `CLAUDE.md`. Read it before changing anything. The rule
below applies to every coding agent in this repository, with no exceptions.

## No other games, in any form

This repository must not name, cite or describe any other shinobi browser game.

- Never write another game's name, abbreviation, organisation, repository path,
  commit id, function name or file path into code, comments, docs, reports,
  handoffs, test fixtures, art prompts, commit messages or pull requests.
- Do not use a stand-in description that points at one either. Describe our own
  design on its own terms, without saying where the idea came from.
- Never say a design was adopted, copied or ported from another game.
- Do not write comparison reports against another game. Do not read another
  game's source code for design ideas.
- Use "shinobi RPG", never the compound phrase with "ninja".
- `scripts/ip-hygiene.test.mjs` enforces this in CI. If it fails, rename or remove
  the text. Never weaken the check, and never add a real name to it in plain text.

Words that are genuinely part of this game's own world, such as jutsu, chakra,
Genin or Kage, are fine.

## Never push old history

The repository moved to a clean history on 2026-11-01. Always branch from a fresh
`origin/main`. Never merge or push a branch made before that date, and never use
`--no-verify` to get past the local push block. Move old work by copying files.
