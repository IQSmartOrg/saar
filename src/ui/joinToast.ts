const TEAL = '#1A414E';
const MINT = '#D9EFEA';
const TEAL_SOFT = 'rgba(26,65,78,.16)';

/** Microphone glyph. Inline SVG rather than a packaged image: a content script
 *  can only load extension files listed in web_accessible_resources, and this
 *  avoids widening the manifest for one 18px icon. */
const MIC_SVG = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="2.5" width="6" height="11" rx="3"/>
  <path d="M5 11a7 7 0 0 0 14 0"/>
  <path d="M12 18.5V21"/>
</svg>`;

/**
 * Renders the cancellable "joining" toast in the user's own Meet tab.
 *
 * Returns a dismiss function. `onProceed` fires when the countdown runs out;
 * Cancel and an external dismiss both stop the countdown and fire nothing —
 * cancelling means no notetaker, which needs no announcement.
 *
 * Top-right: bottom-centre collided with Meet's own control bar and its
 * transient "You're the only one here" banners.
 *
 * Every rule is an inline style. Meet ships aggressive global CSS and this node
 * lives inside its document, so anything relying on a stylesheet of ours would
 * be a coin toss.
 */
export function showJoinToast(
  doc: Document,
  delayMs: number,
  onProceed: () => void,
): () => void {
  const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const host = doc.createElement('div');
  host.setAttribute('data-saar-toast', '');
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.style.cssText = [
    'position:fixed',
    'top:20px',
    'right:20px',
    'z-index:2147483647',
    'width:320px',
    'box-sizing:border-box',
    `background:${MINT}`,
    `color:${TEAL}`,
    'padding:14px 16px 12px',
    'border-radius:14px',
    `border:1px solid ${TEAL_SOFT}`,
    'font:500 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.16)',
    'overflow:hidden',
    reduceMotion ? 'opacity:1' : 'opacity:0',
    reduceMotion ? '' : 'transform:translateX(12px)',
    reduceMotion ? '' : 'transition:opacity .22s ease,transform .22s ease',
  ]
    .filter(Boolean)
    .join(';');

  const row = doc.createElement('div');
  row.style.cssText = 'display:flex;gap:11px;align-items:flex-start';

  const badge = doc.createElement('span');
  badge.innerHTML = MIC_SVG;
  badge.style.cssText = [
    'flex:0 0 auto',
    'width:32px',
    'height:32px',
    'border-radius:50%',
    `background:${TEAL}`,
    `color:${MINT}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const copy = doc.createElement('div');
  copy.style.cssText = 'flex:1 1 auto;min-width:0';

  const title = doc.createElement('div');
  title.textContent = 'Saar is joining to take notes';
  title.style.cssText = 'font-weight:600';

  const sub = doc.createElement('div');
  sub.textContent = 'It will record captions for this meeting.';
  sub.style.cssText = 'margin-top:2px;font-weight:400;opacity:.72;font-size:13px';

  const cancel = doc.createElement('button');
  cancel.setAttribute('data-saar-cancel', '');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = [
    'flex:0 0 auto',
    'align-self:center',
    `background:${TEAL}`,
    `color:${MINT}`,
    'border:0',
    'border-radius:9px',
    'padding:7px 13px',
    'cursor:pointer',
    'font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif',
  ].join(';');

  // Shows how long is left before it joins on its own — otherwise the toast
  // vanishing feels like it was dismissed rather than acted on.
  const track = doc.createElement('div');
  track.style.cssText = `margin-top:12px;height:3px;border-radius:2px;background:${TEAL_SOFT};overflow:hidden`;
  const fill = doc.createElement('div');
  fill.style.cssText = `height:100%;width:100%;border-radius:2px;background:${TEAL}`;
  track.appendChild(fill);

  copy.append(title, sub);
  row.append(badge, copy, cancel);
  host.append(row, track);
  doc.body.appendChild(host);

  // Next tick so the initial values are committed before transitioning from
  // them; setting both in the same frame would skip the animation entirely.
  const enter = setTimeout(() => {
    host.style.opacity = '1';
    host.style.transform = 'translateX(0)';
    if (!reduceMotion) {
      fill.style.transition = `width ${delayMs}ms linear`;
      fill.style.width = '0%';
    }
  }, 0);

  let settled = false;
  const finish = (fn?: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(enter);
    host.remove();
    fn?.();
  };

  const timer = setTimeout(() => finish(onProceed), delayMs);
  cancel.addEventListener('click', () => finish());

  return () => finish();
}
