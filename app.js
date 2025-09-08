const qs = (s) => document.querySelector(s);
} else {
$status.install.textContent = 'Likely running in browser (install to Home Screen)';
}
});


// Permission & subscribe
btnPermission.addEventListener('click', async () => {
try {
const result = await Notification.requestPermission();
$status.perm.textContent = `Permission: ${result}`;
} catch (e) {
$status.perm.textContent = 'Permission request failed';
}
});


btnSubscribe.addEventListener('click', async () => {
try {
const vapid = (inputVapid.value || '').trim();
if (!vapid) { alert('Enter your VAPID public key first.'); return; }
const reg = await getRegistration();
if (!reg) return;


const sub = await reg.pushManager.subscribe({
userVisibleOnly: true,
applicationServerKey: base64urlToUint8Array(vapid)
});


await renderSubscription(sub);
$status.perm.textContent = 'Subscribed';
} catch (e) {
console.error(e);
$status.perm.textContent = 'Subscribe failed (ensure installed on iOS & permission granted)';
}
});


btnUnsubscribe.addEventListener('click', async () => {
const reg = await getRegistration();
const sub = await reg?.pushManager.getSubscription();
if (sub) await sub.unsubscribe();
$status.perm.textContent = 'Unsubscribed';
show($out.endpoint, '—'); show($out.p256dh, '—'); show($out.auth, '—'); show($out.json, '{}');
});


btnTest.addEventListener('click', async () => {
const reg = await getRegistration();
if (!reg) return;
reg.showNotification('Local Test Notification', {
body: 'This notification is shown locally via the SW.',
icon: '/icon-192.png',
badge: '/icon-192.png'
});
});


async function renderSubscription(sub) {
if (!sub) {
const reg = await getRegistration();
sub = await reg?.pushManager.getSubscription();
}
if (!sub) return;


const endpoint = sub.endpoint;
const p256dh = arrayBufferToBase64url(sub.getKey('p256dh'));
const auth = arrayBufferToBase64url(sub.getKey('auth'));


show($out.endpoint, endpoint);
show($out.p256dh, p256dh);
show($out.auth, auth);


const json = {
endpoint,
keys: { p256dh, auth }
};
show($out.json, JSON.stringify(json, null, 2));
}


// Autoload existing subscription on startup
(async () => {
if ('serviceWorker' in navigator) {
const reg = await navigator.serviceWorker.getRegistration();
if (reg) $status.sw.innerHTML = '<span class="ok">registered</span>';
renderSubscription();
}
})();
