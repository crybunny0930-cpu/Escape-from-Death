/* Escape from Death — 서비스 워커
 * - 게임 본체(index.html): 인터넷이 되면 항상 최신본을 받고, 안 되면 저장해 둔 것을 씁니다.
 * - 음악(audio/): 한 번 받으면 기기에 저장해 두고 다음부터 바로 씁니다. (오프라인에서도 재생)
 * - Supabase 등 다른 사이트로 가는 요청은 건드리지 않습니다. (로그인·클라우드 저장에 영향 없음)
 * 새 버전 알림은 index.html 안의 코드가 담당하므로, 게임을 업데이트할 때 이 파일은 고치지 않아도 됩니다.
 */
const CACHE = "efd-v1";
const SHELL = ["./", "index.html", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("efd-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(networkFirst(req));
  } else if (url.pathname.includes("/audio/")) {
    e.respondWith(audioCacheFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const net = await fetch(req.url, { cache: "no-cache" });
    if (net.ok) cache.put("index.html", net.clone());
    return net;
  } catch (_) {
    const hit = (await cache.match("index.html")) || (await cache.match("./"));
    return hit || new Response("오프라인입니다. 인터넷에 연결한 뒤 다시 열어 주세요.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  const fresh = fetch(req).then(r => { if (r.ok) cache.put(req.url, r.clone()); return r; }).catch(() => null);
  return hit || (await fresh) || new Response("", { status: 504 });
}

// 음악: 처음 한 번만 통째로 받아 저장. 브라우저가 Range(일부만 달라는) 요청을 보내면 저장본에서 잘라 줍니다.
async function audioCacheFirst(req) {
  const cache = await caches.open(CACHE);
  let res = await cache.match(req.url);
  if (!res) {
    let net;
    try { net = await fetch(req.url); } catch (_) { return new Response("", { status: 504 }); }
    if (!net.ok) return net;
    await cache.put(req.url, net.clone());
    res = net;
  }
  const range = req.headers.get("range");
  if (!range) return res;

  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) return new Response(buf, { status: 200, headers: audioHeaders(size) });
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (start >= size || start > end) {
    return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  const h = audioHeaders(end - start + 1);
  h["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(buf.slice(start, end + 1), { status: 206, headers: h });
}
function audioHeaders(len) {
  return { "Content-Type": "audio/mpeg", "Content-Length": String(len), "Accept-Ranges": "bytes" };
}
