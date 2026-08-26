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
- **Swipe the panel away.** On touch, push the detail panel back where it came
  from. Drag it a third of the way across and it goes; flick it and it goes
  without travelling far; let go short of either and it springs back. A scroll
  that wanders sideways stays a scroll — the horizontal movement has to clearly
  beat the vertical before the panel starts following your finger. Obsidian
  watches for the same gesture to open its own sidebar, and `touch-action` does
  not stop a gesture implemented in JavaScript, so the panel carries
  `data-ignore-swipe` — core's own opt-out, the one it puts on its sliders,
  canvas and resize handles. `touch-action` is per-element, so it is declared on
  the panel's scroller as well as the panel; declared on the panel alone, the
  browser still owned the gesture everywhere the scroller covered, and the swipe
  worked from the header strip and nowhere else.
- **Back closes the detail panel.** Opening a task is a navigation, so it goes
  into the leaf's history — which is what both of Obsidian's back buttons run,
  the one in the mobile navigation bar and Android's own. Back closes the panel
  instead of leaving the plugin or the app. Closing it yourself is deliberately
  *not* recorded, or back would re-open the panel you had just dismissed.
- **A drag is not a tap.** `pointerup` is not the end of a gesture: the browser
  goes on to dispatch `click` on the same row, and a task row's click opens the
  detail panel — so reordering a list also popped the editor open, on a task
  whose line the drop had just moved, which is why it opened empty. The click a
  drag leaves behind is swallowed, and a selected task that is no longer in its
  file is dropped rather than rendered as a blank panel.
- **A task's note shows on the row.** One faint line under the title, cut off
  where the row runs out, however long the note is. It used to be a chip reading
  "Note", which told you a note existed and nothing about whether it mattered.
- **Every control opens in place.** The due date, reminder and repeat rows expand
  inline into a row of chips. They are not Obsidian Menus: a Menu opens at the
  cursor and reads as a right-click context menu, which is wrong for a primary
  control and has nothing to anchor to on touch.
- **Rows drag into order.** Grab a task and move it; the rows it passes slide to
  open the gap, and nothing is written until you let go. Steps inside a task
  reorder the same way, within their own parent. On touch it takes a long press
  to start, because a vertical swipe on a list has to stay a scroll.
- **The add box expands upward — on a desktop.** Collapsed it is a single line;
  click it and it opens into a title, a description and the same metadata a task
  has. On touch it is the last row *inside* the list instead, and it stays one
  line: expanding it in place put a description, five chips and a second, greener
  "add" button beside the + that already adds, into the middle of the scroll
  under a keyboard covering half the screen. Everything it offered is on the task
  itself once it exists, one tap away, on a panel built for it. Click it and it opens into a title, a description, and
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

## Repeating tasks

Tick a `🔁 every week` task and the next one is left behind, above the completed
record of this one. Everything travels except what belonged to this occurrence:
it starts undone, without a completion date, with its dates advanced.

`every day`, `every 3 days`, `every other week`, `every month`, `every monday`,
`weekly` — and `when done` on the end of any of them. That last one is the
distinction that matters: **rent due every month** means the first of the month
whether or not you paid late, while **water the plants every 3 days when done**
means three days after you last watered them. A rule we do not recognise
advances nothing rather than guessing, because a task quietly repeating on the
wrong schedule is worse than one that visibly does not repeat at all.

A task with both a due and a scheduled date keeps the gap between them.

Month arithmetic clamps: 31 January plus a month is 28 February, not 3 March.
Getting that wrong makes a monthly task creep forward through the calendar a few
days at a time, which is why it is tested rather than assumed.

## Giving a task its own note

The escape hatch that one-file-per-task designs make compulsory. From the detail
panel, a task can become a note: the line stays where it is and turns into a
link — `- [ ] [[Plan the trip|Plan the trip]] 📅 2026-09-01` — so the list still
shows it, still sorts it, still ticks it off.

**The metadata stays on the line.** Moving a due date into the note's
frontmatter would hide it from the list, from Obsidian Tasks, and from anything
that reads the file after this plugin is gone. The note is for the writing; the
line remains the task.

Promoted notes go to their own folder, configurable, kept out of the lists
folder so they are not themselves read as lists. Names are cleaned for the
filesystem without touching the displayed title, and a collision never
overwrites — a second "Same" becomes "Same 2".

## Icons

A list can carry an emoji beside its name. It is stored in the list's
frontmatter as `icon:`, **not** in its filename — changing a filename rewrites
every link pointing at it, and an emoji in a path travels badly between sync
clients and filesystems. An emoji at the *start* of a filename is still read as
a fallback, since plenty of vaults are named that way, but new ones are never
written there.

