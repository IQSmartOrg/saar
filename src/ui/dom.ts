/**
 * The handful of DOM helpers both extension pages need.
 *
 * Saar's pages build their markup in TypeScript rather than templating strings,
 * so nothing user- or model-supplied can ever be parsed as HTML. `el()` and
 * `button()` are what make that readable; they were duplicated in the popup and
 * the meetings page before they lived here.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Progress bar with the ARIA a sighted user gets for free from the fill width. */
export function track(percent: number): HTMLElement {
  const outer = el('div', 'track');
  outer.setAttribute('role', 'progressbar');
  outer.setAttribute('aria-valuenow', String(percent));
  outer.setAttribute('aria-valuemin', '0');
  outer.setAttribute('aria-valuemax', '100');
  const fill = el('span');
  fill.style.width = `${percent}%`;
  outer.append(fill);
  return outer;
}

/** Required element by id. Throws rather than handing back a silent null. */
export function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}
