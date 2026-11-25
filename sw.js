// 앱 파일만 캐시한다(네트워크 먼저). 쪽지(Firebase)는 캐시하지 않는다.
const VERSION = 'ideabox-v19';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/fb.js', 'js/pics.js', 'js/vendor/lucian-icons/runtime.js', 'js/vendor/lucian-icons/refresh.js', 'manifest.webmanifest', 'icons/icon.svg', 'img/ideabox-empty.webp', 'img/ideabox-myturn-empty.webp'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('ideabox-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 공유하기로 들어온 주소(?share=…)도 앱 화면으로 열리게 쿼리 없이 캐시를 찾는다
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { if (!u.search && r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
