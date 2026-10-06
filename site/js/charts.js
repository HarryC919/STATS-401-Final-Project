import { hasNumber, nationalRate, causeTotals } from "./metrics.js";
const tooltip = d3.select("#tooltip");
function showTip(html, event) {
  tooltip.html(html)
    .style("display", "block")
    .style("left", Math.min(event.clientX + 12, window.innerWidth - tooltip.node().offsetWidth - 12) + "px")
    .style("top", Math.max(8, event.clientY - 28) + "px")
    .style("opacity", 1);
}
function hideTip() { tooltip.style("opacity", 0).style("display", "none"); }

const fmtPct = value => hasNumber(value) ? d3.format(".1%")(Number(value)) : "No data";
const fmtNum = d3.format(",");
const fmtMin = d3.format(",.0f");

// Reference-line wording states the pooled scope explicitly (Batch B): selected
// months across all reporting airlines and all origin airports.
const REFERENCE_SCOPE = "selected months, all airlines, all airports";

function emptyState(svg, message = "No flights match the current filters.") {
  svg.append("text").attr("class", "chart-empty").attr("x", 24).attr("y", 44).text(message);
}

const CHART_SVGS = {
  'tab-monthly': '#monthlyChart', 'tab-airline': '#airlineChart', 'tab-airport': '#airportChart',
  'tab-route': '#routeChart', 'tab-detail': '#detailTrend', 'tab-temporal': '#temporalHeatmap',
  'tab-cause': '#causeChart', 'tab-network': '#networkMap',
};

// Panel-level helpers for app.js: remove stale marks before a new render starts,
// and show load failures inside the panel instead of leaving another filter
// scope's chart visible.
export function clearChart(panelId) {
  d3.select(CHART_SVGS[panelId]).selectAll("*").remove();
}

export function chartError(panelId, message) {
  clearChart(panelId);
  emptyState(d3.select(CHART_SVGS[panelId]), message);
}

function drawKPIs(nat, monthly) {
  if (!nat || !hasNumber(nat.scheduled_flights)) {
    d3.select("#kpis").selectAll(".kpi").data([null]).join("div")
      .attr("class", "kpi")
      .html(`<div class="label">No flights</div>
             <div class="value">No data <small>for the current filters</small></div>`);
    return;
  }
  const totalFlights = nat.scheduled_flights;
  const delayRate     = nat.arrival_delay_rate;
  const cancelRate    = nat.cancellation_rate;
  const diversionRate = nat.diversion_rate;

  const items = [
    { label: "Total Flights",      value: hasNumber(totalFlights) ? fmtNum(totalFlights) : "No data", unit: "flights" },
    { label: "Arrival Delay Rate", value: fmtPct(delayRate),    unit: ">=15 min" },
    { label: "Cancellation Rate",  value: fmtPct(cancelRate),   unit: "" },
    { label: "Diversion Rate",     value: fmtPct(diversionRate), unit: "" }
  ];

  d3.select("#kpis").selectAll(".kpi")
    .data(items)
    .join("div")
    .attr("class", "kpi")
    .html(d => `<div class="label">${d.label}</div>
                <div class="value">${d.value} <small>${d.unit}</small></div>`);
}

function drawMonthly(data, options = {}) {
  const svg = d3.select(options.target ?? "#monthlyChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 380;
  const M = { top: 20, right: 60, bottom: 40, left: 60 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const monthKey  = "Month";
  const delayKey  = "arrival_delay_rate";
  const cancelKey = "cancellation_rate";

  data = data.filter(d => d[monthKey] != null && !isNaN(+d[monthKey]));
  data.sort((a,b) => +a[monthKey] - +b[monthKey]);
  if (data.length === 0 || !data.some(d => hasNumber(d[delayKey]) || hasNumber(d[cancelKey]))) {
    emptyState(svg);
    return;
  }

  const x = d3.scalePoint()
    .domain(data.map(d => +d[monthKey]))
    .range([0, w]).padding(0.5);

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d3.max([d[delayKey], d[cancelKey]].filter(hasNumber), Number)) * 1.1])
    .nice().range([h, 0]);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  // Highlight the selected month range; all twelve months always stay visible.
  const range = options.range;
  if (range && (range.start > 1 || range.end < 12)) {
    const step = x.step();
    g.append("rect").attr("class", "range-band")
      .attr("x", x(range.start) - step / 2).attr("y", 0)
      .attr("width", x(range.end) - x(range.start) + step).attr("height", h);
  }
  // Label every meaning the trend carries: the detail trend shows a full-year
  // context (plan requirement), the airline scope, and what the shading marks.
  const scope = [];
  if (options.fullYearContext) scope.push('Full-year context (all twelve months)');
  if (options.airline) scope.push(`Reporting airline: ${options.airline}`);
  if (options.airport) scope.push(`Airport: ${options.airport}`);
  if (options.range && (options.range.start > 1 || options.range.end < 12)) {
    scope.push('Shaded = selected months');
  }
  if (scope.length) {
    g.append("text").attr("class", "chart-scope").attr("x", 0).attr("y", -6).text(scope.join(" · "));
  }

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""));

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d => "M" + d));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));

  g.append("path").datum(data)
    .attr("fill", "none").attr("stroke", "#d9534f").attr("stroke-width", 2.5)
    .attr("d", d3.line().defined(d => hasNumber(d[delayKey])).x(d => x(+d[monthKey])).y(d => y(+d[delayKey])));

  g.append("path").datum(data)
    .attr("fill", "none").attr("stroke", "#3b7dd8").attr("stroke-width", 2.5)
    .attr("d", d3.line().defined(d => hasNumber(d[cancelKey])).x(d => x(+d[monthKey])).y(d => y(+d[cancelKey])));

  g.selectAll(".dot-delay").data(data.filter(d => hasNumber(d[delayKey]))).join("circle")
    .attr("cx", d => x(+d[monthKey])).attr("cy", d => y(d[delayKey]))
    .attr("r", 4).attr("fill", "#d9534f")
    .on("mousemove", (e,d) => showTip(`Month ${d[monthKey]}<br>Delay rate: ${fmtPct(d[delayKey])}`, e))
    .on("mouseleave", hideTip);

  g.selectAll(".dot-cancel").data(data.filter(d => hasNumber(d[cancelKey]))).join("circle")
    .attr("cx", d => x(+d[monthKey])).attr("cy", d => y(d[cancelKey]))
    .attr("r", 4).attr("fill", "#3b7dd8")
    .on("mousemove", (e,d) => showTip(`Month ${d[monthKey]}<br>Cancellation rate: ${fmtPct(d[cancelKey])}`, e))
    .on("mouseleave", hideTip);

  const legend = g.append("g").attr("transform", `translate(${w - 160}, 0)`);
  legend.append("rect").attr("width",12).attr("height",12).attr("fill","#d9534f");
  legend.append("text").attr("x",18).attr("y",10).text("Delay rate").attr("font-size",12);
  legend.append("rect").attr("y",20).attr("width",12).attr("height",12).attr("fill","#3b7dd8");
  legend.append("text").attr("x",18).attr("y",30).text("Cancellation rate").attr("font-size",12);
}

