# Screenshots

Regenerate with `npm run screenshots`.

These are rendered by `scripts/screenshots.mjs`: the plugin's own code and its
own stylesheet, drawn headless against the fixture vault in `harness/fixtures.ts`.
Everything you see is real — the panes, the rows, the spacing, the theme tokens —
but the tasks are fixtures rather than anyone's real list, and there is no
Obsidian around the view: no title bar, no ribbon, no tab strip.

That is fine for a README, where the question is "what does this look like", and
thin for a store listing, where a screenshot is a claim about what someone will
see after they install it.

**So replace these with real captures before submitting.** Take them from
Obsidian on each device, with your own lists in them, and save over these
filenames — the README will pick them up with no edit:

| file | what it shows |
| --- | --- |
| `desktop.png` | the picker and a list, side by side |
| `desktop-detail.png` | a task open in Obsidian's right panel |
| `tablet.png` | the same two panes at a tablet's width |
| `mobile.png` | the single pane a phone collapses to |
| `mobile-detail.png` | a task open as a drawer on a phone |

The detail is shot on its own rather than beside the list because that is what
it is: a separate leaf, docked right on a desktop and a drawer on a phone. A
composite would be a picture of a layout the plugin does not make.
