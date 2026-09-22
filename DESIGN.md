# Design notes

Why List Vibes is built the way it is. The [README](README.md) is what it does;
this is the reasoning underneath — the parts that are decisions rather than
features, and the ones somebody will otherwise have to rediscover from the
source.

## Undo

Obsidian's undo belongs to the editor — it is CodeMirror's history, attached to
a Markdown tab. This view is not one. When the file happens to be open the
plugin writes through the Editor API and those changes do land in that tab's
history, but the ordinary case is ticking a task in the sidebar while the file
is open nowhere, and that write goes to disk with nothing tracking it.

So `Cmd/Ctrl+Z` inside a List Vibes view walks back the last fifty changes it
made. It is bound on the view's own scope rather than as a global hotkey, so
the editor keeps the shortcut everywhere else and the two histories never
compete.

Whole file contents are remembered rather than an inverse per operation. Every
write already funnels through a handful of helpers, so snapshotting there covers
every operation at once — including ones added later — without a single
mutation knowing undo exists.

An undo applies **only if the file still says what that write left behind**. It
may have been edited by hand, by a sync, or by another plugin since, and putting
back what was there before would throw away whatever arrived after.

Deleting a list is undoable too, with one caveat: Obsidian has no un-delete, so
undo writes a new file with the old contents. The trashed copy stays wherever
your vault sent it.

## A tab per list

Each list opens in its own tab, and picking one already open focuses that tab
rather than replacing something.

That is a correctness decision as much as a preference. Obsidian rereads a
custom view's name when it decides to rather than when its state changes, and no
public API asks it to — so a tab handed a *different* list goes on wearing the
old one's name. A tab that is only ever created or focused never holds a list it
was not built for, so the question never arises.

Turn **A tab per list** off for a single shared tab, at the cost of a tab title
that can name the list it used to hold.

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
changing it cannot touch a byte of the file. Every sort keeps the file's `##`
headings: a group is a view of the file rather than a consequence of its order,
so the headings stay and the rows reorder inside them.

The headings carry an order of their own — file order, A–Z or Z–A — chosen in
the same menu and stored the same way. Neither sort can stand in for the other:
a group has no due date and no importance of its own, so ordering the groups by
the task sort would mean inventing an aggregate and calling it the group's.
Tasks in no group sit below every group, and Completed below that. Subtasks are
never sorted and never grouped; they stay under the task they belong to.

Dragging a heading is offered only under **file order**, and dragging a task
only under **custom** sort — each follows its own order rather than the other's,
so choosing "Due date" for the tasks does not stop you reordering the groups.
Neither is offered in a smart view.
Custom sort *is* the file's order, so moving a row is a real edit and the new
position is what you see next time. Under a computed sort, dropping a task
between two others would write a change the sort immediately undoes — which
reads as the drag having failed. A smart view has no single order to rewrite at
all: its rows come from several files at once.

There is deliberately no "last modified" sort for tasks. A markdown line has no
modified timestamp — only the file does — so every task in a list would share one
value. Date created is the honest version of that, and needs the creation-date
setting switched on.

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

A repaint names what it affects, and anything it does not name is left on screen
untouched. A file change rebuilds the task list; expanding a date row rebuilds
the detail panel and nothing else. Only a genuine change of layout shape — the
pane switching, the width crossing the breakpoint — rebuilds the tree.

Without that, editing a task made the whole view flash: a click wrote the file,
the vault event came back about 30ms later, and everything was destroyed and
rebuilt underneath the pointer.

## Fonts

The plugin reads `--font-interface`, not `--font-interface-theme`. The latter is
an input hook for themes, and Obsidian defaults it to a font registered over
`unicode-range: U+0` — it renders no glyphs. Read it directly and the text falls
back to the browser's default serif, worst of all when a theme is well behaved
and sets no font of its own.

## Colour

A list's colour is a pastel mixed from the theme's own colour and the surface
the pane already uses, and the items wear it rather than a stripe beside them.

Mixing into the *surface* is what makes one rule work in both themes: the same
declaration lands pale on a light theme and deep on a dark one, because it is
the theme's background being tinted. There is still no colour here that the
theme did not supply, which the palette suite checks by repainting every token
and failing if a single value fails to move.

A list that has chosen no colour still has one — the theme's accent — so the
default list is tinted too.

## Dependencies

There are none. `main.js` is this repository's own code and nothing else — the
nine packages in `package.json` are esbuild, TypeScript, eslint, Playwright and
their types, none of which reach a vault.

That is a position rather than an accident, and it has been tested twice.

**The post-it wall** is `column-count`, four lines of CSS. The obvious
alternatives are libraries: MiniMasonry lays out but does not drag, Muuri does
both and has not had a release in five years. Both position cards with
`transform` — the property the drag preview already writes — so either would
mean two things writing the same property on the same element. Measured against
a plain grid, the columns are 25% shorter and split no card across a column
break, which is the one thing multicolumn is known to get wrong.

**The drag** is `src/ui/dragSort.ts`. SortableJS is the usual answer and around
twenty Obsidian plugins use it, but its strength is native HTML5 drag, which
does not work in a mobile webview — and the `delay` its fallback needs for a
long press has an open bug on Chrome for Android, which is what Obsidian runs
on. The most successful Obsidian kanban wrote its own for the same reason.

Native CSS masonry lands in Chrome and Firefox during 2026, and Safari has it
now. When it does it replaces `column-count` behind an `@supports` — better,
and still nothing to install.
