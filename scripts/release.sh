#!/usr/bin/env bash
#
# Cut a release, in the order that protected main and squash merges allow.
#
#   ./scripts/release.sh patch      # or minor / major
#
# The obvious sequence — bump, tag, push — quietly breaks here. `npm version`
# tags the commit on your branch; a squash merge then replaces that commit with
# a different one on main, and the tag is left pointing at an object that is not
# in main's history. The release still builds, but `git log` on main will never
# show where it came from.
#
# So the tag comes last, after the merge, on the commit that actually landed.
set -euo pipefail

BUMP="${1:-patch}"
case "$BUMP" in patch|minor|major) ;; *) echo "usage: $0 patch|minor|major"; exit 1 ;; esac

cd "$(git rev-parse --show-toplevel)"

# A stale lock, or a half-applied bump from a run that died, both look like
# nothing is wrong until `npm version` writes on top of them. This is the check
# that would have caught it.
for lock in .git/index.lock .git/HEAD.lock; do
	if [ -e "$lock" ]; then
		echo "error: $lock exists — a git process died here." >&2
		echo "       No git is running? Then: rm -f $lock" >&2
		exit 1
	fi
done

git switch main -q
if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "error: uncommitted changes on main:" >&2
	git status --short | sed 's/^/       /' >&2
	echo "       Commit them, or discard: git checkout -- ." >&2
	exit 1
fi

git pull -q
CURRENT=$(node -p "require('./manifest.json').version")

# The bump, without a tag: this commit is going to be replaced by the squash.
npm version "$BUMP" --no-git-tag-version >/dev/null
NEXT=$(node -p "require('./manifest.json').version")
echo "==> $CURRENT -> $NEXT"

if ! grep -q "^## $NEXT\$" CHANGELOG.md; then
  cat <<MSG

CHANGELOG.md has no "## $NEXT" section.

The release notes are taken from it, so write that section first — what
changed, in words somebody deciding whether to update would care about —
then run this again. Reverting the version bump:
MSG
  git checkout -- package.json manifest.json versions.json
  exit 1
fi

BRANCH="release-$NEXT"
git switch -c "$BRANCH" -q
git add -A
git commit -qm "$NEXT"
git push -u origin "$BRANCH" -q
echo "    pushed $BRANCH"

gh pr create --fill --title "$NEXT" --body "Release $NEXT. Notes in CHANGELOG.md." >/dev/null
echo "    PR opened — waiting for CI checks"
gh pr merge --squash --auto --delete-branch >/dev/null
gh pr checks --watch || { echo "::error:: checks failed — nothing tagged"; exit 1; }

# The merge is what gets tagged, not the branch commit that no longer exists.
git switch main -q
for _ in $(seq 1 30); do
  git pull -q
  [ "$(node -p "require('./manifest.json').version")" = "$NEXT" ] && break
  sleep 5
done

if [ "$(node -p "require('./manifest.json').version")" != "$NEXT" ]; then
  echo "::error:: main is not at $NEXT yet — merge it, then: git tag $NEXT && git push --tags"
  exit 1
fi

git tag "$NEXT"
git push --tags -q
echo "    tagged $NEXT on main — the release workflow is building it"
echo
echo "Watch it: gh run watch"
