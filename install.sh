#!/usr/bin/env bash
# Build List Vibes and install it into an Obsidian vault.
#   ./install.sh "/path/to/your/vault"
set -euo pipefail

VAULT="${1:-}"
if [ -z "$VAULT" ]; then
	echo "usage: ./install.sh /path/to/your/vault" >&2
	exit 1
fi
if [ ! -d "$VAULT/.obsidian" ]; then
	echo "error: $VAULT does not look like an Obsidian vault (no .obsidian folder)" >&2
	echo "       open it in Obsidian once first, then try again" >&2
	exit 1
fi

npm run build

DEST="$VAULT/.obsidian/plugins/list-vibes"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"

echo
echo "Installed to $DEST"
echo
echo "Next:"
echo "  1. In Obsidian: Settings -> Community plugins -> enable \"List Vibes\""
echo "     (if this is a fresh vault, turn off Restricted mode first)"
echo "  2. Make a folder called \"lists\" in the vault, one .md file per list"
echo "  3. Click the checklist icon in the ribbon, or run \"Open List Vibes\""
