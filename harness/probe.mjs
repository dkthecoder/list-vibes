import { chromium } from 'playwright';
const url = 'file://' + process.cwd() + '/harness/index.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const theme of ['light','dark']) {
  const p = await b.newPage({ viewport: { width: 1180, height: 1320 } });
  await p.goto(url);
  if (theme==='dark') await p.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await p.waitForTimeout(200);
  const out = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#desktop .lv-nav-row')];
    return rows.map(r => {
      const label = r.textContent.trim().slice(0,20);
      const cs = getComputedStyle(r);
      const accent = cs.getPropertyValue('--lv-accent').trim();
      const bar = r.querySelector('.lv-nav-bar, .lv-list-bar, [class*=bar]');
      const barColor = bar ? getComputedStyle(bar).backgroundColor : null;
      const barW = bar ? getComputedStyle(bar).width : null;
      return { label, accent, barColor, barW, cls: r.className };
    });
  });
  console.log('==', theme);
  for (const r of out) console.log(JSON.stringify(r));
}
await b.close();
