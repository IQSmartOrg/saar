/**
 * Chrome notifications, which are the only way Saar speaks to someone whose
 * popup is shut — which is almost always.
 */
export async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icon-128.png',
      title,
      message,
    });
  } catch {
    /* notifications are best-effort */
  }
}
