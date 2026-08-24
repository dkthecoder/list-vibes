# Lists

An Obsidian plugin that turns a folder of markdown files into to-do lists.

**One file is one list. One line is one task.** Open `lists/Work To-Dos.md` in any
text editor on any device and you see a checklist you can tick. Open it in
Obsidian with this plugin and you get a task list, a collapsible completed
section, and a detail panel with steps, due dates and reminders.

## Why it works this way

The obvious alternative is one file per task, which is what
[TaskNotes](https://github.com/callumalpass/tasknotes) does — because Obsidian's
**Bases** cannot see inside files. `BasesEntry.file` is a `TFile`; a row *is* a
file, and there is no data-source API to change that. So if you want inline
`- [ ]` tasks, Bases is the wrong substrate and one-file-per-task is the only way
to use it.

But one file per task means your todos are scattered across hundreds of files,
and getting them back on screen needs an index, a cache, a query language and a
filter UI. That complexity isn't a design mistake, it's the model's tax.

This plugin takes the other road. A list is a file, so the list is already a
list — nothing to index, nothing to query, no database. The whole plugin is a
parser and a view over `TaskList[]` rebuilt from disk whenever a file changes.

The trade is real and worth stating: **Bases can't drive this.** We render our
own view instead.

## Storage format

List settings live in YAML frontmatter. Task metadata lives inline, because it
has to fit on one line.

```markdown
---
icon: 💼
sort: manual
showCompleted: collapsed
---

- [ ] Take screenshots for review
- [ ] Write update to review ☀️ ⏰ 11:00 📅 2026-08-24 ➕ 2021-01-08 ⏫
	- [x] take screenshots
	- [ ] crop and prep screenshots
	Remember the product entry needs the new pricing table.
- [x] Draft the outline ✅ 2026-08-20
```

| Field | Written as | Standard |
| --- | --- | --- |
| Due | `📅 2026-08-24` | Obsidian Tasks |
| Scheduled | `⏳ 2026-08-24` | Obsidian Tasks |
| Repeat | `🔁 every week` | Obsidian Tasks |
| Important | `⏫` / `🔺` | Obsidian Tasks |
| Created | `➕ 2021-01-08` | Obsidian Tasks |
| Completed | `[x]` + `✅ 2026-08-20` | Obsidian Tasks |
| Steps | nested `- [ ]` | plain markdown |
| Note | indented text under the task | plain markdown |
| My Day | `☀️` | this plugin |
| Reminder | `⏰ 11:00` | this plugin |

Most of that is the Obsidian Tasks emoji dialect, so existing vaults parse with
no migration and the files stay readable by the Tasks plugin, TaskForge and
Finalist. **Dataview inline fields (`[due:: 2026-08-24]`) are always parsed too**;
the setting only controls which format gets written, so switching it never breaks
anything already on disk.

An emoji at the start of a filename (`📺Movies & TV.md`) is used as the list icon
and removed from the display name.

## Safety

The plugin never rebuilds a file from its parsed model. Every task carries the
exact original line it came from, and every edit is a surgical splice into that
string. A line the plugin didn't mean to change cannot drift.

Writes take one of two paths, which is not optional:

- File open in an editor → the **Editor API**, so cursor, selection and folds survive.
- File not open → **`Vault.process`**, the atomic read-modify-write.

Line numbers are re-verified against the file immediately before every write; if
the line has changed underneath us the edit is abandoned rather than applied to
the wrong place.

## Folder

Default `lists/`, configurable.

Do **not** use a dot-prefixed folder like `.lists/`. Obsidian excludes anything
starting with `.` from the vault entirely — that's how `.obsidian/` stays hidden —
so the files would be invisible to the plugin, to search, and to the file
explorer. A plain folder syncs identically; iCloud, Dropbox and Syncthing all
treat dotfiles as hidden and several skip them by default.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production build
npm test         # 122 tests: parser round-trip + the write path
```

### Test coverage

122 tests across two suites.

`test/roundtrip.test.mjs` (80) covers parsing and serialising. The load-bearing
one reconstructs every fixture file through the edit path with nothing changed
and asserts the bytes come back identical.

`test/mutate.test.mjs` (42) covers the write path against an in-memory vault.
Every behavioural test runs **twice** — once through the Editor API branch and
once through `Vault.process` — because those are two separate implementations
that must agree. It also covers the stale-parse guard, which is what stops a
write landing on the wrong line.

Coverage is 95% of lines and 86% of branches over `parse`, `serialize`, `types`
and `mutate`. The UI layer has no unit tests; it is exercised by the harness,
which catches crashes rather than proving correctness.

### The harness

`npm run harness` builds a standalone browser page that runs the real pane code
against fixture data with a mocked `obsidian` module. It renders the desktop
three-column layout and the three mobile panes side by side, in light and dark,
without needing an Obsidian install. `node harness/shot.mjs` screenshots it.

### Testing in Obsidian

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/lists/`, then enable the plugin in
Settings → Community plugins.

For mobile, `app.emulateMobile(true)` in the desktop console renders the real
`WorkspaceMobileDrawer`, which exercises the same code path the phone uses.

## Licence

MIT
