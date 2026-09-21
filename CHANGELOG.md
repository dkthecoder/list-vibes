# Changelog

Versions are what Obsidian installs by, so this file is the record of what each
one actually contains. A release is a tag matching `manifest.version` exactly —
no `v` prefix — which `npm version` produces because `.npmrc` sets
`tag-version-prefix=""`.

```
./scripts/release.sh patch|minor|major
```

Write the section below first — the release notes are taken from this file, and
the script refuses to run without one. It bumps, opens a PR, waits for CI, and
tags **after** the squash merge: `npm version`'s own tag would point at the
branch commit that the squash replaces, leaving a release whose commit is not in
main's history.

## 0.8.0

**The groups carry an order of their own.** Sorting a list ordered the tasks
inside each heading and left the headings themselves in file order, so there was
no way to say "alphabetically" and have it mean the groups too.

- A second order, chosen in the same menu: file order, A–Z or Z–A. Organise
  within the groups, and organise the groups.
- Neither sort stands in for the other. A group has no due date and no
  importance of its own, so ordering groups by the task sort would mean
  inventing an aggregate and calling it the group's.
- Dragging a heading now follows the group order rather than the task sort.
  Choosing "Due date" for the tasks had been quietly disabling it, which is a
  question it has nothing to say about.
- Both are view-only and stored per list, like the task sort. Nothing is written
  to your markdown.

**Tasks in no group sit below the groups**, with Completed below that. They were
above, by the argument that it is where they are in the file — which only held
while the file's own order was the only order there was.

The `Ungrouped tasks first` setting goes with it: the position is now fixed, and
a setting whose reason has gone is a switch with nothing behind it.

Subtasks are unchanged, and deliberately so — they are never sorted and never
grouped, and stay under the task they belong to.

## 0.7.0

**A group is shaded a level above the items inside it.** The heading had no
surface of its own, so the only thing saying a task belonged to a group was its
indentation.

- A group's band sits at one level, an item inside it at two. An item in no
  group stays where it was.
- The step is toward the text colour rather than toward black, which is the
  contrast pole in either theme — so a light theme reads it as darker, a dark
  theme as lighter, and the nesting reads the same way round in both.
- Depth is derived from a list's colour rather than declared beside it, so a
  coloured list wears both instead of one winning.
- The band takes the rows' own edges now that it is painted. It had been eight
  pixels proud on each side, which nothing showed while it was transparent.

**Every card on the wall has a drop position again.** A wall of mixed-height
cards in columns will eventually put two of them at exactly the same height —
measured on the real thing, two sat at 5546.46875, an exact tie rather than a
rounding artefact.

- The drop index counts how many card centres the pointer has passed, so a tie
  made the count jump by two and left a position between them that no pointer
  could reach: fifteen of sixteen slots on that wall.
- The measuring now folds the column and the height into one ordinate, so the
  arithmetic that reads it stays one-dimensional and stays right. In rows there
  is one column and it is the centre it always was.
- The suites could not have caught this. They check that a card lifts and that a
  drop writes, never that it lands where the preview showed it would.

## 0.6.0

**Groups stopped being a custom-sort-only feature.**

- Any sort now keeps the headings — the rows reorder *inside* each group rather
  than the groups dissolving into one flat list.
- *No group* on the add row means no group. It said "No group" and filed the
  task under the last heading anyway, because the code could not tell an
  explicit "none" from "never chose".
- Groups can be turned off — `groups: hidden` on a list, or the setting for all
  of them. The list goes flat and every row carries its heading as a badge, so
  where a task lives is shown rather than lost.

**One heading, three bands.** A group, Completed and the starred band were three
class trees drawn three different ways, and they had drifted.

- Completed's label sat ten pixels off the rail every other line in the pane
  starts on. It never picked up the leading column the rows and group headings
  share; it does now.
- A group answers a keyboard. Only Completed did before, because that was the
  one place the handling had been written out by hand.
- Headings size from five tokens on the root, so retuning one is a single edit
  and a snippet can resize every band at once.
- They default to 15px in the normal ink — they were 12px against 13px task
  titles, so the label was smaller than the thing it labelled — and they read
  the way the `##` line reads. "India / Hindi", not "INDIA / HINDI".

**Deleting a group is in its menu.** The bin sitting beside every heading put
the most destructive thing a heading can do in the same sweep as folding one,
and gave the heading two trailing controls where the rows beside it have one.

**The add row's group picker looks like a control.** It was a 19px label with
nothing to say it opened a menu.

**The feature list matches the code again.** Striped rows had been gone for a
while — no setting, no frontmatter key — and the README still advertised them.
Undo went the other way, documented everywhere except the list of features.

## 0.5.0

**Groups.** A `##` heading had been parsed and rendered and nothing else: no way
to make one, rename one, move one, or move a task into one.

- Create, rename in place, reorder by dragging the heading, and fold.
- Delete one and its tasks join the group above; taking them with it is a
  separate, confirmed choice.
- Drag a task between groups, and an empty group is drawn so it can be dropped
  into rather than being a dead end.
- The add row names the group a new task joins.
- A starred band above the list, and a badge on any task shown away from its
  heading.

**Two-dimensional drag.** A drop is a run picked by hit-test plus an index
within it, which is what finally lets the post-it wall be sorted at all. Holding
near an edge scrolls the list, and the hit-test is corrected for the scroll.

