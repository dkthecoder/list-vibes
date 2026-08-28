#!/usr/bin/env bash
#
# Cut a release, in the order that protected main and squash merges allow.
#
#   ./scripts/release.sh patch      # or minor / major
#
# The obvious sequence — bump, tag, push — quietly breaks here. `npm version`
# tags the commit on your branch; a squash merge then replaces that commit with
# a different one on main, and the tag is left pointing at an object that is not
# in main's history. The release still builds, but nothing on main says where it
# came from. So the tag comes last, on the commit that actually landed.
#
# Resumable. A release is four things that can each fail on their own — a
# branch, a PR, a green build, a tag — and a script that can only start from
# nothing turns one flaky step into "delete everything and try again". Each
# stage below checks whether it has already happened.
#
set -euo pipefail

BUMP="${1:-patch}"
case "$BUMP" in patch|minor|major) ;; *) echo "usage: $0 patch|minor|major" >&2; exit 1 ;; esac

cd "$(git rev-parse --show-toplevel)"

# A stale lock, or a half-applied bump from a run that died, both look like
# nothing is wrong until `npm version` writes on top of them.
for lock in .git/index.lock .git/HEAD.lock; do
	if [ -e "$lock" ]; then
		echo "error: $lock exists — a git process died here." >&2
		echo "       No git running? Then: rm -f $lock" >&2
		exit 1
	fi
done

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ---- 1. Which version are we releasing? ---------------------------------
# Already on a release branch means this is a resumed run, and the version has
# been decided. Bumping again would silently release something else.
if [[ "$CURRENT_BRANCH" == release-* ]]; then
	NEXT="${CURRENT_BRANCH#release-}"
	echo "==> resuming $NEXT"
	if [ "$(node -p "require('./manifest.json').version")" != "$NEXT" ]; then
		echo "error: on $CURRENT_BRANCH but manifest says $(node -p "require('./manifest.json').version")" >&2
		exit 1
	fi
else
	git switch main -q
	if ! git diff --quiet || ! git diff --cached --quiet; then
		echo "error: uncommitted changes on main:" >&2
		git status --short | sed 's/^/       /' >&2
		exit 1
	fi
	git pull -q
	CURRENT=$(node -p "require('./manifest.json').version")
	npm version "$BUMP" --no-git-tag-version >/dev/null
	NEXT=$(node -p "require('./manifest.json').version")
	echo "==> $CURRENT -> $NEXT"
fi

if ! grep -q "^## $NEXT\$" CHANGELOG.md; then
	echo >&2
	echo "CHANGELOG.md has no \"## $NEXT\" section, and the release notes come" >&2
	echo "from it. Write that section, then run this again." >&2
	git checkout -- package.json package-lock.json manifest.json versions.json 2>/dev/null || true
	exit 1
fi

# ---- 2. The branch ------------------------------------------------------
BRANCH="release-$NEXT"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
	if git show-ref --quiet "refs/heads/$BRANCH"; then
		echo "    $BRANCH already exists — switching to it"
		# No stash: switch carries the bump over by itself, and a real conflict
		# should stop the release rather than be buried in the stash list.
		git switch "$BRANCH" -q
	else
		git switch -c "$BRANCH" -q
	fi
fi

if [ -n "$(git status --porcelain)" ]; then
	git add -A
	git commit -qm "$NEXT"
	echo "    committed"
fi
git push -u origin "$BRANCH" -q 2>/dev/null || git push -q
echo "    pushed $BRANCH"

# ---- 3. The pull request ------------------------------------------------
if gh pr view "$BRANCH" --json number -q .number >/dev/null 2>&1; then
	echo "    PR already open"
else
	gh pr create --fill --title "$NEXT" --body "Release $NEXT. Notes in CHANGELOG.md." >/dev/null
	echo "    PR opened"
fi
gh pr merge "$BRANCH" --squash --auto --delete-branch >/dev/null 2>&1 || true

echo "==> waiting for CI checks"
if ! gh pr checks "$BRANCH" --watch; then
	echo >&2
	echo "Checks failed. Nothing tagged, nothing released. The failing log:" >&2
	echo "    gh run view --log-failed" >&2
	echo "Fix, push to $BRANCH, then run this again — it will resume." >&2
	exit 1
fi

# ---- 4. The tag, on the commit that landed ------------------------------
echo "==> waiting for the squash to land on main"
git switch main -q
for _ in $(seq 1 40); do
	git pull -q
	[ "$(node -p "require('./manifest.json').version")" = "$NEXT" ] && break
	sleep 5
done

if [ "$(node -p "require('./manifest.json').version")" != "$NEXT" ]; then
	echo "error: main is not at $NEXT yet. Merge the PR, then:" >&2
	echo "       git switch main && git pull && git tag $NEXT && git push --tags" >&2
	exit 1
fi

if git rev-parse "refs/tags/$NEXT" >/dev/null 2>&1; then
	echo "    $NEXT already tagged"
else
	git tag "$NEXT"
fi
git push --tags -q
echo "    tagged $NEXT on main — the release workflow is building it"
echo
echo "Watch it:  gh run watch"