function drawAirline(data, national, options = {}) {
  const svg = d3.select("#airlineChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 20, right: 80, bottom: 40, left: 140 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const nameKey = "Reporting_Airline";
  const valKey  = "arrival_delay_rate";

  data = data.filter(d => d[nameKey] && hasNumber(d[valKey]));
  if (data.length === 0) {
    emptyState(svg);
    return;
  }
  data.sort((a,b) => d3.descending(+a[valKey], +b[valKey]));
  const avg = nationalRate(national);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => +d[valKey]) * 1.1])
    .nice().range([0, w]);

  const y = d3.scaleBand()
    .domain(data.map(d => d[nameKey]))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).tickSize(-w).tickFormat(""));

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));

  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(data).join("rect")
    .attr("class", d => "bar" + (+d[valKey] > avg ? " highlight" : ""))
    .attr("x", 0).attr("y", d => y(d[nameKey]))
    .attr("width", d => x(+d[valKey])).attr("height", y.bandwidth())
    .on("mousemove", (e,d) => showTip(`${d[nameKey]}<br>Delay rate: ${fmtPct(+d[valKey])}`, e))
    .on("mouseleave", hideTip)
    .classed("bar-selected", d => d[nameKey] === options.selectedAirline);

  g.append("line")
    .attr("x1", x(avg)).attr("x2", x(avg))
    .attr("y1", 0).attr("y2", h)
    .attr("stroke", "#999").attr("stroke-dasharray", "4 4");

  g.append("text")
    .attr("x", x(avg) + 4).attr("y", 12)
    .attr("font-size", 11).attr("fill", "#666")
    .text(`National avg ${fmtPct(avg)} (${REFERENCE_SCOPE})`);
}

function drawAirport(data, national, options = {}) {
  const svg = d3.select("#airportChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 20, right: 80, bottom: 40, left: 140 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const nameKey = "Origin";
  const idKey = "OriginAirportID";
  const volKey  = "scheduled_flights";
  const valKey  = "arrival_delay_rate";

  data = data.filter(d => d[nameKey] && hasNumber(d[valKey]) && hasNumber(d[volKey]));
  if (data.length === 0) {
    emptyState(svg);
    return;
  }
  const pool = data;
  data.sort((a,b) => d3.descending(+a[volKey], +b[volKey]));
  data = data.slice(0, 15);
  // Keep the comparison context: a selected airport outside the busiest 15 is
  // appended so the highlight stays visible.
  if (options.selectedId != null && !data.some(d => Number(d[idKey]) === Number(options.selectedId))) {
    const selected = pool.find(d => Number(d[idKey]) === Number(options.selectedId));
    if (selected) data.push(selected);
  }
  data.sort((a,b) => d3.descending(+a[valKey], +b[valKey]));
  const avg = nationalRate(national);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => +d[valKey]) * 1.1])
    .nice().range([0, w]);

  const y = d3.scaleBand()
    .domain(data.map(d => d[nameKey]))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));

  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(data).join("rect")
    .attr("class", d => "bar" + (+d[valKey] > avg ? " highlight" : "")
      + (Number(d[idKey]) === Number(options.selectedId) ? " bar-selected" : ""))
    .attr("x", 0).attr("y", d => y(d[nameKey]))
    .attr("width", d => x(+d[valKey])).attr("height", y.bandwidth())
    .on("mousemove", (e,d) => showTip(
      `${d[nameKey]}<br>Flights: ${fmtNum(+d[volKey])}<br>Delay rate: ${fmtPct(+d[valKey])}`, e))
    .on("mouseleave", hideTip)
    .on("click", (e,d) => { if (options.onSelect) options.onSelect(d[idKey]); });

  g.append("text")
    .attr("x", -M.left + 6).attr("y", -6)
    .attr("class", "chart-scope")
    .text(`Reference: national avg ${fmtPct(avg)} (${REFERENCE_SCOPE})`);
}

function drawRoute(data, national) {
  const svg = d3.select("#routeChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 20, right: 80, bottom: 40, left: 220 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const originKey = "Origin";
  const destKey   = "Dest";
  const volKey    = "scheduled_flights";
  const valKey    = "arrival_delay_rate";

  data = data
    .filter(d => d[originKey] && d[destKey] && hasNumber(d[valKey]) && hasNumber(d[volKey]))
    .map(d => ({ ...d, route: `${d[originKey]} → ${d[destKey]}` }));

  if (data.length === 0) {
    emptyState(svg);
    return;
  }

  data.sort((a,b) => d3.descending(+a[volKey], +b[volKey]));
  data = data.slice(0, 15);
  data.sort((a,b) => d3.descending(+a[valKey], +b[valKey]));
  const avg = nationalRate(national);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => +d[valKey]) * 1.1])
    .nice().range([0, w]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.route))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));

  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(data).join("rect")
    .attr("class", d => "bar" + (+d[valKey] > avg ? " highlight" : ""))
    .attr("x", 0).attr("y", d => y(d.route))
    .attr("width", d => x(+d[valKey])).attr("height", y.bandwidth())
    .on("mousemove", (e,d) => showTip(
      `${d.route}<br>Flights: ${fmtNum(+d[volKey])}<br>Delay rate: ${fmtPct(+d[valKey])}`, e))
    .on("mouseleave", hideTip);

  g.append("text")
    .attr("x", -M.left + 6).attr("y", -6)
    .attr("class", "chart-scope")
    .text(`Reference: national avg ${fmtPct(avg)} (${REFERENCE_SCOPE}); directed routes stay separate`);
}

