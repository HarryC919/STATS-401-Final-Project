// Reuse each mark's existing detail formatter and selection callback on touch.
const narrow = matchMedia('(max-width: 650px)');
export const touchDevice = matchMedia('(pointer: coarse)').matches;
let returnTarget = null;
export function dismissTouchDetails(restoreFocus = false) {
  const panel = document.querySelector('#touch-details');
  panel.hidden = true;
  if (restoreFocus && returnTarget?.isConnected) returnTarget.focus({ preventScroll:true });
  returnTarget = null;
}

export function initializeTouch(inspectMark) {
  for (const id of ['method-disclosure', 'filters-disclosure']) {
    const disclosure = document.getElementById(id);
    const resize = () => { disclosure.open = !narrow.matches; };
    resize(); narrow.addEventListener('change', resize);
  }
  // Only the plot scrolls sideways; explanations and controls always reflow.
  document.querySelectorAll('section svg:not(#networkMap)').forEach(svg => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable chart');
    svg.before(wrapper); wrapper.append(svg);
    const hint = document.createElement('p');
    hint.className = 'chart-touch-hint';
    hint.textContent = 'Swipe sideways to explore the chart. Tap a mark for details.';
    wrapper.before(hint);
  });
  const panel = document.querySelector('#touch-details');
  document.querySelector('#touch-detail-close').addEventListener('click', () => dismissTouchDetails(true));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismissTouchDetails(true);
  });
  document.addEventListener('change', () => dismissTouchDetails());
  let lastPointer = '';
  document.addEventListener('pointerdown', event => { lastPointer = event.pointerType; }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('#touch-details')) return;
    const isTouch = event.pointerType === 'touch' || (!event.pointerType && lastPointer === 'touch');
    let mark = event.target;
    while (mark && mark.tagName?.toLowerCase() !== 'svg' && !d3.select(mark).on('mousemove')) mark = mark.parentElement;
    if (!isTouch || !mark?.closest('svg') || !d3.select(mark).on('mousemove')) {
      dismissTouchDetails(); return;
    }
    // Cancel only a completed tap, never pointerdown/move: native scrolling stays available.
    event.preventDefault(); event.stopImmediatePropagation();
    const html = inspectMark(mark, event);
    document.querySelector('#touch-detail-content').innerHTML = html;
    const selection = d3.select(mark).on('click');
    const selectable = mark.matches('.map-node') || mark.closest('#airportChart')
      || (mark.closest('#scatterChart') && document.querySelector('[name="scatter-mode"]:checked').value === 'airports');
    const action = document.querySelector('#touch-detail-action');
    action.hidden = !selection || !selectable;
    action.textContent = mark.matches('.map-node') ? 'Choose airport' : 'Select airport';
    action.onclick = actionEvent => {
      actionEvent.stopPropagation();
      dismissTouchDetails();
      selection.call(mark, event, mark.__data__);
    };
    returnTarget = mark;
    returnTarget.setAttribute('tabindex', '-1');
    panel.hidden = false;
    document.querySelector('#touch-detail-close').focus({ preventScroll:true });
  }, true);
}
