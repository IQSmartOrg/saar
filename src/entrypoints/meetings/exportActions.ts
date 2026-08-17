import { el } from '@/ui/dom';

/**
 * Getting a meeting out of Saar: the clipboard and a .md file.
 *
 * Both live here rather than in the detail view because the confirmation
 * behaviour — a copy that says nothing looks like a copy that failed — is the
 * only thing about them that is not obvious.
 */

export function downloadMarkdown(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const FLASH_MS = 1600;

/** Confirms a copy happened: label swap plus a green tick, then reverts. */
export function flashCopied(node: HTMLButtonElement, label = 'Copied'): void {
  node.dataset['original'] ??= node.textContent ?? '';
  const original = node.dataset['original'];

  node.replaceChildren(el('span', 'tick-in', '✓'), document.createTextNode(label));
  node.classList.add('copied');
  node.disabled = true;

  window.clearTimeout(Number(node.dataset['timer'] ?? 0));
  node.dataset['timer'] = String(
    window.setTimeout(() => {
      node.textContent = original;
      node.classList.remove('copied');
      node.disabled = false;
    }, FLASH_MS),
  );
}

/** Copies to the clipboard and reports either outcome on the button itself. */
export function copyToClipboard(node: HTMLButtonElement, body: string): void {
  void navigator.clipboard
    .writeText(body)
    .then(() => flashCopied(node))
    .catch(() => flashCopied(node, 'Copy failed'));
}