function drawCauses(data) {
  const svg = d3.select("#causeChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 460;
  const radius = Math.min(W, H) / 2 - 90;

  const causeDefs = [
    { key: "CarrierDelay_minutes",      label: "Carrier" },
    { key: "WeatherDelay_minutes",      label: "Weather" },
    { key: "NASDelay_minutes",          label: "NAS" },
    { key: "SecurityDelay_minutes",     label: "Security" },
    { key: "LateAircraftDelay_minutes", label: "Late Aircraft" }
  ];

  const totals = causeTotals(data, causeDefs).filter(d => d.value !== null);

  if (totals.length === 0 || !totals.some(d => d.value > 0)) {
    svg.append("text").attr("x", 20).attr("y", 40)
      .text("No delay cause data (check column names)").attr("fill", "red");
    return;
  }

  const total = d3.sum(totals, d => d.value);

  const color = d3.scaleOrdinal()
    .domain(totals.map(d => d.label))
    .range(["#3b7dd8", "#d9534f", "#f0ad4e", "#5cb85c", "#8e6bbf"]);

  const g = svg.append("g").attr("transform", `translate(${W / 2 - 120},${H / 2})`);

  const pie = d3.pie().value(d => d.value).sort(null);
  const arc = d3.arc().innerRadius(0).outerRadius(radius);
  const outerArc = d3.arc().innerRadius(radius * 1.05).outerRadius(radius * 1.05);

  const arcs = g.selectAll(".arc").data(pie(totals)).join("g");

  arcs.append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data.label))
    .attr("stroke", "#fff").attr("stroke-width", 2)
    .on("mousemove", (e, d) => showTip(
      `${d.data.label}<br>${fmtMin(d.data.value)} min<br>${fmtPct(d.data.value / total)}`, e))
    .on("mouseleave", hideTip);

  function midAngle(d) { return d.startAngle + (d.endAngle - d.startAngle) / 2; }

  arcs.append("polyline")
    .attr("points", d => {
      const pos = arc.centroid(d);
      const pos2 = outerArc.centroid(d);
      pos2[0] = radius * 0.95 * (midAngle(d) < Math.PI ? 1 : -1);
      return [pos, outerArc.centroid(d), pos2];
    })
    .attr("stroke", "#999").attr("fill", "none").attr("stroke-width", 1);

  arcs.append("text")
    .attr("class", "pie-label")
    .attr("transform", d => {
      const pos = outerArc.centroid(d);
      pos[0] = radius * 1.0 * (midAngle(d) < Math.PI ? 1 : -1);
      return `translate(${pos})`;
    })
    .attr("text-anchor", d => midAngle(d) < Math.PI ? "start" : "end")
    .text(d => `${d.data.label} ${fmtPct(d.data.value / total)}`);

  const legend = svg.append("g")
    .attr("class", "pie-legend")
    .attr("transform", `translate(${W - 320}, 60)`);

  totals.forEach((d, i) => {
    const row = legend.append("g").attr("transform", `translate(0, ${i * 24})`);
    row.append("rect").attr("width", 14).attr("height", 14).attr("fill", color(d.label));
    row.append("text").attr("x", 20).attr("y", 12)
      .text(`${d.label} — ${fmtMin(d.value)} min (${fmtPct(d.value / total)})`);
  });
}

/* ===== Batch C: airport detail views ===== */
const CAUSE_DEFS = [
  { key: "CarrierDelay_minutes",      label: "Carrier",       color: "#3b7dd8" },
  { key: "WeatherDelay_minutes",      label: "Weather",       color: "#d9534f" },
  { key: "NASDelay_minutes",          label: "NAS",           color: "#f0ad4e" },
  { key: "SecurityDelay_minutes",     label: "Security",      color: "#5cb85c" },
  { key: "LateAircraftDelay_minutes", label: "Late Aircraft", color: "#8e6bbf" },
];

// Reported cause composition for one airport under the current filters: shares of
// reported attributed minutes with stable category colors; missing attribution is
// never treated as zero and observation counts stay exposed.
function drawDetailCauses(target, pooled) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const W = 1100, H = 380;
  const M = { top: 20, right: 70, bottom: 40, left: 150 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  if (!pooled) {
    emptyState(svg);
    return;
  }
  const rows = CAUSE_DEFS.map(({key, label, color}) => {
    const observations = Number(pooled[key.replace("_minutes", "_observations")]) || 0;
    return { label, color, observations, minutes: observations > 0 ? Number(pooled[key]) : null };
  });
  const observed = rows.filter(row => row.minutes != null);
  const total = d3.sum(observed, row => row.minutes);
  if (observed.length === 0 || total <= 0) {
    emptyState(svg, "No reported cause minutes match the current filters.");
    return;
  }

  const x = d3.scaleLinear()
    .domain([0, d3.max(observed, row => row.minutes / total) * 1.12])
    .nice().range([0, w]);
  const y = d3.scaleBand()
    .domain(rows.map(row => row.label))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(rows).join("rect")
    .attr("class", "bar")
    // Inline style: the global .bar CSS rule would otherwise override the
    // presentation attribute and paint every category blue.
    .style("fill", row => row.color)
    .attr("x", 0).attr("y", row => y(row.label))
    .attr("width", row => (row.minutes == null ? 0 : x(row.minutes / total)))
    .attr("height", y.bandwidth())
    .on("mousemove", (e, row) => showTip(row.minutes == null
      ? `${row.label}<br>No observations under the current filters`
      : `${row.label}<br>${fmtMin(row.minutes)} min<br>Share: ${fmtPct(row.minutes / total)}<br>Observed on ${fmtNum(row.observations)} delayed arrivals`, e))
    .on("mouseleave", hideTip);

  observed.forEach(row => {
    g.append("text")
      .attr("class", "chart-scope")
      .attr("x", x(row.minutes / total) + 5)
      .attr("y", y(row.label) + y.bandwidth() / 2 + 4)
      .text(fmtPct(row.minutes / total));
  });

  svg.append("text")
    .attr("class", "chart-scope")
    .attr("x", 24).attr("y", 14)
    .text(`Attribution observed on ${fmtNum(pooled.cause_observed_flights)} of ${fmtNum(pooled.delayed_arrivals)} delayed arrivals · partial ${fmtNum(pooled.cause_partial_flights)} · delayed with no attribution ${fmtNum(pooled.delayed_cause_missing)}. Missing is not zero.`);
}