The picker is a grid of about a hundred emoji, grouped the way lists tend to be
named — work, home, money, travel, food, health, study — with a text field
beside it. The grid is a *selection*, not a catalogue: a complete picker needs
names, search, skin tones and a data file that goes stale, whereas this needs to
cover what people actually call a list. The field takes anything at all, and
lets the operating system's own picker do the work — the emoji key on a phone
keyboard, Ctrl+Cmd+Space on macOS, Win+. on Windows. Always current, nothing to
maintain.

On a phone the grid is what greets you and the field does **not** take the
caret. Raising the keyboard there was tried and was worse: there is no way to
ask for the *emoji* keyboard specifically — no web API offers one and neither
platform exposes one — so the keyboard comes up on its letters, covers the grid,
and reaching an emoji still costs a tap on the emoji key and a hunt. Tap the
field and the keyboard comes up as it always did, emoji key and all; the
difference is that it is now a choice rather than the only route. The desktop
shortcuts are not shown there either, where they would only cost a line of a
small screen.

Only the first glyph is kept, counted as a person would count it: "👍🏽" is four
code units and "🇬🇧" is two code points, and half of either is a replacement
box in the middle of the picker.

## Adding things

Both add fields have a `+` and it commits, which it did not use to — it was a
plus with nothing wired to it, so Enter was the only way. On a desktop that is a
dead control; on a phone it is the feature missing, because a soft keyboard's
return key is often "Next" rather than a submit. The fields now also declare
`enterkeyhint="done"`, so the key says what it does.

Pressing `+` does not steal focus from the field — a pointer going down on a
button blurs it first, which on a phone starts dismissing the keyboard — and
focus stays put afterwards, so a second step can be typed straight away.

## Sizing

Nothing in the plugin invents a size or a colour. Spacing comes from Obsidian's
`--size-*` scale, radii from `--radius-*`, icons from `--icon-*`, type from
`--font-ui-*`, rows from `--nav-item-*`, and every colour from the theme's own
palette. The two fixed widths — the list column and the detail panel — are in
`em`, so a column grows with the text inside it rather than squeezing it.

**One correction to an earlier version of this file**, which claimed those
widths follow the base font size in appearance settings. They follow the *UI*
type scale, and the two are not the same thing: on a phone Obsidian derives
`--font-ui-*` from the reading font size, so they do scale with that setting; on
desktop `--font-ui-*` are fixed at 12/13/15/20px and the chrome deliberately
does **not** grow with the reading font. Following the token means matching
Obsidian in both cases, which is the actually useful behaviour — but it is worth
saying accurately rather than claiming more than it does.

Zoom is separate and does scale everything, on both platforms, because zoom
scales pixels too.

`npm run test:ui` proves the linkage rather than asserting it: it changes the
tokens the way a theme or a settings change would and checks the plugin moved —
font, type scale, spacing, radii, accent, text and background colours. The last
check is a sweep: every colour token is set to a recognisable value and every
painted colour in the view is tested against it, so a single hardcoded colour
anywhere fails the run. It found two when it was written — a stale white in the
harness, and a checkbox left on the browser's default black.

The one deliberate exception is the card-wall breakpoint, which is a layout
threshold rather than a spacing step.

## Fitting into a phone

Core draws its own header above the view and, once floating navigation is on —
which is the default — makes room for itself by pushing `.view-content` down
with `margin-top: calc(var(--safe-area-inset-top) + var(--view-header-height) +
8px)`. This plugin's header was also adding `--safe-area-inset-top`, on the
assumption that it was the topmost thing on screen. It never is, so the notch
was cleared twice and the result was a band of nothing between the top of
Obsidian and the name of the list — 55px of it, which is what the harness now
measures when the rule is put back.

The same duplication in a different place: core's header carries a drawer
button, and this plugin's header carried a back arrow that revealed the same
sidebar. In a *narrow pane* that arrow does something nothing else does — it
moves between the picker and the list — so it stays there and is gone from a
tab on a phone. Both halves are asserted.

## Typing on mobile

Two faults lived here, and both came from the same mistake: rebuilding DOM the
user was actively using.

Tapping the add box used to repaint the pane, which destroyed and recreated the
very input just tapped. On Android that is worse than it sounds — text arrives
through an IME composition bound to the live element, and replacing it
mid-composition leaves the IME inserting at a stale offset, so characters came
out **reversed**. Expanding is now a class rather than a repaint, and a repaint
from anywhere else is held back while focus is in a field and released when it
leaves. A file change can wait; a half-typed word cannot.

### The keyboard

Tapping a field on a phone or tablet used to blank the view, and the reason is
worth writing down because the fix looks like nothing and the wrong fixes all
look sensible.