**Undo, on `Cmd/Ctrl+Z`.** Obsidian's undo belongs to the editor, and the
ordinary case here is ticking a task in the sidebar while the file is open
nowhere — a write with nothing tracking it. Scoped to the view, so the editor
keeps the shortcut everywhere else.

**A tab per list**, which is also what keeps a tab's title honest: a tab handed
a different list keeps the old one's name, and no public API changes that.

**Colour that shows.** A pastel mixed into the theme's own surface, so one rule
serves light and dark.

**Fixes.**

- A URL keeps its own parentheses. `/wiki/She_(TV_series)` — the everyday
  Wikipedia disambiguator — ended at the first close paren and left the real one
  behind as text, so a list of shows read `She⧉) 2020`.
- A title carrying a markdown link renders in the detail panel instead of
  showing its brackets and URL, which made the panel read as broken on exactly
  the lists that use links most.
- **Delete a list**, through the vault's own deleted-files setting.
- `dev-vault` watches the stylesheet. It copied `styles.css` from esbuild's
  rebuild hook and esbuild rebuilds on TypeScript changes, so editing only the
  stylesheet copied nothing.

## 0.4.0

**A ticked task drops into Completed straight away.** It used to sit in the open
list looking done until you clicked elsewhere — and if you unticked it in that
window, the box cleared but the task went into Completed anyway. The repaint was
being held back because a checkbox is an `<input>` whose value is the string
"on", which the guard against repainting over a half-typed word read as typing.
Nothing was ever written wrongly; the screen was just a step behind the file.

**Everything lines up.** The panel's checkboxes, icons and the + share one
column, and so do the labels after them. The add box's placeholder sits on the
same line as the task titles above it. A row in the task detail no longer slides
its chevron 32px sideways when it has nothing to clear.

**The add box is the list's next row.** It was a bar pinned to the foot of the
pane, which put a gulf of empty space between the last task and the box you add
the next one into. It sits with the list now, and the Completed section closes
things off beneath it.

**Striped rows, optional.** Every other row takes a slightly different
background so a long one is easier to follow across. On by default; a list can
opt out from its own menu, and the setting decides for the rest.

**Confetti, and a glint on the star.** A burst in the list's own colour when you
complete something, a bloom from the star when you mark something important.
Each has its own switch, and both are skipped entirely if your system asks for
reduced motion.

**Post-it cards read as notes rather than tasks with children.** Items sit at
the card's own left edge instead of indented under its title, which is what
makes a pinboard feel like a pinboard.

## 0.3.1

**Task titles render on older iPads again.** The inline renderer used regex
lookbehinds, which iOS before 16.4 does not support — and does not degrade
gracefully: the `RegExp` constructor throws, so every task title rendered as
nothing. 0.3.0 shipped with this. The boundary rules those lookbehinds enforced
(a URL is not a link inside a longer token; a `#` mid-word is not a tag) are now
a character comparison in JavaScript, with eleven tests pinning the behaviour —
including that the parsed pieces always reassemble into the original string.

**Housekeeping.** Lint runs for the first time (`eslint-plugin-obsidianmd`, the
same scan the plugin store applies). CI runs the browser suites, which had only
ever run on one laptop. Per-platform screenshots. A README with a features list
rather than 585 lines of essay.

## 0.3.0

**Fields size to their content.** The note box was fixed at three rows and the
step box at one line, so an empty note reserved space nobody used and a long one
was squeezed into a field with a scrollbar inside it. Both grow now, between a
resting size and a ceiling set in CSS. The step field became a textarea so a long
step wraps instead of scrolling out of sight; Enter still submits.

**A colour audit that can fail.** `harness/palette.mjs` repaints every Obsidian
colour token the stylesheet references, then walks every element in the view and
every colour-bearing property. Anything unchanged is a colour the plugin chose on
its own, named by element and property. 1,886 colours, none of them ours.

## 0.2.0

**The task detail is Obsidian's right panel, not an overlay.** Tapping a task
calls `ensureSideLeaf(..., "right", { reveal: true })` — the API Backlinks and
Outline use — so the panel opens whether or not it was already there, and the
panel opened from anywhere else offers a fuzzy task picker.

Deleted with it: a backdrop, a slide transform, swipe-to-dismiss, an Android
back-button handler, a pin button, a pin breakpoint and a pin setting. All of it
was rebuilding what a docked view already has.

**Completion and creation stamps carry a time** — `✅ 2026-08-26T14:32`, behind a
setting, default on. Bare dates are still read and nothing existing is rewritten.

**Corners, and one column down each edge of the list.** Rows took the theme's
`--nav-item-radius`, so a theme drawing pills drew every task as a lozenge; the
radius scale is capped now. The star sat six pixels below the line it belonged
to, and the completed rows were inset four pixels further than the open ones.

**The mobile keyboard fault, closed.** Obsidian pads `.view-content` by
`max(var(--keyboard-height), 32px)`. Harmless for a note — the editor is one tall
scroller — and fatal for a fixed layout, which it collapsed to nothing. The plugin
shadows `--keyboard-height` on its own root, so core's formula resolves to
something survivable without a specificity fight.

## 0.1.0

First working version. A folder of markdown files as to-do lists: a list picker,
a task list with a collapsible completed section, a detail panel with steps,
notes and dates, smart views for My Day, Important and Planned, drag to reorder,
inline rename, per-list colour and icon, and both the Tasks emoji dialect and
Dataview inline fields.