// The five busiest outgoing directed routes under the current filters, selected by
// pooled scheduled flights (ties break by destination code) and displayed by rate.
function drawDetailRoutes(target, rows, originCode, referenceRow) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const W = 1100, H = 420;
  const M = { top: 20, right: 80, bottom: 40, left: 190 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  // The top five are chosen by scheduled flights before this point; a route with
  // zero eligible arrivals keeps its place with a missing rate — it must never be
  // dropped or shown as zero.
  const data = rows.filter(d => d.Dest).map(d => ({ ...d, route: `${originCode} → ${d.Dest}` }));
  if (data.length === 0) {
    emptyState(svg);
    return;
  }
  const rated = data.filter(d => hasNumber(d.arrival_delay_rate));
  const unrated = data.filter(d => !hasNumber(d.arrival_delay_rate));
  const avg = nationalRate(referenceRow);
  const x = d3.scaleLinear()
    .domain([0, (d3.max(rated, d => +d.arrival_delay_rate) ?? 0) * 1.1 || 1])
    .nice().range([0, w]);
  const y = d3.scaleBand()
    .domain(data.map(d => d.route))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(rated).join("rect")
    .attr("class", d => "bar" + (avg != null && +d.arrival_delay_rate > avg ? " highlight" : ""))
    .attr("x", 0).attr("y", d => y(d.route))
    .attr("width", d => x(+d.arrival_delay_rate)).attr("height", y.bandwidth())
    .on("mousemove", (e, d) => showTip(
      `${d.route}<br>Flights: ${fmtNum(+d.scheduled_flights)}<br>Eligible arrivals: ${fmtNum(+d.eligible_arrivals)}<br>Delay rate: ${fmtPct(+d.arrival_delay_rate)}`, e))
    .on("mouseleave", hideTip);

  g.selectAll(".no-rate").data(unrated).join("text")
    .attr("class", "no-rate chart-scope")
    .attr("x", 6).attr("y", d => y(d.route) + y.bandwidth() / 2 + 4)
    .text("No data")
    .on("mousemove", (e, d) => showTip(
      `${d.route}<br>Flights: ${fmtNum(+d.scheduled_flights)}<br>Eligible arrivals: ${fmtNum(+d.eligible_arrivals)}<br>Delay rate: No data (zero eligible arrivals)`, e))
    .on("mouseleave", hideTip);

  g.append("text")
    .attr("x", -M.left + 6).attr("y", -6)
    .attr("class", "chart-scope")
    .text(`Reference: national avg ${fmtPct(avg)} (${REFERENCE_SCOPE}); top five by scheduled flights, displayed in that order`);
}

/* ===== Batch D1: weekday x scheduled-departure-hour heatmap ===== */
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const LOW_SAMPLE_THRESHOLD = 30;

