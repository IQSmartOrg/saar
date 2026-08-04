const TEAL = '#1A414E';
const MINT = '#D9EFEA';

/**
 * Renders the cancellable "joining" toast in the user's own Meet tab.
 * Returns a dismiss function; dismissing fires neither callback.
 */
export function showJoinToast(
  doc: Document,
  delayMs: number,
  onCancel: () => void,
  onProceed: () => void,
): () => void {
  const host = doc.createElement('div');
  host.setAttribute('data-saar-toast', '');
  host.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    `background:${MINT}`,
    `color:${TEAL}`,
    'padding:12px 16px',
    'border-radius:12px',
    'display:flex',
    'gap:12px',
    'align-items:center',
    'font:14px system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,.2)',
  ].join(';');

  const label = doc.createElement('span');
  label.textContent = 'Saar is joining to take notes…';

  const cancel = doc.createElement('button');
  cancel.setAttribute('data-saar-cancel', '');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = `background:${TEAL};color:${MINT};border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit`;

  host.append(label, cancel);
  doc.body.appendChild(host);

  let settled = false;
  const finish = (fn?: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    host.remove();
    fn?.();
  };

  const timer = setTimeout(() => finish(onProceed), delayMs);
  cancel.addEventListener('click', () => finish(onCancel));

  return () => finish();
}
