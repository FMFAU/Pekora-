// ════════════════════════════════════════════════════════════════════════════
//  pk-bulktrade.js  —  Pekora+ Trade Menu  (v3.3)
//  Exposes: window.PekoraPlus.BulkTrade
//  Requires: pk-core.js, pk-toast.js
//  Tabs: Blast · Cancel · History · Portfolio · Alerts · Lookup · Autosell
// ════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NS = (window.PekoraPlus = window.PekoraPlus || {});
    const { El, Span, Fmt, Toast } = NS;

    // ── shared state ──────────────────────────────────────────────────────
    let BT_Running = false, BT_Abort = false;
    let CancelRunning = false, CancelAbort = false;
    let BT_OwnerCache = {};

    // autosell state
    let AS_Running = false, AS_Interval = null, AS_IntervalMin = 3;
    let AS_SelectedItem = null, AS_CurrentPrice = null, AS_LastUasId = null;
    let AS_Inventory = [];

    // alerts state
    let PriceAlerts = [], AlertInterval = null, AlertPct = 5;

    // history cache
    let HistoryTrades = [], HistoryType = '';

    const Sleep = ms => new Promise(r => setTimeout(r, ms));

    // ── CSS injected once ─────────────────────────────────────────────────
    const CSS = `
#pk-tm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);z-index:1000000;display:flex;align-items:center;justify-content:center;}
#pk-tm-panel{background:#0d1117;border:1px solid rgba(255,255,255,.09);border-radius:12px;width:860px;max-width:97vw;height:640px;max-height:95vh;display:flex;flex-direction:column;box-shadow:0 28px 80px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden;font-family:'Source Sans Pro',sans-serif;font-size:13px;color:#8b949e;}
#pk-tm-header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:#080c10;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;cursor:grab;user-select:none;}
#pk-tm-header:active{cursor:grabbing;}
#pk-tm-tabbar{display:flex;background:#080c10;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;overflow-x:auto;padding:0 8px;}
#pk-tm-tabbar::-webkit-scrollbar{display:none;}
.pk-tm-tab{padding:10px 13px;cursor:pointer;font-size:11px;font-weight:600;color:#444;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;white-space:nowrap;flex-shrink:0;letter-spacing:.1px;text-transform:uppercase;display:flex;align-items:center;gap:5px;}
.pk-tm-tab:hover{color:#6b7280;}
.pk-tm-tab.pk-tm-active{color:#e6edf3;border-bottom-color:var(--pk-accent,#0e6fff);}
#pk-tm-body{flex:1;min-height:0;position:relative;overflow:hidden;}
#pk-tm-body::-webkit-scrollbar{width:4px;}
#pk-tm-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.09);border-radius:3px;}
.pk-tm-pane{display:block;padding:16px 18px;position:absolute;inset:0;overflow-y:auto;visibility:hidden;pointer-events:none;}
.pk-tm-pane.pk-tm-active{visibility:visible;pointer-events:auto;}
.pk-tm-2col{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.pk-tm-box{background:#161b22;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;margin-bottom:12px;}
.pk-tm-box-title{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#444;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;}
.pk-tm-box-title em{color:var(--pk-accent,#0e6fff);font-style:normal;}
.pk-tm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-family:'Source Sans Pro',sans-serif;font-size:12px;font-weight:700;transition:filter .12s,transform .1s;white-space:nowrap;}
.pk-tm-btn:disabled{opacity:.3;cursor:not-allowed;}
.pk-tm-btn:active:not(:disabled){transform:scale(.97);}
.pk-tm-btn:hover:not(:disabled){filter:brightness(1.12);}
.pk-tm-btn-blue{background:rgba(31,111,235,.2);color:#58a6ff;border:1px solid rgba(56,139,253,.3);}
.pk-tm-btn-green{background:rgba(26,127,55,.2);color:#3fb950;border:1px solid rgba(46,160,67,.35);}
.pk-tm-btn-red{background:rgba(218,54,51,.15);color:#f85149;border:1px solid rgba(248,81,73,.3);}
.pk-tm-btn-amber{background:rgba(187,128,9,.15);color:#e3b341;border:1px solid rgba(227,179,65,.3);}
.pk-tm-btn-ghost{background:rgba(255,255,255,.05);color:#8b949e;border:1px solid rgba(255,255,255,.1);}
.pk-tm-btn-w{width:100%;}
.pk-tm-btn-sm{padding:5px 10px;font-size:11px;}
.pk-tm-input{background:#0d1117;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:7px 11px;color:#e6edf3;font-family:'Source Sans Pro',sans-serif;font-size:12px;outline:none;width:100%;transition:border-color .15s;box-sizing:border-box;}
.pk-tm-input:focus{border-color:rgba(var(--pk-accent-rgb,14,111,255),.6);}
.pk-tm-input::placeholder{color:#333;}
.pk-tm-log{background:#080c10;border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:8px 10px;max-height:110px;overflow-y:auto;margin-bottom:10px;font-size:10px;font-family:'SF Mono','Menlo',monospace;line-height:1.8;color:#444;}
.pk-tm-log::-webkit-scrollbar{width:3px;}
.pk-tm-log::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);}
.pk-tm-ok{color:#3fb950;} .pk-tm-err{color:#f85149;} .pk-tm-info{color:#58a6ff;} .pk-tm-warn{color:#e3b341;}
.pk-tm-prog-wrap{margin-bottom:10px;}
.pk-tm-prog-bg{height:3px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-bottom:5px;}
.pk-tm-prog-fill{height:100%;border-radius:3px;width:0%;transition:width .3s ease;}
.pk-tm-prog-fill-blue{background:linear-gradient(90deg,rgba(var(--pk-accent-rgb,14,111,255),.7),rgba(var(--pk-accent-rgb,14,111,255),1));}
.pk-tm-prog-fill-red{background:linear-gradient(90deg,#c0392b,#f85149);}
.pk-tm-prog-fill-green{background:linear-gradient(90deg,#1a7f37,#3fb950);}
.pk-tm-prog-row{display:flex;justify-content:space-between;font-size:10px;color:#444;}
.pk-tm-stepper{display:flex;align-items:center;background:#0d1117;border:1px solid rgba(255,255,255,.1);border-radius:6px;overflow:hidden;}
.pk-tm-step-btn{width:26px;height:26px;background:none;border:none;color:#8b949e;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}
.pk-tm-step-btn:hover{background:rgba(255,255,255,.06);}
.pk-tm-step-v{min-width:38px;text-align:center;font-size:11px;font-weight:700;color:#e6edf3;border-left:1px solid rgba(255,255,255,.07);border-right:1px solid rgba(255,255,255,.07);padding:0 4px;height:26px;line-height:26px;}
.pk-tm-chk-row{display:flex;align-items:center;gap:8px;font-size:12px;color:#8b949e;cursor:pointer;user-select:none;padding:4px 0;}
.pk-tm-chk-row input[type=checkbox]{accent-color:var(--pk-accent,#0e6fff);width:13px;height:13px;cursor:pointer;}
.pk-tm-trade-row{display:flex;align-items:center;gap:8px;background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px 11px;cursor:pointer;margin-bottom:4px;transition:border-color .12s;}
.pk-tm-trade-row:hover{border-color:rgba(255,255,255,.1);}
.pk-tm-trade-row.pk-tm-sel-r{border-color:rgba(248,81,73,.35);background:rgba(248,81,73,.06);}
.pk-tm-trade-row.pk-tm-gone{opacity:.2;pointer-events:none;}
.pk-tm-trade-check{width:13px;height:13px;accent-color:#f85149;cursor:pointer;flex-shrink:0;}
.pk-tm-hist-row{background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:10px 12px;display:flex;align-items:center;gap:10px;margin-bottom:5px;}
.pk-tm-hist-row:hover{border-color:rgba(255,255,255,.1);}
.pk-tm-port-row{display:flex;align-items:center;gap:9px;background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:7px;padding:8px 10px;margin-bottom:4px;}
.pk-tm-port-row:hover{border-color:rgba(255,255,255,.1);}
.pk-tm-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.pk-tm-stat{background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:13px;text-align:center;}
.pk-tm-stat-v{font-size:22px;font-weight:800;color:var(--pk-accent,#0e6fff);letter-spacing:-.5px;}
.pk-tm-stat-l{font-size:9px;color:#444;margin-top:3px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;}
.pk-tm-ratio-bar{display:flex;background:rgba(255,255,255,.02);border-radius:7px;overflow:hidden;border:1px solid rgba(255,255,255,.06);margin-bottom:12px;}
.pk-tm-ratio-cell{display:flex;flex-direction:column;align-items:center;flex:1;padding:8px 10px;border-right:1px solid rgba(255,255,255,.05);}
.pk-tm-ratio-cell:last-child{border-right:none;}
.pk-tm-ratio-lbl{font-size:9px;color:#444;text-transform:uppercase;letter-spacing:.7px;font-weight:700;}
.pk-tm-ratio-val{font-size:14px;font-weight:700;color:#e6edf3;margin-top:1px;}
.pk-tm-status-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;}
.pk-tm-status-badge.running{background:rgba(63,185,80,.1);color:#3fb950;border:1px solid rgba(63,185,80,.2);}
.pk-tm-status-badge.running::before{content:'';width:5px;height:5px;border-radius:50%;background:#3fb950;animation:pk-tm-pulse 1.4s ease-in-out infinite;}
.pk-tm-status-badge.idle{background:rgba(255,255,255,.04);color:#444;border:1px solid rgba(255,255,255,.08);}
.pk-tm-status-badge.sold{background:rgba(227,179,65,.1);color:#e3b341;border:1px solid rgba(227,179,65,.2);}
@keyframes pk-tm-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(1.3);}}
.pk-tm-lk-result{display:none;align-items:center;gap:12px;background:#0d1117;border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:12px;margin-top:10px;}
.pk-tm-lk-result.pk-tm-vis{display:flex;}
.pk-tm-lk-result img{width:52px;height:52px;border-radius:8px;background:#161b22;object-fit:cover;flex-shrink:0;}
.pk-tm-alert-row{background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:10px 12px;display:flex;align-items:center;gap:9px;margin-bottom:5px;}
.pk-tm-inv-item{display:flex;align-items:center;gap:9px;background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:9px 11px;cursor:pointer;transition:all .12s;margin-bottom:4px;}
.pk-tm-inv-item:hover{border-color:rgba(255,255,255,.1);}
.pk-tm-inv-item.pk-tm-sel-i{border-color:var(--pk-accent,#0e6fff);background:rgba(var(--pk-accent-rgb,14,111,255),.08);}
.pk-tm-offer-chip{display:inline-flex;align-items:center;gap:4px;background:rgba(var(--pk-accent-rgb,14,111,255),.12);border:1px solid rgba(var(--pk-accent-rgb,14,111,255),.22);border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer;}
.pk-tm-drop-row:hover{background:rgba(255,255,255,.05);}
#pk-tm-tgt-drop{position:fixed;z-index:2000001;background:#161b22;border:1px solid rgba(255,255,255,.12);border-radius:8px;max-height:240px;overflow-y:auto;display:none;box-shadow:0 12px 32px rgba(0,0,0,.9);}
#pk-tm-tgt-drop::-webkit-scrollbar{width:3px;}
#pk-tm-tgt-drop::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);}
    `;

    let _cssInjected = false;
    function injectCSS() {
        if (_cssInjected) return;
        const s = document.createElement('style');
        s.id = 'pk-tm-css';
        s.textContent = CSS;
        document.head.appendChild(s);
        // Load Lucide icons from CDN if not already loaded
        if (!document.getElementById('pk-lucide-cdn')) {
            const scr = document.createElement('script');
            scr.id = 'pk-lucide-cdn';
            scr.src = 'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js';
            scr.onload = () => { if (window.lucide) window.lucide.createIcons(); };
            document.head.appendChild(scr);
        }
        _cssInjected = true;
    }

    // ── tiny helpers ──────────────────────────────────────────────────────
    function gmGet(url) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: 'GET', url, withCredentials: true,
                headers: { Accept: 'application/json' },
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        try { res(JSON.parse(r.responseText)); }
                        catch (e) { rej(new Error('JSON: ' + e.message)); }
                    } else { rej(new Error('HTTP ' + r.status)); }
                },
                onerror: e => rej(new Error('Network: ' + JSON.stringify(e))),
            });
        });
    }

    function gmPost(url, body, extra) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: 'POST', url, withCredentials: true,
                headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, extra || {}),
                data: JSON.stringify(body),
                onload: r => res({ status: r.status, text: r.responseText, headers: r.responseHeaders }),
                onerror: e => rej(new Error('Network: ' + JSON.stringify(e))),
            });
        });
    }

    function sitePost(url, data, retry) {
        const csrf = getCsrfSync();
        const hdrs = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
        if (csrf) hdrs['X-CSRF-TOKEN'] = csrf;
        return new Promise(res => {
            GM_xmlhttpRequest({
                method: 'POST', url, withCredentials: true, headers: hdrs,
                data: data ? JSON.stringify(data) : undefined,
                onload: async r => {
                    if (r.status === 403 && !retry) {
                        const m = (r.responseHeaders || '').match(/x-csrf-token:\s*([^\r\n]+)/i);
                        if (m) { _csrf = m[1].trim(); return res(await sitePost(url, data, true)); }
                    }
                    res({ status: r.status, body: r.responseText });
                },
                onerror: () => res({ status: 0, body: '' }),
                ontimeout: () => res({ status: 0, body: '' }),
            });
        });
    }

    let _csrf = '';
    function getCsrfSync() {
        if (_csrf) return _csrf;
        try {
            const c = document.cookie.split(';').find(x => x.trim().startsWith('rbxcsrf4='));
            if (c) { const p = JSON.parse(atob(c.trim().slice('rbxcsrf4='.length).split('.')[1])); _csrf = atob(p.csrf); return _csrf; }
        } catch {}
        const m = document.querySelector('meta[name="csrf-token"]');
        if (m) { _csrf = m.content; return _csrf; }
        return '';
    }

    async function getCsrf() {
        if (_csrf) return _csrf;
        try {
            const r = await gmPost('https://www.pekora.zip/apisite/trades/v1/trades/send', {}, {});
            const m = (r.headers || '').match(/x-csrf-token:\s*([^\r\n]+)/i);
            if (m) { _csrf = m[1].trim(); return _csrf; }
        } catch {}
        return getCsrfSync();
    }

    let _myUid = null;
    async function getMyUid() {
        if (_myUid) return _myUid;
        try { const d = await gmGet('https://www.pekora.zip/apisite/users/v1/users/authenticated'); if (d?.id) { _myUid = String(d.id); return _myUid; } } catch {}
        return null;
    }

    function thumb(id) { return 'https://www.pekora.zip/Thumbs/Asset.ashx?width=420&height=420&assetId=' + id; }

    function logLine(box, text, cls) {
        const d = document.createElement('div');
        const t = new Date();
        const ts = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0') + ':' + String(t.getSeconds()).padStart(2,'0');
        d.textContent = '[' + ts + '] ' + text;
        if (cls) d.className = cls;
        box.appendChild(d); box.scrollTop = box.scrollHeight;
    }

    function setProg(fillId, cntId, statId, done, total, status) {
        const f = document.getElementById(fillId); if (f) f.style.width = total > 0 ? (done / total * 100) + '%' : '0%';
        const c = document.getElementById(cntId);  if (c) c.textContent = done + '/' + total;
        const s = document.getElementById(statId); if (s && status) s.textContent = status;
    }

    // Lucide icon helper — returns an <i> element that lucide.createIcons() will hydrate,
    // with a fallback inline SVG for the most-used icons so it works before CDN loads.
    const LUCIDE_PATHS = {
        'x':              ['M18 6L6 18','M6 6l12 12'],
        'check':          ['M20 6L9 17l-5-5'],
        'search':         ['M21 21l-4.35-4.35','M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'],
        'send':           ['M22 2L11 13','M22 2L15 22l-4-9-9-4 20-7z'],
        'ban':            ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z','M12 9v4','M12 17h.01'],
        'clock':          ['M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z','M12 6v6l4 2'],
        'wallet':         ['M21 12V7H5a2 2 0 0 1 0-4h14v4','M3 5v14a2 2 0 0 0 2 2h16v-5','M18 12a2 2 0 0 0 0 4h4v-4z'],
        'bell':           ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9','M13.73 21a2 2 0 0 1-3.46 0'],
        'eye':            ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z','M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0'],
        'tag':            ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z','M7 7h.01'],
        'repeat':         ['M17 2l4 4-4 4','M3 11V9a4 4 0 0 1 4-4h14','M7 22l-4-4 4-4','M21 13v2a4 4 0 0 1-4 4H3'],
        'zap':            ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
        'users':          ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M23 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75','circle cx="9" cy="7" r="4"'],
        'package':        ['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z','M3.27 6.96L12 12.01l8.73-5.05','M12 22.08V12'],
        'download':       ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4','M7 10l5 5 5-5','M12 15V3'],
        'trending-up':    ['M23 6l-9.5 9.5-5-5L1 18','M17 6h6v6'],
        'alert-triangle': ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z','M12 9v4','M12 17h.01'],
        'bar-chart-2':    ['M18 20V10','M12 20V4','M6 20v-6'],
        'settings':       ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z','M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
    };
    function icon(name, sz) {
        sz = sz || 14;
        // Try to use lucide if loaded
        if (window.lucide && window.lucide.icons && window.lucide.icons[name]) {
            const i = document.createElement('i');
            i.setAttribute('data-lucide', name);
            i.style.cssText = 'width:'+sz+'px;height:'+sz+'px;flex-shrink:0;vertical-align:middle;display:inline-flex;';
            // queue a createIcons call after the element is in the DOM
            setTimeout(() => { try { window.lucide.createIcons({ elements: [i] }); } catch {} }, 0);
            return i;
        }
        // Fallback: inline SVG
        const paths = LUCIDE_PATHS[name] || LUCIDE_PATHS['settings'];
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('width', sz); s.setAttribute('height', sz);
        s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
        s.style.cssText = 'flex-shrink:0;vertical-align:middle;';
        paths.forEach(d => {
            if (d.startsWith('circle')) {
                const attrs = d.match(/cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
                if (attrs) { const ci = document.createElementNS('http://www.w3.org/2000/svg','circle'); ci.setAttribute('cx',attrs[1]); ci.setAttribute('cy',attrs[2]); ci.setAttribute('r',attrs[3]); s.appendChild(ci); }
            } else {
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p.setAttribute('d', d); s.appendChild(p);
            }
        });
        return s;
    }
    // Legacy alias for any remaining svg() calls
    function svg(paths, sz) {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('width', sz||'13'); s.setAttribute('height', sz||'13');
        s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('fill','none');
        s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','2');
        s.setAttribute('stroke-linecap','round'); s.setAttribute('stroke-linejoin','round');
        s.style.cssText='flex-shrink:0;vertical-align:middle;';
        (Array.isArray(paths)?paths:[paths]).forEach(d=>{const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);s.appendChild(p);});
        return s;
    }
    const IX = ['M18 6L6 18','M6 6l12 12'];
    const ICHECK = 'M20 6L9 17l-5-5';
    const ISRCH  = ['M21 21l-4.35-4.35','M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'];

    function demCls(d) {
        if (!d) return 'pk-tm-info';
        if (['high','amazing','great'].includes(d.toLowerCase())) return 'pk-tm-ok';
        if (['low','terrible','awful'].includes(d.toLowerCase())) return 'pk-tm-err';
        return 'pk-tm-info';
    }

    function exportCSV(rows, filename) {
        const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = (filename || 'export') + '.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function ensureKmap(log) {
        if (NS.KCache && Object.keys(NS.KCache).length) {
            if (log) log('Using cached values (' + Object.keys(NS.KCache).length + ' items)', 'pk-tm-info');
            return NS.KCache;
        }
        if (typeof NS.GetKMap === 'function') {
            try { const m = await NS.GetKMap(); if (m && Object.keys(m).length) return m; } catch (e) { if (log) log('Kmap failed: ' + e.message, 'pk-tm-err'); }
        }
        return {};
    }

    async function loadInventory(uid, log) {
        log('Loading inventory...', 'pk-tm-info');
        let cursor = null, all = [], page = 0;
        do {
            const cp = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
            try {
                const j = await gmGet('https://www.pekora.zip/apisite/inventory/v1/users/' + uid + '/assets/collectibles?sortOrder=Desc&limit=100' + cp);
                all = all.concat(j.data || []);
                const nx = j.nextPageCursor;
                cursor = (nx != null && nx !== '') ? nx : null;
                page++;
                if (cursor) log('Page ' + page + ': ' + all.length + ' items...', 'pk-tm-info');
            } catch (e) { log('Inventory error: ' + e.message, 'pk-tm-err'); break; }
        } while (cursor && page < 50);
        log('Loaded ' + all.length + ' items', all.length ? 'pk-tm-ok' : 'pk-tm-err');
        return all;
    }

    async function fetchOwners(itemId, log) {
        if (BT_OwnerCache[itemId]) { log('Using cached owners (' + BT_OwnerCache[itemId].length + ')', 'pk-tm-ok'); return BT_OwnerCache[itemId]; }
        log('Fetching owners for item ' + itemId + '...', 'pk-tm-info');
        let cursor = null, all = [], page = 0;
        do {
            const cp = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
            try {
                const j = await gmGet('https://www.pekora.zip/apisite/inventory/v2/assets/' + itemId + '/owners?limit=100&sortOrder=Asc' + cp);
                const withOwner = (j.data || []).filter(e => e.owner != null);
                all = all.concat(withOwner);
                const nx = j.nextPageCursor;
                cursor = (nx != null && nx !== '') ? nx : null;
                page++;
                if (cursor) log('Page ' + page + ': ' + all.length + ' owners...', 'pk-tm-info');
            } catch (e) { log('Owner fetch error: ' + e.message, 'pk-tm-err'); break; }
        } while (cursor && page < 100);
        const byUser = new Map();
        for (const e of all) {
            const uid = String(e.owner.id);
            if (!byUser.has(uid)) byUser.set(uid, { userId: uid, username: e.owner.name || uid, userAssetIds: [e.id] });
            else byUser.get(uid).userAssetIds.push(e.id);
        }
        const owners = [...byUser.values()];
        BT_OwnerCache[itemId] = owners;
        log('Found ' + owners.length + ' unique owners', owners.length ? 'pk-tm-ok' : 'pk-tm-warn');
        return owners;
    }

    async function sendTrade(myUAIds, theirUid, theirUAIds) {
        const csrf = await getCsrf();
        const payload = { offers: [
            { robux: null, userAssetIds: myUAIds,    userId: null },
            { robux: null, userAssetIds: theirUAIds, userId: Number(theirUid) },
        ]};
        const r = await gmPost('https://www.pekora.zip/apisite/trades/v1/trades/send', payload, { 'x-csrf-token': csrf });
        if (r.status < 200 || r.status >= 300) {
            let msg = 'HTTP ' + r.status;
            try { const j = JSON.parse(r.text); msg = j?.errors?.[0]?.message || j?.message || msg; } catch {}
            throw new Error(msg);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  BUILD PANEL
    // ══════════════════════════════════════════════════════════════════════
    function BuildPanel(accentColour) {
        const existing = document.getElementById('pk-tm-overlay');
        if (existing) { existing.remove(); document.getElementById('pk-tm-tgt-drop')?.remove(); return; }

        injectCSS();

        // Inject accent colour as CSS variable so all CSS rules pick it up
        const _ac = accentColour || '#0e6fff';
        const _acRgb = (function() {
            // parse rgb(r,g,b) or #hex into r,g,b for rgba() usage
            const m = _ac.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (m) return m[1] + ',' + m[2] + ',' + m[3];
            const h = _ac.replace('#','');
            if (h.length === 6) {
                const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
                return r + ',' + g + ',' + b;
            }
            return '14,111,255';
        })();
        const accentStyleEl = document.createElement('style');
        accentStyleEl.id = 'pk-tm-accent-vars';
        document.getElementById('pk-tm-accent-vars')?.remove();
        accentStyleEl.textContent = ':root{--pk-accent:' + _ac + ';--pk-accent-rgb:' + _acRgb + ';}';
        document.head.appendChild(accentStyleEl);

        // portalled dropdown
        const tgtDrop = document.createElement('div');
        tgtDrop.id = 'pk-tm-tgt-drop';
        document.body.appendChild(tgtDrop);

        const overlay = document.createElement('div');
        overlay.id = 'pk-tm-overlay';

        const panel = document.createElement('div');
        panel.id = 'pk-tm-panel';

        // ── Header ────────────────────────────────────────────────────────
        const hdr = El('div', {}); hdr.id = 'pk-tm-header';
        const hdrL = El('div', { display: 'flex', alignItems: 'center', gap: '10px' });
        hdrL.appendChild(Span('Pekora+', { fontSize: '15px', fontWeight: '700', color: _ac }));
        hdrL.appendChild(Span('Trade Menu', { fontSize: '15px', fontWeight: '700', color: '#e6edf3', marginLeft: '2px' }));
        hdrL.appendChild(Span('v3.3', { fontSize: '10px', color: '#484f58', marginLeft: '4px' }));
        const closeBtn = El('button', { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', borderRadius: '6px', color: '#555', width: '27px', height: '27px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .12s' });
        closeBtn.appendChild(icon('x', 12));
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e6edf3'; closeBtn.style.background = 'rgba(255,255,255,.09)'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#555'; closeBtn.style.background = 'rgba(255,255,255,.05)'; });
        closeBtn.addEventListener('click', () => { BT_Abort = true; CancelAbort = true; overlay.remove(); tgtDrop.remove(); document.getElementById('pk-tm-accent-vars')?.remove(); });
        hdr.appendChild(hdrL); hdr.appendChild(closeBtn);

        // drag
        let dragging = false, ox = 0, oy = 0;
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            dragging = true;
            const r = panel.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
            panel.style.transition = 'none'; e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - ox));
            const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - oy));
            overlay.style.alignItems = 'flex-start'; overlay.style.justifyContent = 'flex-start';
            panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.position = 'fixed';
        });
        document.addEventListener('mouseup', () => { if (dragging) { dragging = false; panel.style.transition = ''; } });

        // ── Tab bar ───────────────────────────────────────────────────────
        const TAB_DEFS = [
            { id: 'blast',     label: 'Blast',     lucide: 'zap' },
            { id: 'cancel',    label: 'Cancel',    lucide: 'ban' },
            { id: 'history',   label: 'History',   lucide: 'clock' },
            { id: 'portfolio', label: 'Portfolio', lucide: 'wallet' },
            { id: 'alerts',    label: 'Alerts',    lucide: 'bell' },
            { id: 'lookup',    label: 'Lookup',    lucide: 'eye' },
            { id: 'autosell',  label: 'Autosell',  lucide: 'repeat' },
        ];
        const tabBar = document.createElement('div'); tabBar.id = 'pk-tm-tabbar';
        const body = document.createElement('div'); body.id = 'pk-tm-body';
        const panes = {};

        const tabBtns = TAB_DEFS.map((def, i) => {
            const btn = document.createElement('div');
            btn.className = 'pk-tm-tab' + (i === 0 ? ' pk-tm-active' : '');
            btn.dataset.tab = def.id;
            const ic = icon(def.lucide, 13);
            ic.style.marginRight = '5px';
            btn.appendChild(ic);
            btn.appendChild(document.createTextNode(def.label));
            tabBar.appendChild(btn);

            const pane = document.createElement('div');
            pane.className = 'pk-tm-pane' + (i === 0 ? ' pk-tm-active' : '');
            pane.id = 'pk-tm-pane-' + def.id;
            body.appendChild(pane); panes[def.id] = pane;
            return btn;
        });

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('pk-tm-active'));
                Object.values(panes).forEach(p => p.classList.remove('pk-tm-active'));
                btn.classList.add('pk-tm-active');
                panes[btn.dataset.tab].classList.add('pk-tm-active');
            });
        });

        panel.appendChild(hdr); panel.appendChild(tabBar); panel.appendChild(body);
        overlay.appendChild(panel); document.body.appendChild(overlay);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: BLAST
        // ══════════════════════════════════════════════════════════════════
        buildBlast(panes.blast, tgtDrop);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: CANCEL
        // ══════════════════════════════════════════════════════════════════
        buildCancel(panes.cancel);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: HISTORY
        // ══════════════════════════════════════════════════════════════════
        buildHistory(panes.history);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: PORTFOLIO
        // ══════════════════════════════════════════════════════════════════
        buildPortfolio(panes.portfolio);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: ALERTS
        // ══════════════════════════════════════════════════════════════════
        buildAlerts(panes.alerts);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: LOOKUP
        // ══════════════════════════════════════════════════════════════════
        buildLookup(panes.lookup);

        // ══════════════════════════════════════════════════════════════════
        //  TAB: AUTOSELL
        // ══════════════════════════════════════════════════════════════════
        buildAutosell(panes.autosell);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  BLAST TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildBlast(P, tgtDrop) {
        let invItems = [], selOffer = new Set(), tgtId = null, tgtName = '', dropKmap = null, searchTimer = null;
        let tradeLog = [], blastLog = null;
        let delaySec = 5, maxUsers = 50, minRatio = 0, skipDup = true, multiItems = false;

        const wrap2 = El('div', {}); wrap2.className = 'pk-tm-2col';
        const leftCol = El('div', {}), rightCol = El('div', {});

        // ── Offer box ─────────────────────────────────────────────────────
        const offerBox = El('div', {}); offerBox.className = 'pk-tm-box';
        const obt = El('div', {}); obt.className = 'pk-tm-box-title';
        obt.appendChild(Span('Your Offer ', { color: '#555' }));
        const oCount = El('em', {}); oCount.id = 'pk-tm-offer-count'; oCount.textContent = '(0/4)'; obt.appendChild(oCount);
        offerBox.appendChild(obt);

        const loadInvBtn = document.createElement('button');
        loadInvBtn.className = 'pk-tm-btn pk-tm-btn-blue pk-tm-btn-w'; loadInvBtn.appendChild(icon('users', 13)); loadInvBtn.appendChild(document.createTextNode(' Load Inventory'));
        offerBox.appendChild(loadInvBtn);

        const invStatus = El('div', { fontSize: '10px', color: '#333', fontFamily: 'monospace', minHeight: '14px', margin: '4px 0' });
        offerBox.appendChild(invStatus);

        const offerGrid = El('div', { display: 'flex', flexWrap: 'wrap', gap: '5px', minHeight: '28px', background: 'rgba(255,255,255,.02)', borderRadius: '6px', padding: '8px', border: '1px solid rgba(255,255,255,.05)', marginTop: '6px' });
        const offerPH = Span('No items selected', { fontSize: '11px', color: '#333' });
        offerGrid.appendChild(offerPH);
        offerBox.appendChild(offerGrid);

        const pickBtn = document.createElement('button');
        pickBtn.className = 'pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm'; pickBtn.style.marginTop = '7px'; pickBtn.appendChild(icon('package', 12)); pickBtn.appendChild(document.createTextNode(' Pick Items'));
        pickBtn.addEventListener('click', openPicker);
        offerBox.appendChild(pickBtn);
        leftCol.appendChild(offerBox);

        // ── Options box ───────────────────────────────────────────────────
        const optBox = El('div', {}); optBox.className = 'pk-tm-box';
        const optT = El('div', {}); optT.className = 'pk-tm-box-title'; optT.textContent = 'Options';
        optBox.appendChild(optT);

        function mkNumRow(lbl, getV, setV, min, max) {
            const row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' });
            row.appendChild(Span(lbl, { fontSize: '11px', color: '#555' }));
            const st = El('div', {}); st.className = 'pk-tm-stepper';
            const mn = document.createElement('button'); mn.className = 'pk-tm-step-btn'; mn.textContent = '−';
            const dv = El('div', {}); dv.className = 'pk-tm-step-v'; dv.textContent = getV();
            const pl = document.createElement('button'); pl.className = 'pk-tm-step-btn'; pl.textContent = '+';
            mn.addEventListener('click', () => { setV(Math.max(min, getV() - 1)); dv.textContent = getV(); });
            pl.addEventListener('click',  () => { setV(Math.min(max, getV() + 1)); dv.textContent = getV(); });
            st.appendChild(mn); st.appendChild(dv); st.appendChild(pl); row.appendChild(st); return row;
        }
        function mkChk(lbl, getV, setV) {
            const l = El('label', {}); l.className = 'pk-tm-chk-row';
            const c = document.createElement('input'); c.type = 'checkbox'; c.checked = getV();
            c.addEventListener('change', () => setV(c.checked));
            l.appendChild(c); l.appendChild(document.createTextNode(lbl)); return l;
        }

        optBox.appendChild(mkNumRow('Delay (sec)', () => delaySec, v => { delaySec = v; }, 1, 30));
        optBox.appendChild(mkNumRow('Max users',   () => maxUsers,  v => { maxUsers = v; }, 1, 500));
        optBox.appendChild(mkChk('Skip duplicate UIDs',          () => skipDup,    v => { skipDup    = v; }));
        optBox.appendChild(mkChk('Request multiple copies (≤4)', () => multiItems, v => { multiItems = v; }));

        const minRatRow = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' });
        minRatRow.appendChild(Span('Min ratio (0=off)', { fontSize: '11px', color: '#555' }));
        const mri = El('input', { type: 'number', value: '0', min: '0', step: '0.1' });
        mri.className = 'pk-tm-input'; mri.style.width = '65px';
        mri.addEventListener('input', () => { minRatio = parseFloat(mri.value) || 0; });
        minRatRow.appendChild(mri); optBox.appendChild(minRatRow);
        leftCol.appendChild(optBox);
        wrap2.appendChild(leftCol);

        // ── Target box ────────────────────────────────────────────────────
        const tgtBox = El('div', {}); tgtBox.className = 'pk-tm-box';
        const tbt = El('div', {}); tbt.className = 'pk-tm-box-title';
        tbt.appendChild(Span('Target Item ', { color: '#555' }));
        const tgtLbl = El('em', {}); tbt.appendChild(tgtLbl); tgtBox.appendChild(tbt);

        const tgtWrap = El('div', { position: 'relative' });
        const tgtInpWrap = El('div', { position: 'relative', display: 'flex', alignItems: 'center' });
        const tgtIcon = El('div', { position: 'absolute', left: '9px', color: '#333', display: 'flex', pointerEvents: 'none', zIndex: '1' });
        tgtIcon.appendChild(svg(ISRCH, '12'));
        const tgtInp = El('input', {}); tgtInp.className = 'pk-tm-input'; tgtInp.style.paddingLeft = '28px'; tgtInp.placeholder = 'Type item name or ID...';
        tgtInpWrap.appendChild(tgtIcon); tgtInpWrap.appendChild(tgtInp);
        tgtWrap.appendChild(tgtInpWrap); tgtBox.appendChild(tgtWrap);

        const tgtInfo = El('div', { minHeight: '32px', marginTop: '8px' }); tgtBox.appendChild(tgtInfo);

        function posDrop() {
            const r = tgtInp.getBoundingClientRect();
            tgtDrop.style.left = r.left + 'px'; tgtDrop.style.top = (r.bottom + 3) + 'px'; tgtDrop.style.width = r.width + 'px';
        }
        function selectTgt(id, kmap) {
            const k = kmap[id] || {};
            tgtId = id; tgtName = k.Name || k.name || ('Item ' + id);
            tgtInp.value = tgtName; tgtDrop.style.display = 'none'; tgtDrop.innerHTML = '';
            tgtLbl.textContent = tgtName;
            tgtInfo.innerHTML = '';
            const row = El('div', { display: 'flex', alignItems: 'center', gap: '7px', background: 'rgba(255,255,255,.02)', borderRadius: '6px', padding: '7px 10px', border: '1px solid rgba(255,255,255,.05)', flexWrap: 'wrap' });
            row.appendChild(Span(tgtName, { fontSize: '12px', fontWeight: '700', color: '#e6edf3' }));
            const kv = k.Value || k.value || 0, kr = k.RAP || k.rap || 0, kd = k.Demand || k.demand || '';
            if (kv > 0) row.appendChild(Span('Val: ' + Fmt(kv), { fontSize: '10px', color: '#3fb950', fontWeight: '700', padding: '2px 5px', background: 'rgba(63,185,80,.1)', borderRadius: '3px' }));
            if (kr > 0) row.appendChild(Span('RAP: ' + Fmt(kr), { fontSize: '10px', color: '#58a6ff', padding: '2px 5px', background: 'rgba(88,166,255,.08)', borderRadius: '3px' }));
            if (kd && kd !== 'None') row.appendChild(Span(kd, { fontSize: '10px', color: '#e3b341', padding: '2px 5px', background: 'rgba(227,179,65,.08)', borderRadius: '3px' }));
            row.appendChild(Span('ID ' + id, { fontSize: '9px', color: '#333' }));
            tgtInfo.appendChild(row);
            calcRatio();
        }
        function renderDrop(matches, kmap) {
            tgtDrop.innerHTML = '';
            if (!matches.length) { tgtDrop.style.display = 'none'; return; }
            matches.forEach(([id, item]) => {
                const kv = item.Value || item.value || 0, kr = item.RAP || item.rap || 0;
                const row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 11px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.04)' });
                row.className = 'pk-tm-drop-row';
                const l2 = El('div', { display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '1' });
                const nm = El('span', {}); nm.style.cssText = 'color:#e6edf3;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;'; nm.textContent = item.Name || item.name || ('Item ' + id);
                const sub = El('span', {}); sub.style.cssText = 'font-size:9px;color:#333;'; sub.textContent = 'ID: ' + id + ((item.Acronym || item.acronym) ? ' · ' + (item.Acronym || item.acronym) : '');
                l2.appendChild(nm); l2.appendChild(sub);
                const rt = El('div', { display: 'flex', gap: '4px', alignItems: 'center', flexShrink: '0', marginLeft: '7px' });
                if (kv > 0) { const vb = El('span', {}); vb.style.cssText = 'font-size:10px;color:#3fb950;font-weight:700;padding:1px 4px;background:rgba(63,185,80,.1);border-radius:3px;'; vb.textContent = Fmt(kv); rt.appendChild(vb); }
                if (kr > 0) { const rb = El('span', {}); rb.style.cssText = 'font-size:10px;color:#58a6ff;padding:1px 4px;background:rgba(88,166,255,.08);border-radius:3px;'; rb.textContent = Fmt(kr); rt.appendChild(rb); }
                row.appendChild(l2); row.appendChild(rt);
                row.addEventListener('mousedown', e => { e.preventDefault(); selectTgt(id, kmap); });
                tgtDrop.appendChild(row);
            });
            posDrop(); tgtDrop.style.display = 'block';
        }
        async function updateDrop(q) {
            if (!q || q.length < 2) { tgtDrop.style.display = 'none'; return; }
            if (!dropKmap) dropKmap = await ensureKmap(null);
            if (!dropKmap || !Object.keys(dropKmap).length) return;
            const ql = q.toLowerCase(), matches = [];
            if (/^\d+$/.test(q) && dropKmap[q]) matches.push([q, dropKmap[q], 99]);
            for (const [id, item] of Object.entries(dropKmap)) {
                if (/^\d+$/.test(q) && id === q) continue;
                const nm = (item.Name || item.name || '').toLowerCase(), ac = (item.Acronym || item.acronym || '').toLowerCase();
                let sc = 0;
                if (ac && ac === ql) sc = 4;
                else if (nm === ql) sc = 3;
                else if (nm.startsWith(ql)) sc = 2;
                else if (nm.includes(ql)) sc = 1;
                if (sc > 0) matches.push([id, item, sc]);
            }
            matches.sort((a, b) => b[2] - a[2]);
            renderDrop(matches.slice(0, 30).map(m => [m[0], m[1]]), dropKmap);
        }
        tgtInp.addEventListener('input', () => { tgtId = null; tgtInfo.innerHTML = ''; clearTimeout(searchTimer); searchTimer = setTimeout(() => updateDrop(tgtInp.value.trim()), 150); });
        tgtInp.addEventListener('keydown', e => {
            if (e.key === 'Escape') tgtDrop.style.display = 'none';
            if (e.key === 'Enter' && tgtDrop.style.display !== 'none') { const f = tgtDrop.firstElementChild; if (f) f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
        });
        tgtInp.addEventListener('focus', () => { if (tgtInp.value.trim().length >= 2 && !tgtId) updateDrop(tgtInp.value.trim()); });
        document.addEventListener('mousedown', e => { if (!tgtWrap.contains(e.target) && !tgtDrop.contains(e.target)) tgtDrop.style.display = 'none'; }, { capture: true });

        const findOwnersBtn = document.createElement('button');
        findOwnersBtn.className = 'pk-tm-btn pk-tm-btn-blue pk-tm-btn-sm pk-tm-btn-w'; findOwnersBtn.style.marginTop = '8px'; findOwnersBtn.appendChild(icon('search', 12)); findOwnersBtn.appendChild(document.createTextNode(' Find Owners'));
        findOwnersBtn.addEventListener('click', async () => {
            if (!tgtId) { Toast('Set a target item first', 'warn'); return; }
            findOwnersBtn.disabled = true; findOwnersBtn.textContent = 'Loading...';
            const owners = await fetchOwners(tgtId, (t, c) => logLine(blastLog, t, c));
            const on = document.getElementById('pk-tm-bl-owner-n'); if (on) on.textContent = owners.length;
            findOwnersBtn.disabled = false; findOwnersBtn.textContent = 'Find Owners';
            calcRatio();
        });
        tgtBox.appendChild(findOwnersBtn);
        rightCol.appendChild(tgtBox);

        // ── Ratio bar ─────────────────────────────────────────────────────
        const rbar = El('div', {}); rbar.className = 'pk-tm-ratio-bar';
        function rcell(lbl, id) {
            const d = El('div', {}); d.className = 'pk-tm-ratio-cell';
            d.appendChild(Span(lbl, { fontSize: '9px', color: '#333', textTransform: 'uppercase', letterSpacing: '.7px', fontWeight: '700' }));
            const v = El('div', {}); v.className = 'pk-tm-ratio-val'; v.id = id; v.textContent = '—'; d.appendChild(v); return d;
        }
        rbar.appendChild(rcell('Offering', 'pk-tm-r-offer'));
        rbar.appendChild(rcell('Requesting', 'pk-tm-r-req'));
        rbar.appendChild(rcell('Ratio', 'pk-tm-r-ratio'));
        rbar.appendChild(rcell('Owners', 'pk-tm-bl-owner-n'));
        function calcRatio() {
            const kmap = NS.KCache || dropKmap || {};
            let ototal = 0;
            for (const uaid of selOffer) {
                const item = invItems.find(x => String(x.userAssetId) === String(uaid));
                if (item) { const k = kmap[String(item.assetId)]; ototal += k?.Value || k?.value || k?.RAP || k?.rap || 0; }
            }
            const tk = tgtId ? (kmap[tgtId] || {}) : {};
            const rv = (tk.Value || tk.value || 0) > 0 ? (tk.Value || tk.value) : (tk.RAP || tk.rap || 0);
            const ratio = rv > 0 && ototal > 0 ? (ototal / rv).toFixed(2) : '—';
            const col = ratio !== '—' ? (parseFloat(ratio) >= 1 ? '#3fb950' : parseFloat(ratio) >= 0.7 ? '#e3b341' : '#f85149') : '#555';
            const ro = document.getElementById('pk-tm-r-offer');   if (ro) ro.textContent = ototal > 0 ? Fmt(ototal) : '—';
            const rr = document.getElementById('pk-tm-r-req');     if (rr) rr.textContent = rv > 0 ? Fmt(rv) : '—';
            const rt = document.getElementById('pk-tm-r-ratio');   if (rt) { rt.textContent = ratio !== '—' ? ratio + 'x' : '—'; rt.style.color = col; }
        }
        rightCol.appendChild(rbar);
        wrap2.appendChild(rightCol);
        P.appendChild(wrap2);

        // ── Blast box ─────────────────────────────────────────────────────
        const blastBox = El('div', {}); blastBox.className = 'pk-tm-box';
        const bbt = El('div', {}); bbt.className = 'pk-tm-box-title'; bbt.textContent = 'Send Blast'; blastBox.appendChild(bbt);

        const progWrap = El('div', {}); progWrap.className = 'pk-tm-prog-wrap'; progWrap.style.display = 'none';
        progWrap.innerHTML = '<div class="pk-tm-prog-bg"><div class="pk-tm-prog-fill pk-tm-prog-fill-blue" id="pk-tm-bl-fill"></div></div><div class="pk-tm-prog-row"><span id="pk-tm-bl-stat">Sending...</span><span id="pk-tm-bl-cnt">0/0</span></div>';
        blastBox.appendChild(progWrap);

        blastLog = El('div', {}); blastLog.className = 'pk-tm-log';
        blastLog.innerHTML = '<span class="pk-tm-info">// Select offer items, target item, find owners, then blast.</span>';
        blastBox.appendChild(blastLog);

        const brow = El('div', { display: 'flex', gap: '7px', marginTop: '4px' });
        const sendBtn = document.createElement('button'); sendBtn.className = 'pk-tm-btn pk-tm-btn-green pk-tm-btn-w'; sendBtn.appendChild(icon('send', 13)); sendBtn.appendChild(document.createTextNode(' Send All Trades'));
        const stopBtn = document.createElement('button'); stopBtn.className = 'pk-tm-btn pk-tm-btn-red'; stopBtn.style.minWidth = '65px'; stopBtn.textContent = 'Stop'; stopBtn.disabled = true;
        const csvBtn  = document.createElement('button'); csvBtn.className = 'pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm'; csvBtn.textContent = 'CSV';
        brow.appendChild(sendBtn); brow.appendChild(stopBtn); brow.appendChild(csvBtn);
        blastBox.appendChild(brow);

        stopBtn.addEventListener('click', () => { BT_Abort = true; logLine(blastLog, 'Stopped.', 'pk-tm-err'); });
        csvBtn.addEventListener('click', () => {
            if (!tradeLog.length) { Toast('No trades to export', 'warn'); return; }
            exportCSV([['Username','UID','Status','Detail'], ...tradeLog.map(r => [r.name, r.uid, r.status, r.detail])], 'blast-results');
        });

        sendBtn.addEventListener('click', async () => {
            if (BT_Running) return;
            if (!selOffer.size) { Toast('Select at least one offer item', 'warn'); return; }
            if (!tgtId) { Toast('Set a target item first', 'warn'); return; }
            BT_Running = true; BT_Abort = false; tradeLog = [];
            sendBtn.disabled = true; stopBtn.disabled = false;
            blastLog.innerHTML = ''; progWrap.style.display = 'block';
            const myUAIds = [...selOffer].map(Number);
            logLine(blastLog, 'Fetching owners of ' + tgtName + '...', 'pk-tm-info');
            const owners = await fetchOwners(tgtId, (t, c) => logLine(blastLog, t, c));
            if (!owners.length) { logLine(blastLog, 'No owners found.', 'pk-tm-err'); BT_Running = false; sendBtn.disabled = false; stopBtn.disabled = true; return; }
            const kmap = NS.KCache || dropKmap || {};
            const capped = owners.slice(0, maxUsers);
            logLine(blastLog, 'Blasting ' + capped.length + ' owners (' + delaySec + 's delay)', 'pk-tm-info');
            let sent = 0, failed = 0, skipped = 0;
            const seen = new Set();
            for (let i = 0; i < capped.length; i++) {
                if (BT_Abort) break;
                const owner = capped[i];
                if (skipDup && seen.has(owner.userId)) { skipped++; continue; }
                seen.add(owner.userId);
                if (minRatio > 0) {
                    const tk = kmap[tgtId] || {};
                    const rv = (tk.Value || tk.value || 0) > 0 ? (tk.Value || tk.value) : (tk.RAP || tk.rap || 0);
                    const ofv = myUAIds.reduce((s, u) => { const it = invItems.find(x => x.userAssetId === u); return s + ((NS.KCache || {})[String(it?.assetId)]?.Value || 0); }, 0);
                    if (rv > 0 && ofv / rv < minRatio) { skipped++; logLine(blastLog, 'Skip ' + owner.username + ' (ratio too low)', 'pk-tm-warn'); continue; }
                }
                const theirUAIds = multiItems ? owner.userAssetIds.slice(0, 4) : [owner.userAssetIds[0]];
                try {
                    await sendTrade(myUAIds, owner.userId, theirUAIds);
                    logLine(blastLog, '✓ ' + owner.username, 'pk-tm-ok');
                    tradeLog.push({ name: owner.username, uid: owner.userId, status: 'Sent', detail: 'ok' }); sent++;
                } catch (e) {
                    logLine(blastLog, '✗ ' + owner.username + ': ' + e.message, 'pk-tm-err');
                    tradeLog.push({ name: owner.username, uid: owner.userId, status: 'Failed', detail: e.message }); failed++;
                }
                setProg('pk-tm-bl-fill', 'pk-tm-bl-cnt', 'pk-tm-bl-stat', sent + failed + skipped, capped.length, 'Sending...');
                if (!BT_Abort && i < capped.length - 1) await Sleep(delaySec * 1000);
            }
            const summ = 'Done — Sent: ' + sent + '  Failed: ' + failed + '  Skipped: ' + skipped;
            logLine(blastLog, summ, 'pk-tm-ok'); Toast(summ, sent > 0 ? 'success' : 'warn');
            setProg('pk-tm-bl-fill', 'pk-tm-bl-cnt', 'pk-tm-bl-stat', sent + failed + skipped, capped.length, 'Complete');
            BT_Running = false; sendBtn.disabled = false; stopBtn.disabled = true;
        });

        P.appendChild(blastBox);

        // ── refresh offer display ─────────────────────────────────────────
        function refreshOfferGrid() {
            offerGrid.innerHTML = '';
            const kmap = NS.KCache || {};
            if (!selOffer.size) { offerGrid.appendChild(offerPH); }
            else {
                for (const uaid of selOffer) {
                    const item = invItems.find(i => String(i.userAssetId) === String(uaid));
                    if (!item) continue;
                    const k = kmap[String(item.assetId)] || {};
                    const val = k.Value || k.value || k.RAP || k.rap || 0;
                    const chip = El('div', {}); chip.className = 'pk-tm-offer-chip'; chip.title = 'Click to remove';
                    const nm = El('span', {}); nm.style.cssText = 'color:#e6edf3;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;'; nm.textContent = item.name || item.assetName || ('Item ' + item.assetId);
                    chip.appendChild(nm);
                    if (val > 0) chip.appendChild(Span(' · ' + Fmt(val), { color: 'var(--pk-accent,#0e6fff)', fontWeight: '700', fontSize: '10px' }));
                    chip.appendChild(Span(' ×', { color: '#555', marginLeft: '2px', fontSize: '10px' }));
                    chip.addEventListener('click', () => { selOffer.delete(String(uaid)); refreshOfferGrid(); calcRatio(); });
                    offerGrid.appendChild(chip);
                }
            }
            oCount.textContent = '(' + selOffer.size + '/4)';
        }

        // ── inventory picker modal ────────────────────────────────────────
        function openPicker() {
            if (!invItems.length) { Toast('Load inventory first', 'warn'); return; }
            const picker = El('div', { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.8)', zIndex: '1000001', display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const box = El('div', { background: '#0d1117', border: '1px solid rgba(255,255,255,.1)', borderRadius: '10px', width: '480px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.95)' });
            const ph = El('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' });
            ph.appendChild(Span('Select Offer Items (max 4)', { fontSize: '13px', fontWeight: '700', color: '#e6edf3' }));
            const pc = document.createElement('button'); pc.className = 'pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm'; pc.appendChild(icon('x', 12)); pc.addEventListener('click', () => picker.remove()); ph.appendChild(pc); box.appendChild(ph);
            const si = El('input', {}); si.className = 'pk-tm-input'; si.style.cssText = 'margin:8px 12px;width:calc(100% - 24px);'; si.placeholder = 'Search items...';
            box.appendChild(si);
            const pl = El('div', { flex: '1', overflowY: 'auto', padding: '6px 8px' }); pl.style.maxHeight = 'calc(80vh - 110px)'; box.appendChild(pl);
            const pf = El('div', { padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,.07)', display: 'flex', justifyContent: 'flex-end', gap: '7px' });
            const okb = document.createElement('button'); okb.className = 'pk-tm-btn pk-tm-btn-green'; okb.textContent = 'Confirm';
            okb.addEventListener('click', () => { refreshOfferGrid(); calcRatio(); picker.remove(); });
            const cab = document.createElement('button'); cab.className = 'pk-tm-btn pk-tm-btn-ghost'; cab.textContent = 'Cancel'; cab.addEventListener('click', () => picker.remove());
            pf.appendChild(cab); pf.appendChild(okb); box.appendChild(pf);

            function renderPL(f) {
                pl.innerHTML = '';
                const kmap = NS.KCache || {};
                const fil = invItems.filter(i => !f || (i.name || '').toLowerCase().includes(f.toLowerCase()));
                if (!fil.length) { pl.appendChild(Span('No items.', { fontSize: '12px', color: '#333', padding: '10px', display: 'block' })); return; }
                fil.forEach(i => {
                    const k = kmap[String(i.assetId)] || {}, val = k.Value || k.value || k.RAP || k.rap || 0;
                    const sel = selOffer.has(String(i.userAssetId));
                    const row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '5px', cursor: 'pointer', userSelect: 'none', marginBottom: '2px', border: '1px solid ' + (sel ? 'rgba(var(--pk-accent-rgb,14,111,255),.3)' : 'transparent'), background: sel ? 'rgba(var(--pk-accent-rgb,14,111,255),.08)' : 'transparent' });
                    row.className = 'pk-tm-drop-row';
                    const img = document.createElement('img'); img.src = thumb(i.assetId); img.style.cssText = 'width:32px;height:32px;border-radius:5px;background:#161b22;object-fit:cover;flex-shrink:0;'; img.onerror = () => { img.style.display='none'; }; row.appendChild(img);
                    const lft = El('div', { flex: '1', overflow: 'hidden' });
                    const nm = El('div', {}); nm.style.cssText = 'color:#e6edf3;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'; nm.textContent = i.name || i.assetName || ('Item ' + i.assetId);
                    const vl = El('div', {}); vl.style.cssText = 'font-size:10px;color:#444;'; vl.textContent = val > 0 ? 'Val: ' + Fmt(val) : 'No value data';
                    lft.appendChild(nm); lft.appendChild(vl); row.appendChild(lft);
                    const ck = El('div', { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0', border: '1px solid ' + (sel ? 'var(--pk-accent,#0e6fff)' : 'rgba(255,255,255,.15)'), background: sel ? 'rgba(var(--pk-accent-rgb,14,111,255),.25)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' });
                    if (sel) { const c2 = icon('check', 9); c2.style.color = 'var(--pk-accent,#0e6fff)'; ck.appendChild(c2); }
                    row.appendChild(ck);
                    row.addEventListener('click', () => {
                        const k2 = String(i.userAssetId);
                        if (selOffer.has(k2)) {
                            selOffer.delete(k2); row.style.background = 'transparent'; row.style.border = '1px solid transparent';
                            ck.innerHTML = ''; ck.style.background = 'transparent'; ck.style.border = '1px solid rgba(255,255,255,.15)';
                        } else {
                            if (selOffer.size >= 4) { Toast('Max 4 offer items', 'warn'); return; }
                            selOffer.add(k2); row.style.background = 'rgba(var(--pk-accent-rgb,14,111,255),.08)'; row.style.border = '1px solid rgba(var(--pk-accent-rgb,14,111,255),.3)';
                            ck.innerHTML = ''; ck.style.background = 'rgba(var(--pk-accent-rgb,14,111,255),.25)'; ck.style.border = '1px solid ' + _ac;
                            const c2 = icon('check', 9); c2.style.color = 'var(--pk-accent,#0e6fff)'; ck.appendChild(c2);
                        }
                    });
                    pl.appendChild(row);
                });
            }
            si.addEventListener('input', () => renderPL(si.value)); renderPL('');
            picker.appendChild(box); document.body.appendChild(picker);
        }

        loadInvBtn.addEventListener('click', async () => {
            loadInvBtn.disabled = true; loadInvBtn.textContent = 'Loading...'; invStatus.textContent = 'Fetching...';
            const uid = await getMyUid();
            if (!uid) { invStatus.textContent = 'Cannot detect user ID'; loadInvBtn.disabled = false; loadInvBtn.textContent = 'Load Inventory'; return; }
            invItems = await loadInventory(uid, t => { invStatus.textContent = t; });
            invStatus.textContent = invItems.length + ' items loaded';
            loadInvBtn.disabled = false; loadInvBtn.textContent = 'Reload';
            if (invItems.length) openPicker();
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CANCEL TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildCancel(P) {
        let obTrades = [], selT = new Set(), filterText = '', ageDays = 7, cDelaySec = 2;

        P.innerHTML = `
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Outbound Trades <em id="pk-tm-can-count"></em></div>
  <div style="display:flex;gap:7px;margin-bottom:9px;flex-wrap:wrap;">
    <button id="pk-tm-can-load" class="pk-tm-btn pk-tm-btn-blue pk-tm-btn-sm">Load Trades</button>
    <input id="pk-tm-can-filter" class="pk-tm-input" placeholder="Filter by username..." style="flex:1;min-width:100px;"/>
    <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;background:#161b22;border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:4px 8px;">
      Older than
      <button id="pk-tm-age-m" class="pk-tm-step-btn" style="width:20px;height:20px;border:1px solid rgba(255,255,255,.08);border-radius:3px;">−</button>
      <span id="pk-tm-age-v" style="min-width:22px;text-align:center;font-size:11px;font-weight:700;color:#e6edf3;">7d</span>
      <button id="pk-tm-age-p" class="pk-tm-step-btn" style="width:20px;height:20px;border:1px solid rgba(255,255,255,.08);border-radius:3px;">+</button>
    </span>
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
    <input type="checkbox" id="pk-tm-can-selall" style="accent-color:#f85149;width:13px;height:13px;"/>
    <label for="pk-tm-can-selall" style="font-size:12px;color:#555;cursor:pointer;">Select all visible</label>
    <span style="margin-left:auto;font-size:11px;color:#e6edf3;font-weight:700;"><span id="pk-tm-can-sel-n">0</span> selected</span>
  </div>
  <div id="pk-tm-can-list" style="max-height:260px;overflow-y:auto;"></div>
</div>
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Cancel Settings</div>
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <span style="font-size:11px;color:#555;">Delay between cancels</span>
    <div class="pk-tm-stepper"><button class="pk-tm-step-btn" id="pk-tm-cdel-m">−</button><div class="pk-tm-step-v" id="pk-tm-cdel-v">2s</div><button class="pk-tm-step-btn" id="pk-tm-cdel-p">+</button></div>
  </div>
  <div class="pk-tm-prog-wrap" id="pk-tm-can-prog" style="display:none;">
    <div class="pk-tm-prog-bg"><div class="pk-tm-prog-fill pk-tm-prog-fill-red" id="pk-tm-can-fill"></div></div>
    <div class="pk-tm-prog-row"><span id="pk-tm-can-stat">Cancelling...</span><span id="pk-tm-can-cnt">0/0</span></div>
  </div>
  <div class="pk-tm-log" id="pk-tm-can-log"><span class="pk-tm-info">// Load trades then select and cancel.</span></div>
  <div style="display:flex;gap:7px;">
    <button class="pk-tm-btn pk-tm-btn-red pk-tm-btn-w" id="pk-tm-can-do" disabled>Cancel Selected</button>
    <button class="pk-tm-btn pk-tm-btn-ghost" id="pk-tm-can-stop" disabled style="min-width:60px;">Stop</button>
  </div>
</div>`;

        const cLog = (t, c) => logLine(document.getElementById('pk-tm-can-log'), t, c);
        const syncBtn = () => { const b = document.getElementById('pk-tm-can-do'); if (b) b.disabled = !selT.size || CancelRunning; };

        function renderList() {
            const l = document.getElementById('pk-tm-can-list'); if (!l) return;
            const now = Date.now(), cut = ageDays * 86400000, fl = filterText.toLowerCase();
            const vis = obTrades.filter(t => (!fl || t.pn.toLowerCase().includes(fl)) && (now - new Date(t.sa).getTime() >= cut));
            if (!vis.length) { l.innerHTML = '<div style="color:#333;font-size:11px;padding:6px;">No trades match.</div>'; const n = document.getElementById('pk-tm-can-sel-n'); if (n) n.textContent = selT.size; return; }
            l.innerHTML = '';
            vis.forEach(t => {
                const sel = selT.has(t.id);
                const row = El('div', {}); row.className = 'pk-tm-trade-row' + (sel ? ' pk-tm-sel-r' : ''); row.dataset.id = t.id;
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pk-tm-trade-check'; cb.checked = sel;
                const toggle = checked => {
                    if (checked) { selT.add(t.id); row.classList.add('pk-tm-sel-r'); cb.checked = true; }
                    else { selT.delete(t.id); row.classList.remove('pk-tm-sel-r'); cb.checked = false; }
                    const n = document.getElementById('pk-tm-can-sel-n'); if (n) n.textContent = selT.size;
                    syncBtn();
                };
                cb.addEventListener('change', () => toggle(cb.checked));
                row.addEventListener('click', e => { if (e.target === cb) return; toggle(!cb.checked); });
                row.appendChild(cb);
                row.appendChild(Span(t.pn, { flex: '1', fontSize: '12px', color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
                row.appendChild(Span(new Date(t.sa).toLocaleDateString('en-GB'), { fontSize: '10px', color: '#333', flexShrink: '0' }));
                l.appendChild(row);
            });
            const n = document.getElementById('pk-tm-can-sel-n'); if (n) n.textContent = selT.size;
            syncBtn();
        }

        document.getElementById('pk-tm-can-filter')?.addEventListener('input', e => { filterText = e.target.value; renderList(); });
        document.getElementById('pk-tm-age-m')?.addEventListener('click', () => { ageDays = Math.max(1, ageDays - 1); const v = document.getElementById('pk-tm-age-v'); if (v) v.textContent = ageDays + 'd'; });
        document.getElementById('pk-tm-age-p')?.addEventListener('click', () => { ageDays++; const v = document.getElementById('pk-tm-age-v'); if (v) v.textContent = ageDays + 'd'; });
        document.getElementById('pk-tm-cdel-m')?.addEventListener('click', () => { cDelaySec = Math.max(1, cDelaySec - 1); const v = document.getElementById('pk-tm-cdel-v'); if (v) v.textContent = cDelaySec + 's'; });
        document.getElementById('pk-tm-cdel-p')?.addEventListener('click', () => { cDelaySec++; const v = document.getElementById('pk-tm-cdel-v'); if (v) v.textContent = cDelaySec + 's'; });

        document.getElementById('pk-tm-can-selall')?.addEventListener('change', e => {
            const now = Date.now(), cut = ageDays * 86400000, fl = filterText.toLowerCase();
            const vis = obTrades.filter(t => (!fl || t.pn.toLowerCase().includes(fl)) && (now - new Date(t.sa).getTime() >= cut));
            if (e.target.checked) vis.forEach(t => selT.add(t.id)); else vis.forEach(t => selT.delete(t.id));
            renderList();
        });

        document.getElementById('pk-tm-can-load')?.addEventListener('click', async () => {
            const b = document.getElementById('pk-tm-can-load'); if (b) { b.disabled = true; b.textContent = 'Loading...'; }
            cLog('Loading outbound trades...', 'pk-tm-info');
            obTrades = []; selT.clear();
            const l = document.getElementById('pk-tm-can-list'); if (l) l.innerHTML = '<div style="color:#333;font-size:11px;padding:6px;">Loading...</div>';
            let cursor = null, pages = 0;
            try {
                do {
                    const cp = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
                    const j = await gmGet('https://www.pekora.zip/apisite/trades/v1/trades/outbound?limit=100&sortOrder=Desc' + cp);
                    obTrades = obTrades.concat((j.data || []).map(t => ({ id: t.id, pn: t.user?.name || String(t.user?.id || '?'), sa: t.created })));
                    const nx = j.nextPageCursor; cursor = (nx != null && nx !== '') ? nx : null; pages++;
                } while (cursor && pages <= 10);
                // auto-select older than ageDays
                const cut = ageDays * 86400000;
                obTrades.filter(t => (Date.now() - new Date(t.sa).getTime()) >= cut).forEach(t => selT.add(t.id));
                const cnt = document.getElementById('pk-tm-can-count'); if (cnt) cnt.textContent = '(' + obTrades.length + ')';
                cLog('Loaded ' + obTrades.length + ' trades', 'pk-tm-ok'); renderList();
            } catch (e) { cLog('Load failed: ' + e.message, 'pk-tm-err'); }
            if (b) { b.disabled = false; b.textContent = 'Load Trades'; }
        });

        document.getElementById('pk-tm-can-stop')?.addEventListener('click', () => { CancelAbort = true; cLog('Stopped.', 'pk-tm-err'); });

        document.getElementById('pk-tm-can-do')?.addEventListener('click', async () => {
            if (CancelRunning || !selT.size) return;
            CancelRunning = true; CancelAbort = false;
            const doBtn = document.getElementById('pk-tm-can-do'), stopB = document.getElementById('pk-tm-can-stop');
            const prog = document.getElementById('pk-tm-can-prog');
            if (doBtn) { doBtn.disabled = true; doBtn.textContent = 'Cancelling...'; }
            if (stopB) stopB.disabled = false;
            if (prog) prog.style.display = 'block';
            const ids = [...selT]; let done = 0, fail = 0;
            cLog('Cancelling ' + ids.length + ' trades...', 'pk-tm-info');
            for (let i = 0; i < ids.length; i++) {
                if (CancelAbort) break;
                const tid = ids[i];
                try {
                    const csrf = await getCsrf();
                    const r = await gmPost('https://www.pekora.zip/apisite/trades/v1/trades/' + tid + '/decline', {}, { 'x-csrf-token': csrf });
                    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
                    cLog('Cancelled #' + tid, 'pk-tm-ok'); selT.delete(tid);
                    obTrades = obTrades.filter(t => t.id !== tid);
                    const row = P.querySelector('.pk-tm-trade-row[data-id="' + tid + '"]'); if (row) row.classList.add('pk-tm-gone');
                    done++;
                } catch (e) { cLog('#' + tid + ': ' + e.message, 'pk-tm-err'); fail++; }
                setProg('pk-tm-can-fill','pk-tm-can-cnt','pk-tm-can-stat', done+fail, ids.length, 'Cancelling...');
                if (!CancelAbort && i < ids.length - 1) await Sleep(cDelaySec * 1000);
            }
            cLog('Done — Cancelled: ' + done + '  Failed: ' + fail, 'pk-tm-ok');
            const cnt = document.getElementById('pk-tm-can-count'); if (cnt) cnt.textContent = '(' + obTrades.length + ' remaining)';
            const n = document.getElementById('pk-tm-can-sel-n'); if (n) n.textContent = selT.size;
            setProg('pk-tm-can-fill','pk-tm-can-cnt','pk-tm-can-stat', done+fail, ids.length, 'Complete');
            CancelRunning = false;
            if (doBtn) doBtn.textContent = 'Cancel Selected';
            if (stopB) stopB.disabled = true;
            syncBtn();
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  HISTORY TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildHistory(P) {
        P.innerHTML = `
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Trade History</div>
  <div style="display:flex;gap:7px;margin-bottom:10px;flex-wrap:wrap;">
    <button id="pk-tm-hist-comp" class="pk-tm-btn pk-tm-btn-green pk-tm-btn-sm">Completed</button>
    <button id="pk-tm-hist-dec"  class="pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm">Declined</button>
    <button id="pk-tm-hist-exp"  class="pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm">Expired</button>
    <button id="pk-tm-hist-csv"  class="pk-tm-btn pk-tm-btn-ghost pk-tm-btn-sm" style="margin-left:auto;">Export CSV</button>
  </div>
  <div class="pk-tm-log" id="pk-tm-hist-log" style="max-height:45px;"><span class="pk-tm-info">// Click a button to load trade history.</span></div>
  <div id="pk-tm-hist-list" style="max-height:360px;overflow-y:auto;"><div style="color:#333;font-size:11px;">No trades loaded.</div></div>
</div>`;

        const hLog = (t, c) => logLine(document.getElementById('pk-tm-hist-log'), t, c);

        async function loadHistory(type) {
            hLog('Loading ' + type + '...', 'pk-tm-info');
            const l = document.getElementById('pk-tm-hist-list'); if (l) l.innerHTML = '<div style="color:#333;font-size:11px;">Loading...</div>';
            HistoryTrades = []; HistoryType = type;
            let cursor = null, all = [];
            try {
                do {
                    const cp = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
                    const j = await gmGet('https://www.pekora.zip/apisite/trades/v1/trades/' + type + '?limit=25' + cp);
                    all = all.concat(j.data || []); const nx = j.nextPageCursor; cursor = (nx != null && nx !== '') ? nx : null;
                } while (cursor);
                hLog('Fetched ' + all.length + ' records — loading details...', 'pk-tm-info');
                for (let i = 0; i < all.length; i++) {
                    try { const det = await gmGet('https://www.pekora.zip/apisite/trades/v1/trades/' + all[i].id); HistoryTrades.push(det.offers ? det : all[i]); }
                    catch { HistoryTrades.push(all[i]); }
                    if ((i + 1) % 5 === 0) hLog('Loaded ' + (i + 1) + '/' + all.length + '...', 'pk-tm-info');
                    await Sleep(150);
                }
            } catch (e) { hLog('Error: ' + e.message, 'pk-tm-err'); }
            hLog('Done — ' + HistoryTrades.length + ' trades', HistoryTrades.length ? 'pk-tm-ok' : 'pk-tm-warn');
            renderHistory(type, l);
        }

        function renderHistory(type, l) {
            if (!l) l = document.getElementById('pk-tm-hist-list');
            if (!l) return;
            if (!HistoryTrades.length) { l.innerHTML = '<div style="color:#333;font-size:11px;">No ' + type + ' trades found.</div>'; return; }
            l.innerHTML = '';
            const myUid = String(_myUid || '');
            const badgeCls = { completed: 'pk-tm-ok', declined: 'pk-tm-err', expired: 'pk-tm-warn' }[type] || 'pk-tm-info';
            const badgeTxt = { completed: 'Completed', declined: 'Declined', expired: 'Expired' }[type] || type;
            HistoryTrades.forEach(trade => {
                const partner = trade.user?.name || trade.user?.displayName || ('User ' + (trade.user?.id || '?'));
                const pUid = String(trade.user?.id || '');
                const offers = trade.offers || [];
                let myO = null, theirO = null;
                offers.forEach(o => { const ou = String(o.user?.id || ''); if (ou && myUid && ou === myUid) myO = o; else theirO = o; });
                if (!myO) myO = offers[0] || null; if (!theirO) theirO = offers[1] || null;
                const myItems = (myO?.userAssets || myO?.userAssetIds || []).length;
                const theirItems = (theirO?.userAssets || theirO?.userAssetIds || []).length;
                const dateStr = trade.created ? new Date(trade.created).toLocaleDateString() : '';
                const row = El('div', {}); row.className = 'pk-tm-hist-row';
                const img = document.createElement('img'); img.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#161b22;object-fit:cover;flex-shrink:0;'; img.src = 'https://koromons.xyz/logo.png';
                if (pUid) GM_xmlhttpRequest({ method:'GET', url:'https://www.pekora.zip/apisite/thumbnails/v1/users/avatar-headshot?userIds='+pUid+'&size=150x150&format=png', withCredentials:true, headers:{Accept:'application/json'}, onload: r => { try { const d=JSON.parse(r.responseText); const u=d?.data?.[0]?.imageUrl; if(u) img.src=u; } catch {} } });
                const info = El('div', { flex: '1', overflow: 'hidden' });
                const pEl = El('div', {}); pEl.style.cssText = 'font-size:12px;font-weight:700;color:#e6edf3;'; pEl.textContent = partner;
                const meta = El('div', {}); meta.style.cssText = 'font-size:10px;color:#444;margin-top:2px;'; meta.textContent = 'Gave: ' + myItems + ' item(s)  ·  Got: ' + theirItems + ' item(s)  ·  ' + dateStr;
                info.appendChild(pEl); info.appendChild(meta);
                const badge = El('span', {}); badge.className = badgeCls; badge.style.cssText = 'font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;border:1px solid currentColor;flex-shrink:0;opacity:.8;'; badge.textContent = badgeTxt;
                row.appendChild(img); row.appendChild(info); row.appendChild(badge); l.appendChild(row);
            });
        }

        document.getElementById('pk-tm-hist-comp')?.addEventListener('click', () => loadHistory('completed'));
        document.getElementById('pk-tm-hist-dec')?.addEventListener('click', () => loadHistory('declined'));
        document.getElementById('pk-tm-hist-exp')?.addEventListener('click', () => loadHistory('expired'));
        document.getElementById('pk-tm-hist-csv')?.addEventListener('click', () => {
            if (!HistoryTrades.length) { Toast('No history loaded', 'warn'); return; }
            exportCSV([['Partner','Status','Date','Gave','Got'], ...HistoryTrades.map(t => {
                const p = t.user?.name || ('User ' + t.user?.id), o = t.offers || [];
                return [p, HistoryType, t.created ? new Date(t.created).toLocaleDateString() : '', o[0]?.userAssets?.length||0, o[1]?.userAssets?.length||0];
            })], 'trade-history');
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PORTFOLIO TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildPortfolio(P) {
        P.innerHTML = `
<div class="pk-tm-box">
  <div class="pk-tm-box-title">My Portfolio</div>
  <button id="pk-tm-port-load" class="pk-tm-btn pk-tm-btn-blue pk-tm-btn-w" style="margin-bottom:12px;">Calculate Portfolio</button>
  <div id="pk-tm-port-stats" class="pk-tm-stat-grid" style="display:none;">
    <div class="pk-tm-stat"><div class="pk-tm-stat-v" id="pk-tm-port-val">—</div><div class="pk-tm-stat-l">Total Value</div></div>
    <div class="pk-tm-stat"><div class="pk-tm-stat-v" id="pk-tm-port-rap">—</div><div class="pk-tm-stat-l">Total RAP</div></div>
  </div>
  <div class="pk-tm-log" id="pk-tm-port-log" style="display:none;max-height:40px;"></div>
  <div id="pk-tm-port-list" style="max-height:360px;overflow-y:auto;"></div>
</div>`;

        document.getElementById('pk-tm-port-load')?.addEventListener('click', async () => {
            const btn = document.getElementById('pk-tm-port-load'); if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
            const log2 = document.getElementById('pk-tm-port-log'); if (log2) log2.style.display = 'block';
            const pLog = (t, c) => logLine(log2, t, c);
            const uid = await getMyUid(); if (!uid) { pLog('Cannot detect user ID', 'pk-tm-err'); if (btn) { btn.disabled=false; btn.textContent='Calculate Portfolio'; } return; }
            const inv = await loadInventory(uid, pLog);
            const kmap = await ensureKmap(pLog);
            let totalVal = 0, totalRap = 0;
            const rows = inv.map(item => {
                const id = String(item.assetId || ''), k = kmap[id] || {};
                const val = k.Value||k.value||0, rap = k.RAP||k.rap||0;
                totalVal += val; totalRap += rap;
                return { id, name: item.name||item.assetName||('Item '+id), val, rap };
            }).sort((a, b) => b.val - a.val);
            const tv = document.getElementById('pk-tm-port-val'); if (tv) tv.textContent = Fmt(totalVal);
            const tr = document.getElementById('pk-tm-port-rap'); if (tr) tr.textContent = Fmt(totalRap);
            const stats = document.getElementById('pk-tm-port-stats'); if (stats) stats.style.display = 'grid';
            const list = document.getElementById('pk-tm-port-list'); if (!list) return;
            list.innerHTML = '';
            rows.forEach(r => {
                const row = El('div', {}); row.className = 'pk-tm-port-row';
                const img = document.createElement('img'); img.src = thumb(r.id); img.style.cssText = 'width:34px;height:34px;border-radius:6px;background:#161b22;object-fit:cover;flex-shrink:0;';
                const nm = El('div', { flex: '1', fontSize: '11px', fontWeight: '700', color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }); nm.textContent = r.name;
                const vl = El('span', {}); vl.style.cssText = 'font-size:10px;color:var(--pk-accent,#0e6fff);font-weight:700;flex-shrink:0;'; vl.textContent = r.val ? Fmt(r.val) : '—';
                const rp = El('span', {}); rp.style.cssText = 'font-size:10px;color:#444;flex-shrink:0;margin-left:6px;'; rp.textContent = 'RAP ' + (r.rap ? Fmt(r.rap) : '—');
                row.appendChild(img); row.appendChild(nm); row.appendChild(vl); row.appendChild(rp); list.appendChild(row);
            });
            if (btn) { btn.disabled = false; btn.textContent = 'Recalculate'; }
            if (log2) log2.style.display = 'none';
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ALERTS TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildAlerts(P) {
        P.innerHTML = `
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Watch an Item</div>
  <div style="display:flex;gap:7px;margin-bottom:8px;align-items:center;">
    <input id="pk-tm-alert-q" class="pk-tm-input" placeholder="Item name or ID..." style="flex:1;"/>
    <div class="pk-tm-stepper" title="Alert if value changes by this %">
      <button class="pk-tm-step-btn" id="pk-tm-alert-pct-m">−</button>
      <div class="pk-tm-step-v" id="pk-tm-alert-pct-v">5%</div>
      <button class="pk-tm-step-btn" id="pk-tm-alert-pct-p">+</button>
    </div>
    <button id="pk-tm-alert-add" class="pk-tm-btn pk-tm-btn-green pk-tm-btn-sm">Watch</button>
  </div>
  <div id="pk-tm-alert-fb" style="font-size:11px;font-weight:600;min-height:16px;margin-bottom:4px;"></div>
  <div style="font-size:10px;color:#333;">Checks every 15 min. Notifies when value changes by set %.</div>
</div>
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Watched Items <em id="pk-tm-alert-count"></em></div>
  <div id="pk-tm-alert-list"><div style="color:#333;font-size:11px;">No items being watched.</div></div>
</div>`;

        try { PriceAlerts = JSON.parse(GM_getValue('_pk_alerts', '[]')); } catch {}
        const saveAlerts = () => { try { GM_setValue('_pk_alerts', JSON.stringify(PriceAlerts)); } catch {} };

        function alertFb(msg, color) {
            const e = document.getElementById('pk-tm-alert-fb'); if (!e) return;
            e.textContent = msg; e.style.color = color || '#e6edf3';
            clearTimeout(e._t); e._t = setTimeout(() => { e.textContent = ''; }, 3000);
        }

        function renderAlerts() {
            const l = document.getElementById('pk-tm-alert-list'), cnt = document.getElementById('pk-tm-alert-count');
            if (cnt) cnt.textContent = '(' + PriceAlerts.length + ')';
            if (!l) return;
            if (!PriceAlerts.length) { l.innerHTML = '<div style="color:#333;font-size:11px;">No items being watched.</div>'; return; }
            l.innerHTML = '';
            PriceAlerts.forEach((a, i) => {
                const row = El('div', {}); row.className = 'pk-tm-alert-row';
                const img = document.createElement('img'); img.src = thumb(a.id); img.style.cssText = 'width:34px;height:34px;border-radius:6px;background:#161b22;object-fit:cover;flex-shrink:0;';
                const info = El('div', { flex: '1' });
                const nm = El('div', {}); nm.style.cssText = 'font-size:11px;font-weight:700;color:#e6edf3;'; nm.textContent = a.name;
                const vl = El('div', {}); vl.style.cssText = 'font-size:10px;color:#444;margin-top:2px;'; vl.textContent = 'Base: ' + (a.baseVal ? Fmt(a.baseVal) : '?') + '  ·  Alert ±' + a.pct + '%';
                info.appendChild(nm); info.appendChild(vl);
                const rm = El('button', { background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: '16px', lineHeight: '1', padding: '0 2px', transition: 'color .12s' });
                rm.appendChild(icon('x', 12)); rm.addEventListener('mouseenter', () => { rm.style.color = '#f85149'; }); rm.addEventListener('mouseleave', () => { rm.style.color = '#333'; });
                rm.addEventListener('click', () => { PriceAlerts.splice(i, 1); saveAlerts(); renderAlerts(); });
                row.appendChild(img); row.appendChild(info); row.appendChild(rm); l.appendChild(row);
            });
        }

        document.getElementById('pk-tm-alert-pct-m')?.addEventListener('click', () => { AlertPct = Math.max(1, AlertPct-1); const v=document.getElementById('pk-tm-alert-pct-v'); if(v) v.textContent = AlertPct+'%'; });
        document.getElementById('pk-tm-alert-pct-p')?.addEventListener('click', () => { AlertPct = Math.min(99, AlertPct+1); const v=document.getElementById('pk-tm-alert-pct-v'); if(v) v.textContent = AlertPct+'%'; });

        document.getElementById('pk-tm-alert-add')?.addEventListener('click', async () => {
            const q = document.getElementById('pk-tm-alert-q')?.value.trim(); if (!q) return;
            const btn = document.getElementById('pk-tm-alert-add'); if (btn) { btn.disabled = true; btn.textContent = '...'; }
            let foundId = null, foundName = '', foundVal = 0;
            const kmap = await ensureKmap(null);
            if (/^\d+$/.test(q) && kmap[q]) { foundId=q; foundName=kmap[q].Name||kmap[q].name||('Item '+q); foundVal=kmap[q].Value||0; }
            if (!foundId) { const id2 = Object.keys(kmap).find(k => (kmap[k].Name||kmap[k].name||'').toLowerCase().includes(q.toLowerCase())); if (id2) { foundId=id2; foundName=kmap[id2].Name||kmap[id2].name; foundVal=kmap[id2].Value||0; } }
            if (btn) { btn.disabled = false; btn.textContent = 'Watch'; }
            if (!foundId) { alertFb('Item not found', '#f85149'); return; }
            if (PriceAlerts.find(a => a.id === foundId)) { alertFb('Already watching "' + foundName + '"', '#e3b341'); return; }
            PriceAlerts.push({ id: foundId, name: foundName, baseVal: foundVal, pct: AlertPct, lastChecked: Date.now() });
            saveAlerts(); renderAlerts();
            const qel = document.getElementById('pk-tm-alert-q'); if (qel) qel.value = '';
            alertFb('Now watching "' + foundName + '" (±' + AlertPct + '%)', '#3fb950');
        });

        renderAlerts();

        if (!AlertInterval) {
            AlertInterval = setInterval(async () => {
                if (!PriceAlerts.length) return;
                const kmap = await ensureKmap(null);
                for (const a of PriceAlerts) {
                    const k = kmap[a.id] || {}, newVal = k.Value || k.value || 0;
                    if (!newVal || !a.baseVal) continue;
                    const change = Math.abs((newVal - a.baseVal) / a.baseVal) * 100;
                    if (change >= a.pct) {
                        const dir = newVal > a.baseVal ? '▲ UP' : '▼ DOWN';
                        try { GM_notification({ title: 'Pekora+ Alert: ' + a.name, text: dir + ' ' + change.toFixed(1) + '% (' + Fmt(a.baseVal) + ' → ' + Fmt(newVal) + ')', timeout: 8000 }); } catch {}
                        a.baseVal = newVal; saveAlerts(); renderAlerts();
                    }
                    await Sleep(2000);
                }
            }, 15 * 60 * 1000);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  LOOKUP TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildLookup(P) {
        P.innerHTML = `
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Item Lookup</div>
  <div style="display:flex;gap:7px;">
    <input id="pk-tm-lk-item-q" class="pk-tm-input" placeholder="Item name or asset ID..." style="flex:1;"/>
    <button id="pk-tm-lk-item-go" class="pk-tm-btn pk-tm-btn-blue pk-tm-btn-sm">Search</button>
  </div>
  <div class="pk-tm-lk-result" id="pk-tm-lk-item-r">
    <img id="pk-tm-lk-item-img" src=""/>
    <div><div style="font-weight:700;color:#e6edf3;font-size:14px;margin-bottom:3px;" id="pk-tm-lk-item-name"></div><div style="font-size:11px;color:#8b949e;line-height:1.9;" id="pk-tm-lk-item-stats"></div></div>
  </div>
</div>
<div class="pk-tm-box">
  <div class="pk-tm-box-title">Player Lookup</div>
  <div style="display:flex;gap:7px;">
    <input id="pk-tm-lk-user-q" class="pk-tm-input" placeholder="User ID..." style="flex:1;"/>
    <button id="pk-tm-lk-user-go" class="pk-tm-btn pk-tm-btn-blue pk-tm-btn-sm">Search</button>
  </div>
  <div class="pk-tm-lk-result" id="pk-tm-lk-user-r">
    <img id="pk-tm-lk-user-img" src="" style="border-radius:50%;"/>
    <div><div style="font-weight:700;color:#e6edf3;font-size:14px;margin-bottom:3px;" id="pk-tm-lk-user-name"></div><div style="font-size:11px;color:#8b949e;line-height:1.9;" id="pk-tm-lk-user-stats"></div></div>
  </div>
</div>`;

        async function itemLookup() {
            const q = document.getElementById('pk-tm-lk-item-q')?.value.trim(); if (!q) return;
            const kmap = await ensureKmap(null);
            let item = null;
            if (/^\d+$/.test(q) && kmap[q]) item = Object.assign({ id: q }, kmap[q]);
            if (!item) { const id2 = Object.keys(kmap).find(k => (kmap[k].Name||kmap[k].name||'').toLowerCase().includes(q.toLowerCase())); if (id2) item = Object.assign({ id: id2 }, kmap[id2]); }
            const r = document.getElementById('pk-tm-lk-item-r');
            if (item) {
                const img = document.getElementById('pk-tm-lk-item-img'); if (img) img.src = thumb(item.id);
                const nm = document.getElementById('pk-tm-lk-item-name'); if (nm) nm.textContent = item.Name||item.name||('Item '+item.id);
                const st = document.getElementById('pk-tm-lk-item-stats');
                const v = item.Value||item.value||0, rp = item.RAP||item.rap||0, dm = item.Demand||item.demand||'', ry = item.Rarity||item.rarity||'';
                if (st) st.innerHTML = '<b>Value:</b> '+(v?Fmt(v):'?')+'<br/><b>RAP:</b> '+(rp?Fmt(rp):'?')+(dm?'<br/><b>Demand:</b> <span class="'+demCls(dm)+'">'+dm+'</span>':'')+(ry?'<br/><b>Rarity:</b> '+ry:'');
                if (r) r.classList.add('pk-tm-vis');
            } else { if (r) r.classList.remove('pk-tm-vis'); Toast('Item not found', 'warn'); }
        }

        async function userLookup() {
            const q = document.getElementById('pk-tm-lk-user-q')?.value.trim(); if (!q) return;
            try {
                const p = await gmGet('https://koromons.xyz/api/users/' + q);
                if (!p || typeof p !== 'object') throw new Error('No data');
                const r = document.getElementById('pk-tm-lk-user-r');
                const uid = String(p.id || q);
                let avatarUrl = '';
                await new Promise(res => { GM_xmlhttpRequest({ method:'GET', url:'https://www.pekora.zip/apisite/thumbnails/v1/users/avatar-headshot?userIds='+uid+'&size=150x150&format=png', withCredentials:true, headers:{Accept:'application/json'}, onload: rv => { try { const d=JSON.parse(rv.responseText); const u=d?.data?.[0]?.imageUrl; if(u) avatarUrl=u; } catch {} res(); }, onerror:res, ontimeout:res }); });
                const img = document.getElementById('pk-tm-lk-user-img'); if (img) img.src = avatarUrl || 'https://koromons.xyz/logo.png';
                const nm = document.getElementById('pk-tm-lk-user-name'); if (nm) nm.textContent = p.displayName ? p.displayName + ' (@' + p.name + ')' : p.name || ('User ' + q);
                const st = document.getElementById('pk-tm-lk-user-stats'); if (st) st.innerHTML = '<b>Value:</b> '+(p.Value||p.currentValue?Fmt(p.Value||p.currentValue):'?')+'<br/><b>RAP:</b> '+(p.currentRap?Fmt(p.currentRap):'?')+'<br/><b>Banned:</b> '+(p.isBanned?'Yes':'No');
                if (r) r.classList.add('pk-tm-vis');
            } catch (e) {
                const r = document.getElementById('pk-tm-lk-user-r');
                const img = document.getElementById('pk-tm-lk-user-img'); if (img) img.src = 'https://koromons.xyz/logo.png';
                const nm = document.getElementById('pk-tm-lk-user-name'); if (nm) nm.textContent = 'User not found';
                const st = document.getElementById('pk-tm-lk-user-stats'); if (st) st.textContent = e.message;
                if (r) r.classList.add('pk-tm-vis');
            }
        }

        document.getElementById('pk-tm-lk-item-go')?.addEventListener('click', itemLookup);
        document.getElementById('pk-tm-lk-user-go')?.addEventListener('click', userLookup);
        document.getElementById('pk-tm-lk-item-q')?.addEventListener('keydown', e => { if (e.key==='Enter') itemLookup(); });
        document.getElementById('pk-tm-lk-user-q')?.addEventListener('keydown', e => { if (e.key==='Enter') userLookup(); });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  AUTOSELL TAB
    // ══════════════════════════════════════════════════════════════════════
    function buildAutosell(P) {
        P.innerHTML = `
<div class="pk-tm-2col">
 <div>
  <div class="pk-tm-box">
   <div class="pk-tm-box-title">Select Item <em id="pk-tm-as-sel-lbl"></em></div>
   <button id="pk-tm-as-load-inv" class="pk-tm-btn pk-tm-btn-blue pk-tm-btn-w" style="margin-bottom:9px;">Load My Inventory</button>
   <div id="pk-tm-as-inv-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;">
    <div style="color:#333;font-size:11px;">Load inventory to pick an item.</div>
   </div>
  </div>
 </div>
 <div>
  <div class="pk-tm-box">
   <div class="pk-tm-box-title">Pricing</div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:10px;">
    <div><div style="font-size:9px;color:#444;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">Floor Price (R$)</div><input id="pk-tm-as-floor" type="number" class="pk-tm-input" placeholder="e.g. 500" min="1"/></div>
    <div><div style="font-size:9px;color:#444;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">Undercut By (R$)</div><input id="pk-tm-as-undercut" type="number" class="pk-tm-input" value="1" min="1"/></div>
   </div>
   <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span style="font-size:11px;color:#555;">Check every</span>
    <div class="pk-tm-stepper"><button class="pk-tm-step-btn" id="pk-tm-as-int-m">−</button><div class="pk-tm-step-v" id="pk-tm-as-int-v">3m</div><button class="pk-tm-step-btn" id="pk-tm-as-int-p">+</button></div>
   </div>
   <label class="pk-tm-chk-row"><input type="checkbox" id="pk-tm-as-notify" checked/> Notify when sold</label>
   <label class="pk-tm-chk-row" style="margin-top:4px;"><input type="checkbox" id="pk-tm-as-toponly"/> Only undercut if not already cheapest</label>
  </div>
  <div class="pk-tm-box">
   <div class="pk-tm-box-title">Live Prices</div>
   <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:10px;">
    <div class="pk-tm-stat"><div class="pk-tm-stat-v" id="pk-tm-as-floor-d" style="color:#f85149;font-size:16px;">—</div><div class="pk-tm-stat-l">Floor</div></div>
    <div class="pk-tm-stat"><div class="pk-tm-stat-v" id="pk-tm-as-market-d" style="font-size:16px;">—</div><div class="pk-tm-stat-l">Market Low</div></div>
    <div class="pk-tm-stat"><div class="pk-tm-stat-v" id="pk-tm-as-target-d" style="font-size:16px;">—</div><div class="pk-tm-stat-l">Your Price</div></div>
   </div>
   <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
    <span id="pk-tm-as-status" class="pk-tm-status-badge idle">Idle</span>
    <span style="font-size:10px;color:#333;">Next: <span id="pk-tm-as-next">—</span></span>
   </div>
   <div style="display:flex;gap:7px;">
    <button id="pk-tm-as-start" class="pk-tm-btn pk-tm-btn-green pk-tm-btn-w">▶ Start Autosell</button>
    <button id="pk-tm-as-stop" class="pk-tm-btn pk-tm-btn-red" disabled style="min-width:65px;">Stop</button>
   </div>
  </div>
 </div>
</div>
<div class="pk-tm-box">
 <div class="pk-tm-box-title">Activity Log</div>
 <div class="pk-tm-log" id="pk-tm-as-log" style="max-height:100px;"><span class="pk-tm-info">// Select an item and set floor price to begin.</span></div>
</div>`;

        const asLog = (t, c) => logLine(document.getElementById('pk-tm-as-log'), t, c);
        function asSetStatus(s) { const e = document.getElementById('pk-tm-as-status'); if (!e) return; e.className='pk-tm-status-badge '+s; e.textContent = s==='running'?'Running':s==='sold'?'Sold!':'Idle'; }
        function asSetPrices(floor, market, target) {
            const f=document.getElementById('pk-tm-as-floor-d');  if(f) f.textContent = floor  ? 'R$'+Fmt(floor)  : '—';
            const m=document.getElementById('pk-tm-as-market-d'); if(m) m.textContent = market ? 'R$'+Fmt(market) : '—';
            const t=document.getElementById('pk-tm-as-target-d'); if(t) t.textContent = target ? 'R$'+Fmt(target) : '—';
        }

        document.getElementById('pk-tm-as-int-m')?.addEventListener('click', () => { AS_IntervalMin=Math.max(1,AS_IntervalMin-1); const v=document.getElementById('pk-tm-as-int-v'); if(v) v.textContent=AS_IntervalMin+'m'; });
        document.getElementById('pk-tm-as-int-p')?.addEventListener('click', () => { AS_IntervalMin=Math.min(60,AS_IntervalMin+1); const v=document.getElementById('pk-tm-as-int-v'); if(v) v.textContent=AS_IntervalMin+'m'; });

        document.getElementById('pk-tm-as-load-inv')?.addEventListener('click', async () => {
            const btn = document.getElementById('pk-tm-as-load-inv'); if (btn) { btn.disabled=true; btn.textContent='Loading...'; }
            const uid = await getMyUid(); if (!uid) { asLog('Cannot detect user ID', 'pk-tm-err'); if (btn) { btn.disabled=false; btn.textContent='Load My Inventory'; } return; }
            AS_Inventory = await loadInventory(uid, t => asLog(t));
            if (btn) { btn.disabled=false; btn.textContent='Reload'; }
            renderASInv();
        });

        function renderASInv() {
            const l = document.getElementById('pk-tm-as-inv-list'); if (!l) return;
            l.innerHTML = '';
            const seen = new Set(), kmap = NS.KCache || {};
            AS_Inventory.forEach(item => {
                const aid = String(item.assetId || ''); if (!aid || seen.has(aid)) return; seen.add(aid);
                const name = item.name || item.assetName || ('Item '+aid);
                const k = kmap[aid] || {}, val = k.Value||k.value||0;
                const copies = AS_Inventory.filter(i => String(i.assetId)===aid).length;
                const uaids = AS_Inventory.filter(i => String(i.assetId)===aid).map(i => i.userAssetId||i.id).filter(Boolean);
                const sel = AS_SelectedItem?.assetId === aid;
                const row = El('div', {}); row.className = 'pk-tm-inv-item' + (sel ? ' pk-tm-sel-i' : '');
                const img = document.createElement('img'); img.src = thumb(aid); img.style.cssText='width:38px;height:38px;border-radius:7px;background:#161b22;object-fit:cover;flex-shrink:0;';
                const info = El('div', { flex: '1', overflow: 'hidden' });
                const nm = El('div', {}); nm.style.cssText='font-size:12px;font-weight:700;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; nm.textContent = name;
                const sub = El('div', {}); sub.style.cssText='font-size:10px;color:#444;margin-top:2px;'; sub.textContent = (val?'Val: '+Fmt(val)+'  ·  ':'') + 'Copies: '+copies;
                info.appendChild(nm); info.appendChild(sub); row.appendChild(img); row.appendChild(info);
                row.addEventListener('click', () => {
                    AS_SelectedItem = { assetId: aid, name, val, copies, userAssetIds: uaids };
                    const lbl = document.getElementById('pk-tm-as-sel-lbl'); if (lbl) lbl.textContent = name;
                    asLog('Selected: ' + name, 'pk-tm-info');
                    const flEl = document.getElementById('pk-tm-as-floor'); if (flEl && !flEl.value && val) flEl.value = Math.floor(val * 0.8);
                    renderASInv();
                });
                l.appendChild(row);
            });
        }

        async function asGetMarketLow() {
            if (!AS_SelectedItem) return null;
            try { const r = await gmGet('https://www.pekora.zip/apisite/economy/v1/assets/'+AS_SelectedItem.assetId+'/resellers?limit=100&cursor='); const s=r.data||[]; return s.length ? s[0].price||null : null; } catch { return null; }
        }
        async function asGetMyUasId() {
            const uid = await getMyUid(); if (!uid || !AS_SelectedItem) return null;
            try { const r = await gmGet('https://www.pekora.zip/apisite/economy/v1/assets/'+AS_SelectedItem.assetId+'/users/'+uid+'/resellable-copies'); const c=r.data||[]; return c.length ? c[0].userAssetId||null : null; } catch { return null; }
        }
        async function asListItem(uasId, price) {
            const r = await sitePost('https://www.pekora.zip/apisite/economy/v1/assets/'+AS_SelectedItem.assetId+'/resellable-copies/'+uasId, { price }); return r.status===200||r.status===204;
        }

        async function asTick() {
            if (!AS_SelectedItem || !AS_Running) return;
            const floor    = parseInt(document.getElementById('pk-tm-as-floor')?.value)    || 0;
            const undercut = parseInt(document.getElementById('pk-tm-as-undercut')?.value) || 1;
            const topOnly  = document.getElementById('pk-tm-as-toponly')?.checked;
            const notify   = document.getElementById('pk-tm-as-notify')?.checked;
            if (!floor) { asLog('Set a floor price first.', 'pk-tm-err'); return; }
            asSetPrices(floor, null, null);
            const marketLow = await asGetMarketLow();
            if (marketLow === null) { asLog('Could not fetch market prices — retrying next tick', 'pk-tm-warn'); return; }
            asSetPrices(floor, marketLow, null);
            const would = marketLow - undercut;
            const targetPrice = would <= floor ? floor : would;
            asSetPrices(floor, marketLow, targetPrice);
            if (topOnly && AS_CurrentPrice === targetPrice) { asLog('Already cheapest at R$'+targetPrice+' — no change', 'pk-tm-info'); return; }
            if (AS_CurrentPrice === targetPrice) { asLog('Price unchanged (R$'+targetPrice+') — skipping', 'pk-tm-info'); return; }
            const uasId = await asGetMyUasId();
            if (!uasId) { asLog('Could not find your resellable copy', 'pk-tm-err'); return; }
            const listed = await asListItem(uasId, targetPrice);
            if (listed) { asLog('Listed "'+AS_SelectedItem.name+'" at R$'+targetPrice+' (market R$'+marketLow+')', 'pk-tm-ok'); AS_CurrentPrice=targetPrice; AS_LastUasId=uasId; }
            else { asLog('Listing failed — retrying next tick', 'pk-tm-err'); }
        }

        function asStartCountdown() {
            let secs = AS_IntervalMin * 60;
            const tick = setInterval(() => {
                if (!AS_Running) { clearInterval(tick); return; }
                secs--;
                const e = document.getElementById('pk-tm-as-next'); if (e) e.textContent = Math.floor(secs/60)+'m '+String(secs%60).padStart(2,'0')+'s';
                if (secs <= 0) clearInterval(tick);
            }, 1000);
        }

        function asStop() {
            AS_Running = false; if (AS_Interval) clearInterval(AS_Interval); AS_Interval = null;
            const start = document.getElementById('pk-tm-as-start'), stop = document.getElementById('pk-tm-as-stop');
            if (start) start.disabled = false; if (stop) stop.disabled = true;
            const ne = document.getElementById('pk-tm-as-next'); if (ne) ne.textContent = '—';
            asSetStatus('idle');
        }

        document.getElementById('pk-tm-as-start')?.addEventListener('click', async () => {
            if (!AS_SelectedItem) { asLog('Select an item first.', 'pk-tm-err'); return; }
            const floor = parseInt(document.getElementById('pk-tm-as-floor')?.value) || 0;
            if (!floor) { asLog('Set a floor price first.', 'pk-tm-err'); return; }
            if (AS_Running) return;
            AS_Running = true; AS_CurrentPrice = null; AS_LastUasId = null;
            const start=document.getElementById('pk-tm-as-start'), stop=document.getElementById('pk-tm-as-stop');
            if (start) start.disabled = true; if (stop) stop.disabled = false;
            asSetStatus('running');
            asLog('Started for "'+AS_SelectedItem.name+'" — floor R$'+floor, 'pk-tm-ok');
            await asTick(); asStartCountdown();
            AS_Interval = setInterval(async () => { if (!AS_Running) return; await asTick(); asStartCountdown(); }, AS_IntervalMin * 60 * 1000);
        });
        document.getElementById('pk-tm-as-stop')?.addEventListener('click', () => { asStop(); asLog('Autosell stopped.', 'pk-tm-warn'); });
    }

    // ── expose ─────────────────────────────────────────────────────────────
    NS.BulkTrade = { OpenPanel: BuildPanel, version: '3.3' };

})();
