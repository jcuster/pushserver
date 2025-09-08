self.addEventListener('install', (event) => {
// You could pre-cache here. Keep it minimal for clarity.
self.skipWaiting();
});


self.addEventListener('activate', (event) => {
clients.claim();
});


// Handle incoming Web Push
self.addEventListener('push', (event) => {
let data = {};
try {
data = event.data ? event.data.json() : {};
} catch (e) {
try { data = { title: 'Push', body: event.data.text() }; } catch (_) { data = { title: 'Push' }; }
}


const title = data.title || 'Notification';
const options = {
body: data.body || '',
icon: data.icon || '/icon-192.png',
badge: data.badge || '/icon-192.png',
data: { url: data.url || '/' }
};


event.waitUntil(self.registration.showNotification(title, options));
});


self.addEventListener('notificationclick', (event) => {
event.notification.close();
const url = event.notification.data?.url || '/';
event.waitUntil((async () => {
const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
for (const client of allClients) {
const u = new URL(client.url);
if (u.pathname === new URL(url, self.location.origin).pathname) {
client.focus();
return;
}
}
await clients.openWindow(url);
})());
});
