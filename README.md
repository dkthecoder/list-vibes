# List Vibes

An Obsidian plugin that turns a folder of markdown files into to-do lists.

Because how the flip can we make AI Generated content thats super realistic but no one can do a todo list/remidners app correctly 😤

One file is a list. One line is a task. There is no database, no index and no
cache — open any of these files in the editor and you are looking at exactly
what the plugin is looking at. The alternative most Obsidian task plugins take is
one file per task, which scatters your todos across hundreds of files and then
needs an index, a query language and a filter UI to get them back on screen. A
list is already a list.

## Features

### Lists

- A folder of `.md` files is your lists. Add a file, get a list.
- Each list gets an **icon** and a **colour**. The icon can be a leading emoji in
  the filename (`💼Work.md`) or picked from the list menu; both live in the
  file's frontmatter.
- **Rename in place** — double-click a list's name. It renames the file, and
  every open tab follows.
- **Tidy titles** show `my-work-list.md` as "My work list" without touching the
  filename. Toggle it off if you want the true name.
- Work in the **sidebar** or open lists **as tabs**. In tab mode the sidebar
  stays a picker, the way the file explorer works.

### Tasks

- Tick, add, rename, delete, and **drag to reorder**.
- **Steps** — nested subtasks with an "n of m" counter. Can be switched off.
- **Notes** — a description on any task, with its first line shown faintly under
  the title in the list.
- **Importance** — a single star, or a 1–5 rating if you want more room.
- **Due dates**, **scheduled dates**, **reminders**, and **My Day**.
- **Repeating tasks** — `🔁 every week`. Ticking one leaves the next behind.
- **Completed section** — collapsed, expanded or hidden.
- Completion and creation stamps, optionally **with the time**:
  `✅ 2026-08-26T14:32`.

### Views

- **My Day**, **Important**, **Planned** and **Tasks** — cross-list views that
  read every list in the folder.
- **Rows or post-its** — a list layout or a card wall, per list or as a default.
- **Sorting** — custom order, importance, due date, date created (newest or
  oldest), or alphabetical. Remembered per list, and never written to your
  files: changing a sort cannot touch a byte of markdown.

### The detail panel

- Tapping a task opens it in **Obsidian's own right panel** — the same one
  Backlinks and Outline use. It docks, collapses, resizes, and swipes away on a
  phone, because it is a real Obsidian view rather than an overlay pretending to
  be one.
- Opened from anywhere else, it offers a **fuzzy task search** across every list.
- Fields grow as you type instead of sitting at a fixed size.

### It stays markdown

- Reads **both** the [Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji
  dialect and **Dataview** inline fields. Writes whichever you choose — so
  switching the setting never breaks what is already on disk.
- Files are edited **one line at a time**, never re-serialised from a parsed
  model, so nothing the plugin does not understand is rewritten or lost.
- **Promote a task to its own note** when one line stops being enough. The line
  becomes a link; the list still shows it inline.

### Everywhere

- One view on desktop, tablet and phone, collapsing from three panes to two to
  one as the space runs out.
- **No colours of its own.** Every colour comes from an Obsidian token, so the
  plugin follows your theme — including themes it has never seen. A test suite
  repaints the entire palette and fails if a single colour ignores it.

### Commands

`Open List Vibes` · `Open My Day` · `Open a list in a new tab` · `Add a task` ·
`Add a task to My Day`

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

A star rating maps straight onto the five Obsidian Tasks priority glyphs — 5★
`🔺`, 4★ `⏫`, 3★ `🔼`, 2★ `🔽`, 1★ `⏬` — so switching between star and rating
mode never rewrites a file.

An emoji at the start of a filename (`📺Movies & TV.md`) becomes the list's icon
and is dropped from the displayed name.

---

## Folder

Default `lists/`, configurable.

Do **not** use a dot-prefixed folder like `.lists/`. Obsidian excludes anything
starting with a dot from the vault entirely, so the plugin would never see its
own files.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production build
npm test         # unit tests: parsing, sorting, frontmatter, view state, writes
npm run test:ui  # drives the real UI in a browser: drags, renames, layout, theming
npm run shot     # renders every pane to harness/shot-{light,dark}.png
```

### Running it in Obsidian

One-off install into a vault:

```bash
./install.sh "/path/to/your/vault"
```

Then in Obsidian: Settings → Community plugins → enable **List Vibes**. On a
fresh vault you have to turn off Restricted mode first.

For an actual dev loop, build straight into the vault instead:

```bash
npm run dev:vault -- "/path/to/your/vault"
```

esbuild watches `src/` and writes `main.js`, `manifest.json` and `styles.css`
into `<vault>/.obsidian/plugins/list-vibes/` on every save. Only those three
files land in the vault; the repo stays outside it so `node_modules` is never
somewhere Obsidian would try to index.

It also drops a `.hotreload` marker in the plugin folder. Install the
**Hot Reload** community plugin (pjeby/hot-reload) and Obsidian will pick up
each rebuild without a restart. Without it, toggle the plugin off and on in
settings after a change.

For mobile, `app.emulateMobile(true)` in the desktop console (Ctrl/Cmd+Shift+I)
renders the real `WorkspaceMobileDrawer`, which exercises the same code path the
phone uses. To get it onto an actual phone you need the built files inside the
vault's `.obsidian/plugins/list-vibes/` and that folder syncing to the device —
note that Obsidian Sync excludes plugin files unless you explicitly enable it.

## AI

This app is co-created with AI and has been vibe coded. 

## Licence

MIT
