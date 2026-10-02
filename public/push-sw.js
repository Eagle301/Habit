// Push handlers, pulled into the Workbox-generated service worker via `workbox.importScripts`
// in vite.config.ts. Payload comes from netlify/lib/push.ts: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Habits', {
      body: data.body || '',
      tag: data.tag || 'habits',
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
