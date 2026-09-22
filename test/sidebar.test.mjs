import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ListsPlugin from "./build/plugin/main.js";

const TYPE = "list-vibes-view";

/*
 * The wiring, not the decision.
 *
 * chooseSidebarLeaf is unit-tested next door; what is tested here is that
 * activateView asks it about the right container and acts on the answer —
 * which is the half that was actually broken.
 */
function fakeWorkspace({ tabs = 0, inSidebar = 0, side = "left" } = {}) {
	const rootSplit = { name: "root" };
	const leftSplit = { name: "left" };
	const rightSplit = { name: "right" };
	const sideSplit = side === "left" ? leftSplit : rightSplit;
	const revealed = [];
	const created = [];

	const leaf = (root, label) => ({
		label,
		getRoot: () => root,
		view: { getViewType: () => TYPE },
		setViewState: async () => {},
	});

	// getLeavesOfType walks rootSplit first, then the sidebars — the ordering
	// that caused the bug, reproduced here rather than assumed.
	const leaves = [
		...Array.from({ length: tabs }, (_, i) => leaf(rootSplit, `tab${i}`)),
		...Array.from({ length: inSidebar }, (_, i) => leaf(sideSplit, `side${i}`)),
	];

	return {
		rootSplit,
		leftSplit,
		rightSplit,
		revealed,
		created,
		getLeavesOfType: (t) => (t === TYPE ? leaves : []),
		revealLeaf: async (l) => void revealed.push(l.label),
		getLeftLeaf: () => {
			const l = leaf(leftSplit, "new-left");
			created.push("left");
			return l;
		},
		getRightLeaf: () => {
			const l = leaf(rightSplit, "new-right");
			created.push("right");
			return l;
		},
		ensureSideLeaf: async () => {
			created.push("ensureSideLeaf");
			return leaf(sideSplit, "ensured");
		},
	};
}

/** Build the plugin without running onload, which wants a real Obsidian. */
function pluginWith(workspace, side = "left") {
	const p = Object.create(ListsPlugin.prototype);
	p.app = { workspace };
	p.settings = { side };
	return p;
}

describe("activateView picks the sidebar leaf", () => {
	test("reveals the sidebar picker, not the first open tab", async () => {
		const ws = fakeWorkspace({ tabs: 3, inSidebar: 1 });
		await pluginWith(ws).activateView();
		assert.deepEqual(ws.revealed, ["side0"], "should reveal the sidebar leaf");
		assert.deepEqual(ws.created, [], "and should not build another");
	});

	test("builds one in the sidebar when only tabs are open", async () => {
		const ws = fakeWorkspace({ tabs: 4, inSidebar: 0 });
		await pluginWith(ws).activateView();
		assert.deepEqual(ws.created, ["left"], "should build in the left sidebar");
		assert.deepEqual(ws.revealed, ["new-left"]);
	});

	test("honours the right-hand side setting", async () => {
		const ws = fakeWorkspace({ tabs: 2, inSidebar: 0, side: "right" });
		await pluginWith(ws, "right").activateView();
		assert.deepEqual(ws.created, ["right"]);
	});

	test("a leaf in the other sidebar is not the one asked for", async () => {
		const ws = fakeWorkspace({ tabs: 0, inSidebar: 1, side: "right" });
		// Plugin is set to "left"; the existing leaf is on the right.
		await pluginWith(ws, "left").activateView();
		assert.deepEqual(ws.created, ["left"], "should build on the left anyway");
	});

	test("never reuses ensureSideLeaf when a tab is open", async () => {
		// ensureSideLeaf takes the first leaf of the type found anywhere, which
		// with a tab open is the tab — the reason it is no longer the path.
		const ws = fakeWorkspace({ tabs: 5, inSidebar: 0 });
		await pluginWith(ws).activateView();
		assert.ok(!ws.created.includes("ensureSideLeaf"));
	});
});
