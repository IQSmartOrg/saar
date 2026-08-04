import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Saar',
    description: 'AI note-taking for your meetings.',
    version: '0.1.0',
    permissions: ['tabs', 'storage', 'notifications', 'scripting'],
    host_permissions: ['https://meet.google.com/*'],
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
