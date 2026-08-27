import { launch } from "./browser.mjs";
const url = 'file://' + process.cwd() + '/harness/index.html';
const b = await launch();
for (const theme of ['light','dark']) {
  const p = await b.newPage({ viewport: { width: 1180, height: 1320 }, deviceScaleFactor: 2 });
  const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  p.on('pageerror', e=>errs.push(String(e)));
  await p.goto(url);
  if (theme==='dark') await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `harness/shot-${theme}.png`, fullPage: true });
  if (errs.length) console.log(theme.toUpperCase()+' ERRORS:', errs.slice(0,8));
  await p.close();
}
await b.close();
console.log('done');
