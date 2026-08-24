#!/usr/bin/env bash
# Install the built plugin into an Obsidian vault.
#   ./install.sh "/path/to/your/vault"
set -euo pipefail

VAULT="${1:-}"
if [ -z "$VAULT" ]; then
	echo "usage: ./install.sh /path/to/your/vault" >&2
	exit 1
fi
if [ ! -d "$VAULT/.obsidian" ]; then
	echo "error: $VAULT does not look like an Obsidian vault (no .obsidian folder)" >&2
	exit 1
fi

npm run build

DEST="$VAULT/.obsidian/plugins/lists"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"

echo "Installed to $DEST"
echo
echo "Next:"
echo "  1. In Obsidian: Settings -> Community plugins -> enable \"Lists\""
echo "  2. Create a folder called \"lists\" in the vault, with one .md file per list"
echo "  3. Click the list icon in the ribbon, or run the \"Open lists\" command"
