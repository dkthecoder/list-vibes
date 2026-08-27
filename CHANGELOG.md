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