// Arrival-delay rate by weekday (rows, Monday first) and scheduled local departure
// hour (columns, 0-23; the BTS 2400 convention maps to hour 0). Cells pool the
// selected months, airline, and airport. Missing cells (no scheduled flights) stay
// gray — they are never zero — and low-sample cells carry a dashed outline.
function drawHeatmap(target, cells, options = {}) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 46, right: 214, bottom: 66, left: 90 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  if (options.scopeText) {
    svg.append("text").attr("class", "chart-scope").attr("x", 24).attr("y", 22).text(options.scopeText);
  }

  // Rows without a valid scheduled hour cannot sit on the hour axis; the 2025
  // baseline has none, but they are counted and reported instead of hidden.
  const hasValidHour = d => {
    if (d.Weekday == null || d.ScheduledDepHour == null) return false;
    const hour = Number(d.ScheduledDepHour);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23;
  };
  const grid = cells.filter(hasValidHour);
  const missingHour = cells.length - grid.length;
  if (grid.length === 0) {
    // An ordinary empty selection (no rows) and an anomalous one (rows exist but
    // none can be placed on the hour axis) must read differently.
    if (cells.length > 0) {
      svg.append("text").attr("class", "chart-empty").attr("x", 24).attr("y", 44)
        .text(`Data anomaly: all ${fmtNum(cells.length)} pooled rows have an invalid scheduled departure hour and cannot be placed on the hour axis.`);
    } else {
      emptyState(svg);
    }
    return;
  }
  const rated = grid.filter(d => hasNumber(d.arrival_delay_rate));
  // A degenerate all-zero domain would break the scale; keep a 1% floor.
  const maxRate = Math.max(d3.max(rated, d => +d.arrival_delay_rate) ?? 0, 0.01);
  const color = d3.scaleSequential(d3.interpolateRdYlBu)
    .domain([maxRate, 0]).clamp(true); // high rate -> red, observed zero -> blue

  const x = d3.scaleBand().domain(d3.range(24)).range([0, w]).paddingInner(0.06);
  const y = d3.scaleBand().domain(d3.range(1, 8)).range([0, h]).paddingInner(0.06);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickValues(d3.range(0, 24, 2)).tickFormat(v => String(v).padStart(2, '0')));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(v => WEEKDAY_NAMES[v - 1]));
  g.append("text").attr("class", "chart-scope")
    .attr("x", w / 2).attr("y", h + 46).attr("text-anchor", "middle")
    .text("Scheduled local departure hour (BTS 2400 maps to 00)");

  function cellTooltip(mark) {
    const day = WEEKDAY_NAMES[mark.weekday - 1];
    const hourLabel = `${String(mark.hour).padStart(2, '0')}:00–${String(mark.hour).padStart(2, '0')}:59`;
    const cell = mark.cell;
    if (!cell || !(+cell.scheduled_flights)) {
      return `${day} · ${hourLabel}<br>No observations under the current filters`;
    }
    const low = +cell.eligible_arrivals > 0 && +cell.eligible_arrivals < LOW_SAMPLE_THRESHOLD;
    return `${day} · ${hourLabel}` +
      `<br>Flights: ${fmtNum(+cell.scheduled_flights)}` +
      `<br>Eligible arrivals: ${fmtNum(+cell.eligible_arrivals)}` +
      `<br>Delayed (&ge;15 min): ${fmtNum(+cell.delayed_arrivals)}` +
      `<br>Rate: ${hasNumber(cell.arrival_delay_rate) ? fmtPct(+cell.arrival_delay_rate) : 'No data (no eligible arrivals)'}` +
      (low ? `<br>Low sample: fewer than ${LOW_SAMPLE_THRESHOLD} eligible arrivals` : '');
  }

  const lookup = new Map(grid.map(d => [`${d.Weekday}|${d.ScheduledDepHour}`, d]));
  const marks = [];
  for (const weekday of d3.range(1, 8)) {
    for (const hour of d3.range(24)) marks.push({ weekday, hour, cell: lookup.get(`${weekday}|${hour}`) });
  }

  g.selectAll(".heat-cell").data(marks).join("rect")
    .attr("class", "heat-cell")
    .attr("x", m => x(m.hour)).attr("y", m => y(m.weekday))
    .attr("width", x.bandwidth()).attr("height", y.bandwidth())
    .attr("rx", 2)
    .attr("fill", m => {
      const cell = m.cell;
      if (!cell || !(+cell.scheduled_flights)) return "#eef1f4"; // no observations
      return hasNumber(cell.arrival_delay_rate) ? color(+cell.arrival_delay_rate) : "#c9d2da";
    })
    .on("mousemove", (e, m) => showTip(cellTooltip(m), e))
    .on("mouseleave", hideTip);

  // Documented low-sample rule: dashed outline on cells with 0 < eligible < 30.
  g.selectAll(".heat-low").data(marks.filter(m => {
    const cell = m.cell;
    return cell && +cell.eligible_arrivals > 0 && +cell.eligible_arrivals < LOW_SAMPLE_THRESHOLD;
  })).join("rect")
    .attr("class", "heat-low")
    .attr("x", m => x(m.hour)).attr("y", m => y(m.weekday))
    .attr("width", x.bandwidth()).attr("height", y.bandwidth())
    .attr("rx", 2)
    .attr("fill", "none")
    .attr("stroke", "#45576a").attr("stroke-dasharray", "3 2").attr("stroke-width", 1.4)
    .attr("pointer-events", "none");

  // Legend: the gradient must match the cell mapping — left end is 0% (the blue
  // the color scale assigns to rate 0), right end is the scope maximum (red).
  const legendWidth = 140;
  const legend = svg.append("g").attr("transform", `translate(${W - M.right + 24},${M.top})`);
  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient").attr("id", "heatLegendGradient");
  d3.range(21).forEach(i => {
    gradient.append("stop")
      .attr("offset", i / 20)
      .attr("stop-color", color(maxRate * (i / 20)));
  });
  legend.append("text").attr("class", "chart-scope").attr("x", 0).attr("y", -8)
    .text("Arrival-delay rate");
  legend.append("rect").attr("width", legendWidth).attr("height", 12).attr("rx", 4)
    .attr("fill", "url(#heatLegendGradient)");
  legend.append("text").attr("class", "chart-scope").attr("x", 0).attr("y", 28).text("0%");
  legend.append("text").attr("class", "chart-scope").attr("x", legendWidth).attr("y", 28)
    .attr("text-anchor", "end").text(fmtPct(maxRate));
  legend.append("rect").attr("y", 48).attr("width", 22).attr("height", 12)
    .attr("fill", "#eef1f4").attr("stroke", "#d5dde3");
  legend.append("text").attr("class", "chart-scope").attr("x", 30).attr("y", 58)
    .text("No observations");
  legend.append("rect").attr("y", 76).attr("width", 22).attr("height", 12)
    .attr("fill", "#c9d2da");
  legend.append("text").attr("class", "chart-scope").attr("x", 30).attr("y", 86)
    .text("No eligible arrivals");
  legend.append("rect").attr("y", 104).attr("width", 22).attr("height", 12)
    .attr("fill", "none").attr("stroke", "#45576a")
    .attr("stroke-dasharray", "3 2").attr("stroke-width", 1.4);
  legend.append("text").attr("class", "chart-scope").attr("x", 30).attr("y", 114)
    .text(`Low sample (< ${LOW_SAMPLE_THRESHOLD} eligible)`);

  if (missingHour > 0) {
    svg.append("text").attr("class", "chart-scope").attr("x", 24).attr("y", H - 8)
      .text(`${fmtNum(missingHour)} pooled rows have an invalid scheduled time and are not shown on the hour axis.`);
  }
}

