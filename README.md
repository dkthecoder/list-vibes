# List Vibes

An Obsidian plugin that turns a folder of markdown files into to-do lists.

Because how the flip can we make AI Generated content thats super realistic but no one can do a todo list/remidners app correctly 😤

## How it moves

Pick a list, work in it, open a task when you need more than a checkbox.

- **Lists → a list.** Side by side when there is room, one at a time with a back
  arrow when there is not.
- **The detail panel is never a column.** It slides in from the right over the
  task list, with a dimmed backdrop. Escape, the close button, or a tap outside
  dismisses it. One behaviour at every width, from phone to wide main pane. It is
  never full width — a strip of the list always stays visible behind it, because
  at 100% there is nothing to overlay and it just looks like the view changed.
- **Every control opens in place.** The due date, reminder and repeat rows expand
  inline into a row of chips. They are not Obsidian Menus: a Menu opens at the
  cursor and reads as a right-click context menu, which is wrong for a primary
  control and has nothing to anchor to on touch.
- **The add box expands upward.** Collapsed it is a single line — type a title,
  press Enter, keep going. Click it and it opens into a title plus a description,
  with Cancel and Add task. The description is written as an indented line
  beneath the task, so it is the same field the detail panel edits.

## Lists

The list's name **is** its filename. Click the name in the list header and type
to rename it — that renames the file, and Obsidian updates any links pointing at
it. The same is on each list's `⋯` menu in the picker, along with its colour.

A colour is stored as a name in the list's frontmatter (`color: teal`), not a hex
value, so the same list reads correctly in a light and a dark theme. It shows as
a bar on the picker row, an underline on the list header, and an edge on each
card — a bar rather than a wash, because a tinted row fights both the selected
state and whatever background the theme already uses.

Each list can be laid out as **rows** or as a **Google Keep-style card wall**,
toggled from the list header. Cards put the note, the steps and the metadata on
the face rather than behind the detail panel, which is what makes Keep feel like
glancing at a pinboard instead of drilling into a task manager.

## Lists as tabs

A list can be a workspace tab, not just a sidebar pane. Cmd/Ctrl-click or
middle-click a list in the picker, use **Open in new tab** from its context menu,
right-click the file in the explorer and choose **Open as list**, or run the
**Open a list in a new tab** command.

Each tab carries its own selection through the view's state, so several lists can
sit open side by side and every one of them remembers which list it was showing
after a restart. The tab is titled with the list's name.

In the sidebar the view stays deliberately non-navigable. A navigable sidebar
leaf is a valid target for opening files, which would mean clicking a note in the
explorer replaced your Lists pane with that note.

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

## Importance and sorting

Importance has two modes, set in settings:

- **Star** — on or off, the Microsoft To Do behaviour.
- **Rating** — 0 to 5 stars, where 5 is most important. Tapping the star you are
  already on clears it back to zero, so every value is reachable without a
  separate clear button.

Both write the same priority field. The five Obsidian Tasks glyphs map straight
onto the rating (5★ `🔺`, 4★ `⏫`, 3★ `🔼`, 2★ `🔽`, 1★ `⏬`), so switching the
setting never rewrites a file, and a task rated four stars shows as a filled star
in star mode.

Each list can be sorted independently: custom (the file's own order), importance,
due date, date created newest or oldest, and alphabetical either way. **Sorting is
view-only** — it is stored in plugin settings, never written to your markdown, so
changing it cannot touch a byte of the file. Custom order is the only mode that
shows the file's `##` headings as section dividers, since the others break that
grouping by definition.

There is deliberately no "last modified" sort for tasks. A markdown line has no
modified timestamp — only the file does — so every task in a list would share one
value. Date created is the honest version of that, and needs the creation-date
setting switched on.

Most of that is the Obsidian Tasks emoji dialect, so existing vaults parse with
no migration and the files stay readable by the Tasks plugin, TaskForge and
Finalist. **Dataview inline fields (`[due:: 2026-08-24]`) are always parsed too**;
the setting only controls which format gets written, so switching it never breaks
anything already on disk.

An emoji at the start of a filename (`📺Movies & TV.md`) is used as the list icon
and removed from the display name.

Colour and layout are written to the list's frontmatter. That write goes through
our own single-key editor rather than Obsidian's `processFrontMatter`, which
round-trips the whole block through a YAML parser and can reorder keys — these
files are yours, and one of them is a Kanban board whose plugin reads its own
frontmatter back. Only the line being set is ever touched.

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

Do **not** use a dot-prefixed folder like `.lists/`. 

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production build
npm test         # 196 tests: parsing, sorting, frontmatter, view state, writes
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
