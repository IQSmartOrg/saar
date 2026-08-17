import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Not the default '.output': a dot-directory is hidden in the macOS file
  // picker, which makes "Load unpacked" needlessly fiddly.
  outDir: 'dist',
  manifest: {
    name: 'Saar',
    description: 'AI note-taking for your meetings.',
    version: '0.1.0',
    // `alarms` drives the stop-signal watchdog: a setTimeout in an MV3 service
    // worker dies with the worker, so the liveness guarantee needs an alarm.
    permissions: ['tabs', 'storage', 'notifications', 'scripting', 'alarms'],
    host_permissions: ['https://meet.google.com/*'],
    // The model endpoint is user-supplied, so it cannot be declared at build
    // time — and a blanket install-time prompt for all hosts would be
    // indefensible for a feature that is off by default. Requested at the
    // moment the user turns AI summaries on.
    //
    // This permission is also what makes a local Ollama work with NO setup:
    // Chrome omits the Origin header on requests to a host the extension has
    // permission for, so Ollama's extension-origin block never applies.
    // Verified 2026-08-15 against Ollama 0.18 — without the permission Chrome
    // sends `Origin: chrome-extension://<id>` and Ollama answers 403.
    optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*'],
    action: { default_popup: 'popup.html', default_title: 'Saar' },
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
  // Resolved from the project root, not srcDir — '../assets' silently points
  // outside the repo and copies nothing.
  publicDir: 'assets',
});
