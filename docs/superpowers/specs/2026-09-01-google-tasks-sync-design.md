# Google Tasks sync

Two-way sync between a List Vibes list file and a Google Tasks list. Edit in
either place; both converge. The vault stays the source of truth for everything
Google cannot represent, and Google never gets to invent structure the markdown
did not ask for.

The user brings their own Google Cloud project and OAuth client. The plugin
ships the flow and the instructions, not the credentials — no hosted service, no
shipped secret, no verification review, nothing to keep running.

## Build order

Each milestone is independently shippable and independently useful.

| | Delivers | Fields on the wire |
| --- | --- | --- |
| **M1** | See your tasks in Google and back again, open and completed, both ways. Creates, edits, deletes, steps as Google subtasks, list pairing, auth, settings. New tasks append; order is not managed. | `title` `status` `notes` body `📅 due` `completed` `parent` on insert |
| **M2** | Everything Google has no field for becomes visible in the notes footer. Recurrence hand-off. | + `⏰` `🔁` `⏫` `➕` `☀️` `##` `[/]` `[-]` |
| **M3** | Structure, symmetrically. Inbound reorders and re-parenting rewrite the markdown. | + `position`, `parent` on `move` |

Fields not yet on the wire are still parsed and still written by the plugin as
normal. Because every edit is a splice into the original line, a field the sync
does not transmit is never a field the sync can damage.

## Identity and baseline

Three pieces of state, deliberately split by durability.

```
IDENTITY      in the markdown line       🆔 g7k2m9
              durable, travels with the vault, human-visible,
              survives a rename on either side

PAIRING       in the list frontmatter    gtasks: MTk0NzIx...
              written on first sync, never removed — deselecting
              and reselecting a list re-pairs it rather than
              duplicating it

BASELINE      .obsidian/plugins/list-vibes/gtasks.json
              last-agreed field values per task, plus per-list
              lastSync and a per-task localEditedAt for the edit
              clock. Disposable: delete it and the next sync
              rebuilds by matching on 🆔, with no clock history,
              so that one cycle falls back to Obsidian wins
```

`id` is already declared as a `MetaField` in `src/model/types.ts` and mapped in
`src/model/serialize.ts`, but `parse.ts` has no reader for it. M1 adds one, for
both dialects — `🆔 g7k2m9` and `[id:: g7k2m9]`. That reader is the only change
the sync makes to the existing parser.

### Why a baseline is not optional

The usual answer is last-writer-wins on timestamps. It is unavailable here: a
markdown line has no modified time, only the file does, and one edit in a
fifty-task file makes all fifty look modified. Detecting *local* change at task
granularity requires remembering what the task looked like at last sync. Google
supplies the other half free — every task carries `updated`, and
`tasks.list?updatedMin=` returns only what moved.

## Merge

Per field, three-way:

```
             baseline   local     remote     result
title        "Draft"    "Draft"   "Draft"    unchanged
status       todo       todo      done    →  take remote
priority     high       highest   high    →  keep local
due          08-24      08-24     08-26   →  take remote
```

Only *both sides changed* is a conflict. Ticking a task on your phone while
restarring it in Obsidian is two independent writes, not a collision — which is
the everyday case and the entire reason to build three-way rather than
directional ownership.

### Conflict policy: newest wins

The default, matching what Google Tasks does between its own clients and what
the industry does generally — per-field last-write-wins. Settable to
`obsidian` or `google` for anyone who wants a fixed direction.

Google supplies its half exactly: every task carries `updated`. Our half comes
from a **local edit clock**, internal to the sync — never shown in the UI, never
written to markdown, never in the user's files.

```
TIER 1   observed live      the store already watches vault changes.
                            On each change event, diff the parsed tasks
                            against the baseline; any task whose synced
                            fields moved gets localEditedAt = now.
                            Accurate to the second.

TIER 2   file mtime         for a change first seen at sync time —
                            Obsidian was closed, or the vault sync
                            dropped it in — use TFile.stat.mtime.
                            Coarse: every task in the file shares it.
                            Bounded below by the last sync, so it is an
                            estimate, not a guess.

TIER 3   ambiguous          the two timestamps are within the fuzz
                            window, or the local one is a tier-2
                            estimate that cannot be separated from the
                            remote. Fall back to Obsidian wins.
```

