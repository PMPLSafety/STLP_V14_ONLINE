// STLP Service Worker — required for iOS/Android Web Push after "Add to Home Screen".
// This file must be served from the SAME origin/root as index.html (GitHub Pages does this fine).

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Fired when the browser/OS delivers a push message from the server.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "STLP Notification", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "STLP Notification";
  const options = {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: data.url || "./index.html" }
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // App Badge (the little number on the Home Screen icon). Supported on
      // iOS 16.4+ / Android for installed (Home-Screen) PWAs. We count the
      // currently-visible (not-yet-tapped) notifications as the badge number.
      if ("setAppBadge" in self.registration) {
        return self.registration.getNotifications().then((notifs) => {
          return self.registration.setAppBadge(notifs.length);
        });
      }
    })
  );
});

// Fired when the user taps the notification — bring the app to the foreground.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";

  event.waitUntil(
    Promise.resolve()
      .then(() => {
        // Update the badge to reflect the notifications still left unread.
        if ("setAppBadge" in self.registration) {
          return self.registration.getNotifications().then((notifs) => {
            return notifs.length > 0
              ? self.registration.setAppBadge(notifs.length)
              : self.registration.clearAppBadge();
          });
        }
      })
      .then(() =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true })
      )
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
