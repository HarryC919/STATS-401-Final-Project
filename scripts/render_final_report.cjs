/* Capture final-report figures at explicit annual, all-airline/all-airport scope. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/.test(document.querySelector('#load-status').textContent));
}
(async () => {
  const browser = await chromium.launch({ headless:true,
    ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.SITE_URL || 'http://127.0.0.1:8765/'); await settled(page);
    const assets=path.join(root,'docs/assets/final-report'); await fs.mkdir(assets,{recursive:true});
    const figures=[];
    for (const [tab,id,file] of [
      ['temporal','temporalHeatmap','temporal-annual.png'],
      ['cause-compare','causeCompareChart','causes-airports-annual.png'],
      ['scatter','scatterChart','scatter-airports-annual.png'],
    ]) {
      await page.locator(`[data-tab="tab-${tab}"]`).click(); await settled(page);
      assert.equal(await page.locator('#month-start').inputValue(),'1');
      assert.equal(await page.locator('#month-end').inputValue(),'12');
      assert.equal(await page.locator('#airline-select').inputValue(),'');
      assert.equal(await page.locator('#airport-search').inputValue(),'');
      await page.locator(`#${id}`).screenshot({path:path.join(assets,file)});
      figures.push({file:`docs/assets/final-report/${file}`,scope:'Full-year 2025, all reporting airlines and origin airports'});
    }
    const findings=JSON.parse(await fs.readFile(path.join(root,'reports/final_report_findings.json')));
    const points=await page.locator('#scatterChart .scatter-point').evaluateAll(nodes=>nodes.map(node=>node.__data__));
    assert.equal(points.length,findings.volume.all.airports);
    // Reconcile the plotted population with the exact source observations used by the analysis.
    const expected=await page.evaluate(async()=>{
      const rows=await d3.csv('data/airport_annual.csv',d3.autoType);
      return rows.filter(row=>row.eligible_arrivals>0).map(row=>({id:String(row.OriginAirportID),volume:row.scheduled_flights,rate:row.delayed_arrivals/row.eligible_arrivals}));
    });
    for (const point of points) {
      const row=expected.find(row=>row.id===String(point.id));
      assert.ok(row); assert.equal(point.scheduled_flights,row.volume);
      assert.ok(Math.abs(point.arrival_delay_rate-row.rate)<1e-12);
    }
    await page.locator('[data-tab="tab-temporal"]').click(); await settled(page);
    const total=await page.locator('.heat-cell').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+(node.__data__.cell?.scheduled_flights||0),0));
    assert.equal(total,7001619);
    await page.locator('[data-tab="tab-cause-compare"]').click(); await settled(page);
    const segments=await page.locator('.cause-seg').evaluateAll(nodes=>nodes.map(node=>node.__data__));
    for (const [code,category,key] of [['ATL','Carrier','CarrierDelay_minutes'],['ATL','Late Aircraft','LateAircraftDelay_minutes'],['DFW','Late Aircraft','LateAircraftDelay_minutes']]) {
      const segment=segments.find(row=>row.label===code&&row.cat===category);
      assert.ok(segment); assert.ok(Math.abs(segment.share-findings.cause_shares[code][key])<1e-12);
    }
    assert.deepEqual(errors,[]);
    const hashes={};
    for (const name of ['scripts/render_final_report.cjs','scripts/analyze_final_report.py','site/index.html','site/css/style.css','site/js/app.js','site/js/charts.js','site/js/touch.js','site/data/manifest.json','reports/final_report_findings.json'])
      hashes[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
    await fs.writeFile(path.join(root,'reports/final_report_figures.json'),JSON.stringify({checks:'passed',browser:browser.version(),figures,
      checked:['explicit annual unfiltered scope','352 plotted airport observations match the analysis population','heatmap reconciles with national scheduled count','ATL and DFW cause segments match pooled reported minutes'],
      source_sha256:hashes},null,2)+'\n');
    console.log(JSON.stringify({checks:'passed',figures:figures.length,airports:points.length}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