/* ===== Batch D2: comparative 100% stacked cause bars ===== */
// One 100% stacked bar per compared group (origin airports or reporting airlines),
// built from reported attributed minutes with the five stable category colors.
// A group whose reported-minute total is zero or missing is listed with an explicit
// "no reported cause minutes" note — never fabricated into a full bar. Segments
// expose minutes, share, and observation counts; group labels expose the
// observation/completeness counts.
function drawCauseComparison(target, rows, options = {}) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const W = 1100;
  const H = Math.max(380, 120 + rows.length * 36);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const M = { top: 52, right: 170, bottom: 48, left: 190 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  if (options.scopeText) {
    svg.append("text").attr("class", "chart-scope").attr("x", 24).attr("y", 22).text(options.scopeText);
  }
  if (rows.length === 0) {
    emptyState(svg);
    return;
  }

  const sorted = [...rows].sort((a, b) => b.scheduled_flights - a.scheduled_flights
    || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  for (const row of sorted) {
    row.reportedTotal = CAUSE_DEFS.reduce(
      (sum, def) => sum + (row[def.key] != null ? Number(row[def.key]) : 0), 0);
  }
  const withMinutes = sorted.filter(row => row.reportedTotal > 0);
  const without = sorted.filter(row => !(row.reportedTotal > 0));

  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
  const y = d3.scaleBand().domain(sorted.map(row => row.label)).range([0, h]).padding(0.24);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  const byLabel = new Map(sorted.map(row => [row.label, row]));
  const completenessTip = row =>
    `${row.label}<br>Scheduled: ${fmtNum(+row.scheduled_flights)}` +
    `<br>Delayed arrivals: ${fmtNum(+row.delayed_arrivals)}` +
    `<br>Attribution observed on ${fmtNum(row.cause_observed_flights)} of ${fmtNum(row.delayed_arrivals)} delayed arrivals` +
    `<br>Partial: ${fmtNum(row.cause_partial_flights)} · delayed with no attribution: ${fmtNum(row.delayed_cause_missing)}` +
    `<br>Missing attribution is not zero.`;
  // The row labels are real hover targets for the completeness statistics; the
  // segments themselves repeat them so the numbers are reachable everywhere.
  g.append("g").attr("class", "axis").call(d3.axisLeft(y))
    .selectAll("text")
    .on("mousemove", (e, label) => showTip(completenessTip(byLabel.get(label)), e))
    .on("mouseleave", hideTip);

  const segments = [];
  for (const row of withMinutes) {
    let cum = 0;
    for (const def of CAUSE_DEFS) {
      if (row[def.key] == null) continue; // unobserved category: contributes nothing
      const minutes = Number(row[def.key]);
      const share = minutes / row.reportedTotal;
      segments.push({ label: row.label, cat: def.label, minutes, share, x0: cum,
        observations: Number(row[`${def.key.replace("_minutes", "_observations")}`]) });
      cum += share;
    }
  }
  g.selectAll(".cause-seg").data(segments).join("rect")
    .attr("class", "cause-seg")
    .attr("x", d => x(d.x0)).attr("y", d => y(d.label))
    .attr("width", d => Math.max(0, x(d.x0 + d.share) - x(d.x0)))
    .attr("height", y.bandwidth())
    .attr("stroke", "#fff").attr("stroke-width", 0.5)
    // Inline styles: five stable colors must survive the global .bar rule.
    .style("fill", d => CAUSE_DEFS.find(def => def.label === d.cat).color)
    .on("mousemove", (e, d) => {
      const row = byLabel.get(d.label);
      showTip(
        `${d.label} — ${d.cat}<br>${fmtMin(d.minutes)} min<br>Share: ${fmtPct(d.share)}` +
        `<br>Observed on ${fmtNum(d.observations)} delayed arrivals` +
        `<br>Attribution observed on ${fmtNum(row.cause_observed_flights)} of ${fmtNum(row.delayed_arrivals)} delayed arrivals` +
        `<br>Partial: ${fmtNum(row.cause_partial_flights)} · delayed with no attribution: ${fmtNum(row.delayed_cause_missing)}`, e);
    })
    .on("mouseleave", hideTip);

  g.selectAll(".cause-none").data(without).join("text")
    .attr("class", "cause-none chart-scope")
    .attr("x", 6).attr("y", row => y(row.label) + y.bandwidth() / 2 + 4)
    .text(row => row.delayed_arrivals > 0
      ? "No reported cause minutes (attribution missing or zero)"
      : "No delayed arrivals under the current filters")
    .on("mousemove", (e, row) => showTip(
      `${row.label}<br>Scheduled: ${fmtNum(+row.scheduled_flights)}` +
      `<br>Delayed arrivals: ${fmtNum(+row.delayed_arrivals)}` +
      `<br>Reported minutes: none${row.delayed_arrivals > 0 ? " (attribution missing or zero)" : ""}` +
      `<br>Attribution observed on ${fmtNum(row.cause_observed_flights)} of ${fmtNum(row.delayed_arrivals)} delayed arrivals` +
      `<br>Partial: ${fmtNum(row.cause_partial_flights)} · delayed with no attribution: ${fmtNum(row.delayed_cause_missing)}` +
      `<br>Missing attribution is not zero.`, e))
    .on("mouseleave", hideTip);

  // Emphasize the selected group's label without removing comparison context.
  if (options.selectedLabel != null) {
    g.selectAll(".tick text")
      .filter(d => d === options.selectedLabel)
      .attr("font-weight", 700).attr("fill", "#14304d");
  }

  // Legend: the five stable category colors.
  const legend = svg.append("g").attr("transform", `translate(${W - M.right + 28},${M.top - 14})`);
  CAUSE_DEFS.forEach((def, i) => {
    const entry = legend.append("g").attr("transform", `translate(0,${i * 22})`);
    entry.append("rect").attr("width", 14).attr("height", 14).attr("rx", 3)
      .style("fill", def.color);
    entry.append("text").attr("class", "chart-scope").attr("x", 20).attr("y", 11)
      .text(def.label);
  });
  svg.append("text").attr("class", "chart-scope").attr("x", 24).attr("y", H - 6)
    .text("Shares use reported attributed minutes as the denominator; missing attribution is not zero; Weather excludes weather attributed to NAS. Descriptive, not causal.");
}

/* ===== Batch D3: volume-reliability scatterplot ===== */
// Scheduled-flight volume (log x) versus arrival-delay rate (y) for airports or
// airlines under the shared filters. Points with no eligible arrivals are excluded
// and reported — a missing rate is never plotted as zero. The brush defines a
// transient comparison/highlight set only: it never changes any denominator.
function drawScatter(target, rows, options = {}) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const W = 1100, H = 620;
  const M = { top: 46, right: 40, bottom: 66, left: 90 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  if (options.scopeText) {
    svg.append("text").attr("class", "chart-scope").attr("x", 24).attr("y", 22).text(options.scopeText);
  }
  const minVolume = Math.max(0, Number(options.minVolume) || 0);
  const inScope = rows.filter(row => +row.scheduled_flights >= minVolume);
  const rated = inScope.filter(row => hasNumber(row.arrival_delay_rate));
  const noEligible = inScope.length - rated.length; // missing rates are not plotted

  if (rated.length === 0) {
    svg.append("text").attr("class", "chart-empty").attr("x", 24).attr("y", 60)
      .text(noEligible > 0
        ? `No plotted points: ${fmtNum(noEligible)} group(s) match the filters but have no eligible arrivals, and a missing rate is never plotted as zero.`
        : "No flights match the current filters.");
    return;
  }

  const x = d3.scaleLog()
    .domain([1, Math.max(d3.max(rated, row => +row.scheduled_flights), 10)])
    .range([0, w]).clamp(true);
  const y = d3.scaleLinear()
    .domain([0, d3.max(rated, row => +row.arrival_delay_rate) * 1.08])
    .nice().range([h, 0]);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
  const domainMax = x.domain()[1];
  const decadeTicks = [1, 10, 100, 1000, 10000, 100000, 1000000]
    .filter(value => value >= x.domain()[0] && value <= domainMax);
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    // Decade ticks only, clamped to the current domain: default log ticks both
    // overlap badly and can pile up beyond the largest plotted volume.
    .call(d3.axisBottom(x).tickValues(decadeTicks)
      .tickFormat(v => d3.format("~s")(v)));
  g.append("text").attr("class", "chart-scope")
    .attr("x", w / 2).attr("y", h + 46).attr("text-anchor", "middle")
    .text("Scheduled flights (log scale)");
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(".0%")));
  g.append("text").attr("class", "chart-scope")
    .attr("x", 24).attr("y", 40)
    .text("Arrival-delay rate");

  const selectedLabel = options.selectedLabel ?? null;
  const strokeFor = row => (selectedLabel != null && String(row.id) === String(selectedLabel)
    ? { stroke: "#14304d", width: 2.6 } : { stroke: "#fff", width: 1 });

  // The brush layer sits UNDER the points: dragging on empty areas defines the
  // highlight set, while clicks land on the points themselves.
  if (options.onBrush) {
    const brush = d3.brush()
      .extent([[-4, -4], [w + 4, h + 4]])
      .on("brush end", e => {
        if (!e.selection) { options.onBrush(null); return; }
        const [[px0, py0], [px1, py1]] = e.selection;
        options.onBrush({
          volumeMin: x.invert(px0), volumeMax: x.invert(px1),
          rateMin: y.invert(py1), rateMax: y.invert(py0), // pixel top = higher rate
        });
      });
    const brushGroup = g.append("g").attr("class", "scatter-brush").call(brush);
    // Moving the brush to null clears the selection box and its handles; the
    // brush "end" event then reports the cleared set through onBrush(null).
    options.onReady?.({ clearBrush: () => brushGroup.call(brush.move, null) });
  }

  const points = g.append("g").selectAll(".scatter-point").data(rated).join("circle")
    .attr("class", "scatter-point")
    .attr("cx", row => x(+row.scheduled_flights))
    .attr("cy", row => y(+row.arrival_delay_rate))
    .attr("r", 5)
    .attr("fill", "#3b7dd8")
    .attr("fill-opacity", 0.75)
    .attr("stroke", row => strokeFor(row).stroke)
    .attr("stroke-width", row => strokeFor(row).width)
    .on("mousemove", (e, row) => showTip(
      `${row.label}<br>Scheduled: ${fmtNum(+row.scheduled_flights)}` +
      `<br>Eligible arrivals: ${fmtNum(+row.eligible_arrivals)}` +
      `<br>Delayed (&ge;15 min): ${fmtNum(+row.delayed_arrivals)}` +
      `<br>Rate: ${fmtPct(+row.arrival_delay_rate)}` +
      (options.clickHint ? `<br>${options.clickHint}` : ""), e))
    .on("mouseleave", hideTip)
    .on("click", (e, row) => { if (options.onSelect && row.id != null) options.onSelect(row.id); });

  if (options.onSelect) points.attr("cursor", "pointer");
}

