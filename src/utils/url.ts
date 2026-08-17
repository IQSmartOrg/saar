/** Joins a base URL and a path without doubling or dropping the slash. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * `http://localhost:11434/v1` → `http://localhost/*`, the shape
 * `chrome.permissions.request` wants. Null when the URL will not parse.
 */
export function originPattern(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

/** True for a URL a model running on this machine would be serving. */
export function isLocalEndpoint(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
