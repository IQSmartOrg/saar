/**
 * Prioritised control resolution for Google Meet.
 *
 * Google reflows this DOM without notice, so no single selector survives. We
 * try several independent signals in order of durability and report which one
 * matched — falling through to a weaker layer is an early warning that Google
 * shipped a change, visible before capture actually breaks.
 *
 * Order matters, and it is the opposite of what feels natural:
 *
 *   jsname  Google's internal component id. Not localised, tied to component
 *           identity rather than styling, so it outlives CSS churn.
 *   icon    Material Symbols ligature text ("mic", "closed_caption"). Not
 *           localised — the glyph name is the same in every language.
 *   aria    aria-label regex. Readable and fairly stable, but LOCALISED: this
 *           layer fails outright on a non-English Meet UI.
 *   text    Visible label. Also localised, and the most cosmetic. Last resort.
 *   css     Class names. Accurate today, rotate tomorrow.
 *
 * No `chrome.*` here — this must run unchanged under Puppeteer.
 */
export type MatchStrategy = 'jsname' | 'icon' | 'aria' | 'text' | 'css';

export const STRATEGY_ORDER: readonly MatchStrategy[] = ['jsname', 'icon', 'aria', 'text', 'css'];

export interface ControlSpec {
  /** Values for the jsname attribute, most likely first. */
  readonly jsname?: readonly string[];
  /** Material icon ligature names appearing inside the control. */
  readonly icon?: readonly string[];
  /** Matched against aria-label. Localised — English UIs only. */
  readonly aria?: RegExp;
  /** Lowercased visible labels, most specific first. Localised. */
  readonly text?: readonly string[];
  /** Raw CSS fallback. */
  readonly css?: string;
}

export interface Resolved {
  readonly el: HTMLElement;
  readonly matchedBy: MatchStrategy;
}

const ICON_NODE = '[aria-hidden="true"], i, .google-symbols, .notranslate';

/** Visible label with Material icon ligatures stripped out. */
export function visibleLabel(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(ICON_NODE).forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Icon ligature names present inside a control, e.g. ["mic"]. */
export function iconNames(el: Element): string[] {
  return Array.from(el.querySelectorAll(ICON_NODE))
    .map((n) => (n.textContent ?? '').trim().toLowerCase())
    .filter((t) => t !== '' && /^[a-z0-9_]+$/.test(t));
}

function clickable(doc: Document): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
  );
  // Innermost only. Meet nests controls inside wrapper divs whose textContent
  // includes the inner label, so a naive match lands on a wrapper and the click
  // silently does nothing.
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

export function resolveControl(doc: Document, spec: ControlSpec): Resolved | null {
  const candidates = clickable(doc);

  for (const strategy of STRATEGY_ORDER) {
    let el: HTMLElement | undefined;

    switch (strategy) {
      case 'jsname':
        for (const name of spec.jsname ?? []) {
          el = candidates.find((c) => c.getAttribute('jsname') === name);
          if (el) break;
        }
        break;

      case 'icon':
        for (const name of spec.icon ?? []) {
          el = candidates.find((c) => iconNames(c).includes(name));
          if (el) break;
        }
        break;

      case 'aria':
        if (spec.aria) {
          const re = spec.aria;
          el = candidates.find((c) => re.test(c.getAttribute('aria-label') ?? ''));
        }
        break;

      case 'text':
        for (const wanted of spec.text ?? []) {
          el =
            candidates.find((c) => visibleLabel(c) === wanted) ??
            candidates.find((c) => visibleLabel(c).startsWith(wanted));
          if (el) break;
        }
        break;

      case 'css':
        if (spec.css) el = doc.querySelector<HTMLElement>(spec.css) ?? undefined;
        break;
    }

    if (el) return { el, matchedBy: strategy };
  }

  return null;
}
