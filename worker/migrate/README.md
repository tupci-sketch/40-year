# Data migration — Phase 4 (run last, on request only)

Turns the club's exported data into one SQL file, ready to paste into the
D1 console — the same workflow already used for `schema.sql`. **Never run
against production without the owner's go-ahead.** Nothing here touches
the live Worker/D1 by itself; it only reads an export and writes a local
`import.sql` + prints a validation report.

## 1. Get the export as JSON
The club data lives in an XLSX (one sheet per table: `matches`,
`match_stats`, `career`, `club_record`, `config`, `accounts`, `chat`,
`forum_threads`, `forum_posts`). Convert it to JSON first — a short
`openpyxl` script that reads every sheet into `{sheet: [rows...]}` and
writes it out (dates → ISO strings) does the job. Keep this JSON private;
it contains real password hashes.

## 2. Build the import
```
node migrate/build-import.mjs <clubdata.json> [--current-from=<seq>] [--totals=migrate/totals.json]
```
- `--current-from=<seq>` — the match number where the **current** season
  (Season 3 · FC26) starts. Everything before it goes into a "previous
  season" bucket (Season 2 · FC26). Omit it and every match imports into
  one season, flagged `REVIEW` — safe, just not season-split yet.
- `--totals=<file>` — the owner's private totals-reconciliation file
  (copy `totals.example.json`, fill in real verified numbers). Only used
  to annotate the validation report; never required to build the import.

This writes `migrate/import.sql` (gitignored — never commit it, it can
contain real password hashes) and prints a report:
- **PASS** — matches what's expected.
- **REVIEW** — a known, explained gap (e.g. the EA-era baseline gap between
  detailed matches and the club record's "played" total; any player id
  in the stats that isn't in the squad, auto-created as an inactive
  "Guest" placeholder so the recorded stat isn't lost).
- **ERROR** — blocks the import; fix before proceeding.

## 3. Prove it loads clean (always do this before touching production)
```
node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync('schema.sql', 'utf8'));
db.exec(fs.readFileSync('migrate/import.sql', 'utf8'));
console.log('clean');
"
```
If this throws (e.g. a foreign-key error), something in the export doesn't
match — fix the input or the builder, not the schema.

## 4. What it imports
Squad → `players` (identity only; card **images** need a separate R2
upload per player in Housekeeping — the importer can't guess those).
`career` → verified `player_career_baselines` (as-of the existing
`career_baseline_seq`). `club_record` → `club_record_baselines`. Every
match + its scorers + per-player stat line, preserving `seq` order.
Accounts import with their **existing password hash untouched**
(`pw_algo='sha256'`) — nobody's password is reset; each account
transparently upgrades to PBKDF2 the next time that person logs in
(the Worker's auth route already does this). Chat carries over (forum
similarly, resolved by category key).

Amy and Donovan always import as separate player rows — the importer
never merges them, whatever the export contains.

## 5. Only then — the real thing
Once the report has no `ERROR`s and the owner has reviewed the `REVIEW`
items (season boundary, any guest players, totals cross-check): paste
`migrate/import.sql` into the **production** D1 console the same way
`schema.sql` was pasted, exactly once. It's additive (`INSERT OR IGNORE`
/ `INSERT OR REPLACE` throughout) — safe to re-run if something goes
wrong, but treat the production database as live from that point on.
