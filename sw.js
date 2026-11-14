/* سند — Service Worker
   الهدف: بعد أول تحميل بالإنترنت يعمل التطبيق بلا إنترنت.
   - صفحات وملفات الموقع نفسه: الشبكة أولاً ثم النسخة المخزنة (تصل التحديثات عند الاتصال).
   - مكتبات CDN المثبّتة الإصدار وأوزان coco-ssd: المخزن أولاً.
   - نماذج Hugging Face: لا يعترضها هذا الملف (تخزنها مكتبة transformers.js بنفسها)،
     وحزمة لغة Tesseract تخزنها مكتبتها في IndexedDB.
   - أي طلب آخر (Gemini، OpenRouter، الترجمة، خادم الصور الخاص) يمر مباشرة دون تخزين.
   - ملفات الحزم *.json (غير manifest.json) لا تُخزَّن هنا لأن التطبيق يحفظها في IndexedDB.
   لإصدار تحديث جديد للموقع غيّر رقم VERSION. */
const VERSION = 'v1';
const CORE_CACHE = 'sanad-core-' + VERSION;
const LIB_CACHE = 'sanad-libs-v1';
const CORE_FILES = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'storage.googleapis.com'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CORE_CACHE).then(c => Promise.allSettled(CORE_FILES.map(f => c.add(f)))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('sanad-core-') && k !== CORE_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(req, isNav) {
  const cache = await caches.open(CORE_CACHE);
  const cached = await cache.match(req, { ignoreSearch: isNav }) || (isNav ? await cache.match('./', { ignoreSearch: true }) : null);
  try {
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
    if (!cached) return await net;
    // شبكة بطيئة: لا تُبقِ الكفيف ينتظر، افتح النسخة المخزنة بعد 2.5 ثانية (التحديث يكتمل بالخلفية)
    return await Promise.race([net, new Promise(r => setTimeout(() => r(cached), 2500))]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: isNav }) || (isNav ? await cache.match('./', { ignoreSearch: true }) : null);
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque') && res.status !== 206) cache.put(req, res.clone());
    return res;
  } catch (err) { return Response.error(); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('.json') && !url.pathname.endsWith('manifest.json')) return;
    e.respondWith(networkFirst(req, req.mode === 'navigate'));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
});
