/* health-site 离线缓存:GIF/静态资源 cache-first, data JSON network-first */
const CACHE = 'healthsite-v4';
const CORE = [
  './',
  './index.html',
  './vendor/chart.umd.min.js',
  './vendor/chartjs-adapter-date-fns.bundle.min.js',
  './data/body.json',
  './data/config.json',
  './data/daily_summary.json',
  './data/goals.json',
  './data/knowledge.json',
  './data/notes.json',
  './data/reviews.json',
  './data/training.json',
  './data/training_log.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function cleanKey(request) {
  const u = new URL(request.url);
  u.search = '';
  return u.toString();
}

function putCache(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  let copy;
  try { copy = response.clone(); } catch (e) { return; }
  caches.open(CACHE).then(cache => cache.put(cleanKey(request), copy)).catch(() => {});
}

function offlineJSON() {
  return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
}

function networkFirst(req) {
  return new Promise(resolve => {
    let settled = false;
    const finish = cached => resolve(cached || offlineJSON());
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      caches.match(cleanKey(req)).then(finish);
    }, 1500);
    fetch(req).then(res => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      putCache(req, res);
      resolve(res);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caches.match(cleanKey(req)).then(finish);
    });
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 数据 JSON:优先网络,失败用缓存(离线可看上次数据)
  if (url.pathname.indexOf('/data/') === 0 || /\.json$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // GIF/图片:缓存优先,首次访问写入缓存
  if (req.destination === 'image' || /\.(gif|png|jpe?g|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(cleanKey(req)).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => { putCache(req, res); return res; })
          .catch(() => cached);
      })
    );
    return;
  }

  // 页面导航:优先网络,失败回退缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => { putCache(req, res); return res; }).catch(() =>
        caches.match('./index.html').then(c => c || caches.match('./'))
      )
    );
    return;
  }

  // 其他同源静态:有缓存先用缓存,同时后台更新
  event.respondWith(
    caches.match(cleanKey(req)).then(cached => {
      const network = fetch(req).then(res => { putCache(req, res); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