/* ===== Hanchi: static city flight network map ===== */
function drawNetworkMap(nationalRow, isLatest = null, selection = null, onPickCity = null) {
  const svg = d3.select("#networkMap");
  svg.selectAll("*").remove();

  const W = 1100, H = 650;
  const projection = d3.geoAlbersUsa()
    .translate([W * 0.37, H * 0.51])
    .scale(950);
  const geoPath = d3.geoPath(projection);

  return Promise.all([
    d3.json("vendor/states-10m.json"),
    d3.csv("data/city_summary.csv", d3.autoType),
    d3.csv("data/city_routes.csv", d3.autoType)
  ]).then(([us, cities, routes]) => {
    // Async DOM writes must be validated: a superseded render (newer selection or
    // newer tab) owns this panel and must not append a second layer of marks.
    if (isLatest && !isLatest()) return;
    const states = topojson.feature(us, us.objects.states);
    const mesh = topojson.mesh(us, us.objects.states, (a,b) => a !== b);

    svg.append("g").selectAll("path")
      .data(states.features).join("path")
      .attr("class","map-state").attr("d",geoPath);

    svg.append("path").datum(mesh)
      .attr("class","map-state-border").attr("d",geoPath);

    const pcities = cities.map(d => {
      const p = projection([+d.longitude, +d.latitude]);
      return p ? {...d, x:p[0], y:p[1]} : null;
    }).filter(Boolean);

    const cityMap = new Map(pcities.map(d => [d.city,d]));

    const proutes = routes
      .filter(d => cityMap.has(d.city_a) && cityMap.has(d.city_b))
      .sort((a,b) => d3.descending(+a.scheduled_flights,+b.scheduled_flights))
      .slice(0,220)
      .map((d,i) => {
        const a=cityMap.get(d.city_a), b=cityMap.get(d.city_b);
        return a && b ? {...d,a,b,rank:i+1} : null;
      }).filter(Boolean);

    const routeWidth = d3.scaleSqrt()
      .domain(d3.extent(proutes,d=>+d.scheduled_flights))
      .range([0.35,2.25]);

    svg.append("g").selectAll("path")
      .data(proutes).join("path")
      .attr("class",d=>d.rank<=25 ? "map-route top":"map-route")
      .attr("stroke-width",d=>routeWidth(+d.scheduled_flights))
      .attr("d",d=>cityArc(d.a.x,d.a.y,d.b.x,d.b.y));

    const rates = pcities.filter(d=>+d.scheduled_flights>=10000 && hasNumber(d.arrival_delay_rate))
      .map(d=>+d.arrival_delay_rate).sort(d3.ascending);

    const national=nationalRate(nationalRow);
    const low=d3.quantile(rates,.05) ?? .15;
    const high=d3.quantile(rates,.95) ?? .30;

    const color=d3.scaleDiverging()
      .domain([low,national,high])
      .interpolator(t=>d3.interpolateRgbBasis(["#2c7bb6","#abd9e9","#f1f1f1","#fdae61","#d7191c"])(t))
      .clamp(true);

    const radius=d3.scaleSqrt()
      .domain([0,d3.max(pcities,d=>+d.scheduled_flights)])
      .range([0,19.2]);

    const visible=pcities
      .sort((a,b)=>d3.descending(+a.scheduled_flights,+b.scheduled_flights));

    svg.append("g").selectAll("circle")
      .data(visible).join("circle")
      .attr("class","map-node")
      .attr("cx",d=>d.x).attr("cy",d=>d.y)
      .attr("r",d=>radius(+d.scheduled_flights))
      .attr("fill",d=>hasNumber(d.arrival_delay_rate) ? color(+d.arrival_delay_rate) : "#777")
      .attr("fill-opacity",.92)
      .on("mousemove", (e,d) => showTip(
        `${d.city}<br>Departures: ${fmtNum(+d.scheduled_flights)}<br>Delay rate: ${fmtPct(d.arrival_delay_rate)}<br>Airports: ${d.airports}<br>Click to select an airport`, e))
      .on("mouseleave", hideTip)
      .on("click", (e,d) => { if (onPickCity) onPickCity(d, e); });

    svg.append("g").selectAll("text")
      .data(visible.slice(0,14)).join("text")
      .attr("class","map-hub-label")
      .attr("x",d=>d.x+7).attr("y",d=>d.y-8)
      .text(d=>String(d.city).replace(/, [A-Z]{2}$/,""));

    // Batch C: selected-airport layer + directed outgoing routes. The map keeps
    // its fixed full-year, all-airline scope; the airport detail carries the
    // filtered statistics.
    let selectionNote = "";
    if (selection) {
      const origin = projection([selection.longitude, selection.latitude]);
      if (origin) {
        const projected = selection.outgoing
          .map(d => ({ ...d, xy: projection([+d.longitude, +d.latitude]) }))
          .filter(d => d.xy);
        const shown = projected.slice(0, 20);
        const outgoingWidth = d3.scaleSqrt()
          .domain([0, d3.max(shown, d => +d.scheduled_flights)])
          .range([0.8, 3.2]);
        svg.append("g").selectAll("path")
          .data(shown).join("path")
          .attr("class", "map-outgoing")
          .attr("stroke-width", d => outgoingWidth(+d.scheduled_flights))
          .attr("d", d => cityArc(origin[0], origin[1], d.xy[0], d.xy[1]))
          .on("mousemove", (e,d) => showTip(
            `${selection.code} → ${d.Dest}<br>Flights: ${fmtNum(+d.scheduled_flights)}<br>Delay rate: ${fmtPct(+d.arrival_delay_rate)}<br>Directed · full-year, all airlines`, e))
          .on("mouseleave", hideTip);
        svg.append("circle")
          .attr("class", "map-airport-selected")
          .attr("cx", origin[0]).attr("cy", origin[1]).attr("r", 8);
        svg.append("text")
          .attr("class", "map-airport-label")
          .attr("x", origin[0] + 11).attr("y", origin[1] - 9)
          .text(selection.code);
        selectionNote = ` Selected airport ${selection.code} is highlighted with its ${shown.length} busiest outgoing routes (directed, full-year scope; lower-volume destinations beyond the top 20 are not drawn).`;
      } else {
        selectionNote = ` Selected airport ${selection.code} lies outside the Albers USA projection; its statistics remain available in Airport Detail and via the airport box.`;
      }
    }

    drawNetworkLegend(svg,radius,low,national,high,W,color);
    document.querySelector("#network-status").textContent = `${pcities.length} of ${cities.length} cities projected; ${proutes.length} city-pair edges shown. Both directions pooled; within-city flights are not drawn as edges.${selectionNote}`;
  }).catch(err => {
    console.error("Network map error:",err);
    if (isLatest && !isLatest()) return; // superseded: the newest render owns the panel
    svg.append("text").attr("x",25).attr("y",42)
      .attr("fill","red").text("Network map failed to load. Select this tab to retry.");
    throw err;
  });
}

