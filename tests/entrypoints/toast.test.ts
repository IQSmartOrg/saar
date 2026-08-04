// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showJoinToast } from '@/entrypoints/meet-detector/toast';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('showJoinToast', () => {
  it('renders a toast naming the product', () => {
    showJoinToast(document, 5000, () => {}, () => {});
    expect(document.body.textContent).toContain('Saar');
  });

  it('calls onProceed once the delay elapses', () => {
    const proceed = vi.fn();
    showJoinToast(document, 5000, () => {}, proceed);
    vi.advanceTimersByTime(5000);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents onProceed and fires onCancel', () => {
    const proceed = vi.fn();
    const cancel = vi.fn();
    showJoinToast(document, 5000, cancel, proceed);
    document.querySelector<HTMLButtonElement>('[data-saar-cancel]')!.click();
    vi.advanceTimersByTime(5000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
  });

  it('removes itself from the DOM after proceeding', () => {
    showJoinToast(document, 5000, () => {}, () => {});
    vi.advanceTimersByTime(5000);
    expect(document.querySelector('[data-saar-toast]')).toBeNull();
  });

  it('removes itself from the DOM after cancelling', () => {
    showJoinToast(document, 5000, () => {}, () => {});
    document.querySelector<HTMLButtonElement>('[data-saar-cancel]')!.click();
    expect(document.querySelector('[data-saar-toast]')).toBeNull();
  });

  it('the returned dismiss function is idempotent and fires neither callback', () => {
    const proceed = vi.fn();
    const cancel = vi.fn();
    const dismiss = showJoinToast(document, 5000, cancel, proceed);
    dismiss();
    dismiss();
    vi.advanceTimersByTime(5000);
    expect(proceed).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('clicking cancel twice only fires onCancel once', () => {
    const cancel = vi.fn();
    showJoinToast(document, 5000, cancel, () => {});
    const btn = document.querySelector<HTMLButtonElement>('[data-saar-cancel]')!;
    btn.click();
    btn.click();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
