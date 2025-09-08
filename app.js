const qs = (s) => document.querySelector(s);
const $status = {
  sw: qs('#sw-status'),
  install: qs('#install-status'),
  perm: qs('#perm-status'),
  key: qs('#key-status'),
};
const $out = {
  endpoint: qs('#out-endpoint'),
  p256dh: qs('#out-p256dh'),
  auth: qs('#out-auth'),
  json: qs('#out-json'),
};

const btnRegister = qs('#btn-register');
const btnUnregister = qs('#btn-unregister');
const btnPermission = qs('#btn-permission');
const btnSubscribe = qs('#btn-subscribe');
const btnUnsubscribe = qs('#btn-unsubscribe');
const btnTest = qs('#btn-test-notification');
const btnSaveKey = qs('#btn-save-key');
const btnClearKey = qs('#btn-clear-key');
const inputVapid = qs('#vapid');

// Helpers
const show = (el, value) => { el.textContent = value ?? '—'; };
const copyFrom = (selector) => {
  const el = qs(selector);
  const text = el?.textContent?.trim() ?? '';
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
};

document.querySelectorAll('button.copy').forEach(btn => {
  btn.addEventListener('click', () => copyFrom(btn.getAttribute('data-copy')));
});

// Init from localStorage
inputVapid.value = localStorage.getItem('vapidPublicKey') || '';

btnSaveKey.addEventListener('click', () => {
  localStorage.setItem('vapidPublicKey', inputVapid.value.trim());
  $status.key.textContent = inputVapid.value ? 'Saved' : '';
});
btnClearKey.addEventListener('click', () => {
  localStorage.removeItem('vapidPublicKey');
  inputVapid.value = '';
  $status.key.textContent = 'Cleared';
});

// Service worker registration helpers
async function registerSW() {
  if (!('serviceWorker' in navigator)) { $status.sw.textContent = 'Service workers not supported'; return null; }
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js');
    $status.sw.innerHTML = '<span class="ok">registered</span>';
    return reg;
  } catch (err) {
    console.error(err);
    $status.sw.innerHTML = '<span class="err">failed</span>';
    return null;
  }
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return registerSW();
}

btnRegister.addEventListener('click', registerSW);
btnUnregister.addEventListener('click', async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) await reg.unregister();
  $status.sw.textContent = 'unregistered';
});

// Installability note (best effort)
window.addEventListener('load', () => {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    $status.install.textContent = 'Running as an installed app';
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
      applicationServerKey: vapid
    });

    await renderSubscription(sub);
    $status.perm.textContent = 'Subscribed';
  } catch (e) {
    console.error(e);
    $status.perm.textContent = 'Subscribe failed (ensure installed on iOS & permission granted): ' + e;
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

  const json = sub.toJSON();
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