function cityArc(x1,y1,x2,y2) {
  const dx=x2-x1,dy=y2-y1,dist=Math.max(1,Math.sqrt(dx*dx+dy*dy));
  const bend=Math.min(62,Math.max(12,dist*.10));
  const mx=(x1+x2)/2,my=(y1+y2)/2,nx=-dy/dist,ny=dx/dist;
  return `M${x1},${y1} Q${mx+nx*bend},${my+ny*bend} ${x2},${y2}`;
}

function drawNetworkLegend(svg,radius,low,national,high,W,color) {
  const g=svg.append("g").attr("transform",`translate(${W-236},34)`);
  g.append("rect").attr("class","map-legend-box").attr("width",208).attr("height",235).attr("rx",10);

  g.append("text").attr("class","map-legend-title").attr("x",14).attr("y",24).text("Traffic volume");
  const vals=[50000,150000,300000], xs=[34,92,158];
  g.selectAll(".legc").data(vals).join("circle")
    .attr("cx",(_,i)=>xs[i]).attr("cy",57).attr("r",d=>radius(d))
    .attr("fill","#9fb1bc").attr("fill-opacity",.4).attr("stroke","#657b88");
  g.selectAll(".legt").data(vals).join("text")
    .attr("class","map-legend-text").attr("x",(_,i)=>xs[i]).attr("y",92)
    .attr("text-anchor","middle").text(d=>d3.format("~s")(d));

  g.append("text").attr("class","map-legend-title").attr("x",14).attr("y",123).text("Arrival-delay rate");

  const defs=svg.append("defs");
  const grad=defs.append("linearGradient").attr("id","networkColorGradient");
  d3.range(21).map(i => { const t=i/20; return [t,color(t<=.5 ? low+(national-low)*t*2 : national+(high-national)*(t-.5)*2)]; })
    .forEach(([o,c])=>grad.append("stop").attr("offset",o).attr("stop-color",c));

  g.append("rect").attr("x",14).attr("y",135).attr("width",180).attr("height",10)
    .attr("rx",5).attr("fill","url(#networkColorGradient)");
  g.append("text").attr("class","map-legend-text").attr("x",14).attr("y",161).text(d3.format(".1%")(low));
  g.append("text").attr("class","map-legend-text").attr("x",104).attr("y",161).attr("text-anchor","middle")
    .text("National "+d3.format(".1%")(national));
  g.append("text").attr("class","map-legend-text").attr("x",194).attr("y",161).attr("text-anchor","end")
    .text(d3.format(".1%")(high));

  g.append("text").attr("class","map-legend-title").attr("x",14).attr("y",190).text("Route arcs");
  g.append("line").attr("x1",14).attr("x2",72).attr("y1",207).attr("y2",207)
    .attr("stroke","#5a7180").attr("stroke-width",1).attr("stroke-opacity",.35);
  g.append("text").attr("class","map-legend-text").attr("x",82).attr("y",211).text("lower volume");
  g.append("line").attr("x1",14).attr("x2",72).attr("y1",225).attr("y2",225)
    .attr("stroke","#5a7180").attr("stroke-width",3).attr("stroke-opacity",.45);
  g.append("text").attr("class","map-legend-text").attr("x",82).attr("y",229).text("higher volume");
}


export { drawKPIs, drawMonthly, drawAirline, drawAirport, drawRoute, drawCauses, drawNetworkMap,
         drawDetailCauses, drawDetailRoutes, drawHeatmap, drawCauseComparison, drawScatter };
