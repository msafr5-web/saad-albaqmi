// Network-only for all app and API responses: no financial or student data in caches.
// This worker provides an explicit offline page, not offline data editing.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>لا يوجد اتصال — صرح البقمي</title><body style="font-family:Tahoma,sans-serif;background:#f5f6f3;color:#163d32;display:grid;place-items:center;min-height:90vh;text-align:center;padding:20px"><main><h1>أنت غير متصل بالإنترنت</h1><p>تحتاج المنصة إلى الاتصال لحماية دقة البيانات المالية والأكاديمية.</p><p>لا تُحفظ بيانات الطلاب أو المعاملات على هذا الجهاز للعمل دون اتصال.</p><button style="padding:12px 24px;background:#163d32;color:white;border:0;border-radius:8px;cursor:pointer" onclick="location.reload()">إعادة المحاولة</button></main></body></html>',
    {status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}}
  )));
});
