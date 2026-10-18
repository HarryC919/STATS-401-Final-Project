/* Touch-emulated browser acceptance. Serve site/ and use the README QA environment. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/.test(document.querySelector('#load-status').textContent))
    .catch(async error=>{throw new Error(`Dashboard did not settle: ${await page.locator('#load-status').innerText()}`,{cause:error});});
}
async function swipe(page, from, to) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[from] });
    for (let i=1;i<=12;i++) {
      await session.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{
        x:from.x+(to.x-from.x)*i/12, y:from.y+(to.y-from.y)*i/12 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  } finally { await session.detach(); }
}
(async () => {
  const browser = await chromium.launch({ headless:true,
    ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:1 });
    const page = await context.newPage(); const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await settled(page);
    assert.equal(await page.locator('#filters-disclosure').count(), 1, 'phone filters have a collapsible container');
    assert.equal(await page.locator('#filters-disclosure').getAttribute('open'), null);
    assert.equal(await page.locator('#method-disclosure').getAttribute('open'), null);
    assert.match(await page.locator('#compact-filter-summary').innerText(), /full year 2025/);
    const assets=path.join(root,'docs/assets/touch'); await fs.mkdir(assets,{recursive:true});
    const layouts=[];
    for (const [width,height] of [[320,740],[390,844],[844,390],[768,1024]]) {
      await page.setViewportSize({width,height});
      await page.waitForFunction(() => document.querySelector('#networkMap').getBoundingClientRect().width <= innerWidth);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page stays within the viewport');
      const targets=await page.locator('.tab-btn').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
      assert.ok(targets.every(height=>height>=44), 'touch navigation targets are at least 44px high');
      assert.equal(await page.locator('#network-touch-legend').isVisible(), true);
      layouts.push({width,height,overflow:false});
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#tab-network').screenshot({path:path.join(assets,'map-phone.png')});
    await page.locator('#networkMap').scrollIntoViewIfNeeded();
    const routePoint=await page.locator('#networkMap').evaluate(svg=>{
      const nodes=[...svg.querySelectorAll('.map-node')].map(node=>node.getBoundingClientRect());
      for (const mark of svg.querySelectorAll('.touch-route-target')) {
        for (let f=.1; f<.9; f+=.05) {
          const p=mark.getPointAtLength(mark.getTotalLength()*f);
          const q=new DOMPoint(p.x,p.y).matrixTransform(mark.getScreenCTM());
          if (nodes.some(r=>Math.hypot(q.x-r.left-r.width/2,q.y-r.top-r.height/2)<10)) continue;
          if (document.elementFromPoint(q.x,q.y)===mark) return {x:q.x,y:q.y};
        }
      }
      return null;
    });
    assert.ok(routePoint,'an enlarged route target can be reached away from city nodes');
    await page.touchscreen.tap(routePoint.x,routePoint.y);
    await page.locator('#touch-details').waitFor({state:'visible'});
    assert.match(await page.locator('#touch-detail-content').innerText(),/City pair/);
    await page.locator('#touch-detail-close').tap();
    await page.locator('[data-tab="tab-monthly"]').tap(); await settled(page);
    await page.locator('#monthlyChart circle').first().tap();
    await page.locator('#touch-details').waitFor({state:'visible'});
    assert.match(await page.locator('#touch-detail-content').innerText(), /Month 1[\s\S]*rate:/);
    await page.locator('#touch-details').screenshot({path:path.join(assets,'point-details.png')});
    await page.locator('#touch-detail-close').tap();
    assert.equal(await page.locator('#touch-details').isVisible(),false);
    // Horizontal scrolling is contained by the chart, not the whole card/page.
    const scroll=page.locator('#tab-monthly .chart-scroll');
    await scroll.scrollIntoViewIfNeeded(); const sb=await scroll.boundingBox();
    await swipe(page,{x:sb.x+sb.width-35,y:sb.y+65},{x:sb.x+35,y:sb.y+65});
    await page.waitForFunction(()=>document.querySelector('#tab-monthly .chart-scroll').scrollLeft>0);
    assert.equal(await page.locator('#touch-details').isVisible(),false,'a swipe does not open details');
    await page.locator('[data-tab="tab-airport"]').tap(); await settled(page);
    const target=page.locator('#airportChart .bar').first();
    const expected=await target.evaluate(n=>n.__data__.Origin);
    await page.locator('#tab-airport .chart-scroll').scrollIntoViewIfNeeded();
    const bar=await target.boundingBox();
    await page.touchscreen.tap(Math.max(50,bar.x+20),bar.y+bar.height/2);
    await page.locator('#touch-details').waitFor({state:'visible'});
    assert.equal(await page.locator('#airport-search').inputValue(),'','inspection does not select an airport');
    await page.locator('#touch-detail-action').tap(); await settled(page);
    assert.match(await page.locator('#airport-search').inputValue(),new RegExp(`^${expected} — `));
    assert.equal(await page.locator('.tab-panel.active').getAttribute('id'),'tab-airport');
    await page.locator('[data-tab="tab-network"]').tap(); await settled(page);
    const chicago=await page.locator('.map-node').evaluateAll(nodes=>nodes.findIndex(n=>n.__data__.city==='Chicago, IL'));
    await page.locator('.map-node').nth(chicago).tap();
    assert.equal(await page.locator('#airport-chooser').isVisible(),false,'city inspection waits for an explicit selection action');
    await page.locator('#touch-detail-action').tap();
    await page.locator('#airport-chooser button').filter({hasText:/^ORD —/}).tap(); await settled(page);
    assert.match(await page.locator('#airport-search').inputValue(),/^ORD —/);
    await page.locator('[data-tab="tab-scatter"]').tap(); await settled(page);
    assert.equal(await page.locator('#scatter-brush-toggle').getAttribute('aria-pressed'),'false');
    assert.ok(await page.locator('#filter-bar select').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0)
      .every(n=>n.getBoundingClientRect().height>=44)),'touch filter targets are at least 44px high');
    assert.equal(await page.locator('#scatterChart .scatter-brush').count(),0);
    await page.locator('#tab-scatter .chart-scroll').scrollIntoViewIfNeeded();
    const vb=await page.locator('#scatterChart').boundingBox();
    const before=await page.evaluate(()=>scrollY);
    await swipe(page,{x:Math.min(300,vb.x+240),y:vb.y+200},{x:Math.min(300,vb.x+240),y:vb.y+70});
    await page.waitForFunction(y=>scrollY>y,before);
    assert.equal(await page.locator('#scatterChart .selection').count(),0);
    await page.locator('#scatter-brush-toggle').tap(); await settled(page);
    assert.equal(await page.locator('#scatter-brush-toggle').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#scatterChart .scatter-brush').count(),1);
    await page.locator('#tab-scatter .chart-scroll').scrollIntoViewIfNeeded();
    const bb=await page.locator('#scatterChart').boundingBox();
    await swipe(page,{x:bb.x+140,y:bb.y+150},{x:bb.x+270,y:bb.y+250});
    await page.waitForFunction(()=>document.querySelector('#scatterChart .selection')?.getAttribute('width')>0);
    assert.match(await page.locator('#scatter-brush-count').innerText(),/Brushed:/);
    await page.locator('#filters-disclosure summary').tap();
    await page.locator('#filter-reset').tap(); await settled(page);
    await page.locator('[data-tab="tab-scatter"]').tap(); await settled(page);
    assert.equal(await page.locator('#scatter-brush-toggle').getAttribute('aria-pressed'),'false');
    const ordOption=await page.locator('#airport-touch-select option').evaluateAll(options=>options.find(option=>option.textContent.startsWith('ORD —')).value);
    await page.locator('#airport-touch-select').selectOption(ordOption); await settled(page);
    assert.match(await page.locator('#airport-search').inputValue(),/^ORD —/);
    assert.match(await page.locator('#compact-filter-summary').innerText(),/detail: ORD/);
    // Visit every view using touch, including lazy-loaded charts.
    const tabs=await page.locator('.tab-btn').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab));
    for (const tab of tabs) {
      await page.locator(`[data-tab="${tab}"]`).tap(); await settled(page);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tab}: no page overflow`);
      const panel=page.locator(`#${tab}`);
      const plot=panel.locator('.chart-scroll').first();
      if (await plot.count()) await plot.scrollIntoViewIfNeeded();
      else await page.locator('#networkMap').scrollIntoViewIfNeeded();
      // Find a visible, exposed mark using its real hit-test, then tap it.
      const point=await panel.evaluate(panel=>{
        const candidates=[...panel.querySelectorAll('svg *')];
        candidates.sort((a,b)=>Number(b.tagName==='circle')-Number(a.tagName==='circle'));
        for (const mark of candidates) {
          if (!d3.select(mark).on('mousemove')) continue;
          const r=mark.getBoundingClientRect();
          for (const fx of [.5,.2,.8]) for (const fy of [.5,.2,.8]) {
            const x=r.left+r.width*fx, y=r.top+r.height*fy;
            if (x<28||x>innerWidth-28||y<5||y>innerHeight-5) continue;
            if (document.elementFromPoint(x,y)===mark) return {x,y};
          }
        }
        return null;
      });
      assert.ok(point,`${tab}: an inspectable mark is reachable by touch`);
      await page.touchscreen.tap(point.x,point.y);
      await page.locator('#touch-details').waitFor({state:'visible',timeout:5000}).catch(error=>{
        throw new Error(`${tab}: tapped mark did not open details (${JSON.stringify(point)})`,{cause:error});
      });
      assert.ok((await page.locator('#touch-detail-content').innerText()).length>0);
      await page.locator('#touch-detail-close').tap();
      await page.setViewportSize({width:320,height:740});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tab}: no 320px page overflow`);
      await page.setViewportSize({width:390,height:844});
    }
    assert.deepEqual(errors,[]);
    const hashes={};
    for (const file of ['site/index.html','site/css/style.css','site/js/app.js','site/js/charts.js','site/js/touch.js'])
      hashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
    await fs.writeFile(path.join(root,'reports/site_validation_touch.json'),JSON.stringify({checks:'passed',browser:browser.version(),layouts,
      checked:['phone disclosures and scope summary','44px touch navigation','full-width map and separate phone legend',
        'tap-to-inspect and explicit airport selection','enlarged route hit areas preserve visible line widths','native airport picker and scope summary','touch chart scrolling without accidental selection',
        'scatter scroll by default and opt-in touch brushing','Reset exits touch brush mode','tap details in all ten views','320px layout in all ten views'],
      notChecked:['physical iOS/Android devices','Safari/WebKit','live deployment','participant study'],source_sha256:hashes},null,2)+'\n');
    console.log(JSON.stringify({checks:'passed',layouts:layouts.length,views:tabs.length}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
