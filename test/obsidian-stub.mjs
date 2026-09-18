/**
 * Node-side stand-in for the `obsidian` module, so the write path (mutate.ts)
 * can be tested against an in-memory vault. Only the surface Mutator touches.
 */

export class TFile {
	constructor(path, vault) {
		this.path = path;
		this.vault = vault;
		this.extension = path.split(".").pop();
		this.parent = { path: path.split("/").slice(0, -1).join("/") };
	}
}

export class TFolder {
	constructor(path) {
		this.path = path;
		this.children = [];
	}
}

export class MarkdownView {}
export class Notice {}
export class Menu {}
export class Modal {}
export class Setting {}
export class PluginSettingTab {}
export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export function setIcon() {}
export function normalizePath(p) {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export const Platform = { isMobile: false };

/**
 * An in-memory vault. `files` maps path -> content.
 *
 * `openEditors` decides which branch Mutator takes: a path listed there is
 * treated as open in an editor (Editor API path), otherwise it goes through
 * Vault.process. Both are implemented so the two branches can be tested
 * against identical expectations.
 */
export function makeApp(files, openEditors = []) {
	const store = new Map(Object.entries(files));

	/*
	 * Which write path each edit took.
	 *
	 * Both paths land in the same store, so the result cannot tell them apart —
	 * and the rule the Mutator states is about the path, not the result: an open
	 * file has to be written through the editor or the cursor, selection and
	 * folds are lost when the file watcher reconciles.
	 */
	const paths = { process: 0, editor: 0 };

	const editorFor = (path) => {
		const lines = () => store.get(path).split("\n");
		return {
			lineCount: () => lines().length,
			lastLine: () => lines().length - 1,
			getLine: (n) => lines()[n],
			setLine: (n, text) => {
				paths.editor++;
				const l = lines();
				l[n] = text;
				store.set(path, l.join("\n"));
			},
			getValue: () => store.get(path),
			setValue: (v) => store.set(path, v),
			transaction: (tx) => {
				paths.editor++;
				// Only the whole-document replacement shape the Mutator uses.
				for (const c of tx.changes ?? []) {
					const l = lines();
					const head = l.slice(0, c.from.line);
					const tail = c.to ? l.slice(c.to.line + 1) : [];
					store.set(path, [...head, c.text, ...tail].join("\n"));
				}
			},
			replaceRange: (replacement, from, to) => {
				const l = lines();
				if (!to) {
					// Insertion at from.
					const head = l.slice(0, from.line);
					const tail = l.slice(from.line);
					const inserted = replacement.replace(/\n$/, "").split("\n");
					const merged =
						replacement.startsWith("\n") && from.line >= l.length
							? [...l, ...replacement.replace(/^\n/, "").split("\n")]
							: [...head, ...inserted, ...tail];
					store.set(path, merged.join("\n"));
					return;
				}
				// Deletion of [from.line, to.line).
				const l2 = lines();
				l2.splice(from.line, to.line - from.line);
				store.set(path, l2.join("\n"));
			},
		};
	};

	const folders = new Set();

	return {
		__store: store,
		__paths: paths,
		vault: {
			/*
			 * Folders exist here only as a set of names. The real vault has
			 * TFolder objects, but nothing the Mutator does with a folder needs
			 * more than "is it there" and "make it" — and pretending otherwise
			 * would be inventing behaviour to test against.
			 */
			getAbstractFileByPath: (p) =>
				store.has(p) ? new TFile(p) : folders.has(p) ? { path: p } : null,
			createFolder: async (p) => {
				folders.add(p);
			},
			create: async (p, data) => {
				if (store.has(p)) throw new Error(`already exists: ${p}`);
				store.set(p, data);
				return new TFile(p);
			},
			cachedRead: async (f) => store.get(f.path),
			read: async (f) => store.get(f.path),
			process: async (f, fn) => {
				paths.process++;
				const next = fn(store.get(f.path));
				store.set(f.path, next);
				return next;
			},
		},
		fileManager: {
			renameFile: async (file, target) => {
				const content = store.get(file.path);
				store.delete(file.path);
				store.set(target, content);
			},
		},
		workspace: {
			getLeavesOfType: (type) =>
				type !== "markdown"
					? []
					: openEditors.map((path) => ({
							view: { file: { path }, editor: editorFor(path) },
						})),
		},
	};
}
