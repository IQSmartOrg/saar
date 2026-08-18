import type { ControlSpec } from '@/meet/controls';

/**
 * Finding a Meet control on the page.
 *
 * Google reflows this DOM without notice, so no single selector survives. We
 * try several independent signals in order of durability and report which one
 * matched — falling through to a weaker layer is an early warning that Google
 * shipped a change, visible before joining or capture actually breaks.
 *
 * Order matters, and it is the opposite of what feels natural:
 *
 *   jsname  Google's internal component id. Not localised, tied to component
 *           identity rather than styling, so it outlives CSS churn.
 *   icon    Material Symbols ligature text ("mic", "call_end"). Not localised —
 *           the glyph name is the same in every language.
 *   aria    aria-label regex. Readable and fairly stable, but LOCALISED: this
 *           layer fails outright on a non-English Meet UI.
 *   text    Visible label. Also localised, and the most cosmetic. Last resort.
 *   css     Class names. Accurate today, rotate tomorrow.
 *
 * No `chrome.*` here — this must run unchanged under Puppeteer.
 */
export type MatchStrategy = 'jsname' | 'icon' | 'aria' | 'text' | 'css';

export const STRATEGY_ORDER: readonly MatchStrategy[] = ['jsname', 'icon', 'aria', 'text', 'css'];

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

/**
 * @param includeDisabled keep controls that cannot be clicked.
 *
 * Clicking and reading are different needs, and conflating them was a bug: a
 * disabled mic button still carries `data-is-muted`, so it answers "is the mic
 * off?" perfectly well even though it cannot be pressed. Filtering it out meant
 * the safety gate could never confirm a mute it was looking straight at, and
 * the bot silently declined to join.
 */
function candidates(doc: Document, includeDisabled: boolean): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
    (el) =>
      includeDisabled ||
      (!el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true'),
  );
  // Innermost only. Meet nests controls inside wrapper divs whose textContent
  // includes the inner label, so a naive match lands on a wrapper and the click
  // silently does nothing.
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

export interface ResolveOptions {
  /** Include controls that are disabled. For reading state, never for clicking. */
  readonly includeDisabled?: boolean;
}

export function resolveControl(
  doc: Document,
  spec: ControlSpec,
  opts: ResolveOptions = {},
): Resolved | null {
  const candidates_ = candidates(doc, opts.includeDisabled === true);

  for (const strategy of STRATEGY_ORDER) {
    let el: HTMLElement | undefined;

    switch (strategy) {
      case 'jsname':
        for (const name of spec.jsname ?? []) {
          el = candidates_.find((c) => c.getAttribute('jsname') === name);
          if (el) break;
        }
        break;

      case 'icon':
        for (const name of spec.icon ?? []) {
          el = candidates_.find((c) => iconNames(c).includes(name));
          if (el) break;
        }
        break;

      case 'aria':
        if (spec.aria) {
          const re = spec.aria;
          el = candidates_.find((c) => re.test(c.getAttribute('aria-label') ?? ''));
        }
        break;

      case 'text':
        for (const wanted of spec.text ?? []) {
          el =
            candidates_.find((c) => visibleLabel(c) === wanted) ??
            candidates_.find((c) => visibleLabel(c).startsWith(wanted));
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
