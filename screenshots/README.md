# Screenshots

**Captured from List Vibes 0.9.2.** Real Obsidian on both platforms — window
chrome, ribbon and tab strip included — not the headless renders these replaced.

Desktop is macOS at 2×; phone is Android at 1440×2939. The vault in every shot
is the demo vault: seven lists, each built around one thing the plugin does.

## Desktop

| file | what it shows |
| --- | --- |
| `desktop/1-list-and-detail.png` | All three panes: picker, the Japan trip list with a starred band and four groups, a task open in Obsidian's right panel |
| `desktop/2-postit-wall.png` | Groceries as a post-it wall, cards carrying their heading as a badge |
| `desktop/3-my-day.png` | My Day reading every list at once, each row naming its list and group |
| `desktop/4-markdown.png` | The Work list opened as markdown — frontmatter settings, one task per line |

## Mobile

| file | what it shows |
| --- | --- |
| `mobile/1-lists.jpg` | The picker: four cross-list views above seven coloured lists |
| `mobile/2-list.jpg` | Work collapsed to one pane, starred band and groups intact |
| `mobile/3-detail-drawer.jpg` | A task as a drawer over the list: note, steps, group, My Day, reminder, due, repeat |
| `mobile/4-my-day.jpg` | My Day on a phone |
| `mobile/5-postit-wall.jpg` | The wall reflowed to a single column |

The detail is shot on its own on mobile and docked on desktop because that is
what it is: a real Obsidian leaf, docked right on a desktop and a drawer on a
phone. A composite would be a picture of a layout the plugin does not make.

## Reshooting

macOS: `Cmd+Shift+4`, then `Space`, then click the window. Hold `Option` while
clicking to drop the shadow, or turn it off for good:

```bash
defaults write com.apple.screencapture disable-shadow -bool true && killall SystemUIServer
```

`Cmd+Shift+5` gives a timer, which is the only way to shoot an open menu —
clicking to capture dismisses it.

Keep the same filenames and the parent README picks them up with no edit.
**Update the version in both README files**, since a screenshot is a claim
about what someone sees after installing a particular build.

Shoot the whole set in one theme. Mixed light and dark across a listing reads
as inconsistent, even though following the theme is the point — the light/dark
pair belongs in the feature text, where it can be captioned.
