self.addEventListener('install', (event) => {
  // You could pre-cache here. Keep it minimal for clarity.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  clients.claim();
});

// === E2EE helpers (IndexedDB + base64url + decrypt) ===
const idb = {
  open() { return new Promise((resolve, reject) => {
    const req = indexedDB.open('e2ee-db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });},
  async get(key) {
    const db = await idb.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }
};

const b64uToBuf = (str='') => {
  // base64url -> Uint8Array
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  const pad = str.length % 4 ? 4 - (str.length % 4) : 0;
  if (pad) str += '='.repeat(pad);
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
  return buf;
};

async function decryptE2EEEnvelope(env) {
  console.log(env);
  // env = { version, epk, iv, salt, ct } where epk is uncompressed EC point (X9.62)
  if (!env?.epk || !env?.iv || !env?.salt || !env?.ct) return null;

  // Decode and validate shapes
  const epk = b64uToBuf(env.epk);
  const iv = b64uToBuf(env.iv);
  const salt = b64uToBuf(env.salt);
  const ct = b64uToBuf(env.ct);
  if (epk.length !== 65 || epk[0] !== 0x04) throw new Error('bad-epk-x962');
  if (iv.length !== 12) throw new Error('bad-iv-len');
  if (salt.length !== 16) throw new Error('bad-salt-len');
  if (ct.length < 17) throw new Error('bad-ct-len'); // needs >= 1 + 16 tag

  const kp = await idb.get('e2eeKeyPair');
  if (!kp?.privateJwk) return null;

  const enc = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const log8 = (label, u8) => console.log('[E2EE]', label, enc(u8.slice(0,8)));
  
  let recipientPriv;
  try {
    recipientPriv = await crypto.subtle.importKey(
      'jwk', kp.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']
    );
    console.log('[E2EE] imported recipient private key');
  } catch (e) {
    console.error('[E2EE] importKey failed (priv):', e);
    throw e;
  }

  // Quick sanity check
  if (!kp?.privateJwk?.d) console.warn('[E2EE] private JWK missing "d"');

  let senderPub;
  try {
    senderPub = await crypto.subtle.importKey(
      'raw', epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    console.log('[E2EE] imported sender pub');
  } catch (e) {
    console.error('[E2EE] importKey failed (epk):', e);
    throw e;
  }

  let secretBits;
  try {
    secretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: senderPub },
      recipientPriv,
      256
    );
    console.log('[E2EE] derived secretBits');
  } catch (e) {
    console.error('[E2EE] deriveBits failed:', e);
    throw e;
  }

  const hkdfBase = await crypto.subtle.importKey('raw', secretBits, 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: b64uToBuf(env.salt), info: new Uint8Array([]) },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
  console.log('[E2EE] derived aesKey');
  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  console.log('[E2EE] device pubJWK fp', (kp?.publicJwk?.x||'').slice(0,8)+':' + (kp?.publicJwk?.y||'').slice(0,8));
  const hash = await crypto.subtle.digest('SHA-256', rawKey);
  log8('epk fp', b64uToBuf(env.epk));
  log8('salt fp', b64uToBuf(env.salt));
  console.log('[E2EE] epk len', b64uToBuf(env.epk).length); // should be 65, first byte 0x04
  const secret = new Uint8Array(secretBits);
  log8('ECDH secret fp', secret);
  const rawAesKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
  log8('AES key fp (device)', rawAesKey);
  console.log('[E2EE] key sha256 (first 8 bytes b64u):',
    btoa(String.fromCharCode(...new Uint8Array(hash).slice(0,8))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  );
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64uToBuf(env.iv) },
    aesKey,
    b64uToBuf(env.ct)
  );
  console.log(pt)
  return JSON.parse(new TextDecoder().decode(pt));
}

// Handle incoming Web Push
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try { data = { title: 'Push', body: event.data.text() }; } catch (_) { data = { title: 'Push' }; }
  }

  event.waitUntil((async () => {
    // If payload carries an E2EE envelope, decrypt it to {title, body, icon, badge, url}
    if (data && data.e2ee) {
      try {
        const inner = await decryptE2EEEnvelope(data.e2ee);
        if (inner) data = inner;
      } catch (e) {
        // If decryption fails, fall back to a minimal notification that surfaces the error.
        console.error('[E2EE] decrypt failed:', e, { haveEpk: !!data.e2ee?.epk, haveIv: !!data.e2ee?.iv, haveSalt: !!data.e2ee?.salt, haveCt: !!data.e2ee?.ct });
        data = { title: 'Encrypted message', body: 'Unable to decrypt on device.' };
      }
    }
    const title = data.title || 'Notification';
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-192.png',
      data: { url: data.url || '/pushserver' }
    };
    await self.registration.showNotification(title, options);
  })());
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