The baseline is what makes tier 2 honest. It tells us **what** changed; the clock
only has to say roughly **when**. `mtime` is file-wide and therefore useless for
the first job — which is why local-change detection needs the baseline — but for
timestamping a task we have already established changed, it is a reasonable
estimate.

**Whatever the policy decides, the losing value is reported, never discarded
silently**, with a one-click "use theirs" in the report.

### Lossy projection is safe under three-way merge

Pushing `[/]` in-progress to Google's `needsAction` looks destructive. It is not:
remote-unchanged means we do not write, so `[/]` survives every sync untouched.
The loss only materialises when someone genuinely ticks it in Google — and then
turning `[/]` into `[x]` is the correct answer. This is what makes squashing
fourteen fields into Google's six acceptable rather than reckless.

### Loop prevention

**The baseline is always written from the API response body, never from what we
intended to send.** Google bumps `updated` and normalises values on write; record
our intent instead and the next `updatedMin` poll reads our own write back as a
remote change, forever. Locally, our own vault writes fire change events, so the
sync debounces and compares against baseline on that side too.

## Symmetry

| Class | Meaning | A Google-side edit is |
| --- | --- | --- |
| **⇄** | Both sides may write. Three-way merged. | honoured |
| **→** | Obsidian writes it, natively or into the footer. | reverted next sync |
| **←** | Only Google generates it. | honoured, read-only |
| **∅** | Never leaves the vault. | n/a |

| List Vibes | Google | Class | |
| --- | --- | --- | --- |
| title | `title` | ⇄ | markdown verbatim; `#tags` ride inside it |
| `[ ]` `[x]` | `status` | ⇄ | four states to two, see below |
| `[/]` `[-]` | footer | → | true status char recorded |
| note body | `notes`, above the delimiter | ⇄ | free text has no field-wise merge: the policy picks a side wholesale, loser goes to the report |
| `📅 due` | `due` | ⇄ | date only; UTC trap below |
| `⏳ scheduled` | `due` when there is no `📅` | ⇄ (M2) | needs the footer to record which field sourced it, or a changed date returns as a spurious `📅` |
| `✅ done` | `completed` | ⇄ | |
| steps | `parent` | ⇄ | create and complete in M1; re-parenting is reported until M3. Depth ≥2 flattens |
| file order | `position` | → (M3) | unmanaged in M1 and M2; new tasks append |
| `⏫` priority | footer | → | Google has no `starred` field |
| `⏰ reminder` | footer | → | |
| `🔁 repeat` | footer | → | drives the recurrence hand-off |
| `➕ created` | footer | → | |
| `☀️ My Day` | footer | → | |
| `##` sections | footer | → | Google has no sections |
| — | `webViewLink` | ← | offered in the detail panel, not written to the line |
| — | `assignmentInfo` | ← | tasks assigned from Docs or Chat, surfaced read-only |
| icon, colour, view, sort | — | ∅ | |

### Status, four states to two

Push `todo`→`needsAction`, `done`→`completed`, `[/]`→`needsAction`,
`[-]`→`completed` — `isComplete()` already treats cancelled as complete. Pull
applies only when remote changed, so `[/]` and `[-]` are stable until someone
deliberately touches them in Google.

### The UTC trap

Google's `due` is RFC 3339 but date-only in meaning. The documentation is
explicit: the time portion is discarded on write and *"it isn't possible to read
or write the time that a task is scheduled for using the API."*

`src/model/datetime.ts` is local-time throughout. Parse `2026-08-24T00:00:00.000Z`
with `new Date()` in any negative-offset timezone and **every due date shifts back
one day, silently, on every sync** — compounding. The date must be extracted with
UTC getters and must never be routed through the existing local-time helpers.
This is the most likely bug in the feature and gets its own named test.

### Recurrence hand-off

Google's API has no recurrence at all. Tick a `🔁 every week` task on your phone
and the pull marks it `[x]` **through the existing `Mutator`**, so
`nextOccurrence` fires exactly as a local tick would, the new occurrence line
appears, and the next push creates a fresh Google task. Repeating tasks work on
your phone despite Google not supporting them.

The requirement this rests on: **pull never bypasses the Mutator.** No direct
file writes from the sync engine.

## The notes footer (M2)

