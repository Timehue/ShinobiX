# Play Console submission answers

Prepared answers for the Data safety form, the IARC content rating questionnaire,
and the app-content declarations, so those are copy-paste rather than
reconstructed from memory at submission time. Getting the Data safety form wrong
is one of the most common causes of suspension, and it is a form, not code.

**How to use this.** Every factual claim below is sourced to a file so you can
verify it rather than trust it. The *mapping* to Play's categories is a
considered suggestion, not authority — Play's category definitions change and
each one has its own scope notes. Read the form's own description for each item
before ticking it, and treat a disagreement between this file and the form as the
form winning.

**Keep this current.** If the code starts collecting something new, this file and
the submitted form both have to change *before* that ships. A Data safety
declaration that no longer matches the app is the failure mode to avoid.

---

## 1. Data safety

### What the app actually collects

| Data | Where in the code | Collected from | Notes |
| --- | --- | --- | --- |
| Player name / slug | `api/player-auth.ts`, save keys | Everyone | User-chosen; the primary account identifier and publicly visible |
| Email address | `api/_google-auth.ts`, `api/auth/google/*` | Google sign-in users only | Not collected for password or guest accounts |
| Password hash + salt | `api/player-auth.ts` | Password accounts only | Hashed, never stored or transmitted in plaintext |
| IP address | `api/_player-ips.ts` | Everyone | Abuse/multi-account detection |
| Browser fingerprint | `shinobij.client/src/fingerprint.ts`, `x-client-fp` header | Everyone | Anti-cheat. A persistent-ish device signal — declare it |
| Chat and direct messages | `api/village/chat.ts`, `api/clan/chat.ts`, `api/messages.ts` | Users who chat | Retained; visible to recipients |
| Player-uploaded avatars | `api/save/[name].ts` avatar path | Users who upload | Image content |
| Gameplay state | `save:` records | Everyone | Progress, inventory, currency, clan |
| Crash and error diagnostics | `shinobij.client/src/lib/sentry-runtime.ts` | Everyone | Sentry |
| Aggregate product events | `shared/product-analytics.ts` | Everyone, when enabled | Shared `distinct_id`, no person profiles, off by default |

### Suggested Data safety mapping

- **Personal info → User IDs** — player name/slug. Purpose: App functionality,
  Account management. Required.
- **Personal info → Email address** — Google sign-in only. Purpose: Account
  management. **Optional**, since password and guest accounts exist.
- **Messages → Other in-app messages** — chat and DMs. Purpose: App
  functionality.
- **Photos and videos → Photos** — uploaded avatars. Purpose: App functionality.
  Optional.
- **App activity → Other actions** — gameplay progress.
- **Device or other IDs** — the anti-cheat fingerprint. Purpose: Fraud prevention
  and security, App functionality. ⚠ Declare this one honestly; it is the item
  most likely to be missed, and a fingerprint is exactly what this category is
  for.
- **App info and performance → Crash logs / Diagnostics** — Sentry.
- ⚠ **IP address** — confirm against the form's current wording. Play has
  historically treated an IP used only for security/anti-abuse differently from
  one used to derive location. We do **not** derive or store location from it.

### Security practices

| Question | Answer | Evidence |
| --- | --- | --- |
| Is data encrypted in transit? | **Yes** | HTTPS everywhere; security headers in `api/_http-security.ts` |
| Can users request data deletion? | **Yes** | In-app and web, see below |
| Data deletion URL | `https://shinobijourney.com/delete-account` | `LegalPage.tsx`, prerendered so it works without JavaScript |
| Committed to the Play Families policy? | **No** | Target audience is 13+ |
| Independent security review? | **No** | Do not claim one; none has been done |

### Answers to have ready

- **Privacy policy URL:** `https://shinobijourney.com/privacy`
- **Account deletion URL:** `https://shinobijourney.com/delete-account`
- Both are prerendered to static HTML by `scripts/build-client.mjs` →
  `prerender-legal.mts`, so a reviewer fetching them without JavaScript gets real
  text rather than an empty app shell. This matters: the same gap previously got
  the Google OAuth brand verification rejected twice.

---

## 2. Content rating (IARC)

Answer these truthfully; a rating obtained from wrong answers can be invalidated
later, which is worse than a higher rating.

