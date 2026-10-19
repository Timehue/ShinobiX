# Pet battle admission and one-use items

Paid Colosseum admission seals the selected roster and spends its equipped one-use items at entry. `character.petShowdownAdmission` identifies the one pending paid bout. Duplicate starts and reconnects resume that bout with its original charges. A terminal or expired session cannot prevent a later admission. Practice remains independent and retains equipped items.

The pointer is server-owned and protected by the generic save sanitizer. Admission re-reads ownership, availability, level, equipment and the daily cap under the player save lock. The existing versioned save commit receives a narrow storage adapter that appends the sealed session to the same `compareSetMany` transaction as the save and any currency ledger operation. No SQL, table or storage adapter schema changes are required. A refused or failed batch writes neither combat nor an item debit. An exact save readback confirms a commit whose acknowledgement was lost.

Dungeon admission commits its existing parent-run pointer, item spend and session together. Hollow Gate retains its authored rule: the chosen lead spends its item, while server-drawn partners retain theirs. New parent-bound sessions stamp `consumablesCommitted`; the durable Hollow Gate result carries that fact after combat expires. Parent settlement therefore cannot consume an item equipped after admission. Retained sessions continue through their original terminal spending path.

Paid wins share a total budget of 20 pet XP among server-proven, owned participants below their level cap. The existing daily win limit and payment receipt protect the XP and ryo in the same save write. The XP value is a conservative tuning choice pending the full balance review.

Focused admission checks cover duplicate starts, concurrent requests, atomic write failure, lost acknowledgement, reconnect, loss, expired pointers, practice and forged generic saves. Parent-bound lifecycle suites verify their existing proof and settlement contracts.
