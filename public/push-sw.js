/*
 * Push handling, imported into the generated service worker via Workbox's
 * importScripts. Kept as a separate plain script so the rest of the service
 * worker stays generated rather than hand-maintained.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Life Dashboard', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Life Dashboard', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // A tag means a second brief replaces the first rather than stacking.
      tag: payload.tag || 'life-dashboard',
      renotify: false,
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an open tab if there is one rather than opening a duplicate.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
