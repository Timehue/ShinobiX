# Owner launch filings: ready-to-use answers

These steps need your identity, your payment or your accounts, so no code can do them for you. Everything that can be prepared is prepared here: what to file, where, and the answers, taken from what the game actually does (the privacy policy in `shinobij.client/src/screens/LegalPage.tsx` and the code it describes). Written 2026-11-18. The research behind each item is in `docs/launch-readiness-plan-2026-11.md` section 3.

Order of priority: 1 and 2 before launch traffic, 3 before the Play submission, the rest when convenient.

## 1. Register a DMCA agent (about 15 minutes, $6)

Without a registered agent there is no safe harbour for what players post (chat, names, uploaded portraits). The Copyright page currently says an agent "will be published".

1. Go to https://www.copyright.gov/dmca-directory/ and create an account (the organization is you, operating Shinobi Journey).
2. Service provider name: your legal name or business name, with "Shinobi Journey" as an alternate name. Website: shinobijourney.com.
3. Designated agent: yourself. Address: a mailing address you can receive legal mail at (a PO box is not accepted; a registered-agent or virtual-office street address is). Email: support@shinobijourney.com (the address the legal pages already use). Phone: required.
4. Pay the $6 fee. The registration lasts 3 years, and the Copyright Office emails a renewal reminder.
5. Send me the agent's name and address as registered, and I will put them on the Copyright page (the page must match the directory entry).

## 2. Turn on the nightly off-site backup (about 5 minutes, no cost)

`.github/workflows/nightly-backup.yml` is already merged. It does nothing until two repository secrets exist.

1. GitHub: Timehue/ShinobiX, then Settings, then Secrets and variables, then Actions, then "New repository secret".
2. `BACKUP_DATABASE_URL`: the same Postgres connection string Railway uses (Railway, the database service, then Variables, then `DATABASE_URL`). A read-only role is better if you have one.
3. `KV_BACKUP_PASSPHRASE`: a long random passphrase. **Also store it in your password manager.** Without it the backups cannot be decrypted, and GitHub will not show it again.
4. The next run is at 07:17 UTC. To test at once: Actions, then "Nightly backup", then "Run workflow". A failed run opens a "Nightly backup failed" issue, and it never blocks a deploy.

## 3. Google Play forms (at submission)

### Data safety

Answers below match the privacy policy. "Required" means the game cannot be used without it.

| Play category | Collected? | Shared? | Why | Required? |
|---|---|---|---|---|
| Personal info: Email address | Yes, only with Google sign-in | No | Account management | No (password or guest play need none) |
| Personal info: User IDs | Yes (player name, Google account ID if used) | No | App functionality, account management | Yes |
| Financial info: Purchase history | Yes (transaction references for web purchases; the Play build blocks the store) | No | App functionality | No |
| Messages: Other in-app messages | Yes (chat, direct messages) | No | App functionality | No |
| Photos and videos: Photos | Yes, only if a player uploads a portrait or uses Make Model | No (processors, see below) | App functionality | No |
| App activity: App interactions | Yes (gameplay events, aggregate analytics to PostHog without an account ID) | No | Analytics, app functionality | Yes |
| App activity: Other user-generated content | Yes (names, titles, prompts) | No | App functionality | No |
| App info and performance: Crash logs, Diagnostics | Yes, when Sentry is configured | No | App functionality | No |
| Device or other IDs | Yes (browser device fingerprint, IP address) | No | Fraud prevention, security | Yes |

- "Shared" is No for all of them because hosting and analytics providers acting for you are service providers, which Play does not count as sharing. Payments go to Tebex outside the app.
- Encrypted in transit: Yes (HTTPS only).
- Users can request deletion: Yes. In-app account deletion, plus the web URL https://shinobijourney.com/delete-account (Play requires a web URL).
- Independent security review: No.

### Content rating (IARC questionnaire)

- Category: Game.
- Violence: fantasy or stylized combat between characters, no blood or gore (answer to match the art you ship).
- Users interact: **Yes** (chat, direct messages, clans).
- Shares user location: No.
- Digital purchases: **Yes** (Fate Shards and Supporter on the web). Declare "in-game purchases" and randomized items (card packs and rerolls publish their odds).
- Unrestricted web access: No.

### Payments policy

The Play build blocks the store. Keep it that way: if Play users can ever buy digital goods inside the app, Google Play Billing is required.

## 4. Trademark search on "Shinobi Journey" (about 30 minutes, free)

1. https://tmsearch.uspto.gov/ : search the exact phrase, then "Shinobi" alone in classes 9 (game software) and 41 (online game services).
2. Note any live mark in those classes that contains "Shinobi" or a close variant. "Shinobi" alone is used by others, so a combined mark is what matters.
3. Hand the list to the lawyer (section 6). A clear search can then become an application, about $350 per class.

## 5. Wipe policy (a decision, about 10 minutes)

The game is in testing and a reset is planned. Players should know before they pay what survives. Pick one, and I will write it into the Terms and the in-game notice:

- **A. Full wipe, purchases restored:** progress resets, and bought Shards and Supporter time are re-credited from the Tebex records.
- **B. Full wipe, purchases kept:** progress resets, and Shards and Supporter time on the account are kept as they are.
- **C. Partial wipe:** only named systems reset; the rest is kept by the server reset's preserve list (`api/admin/server-reset.ts`).

## 6. One lawyer review (one consultation)

Bring this list so the hour covers everything:

1. Terms and Privacy as a whole (v1.15), including the ban paragraph in the Terms' conduct section.
2. Is the game "directed to children" under COPPA (anime style, chat, purchases)? Should under-16s get chat and purchases off by default (UK children's code)?
3. Does the game need an EU or UK representative (GDPR Art. 27, DSA Art. 13)?
4. The UK Online Safety Act: the illegal-content and children's-access risk assessments that chat brings into scope.
5. The trademark search results from section 4.
6. AI-assisted art: what records of human creative work to keep.
7. The purchase claims in the Terms (v1.15). The old wording ("Everything Fate Shards buy can also be earned by playing", Supporter "grants no combat advantage") was untrue and has been replaced. The page now says Shards can be earned by playing but more slowly than bought, names the Shard-only items, and says Supporter's 15-slot loadout also applies in PvP. Ask whether that disclosure is enough under EU consumer law and the FTC rules, or whether the Shard-only gear needs a play path. Details: `docs/launch-readiness-plan-2026-11.md` section 3.B item 14.

## 7. Real-phone check after a deploy (about 5 minutes)

On your phone, over mobile data rather than Wi-Fi:

1. Travel to a sector. The painted ground and your character should be there the moment the travel screen ends, with no blank frame.
2. The residents and buildings follow within about half a second.
3. The "Connecting to world…" label should not appear at all on a normal connection.

Tell me if any step fails. The numbers so far come from emulated phones only.
