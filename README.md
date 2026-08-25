# List Vibes

An Obsidian plugin that turns a folder of markdown files into to-do lists.

Because how the flip can we make AI Generated content thats super realistic but no one can do a todo list/remidners app correctly 😤

## How it moves

Pick a list, work in it, open a task when you need more than a checkbox.

- **Lists → a list.** Side by side when there is room, one at a time with a back
  arrow when there is not.
- **The detail panel slides over, or pins beside.** By default it slides in from
  the right over the task list, with a dimmed backdrop. Pin it — from the button
  on the panel or from settings — and it becomes a fixed column instead, with the
  list simply getting narrower rather than being covered. Below about 900px it
  overlays regardless, and the pin button is hidden there: a third column that
  narrow leaves the list unreadable, which is why the overlay exists at all.
- **As an overlay it is never a column.** It slides in from the right over the
  task list, with a dimmed backdrop. Escape, the close button, or a tap outside
  dismisses it. One behaviour at every width, from phone to wide main pane. It is
  never full width — a strip of the list always stays visible behind it, because
  at 100% there is nothing to overlay and it just looks like the view changed.
- **Every control opens in place.** The due date, reminder and repeat rows expand
  inline into a row of chips. They are not Obsidian Menus: a Menu opens at the
  cursor and reads as a right-click context menu, which is wrong for a primary
  control and has nothing to anchor to on touch.
- **Rows drag into order.** Grab a task and move it; the rows it passes slide to
  open the gap, and nothing is written until you let go. Steps inside a task
  reorder the same way, within their own parent. On touch it takes a long press
  to start, because a vertical swipe on a list has to stay a scroll.
- **The add box expands upward.** Collapsed it is a single line — type a title,
  press Enter, keep going. Click it and it opens into a title, a description, and
  the same metadata a task has: My Day, due, reminder, repeat and importance.
  Steps are the one omission — a step has to hang beneath a task that exists.
  Nothing is written as you tap: the chips stage a draft that lands in one edit
  with the task, so an abandoned compose leaves the file untouched.

## Lists

The list's name **is** its filename, so renaming one renames the file and
Obsidian updates every link pointing at it.

In the list header the name is a field — click and type. In the picker a row is
a *button*, so renaming is armed deliberately: **double-click the name**, press
**F2**, or use **Rename** on the row's `⋯` menu. Enter commits, Escape reverts,
and an empty name is refused rather than written, since it would be a file you
could not open.

Picking a list moves the picker's highlight in place rather than repainting.
That is not only cheaper — a repaint destroys the row under the pointer, and a
double-click cannot survive its own first click.

Every list is accented. Left alone, that accent is **the colour you picked in
Obsidian's own appearance settings**, so the plugin follows your theme rather
than imposing a palette of its own. Give a list a colour of its own and it
overrides that, stored as a name in its frontmatter (`color: teal`) rather than a
hex value, so it still reads correctly in both a light and a dark theme.

The accent shows as a bar on the picker row, an underline on the list header, and
an edge on each card — a bar rather than a wash, because a tinted row fights both
the selected state and whatever background the theme already uses.

Each list can be laid out as **rows** or as a **post-it wall** — the Google
Keep layout — toggled from the list header. Post-its put the note, the steps and
the metadata on the face rather than behind the detail panel, which is what makes
Keep feel like glancing at a pinboard instead of drilling into a task manager.

Layout is per list and is written to that list's frontmatter (`view: postit`), so
it travels with the file. **Post-it view for new lists** on the `⋯` menu decides
where a *new* list starts; it does not touch any list you have already set. The
same switch is in settings as **New lists start as**.

Lists written by an earlier version say `view: cards`, and that keeps working —
permanently, not as a one-off migration. Your frontmatter is your file, and
quietly rewriting it to fix our own naming is not a trade worth making.

## In the sidebar

The view is added to the sidebar when Obsidian starts, alongside Files, Search
and Bookmarks, without taking focus from whatever you had open. Turn it off in
settings if you would rather open it from the ribbon.

By default it lands after Files, Search and Bookmarks, because `getLeftLeaf`
and `ensureSideLeaf` always append — Obsidian passes index -1 internally and
offers no way to change it, which is why every community plugin ends up last.

**Put it first in the sidebar** in settings uses `createLeafInParent`, which is
public, documented, and does take an index. It applies only when the pane is
first created: once List Vibes is in your layout its position is yours, and
dragging it elsewhere sticks. Desktop only — the mobile drawer is a vertical
list with no tab strip to reorder.

## Lists as tabs

Picking a list in the sidebar opens it in the main area, and the sidebar stays
the picker — the same division of labour the file explorer has, and what makes
the pane usable as a navigator rather than something you keep backing out of.

**One tab is reused** as you click through lists, so browsing five of them
leaves one tab rather than five. Three rules decide where a list lands:

1. A tab already showing it is focused, never duplicated.
2. Otherwise the first **unpinned** List Vibes tab is retargeted. Pin a tab and
   it keeps its list, exactly as pinning a note does.
3. Failing both, a new tab.

Tabs holding *notes* are never candidates. Taking over whatever you happened to
be reading is a much worse surprise than one extra tab.

Cmd/Ctrl-click or middle-click always opens an extra tab, as does **Open in new
tab** on a list's menu and the **Open a list in a new tab** command. Right-click
a file in the explorer and choose **Open as list** to open it the normal way.

Each tab carries its own selection through the view's state, so several lists can
sit open side by side and every one of them remembers which list it was showing
after a restart. The tab is titled with the list's name.

