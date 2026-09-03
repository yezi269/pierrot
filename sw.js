const CACHE = 'jingyu-v3';

// ── 后台定时任务存储 ──
// 存放从主页面委托给 SW 的定时事件 {id, fireAt, title, body}
let swTimers = [];

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});

// 收到通知消息（Push API）
self.addEventListener('push', e => {
    const data = e.data ? e.data.json() : { title: '静语', body: '你有新消息' };
    e.waitUntil(
        self.registration.showNotification(data.title || '静语', {
            body: data.body || '你有新消息',
            vibrate: [200, 100, 200],
            tag: 'jingyu-' + Date.now()
        })
    );
});

// 点击通知打开页面
self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
            if (cs.length) { cs[0].focus(); return; }
            return clients.openWindow('./');
        })
    );
});

// ── 通知所有客户端某个定时任务已触发 ──
const notifyClients = async (type, payload) => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
        c.postMessage({ type, ...payload });
    }
};

// ── 接收主页面发来的消息 ──
self.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;

    // 显示通知
    if (msg.type === 'SHOW_NOTIF') {
        self.registration.showNotification(msg.title, {
            body: msg.body,
            vibrate: [200, 100, 200],
            tag: 'jingyu-' + Date.now()
        });
        return;
    }

    // 保活 ping — 只要 SW 还活着就回复
    if (msg === 'keepalive' || msg.type === 'keepalive') {
        e.source && e.source.postMessage({ type: 'keepalive_ack' });
        return;
    }

    // 委托 SW 后台计时（页面切走后依然可触发）
    // { type: 'SCHEDULE', id, fireAt(ms timestamp), notifTitle, notifBody, clientEvent }
    if (msg.type === 'SCHEDULE') {
        // 去重
        swTimers = swTimers.filter(t => t.id !== msg.id);
        const delay = Math.max(0, msg.fireAt - Date.now());
        const timer = setTimeout(async () => {
            swTimers = swTimers.filter(t => t.id !== msg.id);
            // 先通知客户端
            await notifyClients('SW_FIRE', { id: msg.id, clientEvent: msg.clientEvent });
            // 如果有通知文本也发通知
            if (msg.notifTitle) {
                self.registration.showNotification(msg.notifTitle, {
                    body: msg.notifBody || '',
                    vibrate: [200, 100, 200],
                    tag: 'jingyu-sw-' + msg.id
                });
            }
        }, delay);
        swTimers.push({ id: msg.id, fireAt: msg.fireAt, timer });
        return;
    }

    // 取消委托的计时
    if (msg.type === 'UNSCHEDULE') {
        const found = swTimers.find(t => t.id === msg.id);
        if (found) { clearTimeout(found.timer); }
        swTimers = swTimers.filter(t => t.id !== msg.id);
        return;
    }
});