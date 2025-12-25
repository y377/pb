/* pb.jsjs.net - shift-calendar PWA service worker */
const VERSION = 'v3';                 // 你每次改 SW 就改这个，强制更新
const APP_CACHE = `app-${VERSION}`;
const CDN_CACHE = `cdn-${VERSION}`;

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

// ✅ 安装时预缓存你要离线必用的 CDN 入口资源
const CDN_PRECACHE = [
  'https://cdn.anssl.cn/bootstrap/css/bootstrap.min.css',
  'https://cdn.anssl.cn/bootstrap-icons/font/bootstrap-icons.min.css',
  'https://cdn.anssl.cn/bootstrap/js/bootstrap.bundle.min.js',
  'https://cdn.anssl.cn/fullcalendar-6.1.20/index.global.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 1) App 壳缓存
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_SHELL);

    // 2) CDN 预缓存（no-cors => 能缓存跨域资源为 opaque，离线可用）
    const cdn = await caches.open(CDN_CACHE);
    await Promise.allSettled(
      CDN_PRECACHE.map(async (url) => {
        const req = new Request(url, { mode: 'no-cors' });
        const res = await fetch(req);
        await cdn.put(req, res);
      })
    );
  })());

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清旧缓存
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![APP_CACHE, CDN_CACHE].includes(k)) return caches.delete(k);
      return null;
    }));
    await self.clients.claim();
  })());
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: false });
  if (cached) return cached;
  const res = await fetch(req);
  await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: false });

  const fetchPromise = fetch(req).then(async (res) => {
    await cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 页面导航：网络优先，失败回退 index（保证离线可打开）
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        // 保持 index 最新
        await cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // 只缓存 GET
  if (req.method !== 'GET') return;

  // 同源静态资源：cache-first（离线稳定）
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }

  // 跨域静态资源（脚本/样式/字体/图片）：SWR（包含 bootstrap-icons 字体）
  const dest = req.destination; // script | style | font | image ...
  const isAsset = ['script', 'style', 'font', 'image'].includes(dest);

  if (url.protocol === 'https:' && isAsset) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }
});
