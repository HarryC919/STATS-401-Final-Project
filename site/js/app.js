import { drawKPIs, drawMonthly, drawAirline, drawAirport, drawRoute, drawCauses, drawNetworkMap } from './charts.js';

const status = document.querySelector('#load-status');
const buttons = [...document.querySelectorAll('.tab-btn')];
buttons.forEach(button => { button.disabled = true; });

async function start() {
  const names = ['national', 'monthly', 'airline_annual', 'airport_annual', 'route_annual'];
  const [national, monthly, airline, airport, route] = await Promise.all(
    names.map(name => d3.csv(`data/${name}.csv`, d3.autoType)));
  if (national.length !== 1 || monthly.length !== 12) throw new Error('Expected a complete 2025 snapshot.');
  const baseline = national[0];
  drawKPIs(baseline);
  const renderers = {
    'tab-monthly': () => drawMonthly(monthly),
    'tab-airline': () => drawAirline(airline, baseline),
    'tab-airport': () => drawAirport(airport, baseline),
    'tab-route': () => drawRoute(route, baseline),
    'tab-cause': () => drawCauses(national),
    'tab-network': () => drawNetworkMap(baseline),
  };
  const drawn = new Set();
  let loading = false;
  async function activate(button) {
    if (loading) return;
    const id = button.dataset.tab;
    buttons.forEach(b => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === id));
    document.querySelector('#tooltip').style.opacity = 0;
    document.querySelector('#tooltip').style.display = 'none';
    if (!drawn.has(id)) {
      loading = true;
      status.textContent = 'Rendering chart…';
      try {
        await renderers[id]();
        drawn.add(id);
        status.textContent = 'Verified 2025 snapshot loaded. Hover chart marks for details; linked filters are planned.';
      } catch (error) {
        status.textContent = `Chart could not load: ${error.message}. Select the tab to retry.`;
        console.error(error);
      } finally {
        loading = false;
      }
    }
  }
  buttons.forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => activate(button));
  });
  await activate(buttons[0]);
}

start().catch(error => {
  status.textContent = `Data could not load: ${error.message}. Serve the site over HTTP and check site/data/.`;
  status.setAttribute('role', 'alert');
  console.error(error);
});
