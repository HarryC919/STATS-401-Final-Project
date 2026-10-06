// Cached, deduplicated loading of the publication snapshot. URLs are relative to
// site/, exactly like the pre-existing views. Failed loads evict their cache entry
// so a retry (tab reselect or filter change) fetches again.
const pending = new Map();

function cached(key, loader) {
  if (!pending.has(key)) {
    pending.set(key, loader().catch(error => {
      pending.delete(key);
      throw error;
    }));
  }
  return pending.get(key);
}

export function loadCsv(key, url) {
  // The initial snapshot fetches several files at once, which the same simple
  // static servers occasionally reset — retry like the partition loader.
  return cached(`csv:${key}`, () => fetchCsvRetry(url));
}

export function loadJson(key, url) {
  return cached(`json:${key}`, () => d3.json(url));
}

// Fetch in small batches: hundreds of simultaneous requests can overwhelm a
// simple local static server, and politeness costs little even over HTTP/2.
async function fetchInBatches(items, mapper, batchSize = 6) {
  const results = [];
  for (let start = 0; start < items.length; start += batchSize) {
    results.push(...await Promise.all(items.slice(start, start + batchSize).map(mapper)));
  }
  return results;
}

// Simple static servers occasionally reset bursts of connections; retry a few
// times before surfacing the failure (the caller then shows a retryable error).
async function fetchCsvRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await d3.csv(url, d3.autoType);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 120 * attempt));
    }
  }
  throw lastError;
}

// Single-origin route partition for the airport detail and map layers (Batch C).
// The partition file name is the origin IATA code per the Batch A contract and the
// origin identity is known from the selection, so no manifest round-trip is needed.
export function loadRoutePartition(code) {
  return cached(`route-partition:${code}`, () => fetchCsvRetry(`data/routes/${code}.csv`));
}

// Monthly temporal partitions for the D1 heatmap (Batch A contract): one file per
// month, grain airline x origin airport x weekday x scheduled hour. Rows gain their
// Month so pooling across partitions keeps the partition boundaries explicit.
export function loadTemporalPartition(month) {
  const name = `2025-${String(month).padStart(2, '0')}`;
  return cached(`temporal:${name}`, async () => {
    const rows = await fetchCsvRetry(`data/temporal/${name}.csv`);
    return rows.map(row => ({ ...row, Month: month }));
  });
}

export function loadTemporalPartitions(months) {
  return fetchInBatches(months, loadTemporalPartition, 4).then(frames => frames.flat());
}

// On-demand directed-route partitions (Batch A contract): discovered through the
// manifest, fetched once and cached. The origin identity comes from the manifest
// entry so pooled rows carry the same keys as route_annual.csv. Never loaded on
// the initial page view.
export function loadRoutePartitions() {
  return cached('route-partitions', async () => {
    const manifest = await d3.json('data/manifest.json');
    const entries = Object.entries(manifest.partitions.routes.files);
    const frames = await fetchInBatches(entries, async ([code, entry]) => {
      const rows = await fetchCsvRetry(`data/${entry.file}`);
      return rows.map(row => ({ ...row, Origin: code, OriginAirportID: entry.origin_airport_id }));
    });
    return frames.flat();
  });
}