`notes` is a field the user also types in, so the contract is a split rule, not a
format. Everything above the delimiter is theirs and merges normally. Everything
below is ours and is regenerated wholesale on every push.

```
Remember the pricing table.          <- theirs, ⇄ merged

--- List Vibes ---                   <- delimiter
☀️ My Day · ⏰ 11:00                  <- ours, regenerated
🔁 every week · ⏫ Important
```

Two edges:

- `notes` caps at **8192 characters** and the note field in markdown is
  unbounded. Truncation eats **our footer first and the user's text never**.
- If someone deletes the delimiter in the Google app, the pull must scrub lines
  matching the footer's own generated shape rather than trusting the marker
  alone. Otherwise the next push re-adds a footer and the stale one is now body
  text.

## Deletion, asymmetric on purpose

**Google → Obsidian** is unambiguous. `showDeleted=true` returns real tombstones
with `deleted: true`. Propagate.

**Obsidian → Google** is a guess. A line vanishing could be a deletion, a
half-written file, or a vault sync conflict mid-flight. A vanished line deletes
from Google **only if** the file parsed cleanly *and* that `🆔` was present in the
previous baseline. Anything else is orphaned and reported, never deleted.

An orphan — a baseline entry whose `🆔` is in neither the file nor the remote —
is surfaced in the report with both last-known values and left alone.

## Google API constraints that shape the design

Verified against the live REST reference, 2026-09-01.

- **`showHidden=true` and `showDeleted=true` on every list call, always.**
  Ticking a task in Google's own web or mobile client marks it **hidden**, and
  `showHidden` defaults to `false`. Omit it and completed tasks are absent from
  the response, our deletion logic reads absent-but-in-baseline as deleted, and
  **ticking a task on your phone erases it from the vault.** Named test.
- **`parent` and `position` are read-only fields.** They cannot be patched. Set
  via `tasks.insert?parent=&previous=` and a separate `tasks.move?parent=&previous=`.
  A push that changes order is two calls, not one.
- **Completed and hidden tasks cannot have a parent.** A completed step pushes as
  a top-level completed task and returns with `parent` cleared. Google's
  behaviour, not a conflict — suppress it explicitly or every sync reports a
  phantom re-parenting on every completed step. This lands in M1, because M1
  syncs both steps and completion, and a list with any ticked step hits it
  immediately.
- **Subtasks are exactly one level deep.** Task → subtask, no sub-subtasks. The
  API has enforced this since 30 August 2019, so it is not a UI limitation to
  work around. Steps at depth ≥2 in markdown flatten to depth 1 in Google, order
  preserved. The baseline makes that safe: remote-unchanged means we never write
  the flattened shape back over the real nesting.
- Assigned and repeating tasks can be neither parent nor child. `parent` on
  `insert` and `move` is a query parameter, not a body field.
- `maxResults` defaults to **20**, caps at **100**. Pagination is required.
- **No `watch` method.** Polling on `updatedMin` is the only incremental option.
- `notes` maximum 8192 characters. No `starred` field. No priority field.
- `showAssigned` stays `false` in M1 — assigned tasks belong to Docs and Chat and
  cannot be parented anyway.

## Auth

Bring your own client, loopback redirect, PKCE. Desktop only; the phone already
has the Google Tasks app, which is the point.

```
SETUP, once            console.cloud.google.com
                       → new project → enable Tasks API
                       → OAuth client, type: Desktop
                       → publishing status: In production
                       → paste id + secret into List Vibes

SIGN IN                browser opens → user approves
                       → 127.0.0.1:PORT catches the code
                       → refresh token into data.json
```

**The step that will generate every support issue:** a client left in *Testing*
publishing status hands out refresh tokens that **expire after seven days**. Sync
works beautifully, then dies silently a week later. Publishing status → *In
production* is a numbered step with a screenshot in the guide, not a footnote.
Verify the current behaviour when writing the guide.

Because the credentials are the user's, roughly half the failure modes are their
Cloud Console setup. Errors name the actual cause: *"Tasks API not enabled on
project foo-123"*, not *"sync failed"*.

Scope requested: `https://www.googleapis.com/auth/tasks`.

## Settings and frontmatter

