/**
 * The Obsidian store runs an automated scan on submission. `eslint-plugin-obsidianmd`
 * is that scan, so running it here means finding out now rather than in review.
 */
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	{ ignores: ["main.js", "harness/bundle.js", "test/build/**", "test/*.mjs", "node_modules/**"] },
	...tseslint.configs.recommended,
	...obsidianmd.configs.recommended,
	{
		languageOptions: { parserOptions: { projectService: true } },
		rules: {
			// The plugin owns its own DOM; `any` is not needed to describe it.
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],

			/*
			 * Below are the rules this codebase does not currently satisfy.
			 *
			 * They are warnings rather than "off" on purpose: silencing a rule
			 * hides the debt, and each of these is a real thing somebody should
			 * decide about rather than a thing that has been decided. CI fails on
			 * errors, so the build is honest without the list being invisible.
			 */

			/*
			 * The rule cannot tell a proper noun from a sentence, and everything
			 * it flags here is one: "List Vibes" is the plugin's name, "My Day"
			 * is a view's, "Google Keep" is somebody else's. Lowercasing them to
			 * satisfy it would make the UI worse, not more consistent.
			 */
			"obsidianmd/ui/sentence-case": "off",

			/*
			 * Wants the settings tab to declare itself through
			 * `getSettingDefinitions()`, which would let Obsidian's global search
			 * find individual settings. A genuine improvement and a rewrite of
			 * every setting in the tab, so it is a warning until somebody does it
			 * on purpose rather than in passing.
			 */
			"obsidianmd/settings-tab/prefer-setting-definitions": "warn",
		},
	}
);
