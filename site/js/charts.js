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

function drawKPIs(nat, monthly) {
  if (!nat) return;
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

function drawMonthly(data) {
  const svg = d3.select("#monthlyChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 380;
  const M = { top: 20, right: 60, bottom: 40, left: 60 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const monthKey  = "Month";
  const delayKey  = "arrival_delay_rate";
  const cancelKey = "cancellation_rate";

  data = data.filter(d => d[monthKey] != null && !isNaN(+d[monthKey]));
  data.sort((a,b) => +a[monthKey] - +b[monthKey]);
  if (data.length === 0) return;

  const x = d3.scalePoint()
    .domain(data.map(d => +d[monthKey]))
    .range([0, w]).padding(0.5);

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d3.max([d[delayKey], d[cancelKey]].filter(hasNumber), Number)) * 1.1])
    .nice().range([h, 0]);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

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

function drawAirline(data, national) {
  const svg = d3.select("#airlineChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 20, right: 80, bottom: 40, left: 140 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const nameKey = "Reporting_Airline";
  const valKey  = "arrival_delay_rate";

  data = data.filter(d => d[nameKey] && hasNumber(d[valKey]));
  if (data.length === 0) {
    svg.append("text").attr("x", 20).attr("y", 40)
      .text("No airline data (check column names)").attr("fill", "red");
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
    .on("mouseleave", hideTip);

  g.append("line")
    .attr("x1", x(avg)).attr("x2", x(avg))
    .attr("y1", 0).attr("y2", h)
    .attr("stroke", "#999").attr("stroke-dasharray", "4 4");

  g.append("text")
    .attr("x", x(avg) + 4).attr("y", 12)
    .attr("font-size", 11).attr("fill", "#666")
    .text(`National avg ${fmtPct(avg)}`);
}

function drawAirport(data, national) {
  const svg = d3.select("#airportChart");
  svg.selectAll("*").remove();
  const W = 1100, H = 520;
  const M = { top: 20, right: 80, bottom: 40, left: 140 };
  const w = W - M.left - M.right, h = H - M.top - M.bottom;

  const nameKey = "Origin";
  const volKey  = "scheduled_flights";
  const valKey  = "arrival_delay_rate";

  data = data.filter(d => d[nameKey] && hasNumber(d[valKey]) && hasNumber(d[volKey]));
  if (data.length === 0) {
    svg.append("text").attr("x", 20).attr("y", 40)
      .text("No airport data (check column names)").attr("fill", "red");
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
    .domain(data.map(d => d[nameKey]))
    .range([0, h]).padding(0.2);

  const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));

  g.append("g").attr("class", "axis").call(d3.axisLeft(y));

  g.selectAll(".bar").data(data).join("rect")
    .attr("class", d => "bar" + (+d[valKey] > avg ? " highlight" : ""))
    .attr("x", 0).attr("y", d => y(d[nameKey]))
    .attr("width", d => x(+d[valKey])).attr("height", y.bandwidth())
    .on("mousemove", (e,d) => showTip(
      `${d[nameKey]}<br>Flights: ${fmtNum(+d[volKey])}<br>Delay rate: ${fmtPct(+d[valKey])}`, e))
    .on("mouseleave", hideTip);
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
    svg.append("text").attr("x", 20).attr("y", 40)
      .text("No route data (check column names)").attr("fill", "red");
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

/* ===== Hanchi: static city flight network map ===== */
function drawNetworkMap(nationalRow) {
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
      .attr("fill-opacity",.92);

    svg.append("g").selectAll("text")
      .data(visible.slice(0,14)).join("text")
      .attr("class","map-hub-label")
      .attr("x",d=>d.x+7).attr("y",d=>d.y-8)
      .text(d=>String(d.city).replace(/, [A-Z]{2}$/,""));

    drawNetworkLegend(svg,radius,low,national,high,W,color);
    document.querySelector("#network-status").textContent = `${pcities.length} of ${cities.length} cities projected; ${proutes.length} city-pair edges shown. Both directions pooled; within-city flights are not drawn as edges.`;
  }).catch(err => {
    console.error("Network map error:",err);
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


export { drawKPIs, drawMonthly, drawAirline, drawAirport, drawRoute, drawCauses, drawNetworkMap };
