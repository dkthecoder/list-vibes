/**
 * Where the list's name shows.
 *
 * Obsidian draws the view title in `.view-header` — but only in some
 * placements, and one of them depends on a setting the user can change while
 * the view is open. Deciding this in TypeScript got the "title bar turned off"
 * case wrong and left the list unnamed, so the rule lives in CSS and this
 * checks it against every placement Obsidian actually uses.
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1180, height: 900 } });
await p.goto("file://" + process.cwd() + "/harness/index.html");
await p.waitForTimeout(250);

// Reproduce the four placements Obsidian actually puts the view in, by
// wrapping a rendered pane in the ancestry each one has.
const r = await p.evaluate(() => {
  const src = document.querySelector("#drag .lv-root, #drag");
  const shown = (bodyCls, wrapCls) => {
    document.body.className = bodyCls;
    const host = document.createElement("div");
    host.className = wrapCls;
    const clone = src.cloneNode(true);
    host.appendChild(clone);
    document.body.appendChild(host);
    const t = clone.querySelector(".lv-header-title");
    const d = t ? getComputedStyle(t).display : "missing";
    host.remove();
    return d;
  };
  return {
    // desktop main tab, title bar on -> both show; ours carries the icon and
    // the inline rename, and being absent is worse than being doubled
    mainTabHeaderOn: shown("show-view-header", "workspace-split mod-root"),
    // desktop main tab, title bar off -> nobody draws it unless we do
    mainTabHeaderOff: shown("", "workspace-split mod-root"),
    // sidebar -> .view-header is hidden there, so ours shows
    sidebar: shown("show-view-header", "workspace-split mod-left-split"),
    // phone main tab -> .view-header always shown, ours must hide
    phoneMainTab: shown("show-view-header is-phone is-mobile", "workspace-split mod-root"),
    // phone drawer -> .view-header hidden, ours shows
    phoneDrawer: shown("show-view-header is-phone is-mobile", "workspace-drawer"),
  };
});
const want = { mainTabHeaderOn: "flex", mainTabHeaderOff: "flex", sidebar: "flex",
               phoneMainTab: "none", phoneDrawer: "flex" };
let bad = 0;
for (const [k, v] of Object.entries(want)) {
  const ok = r[k] === v;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${k}: ${r[k]} (want ${v})`);
}
console.log(bad ? `\n${bad} placement(s) wrong` : "\nall five placements correct");
await b.close();
process.exit(bad ? 1 : 0);