```ts
googleSync: {
  enabled: boolean;
  clientId: string;
  clientSecret: string;          // the user's own, in data.json
  scope: "all" | "selected";
  conflictPolicy: "newest" | "obsidian" | "google";   // default "newest"
  lists: string[];               // file paths, when scope is "selected"
  intervalMinutes: number;       // 0 = manual only
  confirmFirstSync: boolean;     // default true
}
```

Frontmatter, written on first sync through the existing single-key
`setFrontmatterKey` — never `processFrontMatter`, which round-trips the whole
block through a YAML parser and reorders keys:

```yaml
gtasks: MTk0NzIxMzc0NTk...
```

Deselecting a list leaves the key in place, so re-selecting re-pairs to the same
Google list instead of duplicating it.

**First sync of each list is a preview.** It shows what it is about to do to both
the vault and the Google account, and waits. This matches the plugin's existing
promise that nothing drifts, and it is the only defence against a misconfigured
pairing before it writes anything.

## Shape

```
src/sync/
  auth.ts        PKCE, loopback listener, token refresh
  client.ts      Tasks REST calls, pagination, backoff, error translation
  baseline.ts    the cache: load, save, rebuild-from-🆔
  clock.ts       local edit clock: observe, estimate, compare
  project.ts     Task ⇄ GoogleTask field projection, both directions
  footer.ts      notes split rule, render, scrub
  merge.ts       three-way per field, conflict policy
  engine.ts      orchestration: pull, merge, push, report
  report.ts      what happened, what was skipped, what conflicted
```

`project.ts`, `footer.ts`, `merge.ts` and `baseline.ts` are pure — no `App`, no
network, no vault. They are the bulk of the logic and all of the risk, and they
test as plain functions against fixtures the way `src/model/` already does.

`engine.ts` is the only file that touches both the network and the `Mutator`, and
it writes through the `Mutator` exclusively.

Command: `Sync with Google Tasks`.

## Tests

Following the existing `node --test` suite over fixture files.

- **`showHidden`** — a task completed in Google and therefore hidden is not
  treated as deleted. The data-loss case.
- **UTC dates** — round-trip a due date under a forced negative-offset timezone
  and assert it does not drift. Repeat across a DST boundary.
- **Three-way merge** — the full matrix per field: neither, local, remote, both.
- **Edit clock** — a live-observed edit beats an older remote `updated`; an older
  live-observed edit loses to a newer remote; a tier-2 mtime estimate inside the
  fuzz window falls back to Obsidian wins; a discarded baseline yields no clock
  and therefore Obsidian wins for one cycle.
- **Policy** — the same conflict resolves three ways under `newest`, `obsidian`
  and `google`, and reports the loser in all three.
- **Lossy projection** — `[/]` and `[-]` survive N syncs with no remote change.
- **Subtasks** — a step pushes under its parent; a subtask created in Google
  arrives as an indented step; a step at depth ≥2 flattens to depth 1 without
  the flattened shape being written back over the real nesting; completing a step
  does not produce a phantom re-parenting report.
- **Loop prevention** — a push followed by a poll produces zero writes.
- **Footer split** — user text preserved; footer regenerated; delimiter deleted
  in Google and recovered; 8192-char truncation eats the footer not the text.
- **Deletion** — tombstone propagates; vanished line with clean parse propagates;
  vanished line with a parse error does not; orphan is reported not deleted.
- **Recurrence** — remote tick on a `🔁` task writes the next occurrence.
- **Pagination** — more than 100 tasks in a list.

## Documentation

Both land in the implementation PRs, not ahead of them.

- **README** — new `## Google Tasks sync` section straight after `## Storage
  format`, since it extends that section's field table. Carries the four
  symmetry classes, the field table, a worked footer example, and the loop and
  UTC notes at one line each. Plus three one-liners: a bullet under Features, the
  command under Commands, the settings in the settings prose.
- **`docs/google-tasks-setup.md`** — the Cloud Console walkthrough, with the *In
  production* step and its screenshot. Linked from the README, not inlined.

## Open items

- Verify the seven-day refresh token expiry for Testing-status clients against
  current Google documentation before writing the setup guide.
- Confirm empirically that Google clears `parent` on completion, rather than
  rejecting the write, and suppress accordingly.
- Confirm the loopback port range against Google's current redirect-URI rules.
  The design assumes a fixed range of three ports, each registered by hand during
  setup, because an ephemeral port cannot be pre-registered and the user is the
  one doing the registering.