The two halves of that arrangement move together: the sidebar shows only the
picker, and a tab shows only its list. A tab repeating the picker down its left
edge would be showing the same control twice and eating the width the tasks were
opened to get. The back arrow in a tab's header reveals the sidebar picker, so a
tab is never a dead end when the sidebar has been closed.

Turn **Open lists in a tab** off to browse entirely inside the sidebar pane
instead, with the list picker and the task list swapping places behind a back
arrow, and each pane self-contained.

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

## Sizing

Nothing in the plugin invents a size. Spacing comes from Obsidian's `--size-*`
scale, radii from `--radius-*`, icons from `--icon-*`, type from `--font-ui-*`,
and rows from `--nav-item-*`. The two fixed widths in the layout — the list
column and the detail panel — are in `em`, so they follow the base font size in
Obsidian's appearance settings instead of pinning while the text around them
grows. Change your font size or zoom and the whole thing scales with the rest of
the app, because it is reading the same numbers.

The one deliberate exception is the card-wall breakpoint, which is a layout
threshold rather than a spacing step.

## Where the title comes from

Obsidian draws the view's title in `.view-header`, but only in some placements:
hidden in a sidebar, hidden in the mobile drawer, shown in a main-area tab,
always shown on a phone — and hidden again on desktop if you turn off "show tab
title bar".

So the pane always builds a title and a stylesheet decides whether it shows.
Deciding it in TypeScript got that last case wrong and left the list unnamed,
because a setting can change while the view is open. `npm run test:ui` checks all
five placements.

The tab's own name is refreshed once the leaf is attached. `getDisplayText()`
depends on where the leaf ended up, Obsidian reads it during construction, and
`leaf.getRoot()` is not reliably the root split that early — read too soon, a tab
takes the sidebar's generic name and keeps it.

## Looking like Obsidian

The plugin builds on Obsidian's own UI vocabulary rather than approximating it.
Picker rows are `tree-item` / `tree-item-self` / `tree-item-inner` /
`tree-item-flair` — the generic tree markup behind the file explorer, the tag
pane, the outline and backlinks, and behind Obsidian's own first-party Importer.
Icon buttons are `clickable-icon`, which also puts them in the selector core uses
for press feedback on touch. The toolbar is `nav-header` > `nav-buttons-container`.

Task checkboxes are real `<input type="checkbox" class="task-list-item-checkbox">`
elements carrying `data-task`, the same markup Obsidian Tasks and Dataview emit.
That is the interop contract themes hang their alternate markers off, so `[/]`,
`[-]` and `[!]` render with **your** theme's glyph and colour rather than ours.

Every element is **dual-classed**: Obsidian's class for the theming, ours for our
own CSS and JS. Nothing here ever selects on a core class. Those names are not
public API — they appear nowhere in `obsidian.d.ts`, and Obsidian's theme
guidelines note that new versions may change class names. Carrying both means a
rename costs inherited polish, never a working view.

The single biggest change was the smallest: task rows lost their card background.
No core list row has a resting background — the file explorer, search results,
backlinks and the outline all paint one only on hover or when active. That one
difference did more than every token elsewhere put together.

## On mobile

Obsidian's phone navigation bar is a fixed-position pill that overlays the view —
floating navigation and auto full screen are both on by default — so a
bottom-anchored bar sits underneath it. The add box reserves
`--view-bottom-spacing`, Obsidian's own answer to this, which is correct whether
the bar floats or docks and already accounts for the keyboard. Rows scroll clear
of it rather than stopping above it, and the reserve is released while the
keyboard is up, because the bar is detached from the DOM then.

That variable is undocumented and only defined under `.is-phone`, so every use
carries a fallback — an unresolvable variable inside a `calc()` invalidates the
whole declaration, which is how at least one popular plugin's navbar clearance
silently became zero.

Obsidian's `--safe-area-inset-*` is used rather than `env()` directly, because
Obsidian overrides those in desktop mobile-emulation and `env()` always reports
zero there — so the layout can actually be tested without a phone.

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

Dragging is only offered under **custom** sort, and never in a smart view.
Custom sort *is* the file's order, so moving a row is a real edit and the new
position is what you see next time. Under a computed sort, dropping a task
between two others would write a change the sort immediately undoes — which
reads as the drag having failed. A smart view has no single order to rewrite at
all: its rows come from several files at once.

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

## Repainting

Editing a task used to make the view flash. A click wrote the file, the vault
event came back about 30ms later, and the whole tree — picker, task list,
overlay and all — was destroyed and rebuilt underneath the pointer.

A repaint now names what it affects, and anything it does not name is left on
screen untouched. Expanding a date row rebuilds the detail panel and nothing
else; a file change rebuilds the panes but leaves the overlay, and therefore its
slide and its backdrop, exactly where they were. Only a genuine change of layout
shape — the pane switching, the detail opening or closing, the width crossing
the breakpoint — rebuilds the tree.

## Fonts

The plugin reads `--font-interface`, the resolved interface stack, not
`--font-interface-theme`. The latter is an input hook that themes may set, and
Obsidian defaults it to a font registered over `unicode-range: U+0` — it renders
no glyphs. Reading it directly gives a font stack containing nothing at all, and
the text falls back to the browser's default serif. That failure is worst
exactly when a theme is well behaved and sets no font of its own.

## Folder

Default `lists/`, configurable.

Do **not** use a dot-prefixed folder like `.lists/`. 

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production build
npm test         # 248 tests: parsing, sorting, frontmatter, view state, writes
npm run test:ui  # drives real drags and renames in a headless browser
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