iOS shrinks the **visual** viewport when the keyboard opens but leaves the
layout viewport alone, then scroll-into-views the focused field. A scroll
container that can absorb that does, and nothing else moves. If none can, the
browser scrolls the *page* — and a `height: 100vh` app shell scrolled to a
region with nothing painted is a blank screen that comes back when the keyboard
closes. ([Apple 723420](https://developer.apple.com/forums/thread/723420),
[WebKit 207049](https://bugs.webkit.org/show_bug.cgi?id=207049),
[192564](https://bugs.webkit.org/show_bug.cgi?id=192564).)

A markdown note never triggers it, which is the clue that matters: its caret
lives inside `.cm-scroller`, which can always scroll.

Android arrives at the same place by a different road. The WebView there is
generally *not* resized when the keyboard opens — `window.innerHeight` and the
visual viewport both stay put, which is why the keyboard has to be measured from
Obsidian's own `--keyboard-height` rather than inferred. What shrinks instead is
`.app-container`, clamped by core the instant the keyboard's animation ends.
The focused field is then below the fold, something scrolls to reveal it, and
the rest follows identically. Worth stating plainly because it rules a fix out:
`100dvh` does **not** help, on either platform — the on-screen keyboard is
[explicitly not part of any viewport unit](https://web.dev/blog/viewport-units),
`dvh` included.

So two rules here, and they are the whole answer:

**Every field you can type into is inside a scroller.** On touch the add box is
the last row *inside* the list rather than a bar pinned below it, where nothing
could have revealed it. On a desktop it stays pinned — there is no keyboard to
dodge and a bar in reach is better.

**That scroller always has room to scroll into, keyboard or not.** Reserving it
only once the keyboard is measured loses a race it cannot win: the measurement
arrives after focus, by which point the browser has already looked for somewhere
to reveal the field and moved the page instead. A short list had no overflow at
the moment it mattered. `40vh` is about a keyboard's worth, and the same trick
core plays in the editor, where `updateBottomPadding` reserves roughly half the
view beneath the note. The harness pins the race directly: shrink the pane to a
phone's height and the scroller must already be scrollable with nothing tapped.

**And every ancestor that could be scrolled behind your back is put back.** An
`overflow: hidden` box is still a scroll container — it merely has no scrollbar.
So when the keyboard covers a focused input, the browser walks up the ancestors
looking for something it can scroll to reveal the field, and an `overflow:
hidden` ancestor answers yes. Everything inside slides up together, with no
scrollbar to bring it back until the keyboard closes.

*Which* ancestor answers decides how much disappears, and this is the part that
took longest to see. `.view-content` takes the plugin's view with it.
`.app-container` takes Obsidian's own header and navigation bar too — which is a
whole screen going blank, in an app where nothing else that day went wrong. The
guard used to name two boxes by hand and left every other link in the chain
free; it now walks the chain from the view to the body. `harness/vanish.mjs`
builds a real app shell and asserts that scrolling it is undone and that the
chrome above the view does not move — remove the app shell from the walk and it
reports `chrome top 950 -> 810`, which is the bug in one number.

Pinning is safe precisely because these boxes have no scrollbar: an offset
nobody can see and nobody can undo is never one they asked for. It is the guard
core already runs on the document root, applied one level down. When it fires it
logs which box it caught, so a recurrence names its own cause instead of
starting another round of guessing.

**And core's own `.view-content` padding is neutralised, which was the fault all
along.** Not the app container. Not Android. Ours, and in plain sight.

A plugin's root element *is* the view's `.view-content` — Obsidian hands you that
element and you add your class to it — and core pads it:

```css
padding-bottom: max(var(--keyboard-height), 32px);
```

For a note that is right and invisible: the editor inside is one tall scroller,
so bottom padding just adds somewhere to scroll past the last line. For a fixed
`height: 100%` layout inside a leaf core has already shortened to
`100vh − keyboard`, it eats the content box. Read off an Android phone with the
keyboard up:

```
.view-content.lv-root   h 475   padding-bottom 463.143   ->  12px of content
.lv-shell               h 0
.lv-pane .lv-tasks      h 0
```

Zero. On a phone the view is the screen, so the screen goes blank — and in
landscape there is not even the 12px. That is the whole bug, and it explains
every observation that made it look like something else: invisible in a markdown
file because the editor absorbs the padding, absent from the Quick Switcher
because a modal is not a `.view-content`, and untouched by three rounds of
overriding `.app-container`, which was never involved.

**The fix is the variable, not the property.** Overriding `padding-bottom` means
out-specifying a selector nobody had read — core's beats a plain `.lv-root`, but
by how much is a guess. `--keyboard-height` inherits, so setting it on the root
shadows it for that subtree, core's own formula resolves against it and yields
`max(0px, 32px)`, and no cascade is fought. `harness/collapse.mjs` pitches core's
stand-in rule at four classes deep on purpose: remove the shadowed variable and
it reports `pane=0px` — the device symptom, reproduced locally — and it reports
the same with the `padding-bottom` override still in place, which is the fix that
would have shipped and failed a fourth time.

That suite exists because the others modelled `.view-content` and `.lv-root` as
two elements when Obsidian makes them one. Eight rounds of tests could not see a
rule aimed at a class the harness never put on the root.

**And nothing else.** The view does not shorten itself, lift anything, or reset
the page scroll for the keyboard. The webview slides the whole app upward when
the keyboard rises — core's own editor does it too — so it is not a plugin's to
correct, and correcting it means subtracting a keyboard Obsidian has often
already subtracted. `harness/vanish.mjs` asserts those absences under a faithful
pane, because an absence is not something a screenshot shows.

Two properties are deliberately **not** used. `-webkit-overflow-scrolling: touch`
is dead weight: WebKit's own source shows its compositing branch is unreachable
once `asyncOverflowScrollingEnabled` is on — the default in every WKWebView —
and Blink removed the property outright, so on Android it is dropped at parse
time. Its one surviving effect on iOS is silently forcing `z-index: 0`. Core
uses it zero times. And nothing reads `--keyboard-height` to lay anything out;
it feeds one padding and one class, and that is all.

Every field is also at least 16px on touch, because iOS zooms a WKWebView in on
a smaller one. At Obsidian's default reading size this changes nothing —
`--font-ui-medium` is already `--font-text-size` on mobile — so it is a floor
rather than a change of scale.

Obsidian's own documentation says nothing about any of this. Its [mobile
development page](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
covers emulation, the `Platform` API, remote inspection and `isDesktopOnly`, and
does not mention the keyboard, the viewport or safe areas. That is recorded here
so nobody spends an afternoon looking for it.

## The list's name, and the two places it shows

A list's name **is** its filename. Renaming the title renames the file and
Obsidian updates every link pointing at it — that is the whole idea, and it is
why the name is never stored anywhere else.

It shows in two places on a desktop: Obsidian's own tab, and the title inside
the view. They used to disagree — a tab reading "Untitled list" beside a view
reading "Favourite animals" — for a reason worth writing down. `followRename`
existed to point every open view at a renamed list's new path, and **nothing
ever called it**. Rename from the sidebar picker, the file explorer, or a sync
landing, and the view kept a path that no longer existed. It is wired to the
vault's rename event now. The tab's title is also read straight off the path
rather than out of the store, because the store is a cache rebuilt from vault
events and can answer with yesterday's name for a moment; a path cannot.

A leading emoji in a filename — `💼Work.md`, which plenty of vaults use — is
promoted to the list's *icon*, so the view shows the icon and the word "Work".
A tab has nowhere to put an icon, so it shows "Work" too rather than repeating
the emoji in the text.

The title inside the view is additionally **tidied**: `weekly-review` reads as
`weekly review`. Only names written without spaces are touched. A hyphen you
typed *between spaces you chose* is your own punctuation, and rewriting
`Movies & TV - new` would be editing your prose rather than tidying a filename.
Nothing is capitalised, because case is guesswork — `iphone` is not `Iphone`.
There is a setting to turn it off and show the true filename everywhere.

The trap in that, and the reason it is tested harder than it looks worth: the
title is also the field that renames the file. If the tidied text were what sat
in the field when it took focus, opening a list and touching its title would
quietly rename `weekly_review.md` to `weekly review.md`. So the field shows the
tidy version at rest and swaps to the **true** name the instant it is focused —
what you edit is always what will be written. Remove that swap and the harness
reports the file being renamed by a click that typed nothing.

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

Nothing paints a background it was not asked to. Obsidian already paints a
workspace leaf, and it picks the colour by where the leaf is —
`--background-secondary` in a sidebar, `--background-primary` in the main
workspace, through two rules in core's own stylesheet. A pane that paints
`--background-primary` regardless is therefore right in a tab and a bright
rectangle in the sidebar, which is most of what "it doesn't look native" turns
out to mean. The panes paint nothing and the leaf shows through, exactly as the
file explorer's do. The few surfaces that genuinely have to be opaque — the add
bar, the sliding panel, a post-it — read `--lv-surface`, which follows the same
rule the leaf does, and `--lv-surface-alt`, which is always the other one, so a
raised card has contrast wherever the view happens to be.

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
npm test         # 294 tests: parsing, sorting, frontmatter, view state, writes
npm run test:ui  # drives drags, renames, titles and mobile typing in a browser
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