| Question | Answer | Why |
| --- | --- | --- |
| Violence | **Yes — cartoon/fantasy** | Turn-based ninja combat against characters and creatures. Stylised, no gore, no realistic depictions of injury |
| Blood or gore | **No** | |
| Sexual content or nudity | **No** | |
| Profanity | **No authored profanity** | But see user interaction below — chat exists |
| Controlled substances | **No** | |
| Horror or fear themes | **Mild at most** | |
| Real-money gambling | **No** | |
| ⚠ Simulated gambling | **Check before answering** | See the note below |
| Users can interact | **Yes** | Village chat, clan chat, direct messages, clans, trading |
| Users can share content | **Yes** | Chat, custom avatars, profile text, custom item and bloodline names |
| Shares user location | **No** | |
| Digital purchases | **Currently No** | Patreon was removed 2026-08-28 and Play Billing is not live yet. **Change this the moment Billing ships** |

⚠ **Simulated gambling — decide deliberately.** Randomised rewards exist (pet
breeding odds in `api/pet/_breeding.ts`, chests in `api/world/_chest.ts`, the
festival black market in `api/festival/_black-market.ts`). Read the
questionnaire's own definition against these before answering.

### Randomised purchases, surveyed 2026-08-28

Fate Shards are planned to become purchasable, so this is what would then be
buyable with real money:

| Surface | Randomised? | Currency | Verdict |
| --- | --- | --- | --- |
| **Card packs** | Yes — which card you get | **Fate Shards** (Elite 10, Legendary 30) | ✅ **The one that needs disclosure.** Done — odds are stated in the Shop above the buy buttons, and pinned to the live `PACKS` table by a parity test |
| Standard card pack | Yes | ryo | Not a real-money purchase |
| Named weapon / armour forge | Yes | 1,000 pts (mixed, incl. shards) | ⚠ **Not a loot box** — `action:'roll'` is free and reveals the complete roll; `action:'forge'` then charges for the item already shown. Preview-then-buy, not a blind purchase |
| Festival black market | Yes, incl. a jackpot | **ryo only** | Not a real-money gamble |
| Pet breeding, world chests | Yes | earned only | Not purchasable |

**Disclosed odds** (`api/shop/_settlement.ts`, `PACKS`): every pack guarantees
the rarity on its button — Standard draws Common or Rare, Elite is always Epic,
Legendary is always Legendary. Within the eligible rarity every card is equally
likely; no weighting, no pity timer. Draws are independent (with replacement), so
a multi-card pack can repeat.

⚠ If a paid randomised roll is ever put behind the **named forge**, its odds must
be disclosed too — and the weapon tag draw had to be fixed first, because it used
a `sort()` comparator shuffle whose distribution was non-uniform and depended on
V8 internals. It is Fisher–Yates now, with a fairness test.

**User-generated content follow-ups.** Play will ask how UGC is moderated. The
answers exist: in-app reporting via `api/report.ts` with the `ReportControl`
trigger on profiles, messages, clan chat, and the tavern; blocking for 1:1
interaction via `api/player/_blocks.ts`, enforced in messages, village chat, and
challenges; automated text moderation in `api/_text-moderation.ts`; and an admin
review queue in `ModerationPanel.tsx`.

---

## 3. App content declarations

| Declaration | Answer |
| --- | --- |
| Target audience | **13+** — no age bracket under 13 |
| Appeals to children? | **No** — keep the store listing consistent with this |
| Ads | **No ads.** No ad SDK, no third-party trackers in `index.html` |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | Section 1 above |
| Government app | No |
| Financial features | No |
| Health | No |

⚠ **The listing itself has to support the 13+ answer.** If reviewers judge the
art as child-directed, the listing can be pulled into the Families policy, which
restricts persistent identifiers — and the anti-cheat fingerprint is exactly
that. Lean the screenshots and feature graphic on the war map, clans, and PvP
rather than the pets.

---

## 4. Store listing assets

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 512×512 PNG | ✅ `shinobij.client/public/icon-512.png` |
| Feature graphic | 1024×500 | ❌ not made |
| Phone screenshots | 2–8 | ❌ not captured |
| Tablet screenshots | Needed for tablet distribution | ❌ not captured |
| Short description | ≤80 characters | ❌ not written |
| Full description | ≤4000 characters | ❌ not written |
| Privacy policy URL | Required | ✅ `/privacy` |

Screenshots are deliberately last: the game is under active development and shots
taken weeks before submission will not match what ships. `docs/MEDIA_KIT.md` and
the `landing-hero-keyart.webp` family are the starting material.

---

## 5. Not answerable yet

These need the Play Console, which needs identity verification to finish:

- App package name (`ANDROID_APP_PACKAGE`) and the signing SHA-256
  (`ANDROID_APP_SHA256_FINGERPRINTS`) — see `docs/ANDROID_TWA_SETUP.md`.
- The closed-testing track and the 12-tester / 14-day clock. Recruiting the 12
  testers does **not** need the console and is the long pole; line them up now so
  the clock starts the day the console opens.
