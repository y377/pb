/* shift-calendar PWA – Service Worker (方案一：no-cors → cache-first) */

const VERSION = 'v4'; // 修改 SW 时递增
const APP_CACHE = `app-${VERSION}`;
const CDN_CACHE = `cdn-${VERSION}`;

/* ======================
   App Shell（同源）
====================== */
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/service-worker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon-180.png'
];

/* ======================
   CDN 预缓存（跨域）
   使用 no-cors → opaque
====================== */
const CDN_PRECACHE = [
  'https://cdn.anssl.cn/bootstrap/css/bootstrap.min.css',
  'https://cdn.anssl.cn/bootstrap-icons/font/bootstrap-icons.min.css',
  'https://cdn.anssl.cn/bootstrap/js/bootstrap.bundle.min.js',
  'https://cdn.anssl.cn/fullcalendar-6.1.20/index.global.min.js'
];

/* ======================
   install
====================== */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // App Shell
    const appCache = await caches.open(APP_CACHE);
    await appCache.addAll(APP_SHELL);

    // CDN 资源（no-cors，只缓存，不解析）
    const cdnCache = await caches.open(CDN_CACHE);
    await Promise.allSettled(
      CDN_PRECACHE.map(async (url) => {
        try {
          const req = new Request(url, { mode: 'no-cors' });
          const res = await fetch(req);
          await cdnCache.put(req, res);
        } catch (_) {
          // CDN 失败不阻断 install
        }
      })
    );
  })());

  self.skipWaiting();
});

/* ======================
   activate
====================== */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        if (![APP_CACHE, CDN_CACHE].includes(key)) {
          return caches.delete(key);
        }
        return null;
      })
    );
    await self.clients.claim();
  })());
});

/* ======================
   工具函数
====================== */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  const res = await fetch(req);
  await cache.put(req, res.clone());
  return res;
}

async function cacheFirstNoCors(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  // 保持 no-cors 语义
  const res = await fetch(req);
  return res;
}

/* ======================
   fetch
====================== */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* ---- 页面导航 ---- */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        await cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(APP_CACHE);
        return (
          (await cache.match('/index.html')) ||
          new Response('Offline', { status: 503 })
        );
      }
    })());
    return;
  }

  // 只处理 GET
  if (req.method !== 'GET') return;

  /* ---- 同源资源 ---- */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }

  /* ---- 跨域静态资源（no-cors）---- */
  const isAsset = ['script', 'style', 'font', 'image'].includes(req.destination);

  if (isAsset && req.mode === 'no-cors') {
    event.respondWith(cacheFirstNoCors(req, CDN_CACHE));
    return;
  }

  // 其他请求：直连网络
});
