// ════════════════════════════════════════════════════════════════════════════
//  pk-tradepage.js  —  Pekora+ Better Trades Page  (v1.0)
//  Requires: pk-core.js (El, Span, Fmt, Toast), GM_xmlhttpRequest
// ════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const NS = (window.PekoraPlus = window.PekoraPlus || {});

    async function RenderBetterTradesPage() {
        // ── Find the native money container and replace its contents ──────────
        const moneyContainer = document.querySelector('[class*="moneyContainer"]');
        if (!moneyContainer) {
            // Retry if page hasn't loaded yet
            setTimeout(RenderBetterTradesPage, 300);
            return;
        }

        // Don't double-inject
        if (moneyContainer.querySelector('#pk-bt-inner')) return;

        const { El, Span, Fmt } = NS;
        const accent = NS.GetSiteAccent ? NS.GetSiteAccent() : '#0e6fff';
        const acRgb = (function () {
            const m = accent.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (m) return m[1] + ',' + m[2] + ',' + m[3];
            const h = accent.replace('#', '');
            if (h.length === 6) return parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16);
            return '14,111,255';
        })();

        // Hide native content inside the container (tab bar + table)
        Array.from(moneyContainer.children).forEach(ch => { ch.style.display = 'none'; });

        // ── Inject styles ────────────────────────────────────────────────────
        if (!document.getElementById('pk-bt-css')) {
            const S = document.createElement('style');
            S.id = 'pk-bt-css';
            S.textContent = `
#pk-bt-inner{font-family:'Source Sans Pro',sans-serif;padding:0;color:#8b949e;}
#pk-bt-tabbar{display:flex;border-bottom:1px solid rgba(255,255,255,.07);padding:0 4px;margin-bottom:16px;overflow-x:auto;}
#pk-bt-tabbar::-webkit-scrollbar{display:none;}
.pk-bt-tab{padding:10px 14px;cursor:pointer;font-size:11px;font-weight:700;color:#444;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;white-space:nowrap;letter-spacing:.1px;display:flex;align-items:center;gap:6px;text-transform:uppercase;flex-shrink:0;}
.pk-bt-tab:hover{color:#6b7280;}
.pk-bt-tab.active{color:#e6edf3;border-bottom-color:var(--pk-bt-accent);}
.pk-bt-tab svg{width:13px;height:13px;flex-shrink:0;vertical-align:middle;}
#pk-bt-body{position:relative;min-height:300px;}
.pk-bt-pane{display:none;padding:0 4px;}
.pk-bt-pane.active{display:block;}
.pk-bt-filter-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}
.pk-bt-input{background:#0d1117;border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:7px 12px;color:#e6edf3;font-family:'Source Sans Pro',sans-serif;font-size:12px;outline:none;transition:border-color .15s;box-sizing:border-box;}
.pk-bt-input:focus{border-color:var(--pk-bt-accent);}
.pk-bt-input::placeholder{color:#333;}
.pk-bt-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:none;border-radius:7px;cursor:pointer;font-family:'Source Sans Pro',sans-serif;font-size:12px;font-weight:700;transition:filter .12s;white-space:nowrap;}
.pk-bt-btn:hover{filter:brightness(1.12);}
.pk-bt-btn-ghost{background:rgba(255,255,255,.05);color:#8b949e;border:1px solid rgba(255,255,255,.1);}
.pk-bt-btn-sm{padding:5px 10px;font-size:11px;}
.pk-bt-trade-row{display:flex;align-items:center;gap:12px;padding:11px 14px;background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:9px;margin-bottom:6px;cursor:pointer;transition:all .12s;}
.pk-bt-trade-row:hover{border-color:rgba(255,255,255,.12);transform:translateX(2px);}
.pk-bt-trade-row img{width:36px;height:36px;border-radius:50%;background:#161b22;object-fit:cover;flex-shrink:0;}
.pk-bt-trade-partner{font-size:13px;font-weight:700;color:#e6edf3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pk-bt-trade-meta{font-size:10px;color:#444;margin-top:2px;}
.pk-bt-trade-date{font-size:11px;color:#444;flex-shrink:0;}
.pk-bt-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;flex-shrink:0;}
.pk-bt-badge.inbound{background:rgba(56,139,253,.1);color:#58a6ff;border:1px solid rgba(56,139,253,.2);}
.pk-bt-badge.outbound{background:rgba(63,185,80,.1);color:#3fb950;border:1px solid rgba(63,185,80,.2);}
.pk-bt-badge.completed{background:rgba(63,185,80,.1);color:#3fb950;border:1px solid rgba(63,185,80,.2);}
.pk-bt-badge.declined,.pk-bt-badge.inactive{background:rgba(248,81,73,.1);color:#f85149;border:1px solid rgba(248,81,73,.2);}
.pk-bt-badge.expired{background:rgba(227,179,65,.1);color:#e3b341;border:1px solid rgba(227,179,65,.2);}
.pk-bt-load-more{width:100%;padding:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#555;font-family:'Source Sans Pro',sans-serif;font-size:12px;font-weight:600;cursor:pointer;margin-top:8px;transition:all .12s;box-sizing:border-box;}
.pk-bt-load-more:hover{background:rgba(255,255,255,.07);color:#8b949e;}
.pk-bt-stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px;}
.pk-bt-stat{background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:14px;text-align:center;}
.pk-bt-stat-v{font-size:20px;font-weight:800;letter-spacing:-.3px;}
.pk-bt-stat-l{font-size:9px;color:#444;margin-top:3px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
.pk-bt-tx-row{display:flex;align-items:center;gap:10px;padding:9px 13px;background:#0d1117;border:1px solid rgba(255,255,255,.06);border-radius:8px;margin-bottom:5px;transition:border-color .12s;}
.pk-bt-tx-row:hover{border-color:rgba(255,255,255,.1);}
.pk-bt-tx-img{width:34px;height:34px;border-radius:6px;background:#161b22;object-fit:cover;flex-shrink:0;}
.pk-bt-tx-name{flex:1;font-size:12px;font-weight:600;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pk-bt-tx-amount{font-size:12px;font-weight:700;flex-shrink:0;min-width:60px;text-align:right;}
.pk-bt-tx-amount.pos{color:#3fb950;}
.pk-bt-tx-amount.neg{color:#f85149;}
.pk-bt-tx-amount.neu{color:#8b949e;}
.pk-bt-tx-date{font-size:10px;color:#444;flex-shrink:0;margin-left:8px;}
.pk-bt-empty{text-align:center;padding:40px 20px;color:#333;font-size:13px;}
.pk-bt-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.08);border-top-color:var(--pk-bt-accent);border-radius:50%;animation:pk-bt-spin .7s linear infinite;margin-right:6px;vertical-align:middle;}
.pk-bt-count{font-size:11px;color:#444;flex-shrink:0;}
@keyframes pk-bt-spin{to{transform:rotate(360deg);}}
            `.replace(/var\(--pk-bt-accent\)/g, accent);
            document.head.appendChild(S);
        }

        // ── Build the container ──────────────────────────────────────────────
        const inner = document.createElement('div');
        inner.id = 'pk-bt-inner';

        const tabBar = document.createElement('div'); tabBar.id = 'pk-bt-tabbar';
        const body = document.createElement('div'); body.id = 'pk-bt-body';

        const mkSvg = (d) => {
            const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
            s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('fill','none');
            s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','2');
            s.setAttribute('stroke-linecap','round'); s.setAttribute('stroke-linejoin','round');
            s.setAttribute('width','13'); s.setAttribute('height','13');
            d.split('|').forEach(path => { const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',path); s.appendChild(p); });
            return s;
        };

        const TABS = [
            { id:'inbound',      label:'Inbound',      icon:'M12 19V5|M5 12l7-7 7 7' },
            { id:'outbound',     label:'Outbound',     icon:'M12 5v14|M5 12l7 7 7-7' },
            { id:'completed',    label:'Completed',    icon:'M20 6L9 17l-5-5' },
            { id:'inactive',     label:'Inactive',     icon:'M18 6L6 18|M6 6l12 12' },
            { id:'summary',      label:'Summary',      icon:'M18 20V10|M12 20V4|M6 20v-6' },
            { id:'transactions', label:'Transactions', icon:'M12 1v22|M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
        ];

        const panes = {};
        const tabBtns = TABS.map((t, i) => {
            const btn = document.createElement('div');
            btn.className = 'pk-bt-tab' + (i === 0 ? ' active' : '');
            btn.dataset.tab = t.id;
            btn.appendChild(mkSvg(t.icon));
            btn.appendChild(document.createTextNode(t.label));
            tabBar.appendChild(btn);
            const pane = document.createElement('div');
            pane.className = 'pk-bt-pane' + (i === 0 ? ' active' : '');
            body.appendChild(pane); panes[t.id] = pane;
            return btn;
        });

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                Object.values(panes).forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                panes[tab].classList.add('active');
                if (!panes[tab].dataset.loaded) loadTab(tab);
            });
        });

        inner.appendChild(tabBar);
        inner.appendChild(body);
        moneyContainer.appendChild(inner);

        // ── Shared helpers ───────────────────────────────────────────────────
        function pkFetch(url) {
            return new Promise((res, rej) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, withCredentials: true,
                    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                    onload: r => { try { res(JSON.parse(r.responseText)); } catch(e) { rej(new Error('Parse error')); } },
                    onerror: () => rej(new Error('Network error')), ontimeout: () => rej(new Error('Timeout'))
                });
            });
        }

        function spinner(msg) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:24px;text-align:center;color:#555;font-size:12px;';
            d.innerHTML = '<span class="pk-bt-spinner"></span>' + (msg || 'Loading...');
            return d;
        }

        // ── Trade row renderer ───────────────────────────────────────────────
        function tradeRow(trade, type) {
            const partner = trade.user?.name || trade.user?.displayName || ('User ' + (trade.user?.id || '?'));
            const pUid = String(trade.user?.id || '');
            const dateStr = trade.created ? new Date(trade.created).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
            const expStr  = trade.expiration ? new Date(trade.expiration).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '';

            const row = document.createElement('div'); row.className = 'pk-bt-trade-row';
            const img = document.createElement('img'); img.src = 'https://koromons.xyz/logo.png'; img.style.cssText='width:36px;height:36px;border-radius:50%;background:#161b22;object-fit:cover;flex-shrink:0;';
            if (pUid) GM_xmlhttpRequest({ method:'GET', url:'https://www.pekora.zip/apisite/thumbnails/v1/users/avatar-headshot?userIds='+pUid+'&size=150x150&format=png', withCredentials:true, headers:{Accept:'application/json'}, onload:r=>{try{const d=JSON.parse(r.responseText);const u=d?.data?.[0]?.imageUrl;if(u)img.src=u;}catch{}} });

            const info = document.createElement('div'); info.style.cssText='flex:1;overflow:hidden;min-width:0;';
            const nm = document.createElement('div'); nm.className='pk-bt-trade-partner'; nm.textContent = partner;
            const meta = document.createElement('div'); meta.className='pk-bt-trade-meta'; meta.textContent = dateStr + (expStr ? '  ·  Exp: '+expStr : '');
            info.appendChild(nm); info.appendChild(meta);

            const badge = document.createElement('span'); badge.className='pk-bt-badge '+type; badge.textContent = type.charAt(0).toUpperCase()+type.slice(1);
            const idEl = document.createElement('div'); idEl.className='pk-bt-trade-date'; idEl.textContent='#'+trade.id;

            row.appendChild(img); row.appendChild(info); row.appendChild(badge); row.appendChild(idEl);
            row.addEventListener('click', () => { window.location.href = '/trades/' + trade.id; });
            return row;
        }

        // ── Trade list loader ────────────────────────────────────────────────
        async function loadTradeTab(pane, type) {
            pane.innerHTML = ''; pane.appendChild(spinner('Loading ' + type + ' trades...'));
            pane.dataset.loaded = '1';

            let allTrades = [], cursor = null;

            const filterRow = document.createElement('div'); filterRow.className = 'pk-bt-filter-row';
            const filterInp = document.createElement('input'); filterInp.className = 'pk-bt-input'; filterInp.placeholder = 'Filter by username...'; filterInp.style.cssText='flex:1;min-width:120px;';
            const countEl = document.createElement('span'); countEl.className = 'pk-bt-count';
            const reloadBtn = document.createElement('button'); reloadBtn.className = 'pk-bt-btn pk-bt-btn-ghost pk-bt-btn-sm'; reloadBtn.textContent = 'Reload';
            filterRow.appendChild(filterInp); filterRow.appendChild(countEl); filterRow.appendChild(reloadBtn);

            const list = document.createElement('div');
            const loadMoreBtn = document.createElement('button'); loadMoreBtn.className = 'pk-bt-load-more'; loadMoreBtn.textContent = 'Load more'; loadMoreBtn.style.display = 'none';

            async function fetchPage() {
                const cp = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
                const data = await pkFetch('https://www.pekora.zip/apisite/trades/v1/trades/' + type + cp);
                allTrades = allTrades.concat(data.data || []);
                cursor = data.nextPageCursor || null;
            }

            function renderList() {
                list.innerHTML = '';
                const fl = filterInp.value.toLowerCase();
                const vis = fl ? allTrades.filter(t => (t.user?.name||'').toLowerCase().includes(fl)) : allTrades;
                countEl.textContent = vis.length + ' trade' + (vis.length !== 1 ? 's' : '');
                if (!vis.length) { list.innerHTML = '<div class="pk-bt-empty">No ' + type + ' trades found.</div>'; }
                else vis.forEach(t => list.appendChild(tradeRow(t, type)));
                loadMoreBtn.style.display = (cursor && allTrades.length > 0) ? 'block' : 'none';
            }

            try { await fetchPage(); } catch(e) { pane.innerHTML = '<div class="pk-bt-empty">Error: ' + e.message + '</div>'; return; }

            pane.innerHTML = '';
            pane.appendChild(filterRow); pane.appendChild(list); pane.appendChild(loadMoreBtn);
            renderList();

            filterInp.addEventListener('input', renderList);
            loadMoreBtn.addEventListener('click', async () => {
                loadMoreBtn.disabled = true; loadMoreBtn.innerHTML = '<span class="pk-bt-spinner"></span>Loading...';
                try { await fetchPage(); renderList(); } catch {}
                loadMoreBtn.disabled = false; loadMoreBtn.textContent = 'Load more';
            });
            reloadBtn.addEventListener('click', () => { allTrades=[]; cursor=null; pane.dataset.loaded=''; loadTab(type); });
        }

        // ── Summary tab ──────────────────────────────────────────────────────
        async function loadSummaryTab(pane) {
            pane.innerHTML = ''; pane.appendChild(spinner('Loading summary...'));
            pane.dataset.loaded = '1';
            let uid = null;
            try { const d = await pkFetch('https://www.pekora.zip/apisite/users/v1/users/authenticated'); uid = d?.id; } catch {}
            if (!uid) { pane.innerHTML = '<div class="pk-bt-empty">Could not detect user ID.</div>'; return; }

            const FRAMES = ['day','week','month','year'];
            const filterRow = document.createElement('div'); filterRow.className = 'pk-bt-filter-row';
            const frameSelect = document.createElement('select'); frameSelect.className = 'pk-bt-input';
            FRAMES.forEach(f => { const o=document.createElement('option'); o.value=f; o.textContent=f.charAt(0).toUpperCase()+f.slice(1); if(f==='week')o.selected=true; frameSelect.appendChild(o); });
            filterRow.appendChild(frameSelect);
            const statGrid = document.createElement('div'); statGrid.className = 'pk-bt-stat-grid';
            const reloadBtn = document.createElement('button'); reloadBtn.className = 'pk-bt-btn pk-bt-btn-ghost pk-bt-btn-sm'; reloadBtn.textContent = 'Reload';
            filterRow.appendChild(reloadBtn);

            async function loadSummary() {
                statGrid.innerHTML = '<div style="color:#333;font-size:12px;padding:10px;"><span class="pk-bt-spinner"></span>Loading...</div>';
                try {
                    const data = await pkFetch('https://www.pekora.zip/apisite/economy/v2/users/'+uid+'/transaction-totals?timeFrame='+frameSelect.value+'&transactionType=summary');
                    statGrid.innerHTML = '';
                    const FIELDS = [['salesTotal','Sales'],['purchasesTotal','Purchases'],['affiliateSalesTotal','Affiliates'],['groupPayoutsTotal','Group Payouts'],['currencyPurchasesTotal','Robux Bought'],['premiumStipendsTotal','Premium']];
                    FIELDS.forEach(([k,l]) => {
                        const v = data[k] || 0; if (!v) return;
                        const stat = document.createElement('div'); stat.className = 'pk-bt-stat';
                        const sv = document.createElement('div'); sv.className = 'pk-bt-stat-v';
                        sv.textContent = (v>0?'+':'')+Fmt(Math.abs(v)); sv.style.color = v>0?'#3fb950':'#f85149';
                        const sl = document.createElement('div'); sl.className = 'pk-bt-stat-l'; sl.textContent = l;
                        stat.appendChild(sv); stat.appendChild(sl); statGrid.appendChild(stat);
                    });
                    if (!statGrid.children.length) statGrid.innerHTML = '<div class="pk-bt-empty">No data for this period.</div>';
                } catch(e) { statGrid.innerHTML = '<div class="pk-bt-empty">Error: ' + e.message + '</div>'; }
            }

            pane.innerHTML = '';
            pane.appendChild(filterRow); pane.appendChild(statGrid);
            frameSelect.addEventListener('change', loadSummary);
            reloadBtn.addEventListener('click', loadSummary);
            loadSummary();
        }

        // ── Transactions tab ─────────────────────────────────────────────────
        async function loadTransactionsTab(pane) {
            pane.innerHTML = ''; pane.appendChild(spinner('Loading transactions...'));
            pane.dataset.loaded = '1';
            let uid = null;
            try { const d = await pkFetch('https://www.pekora.zip/apisite/users/v1/users/authenticated'); uid = d?.id; } catch {}
            if (!uid) { pane.innerHTML = '<div class="pk-bt-empty">Could not detect user ID.</div>'; return; }

            // Correct transaction type slugs from the actual API
            const TX_TYPES = [
                { v:'purchase',     l:'Purchases' },
                { v:'sale',         l:'Sales' },
            ];
            let allTx = [], cursor = null, currentType = 'purchase';

            const filterRow = document.createElement('div'); filterRow.className = 'pk-bt-filter-row';
            const typeSelect = document.createElement('select'); typeSelect.className = 'pk-bt-input';
            TX_TYPES.forEach(t => { const o=document.createElement('option'); o.value=t.v; o.textContent=t.l; typeSelect.appendChild(o); });
            const countEl = document.createElement('span'); countEl.className = 'pk-bt-count';
            const reloadBtn = document.createElement('button'); reloadBtn.className = 'pk-bt-btn pk-bt-btn-ghost pk-bt-btn-sm'; reloadBtn.textContent = 'Reload';
            filterRow.appendChild(typeSelect); filterRow.appendChild(countEl); filterRow.appendChild(reloadBtn);

            const list = document.createElement('div');
            const loadMoreBtn = document.createElement('button'); loadMoreBtn.className = 'pk-bt-load-more'; loadMoreBtn.textContent = 'Load more'; loadMoreBtn.style.display = 'none';

            // Transaction amount display:
            // - purchases: amount is the cost (positive = you spent robux), show as -N (red)
            // - sales: amount is what you earned, show as +N (green)
            // - commission/ad/group: show sign from API with green/red
            function amountDisplay(tx, type) {
                const raw = tx.amount || 0;
                if (raw === 0) return { text: '0', cls: 'neu' };
                // For purchases, the API returns the price paid as a positive number — show as negative (cost)
                if (type === 'purchase') return { text: '-' + Fmt(Math.abs(raw)), cls: 'neg' };
                // For sales, positive = earned
                if (raw > 0) return { text: '+' + Fmt(raw), cls: 'pos' };
                return { text: Fmt(raw), cls: 'neg' };
            }

            function txRow(tx) {
                const row = document.createElement('div'); row.className = 'pk-bt-tx-row';
                const assetId = tx.details?.id || tx.assetId || '';
                const img = document.createElement('img'); img.className = 'pk-bt-tx-img';
                img.src = assetId ? 'https://www.pekora.zip/Thumbs/Asset.ashx?width=100&height=100&assetId='+assetId : 'https://koromons.xyz/logo.png';
                img.onerror = () => { img.src='https://koromons.xyz/logo.png'; };

                const name = document.createElement('div'); name.className = 'pk-bt-tx-name';
                name.textContent = tx.details?.name || tx.description || '—';
                if (assetId) { name.style.cursor='pointer'; name.style.color=accent; name.addEventListener('click', () => window.open('/catalog/'+assetId, '_blank')); }

                const { text, cls } = amountDisplay(tx, currentType);
                const amt = document.createElement('div'); amt.className = 'pk-bt-tx-amount ' + cls; amt.textContent = text;

                const date = document.createElement('div'); date.className = 'pk-bt-tx-date';
                date.textContent = tx.created ? new Date(tx.created).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';

                row.appendChild(img); row.appendChild(name); row.appendChild(amt); row.appendChild(date);
                return row;
            }

            async function fetchTxPage() {
                const cp = cursor ? '&cursor='+encodeURIComponent(cursor) : '';
                const data = await pkFetch('https://www.pekora.zip/apisite/economy/v2/users/'+uid+'/transactions?transactionType='+currentType+cp);
                allTx = allTx.concat(data.data || []);
                cursor = data.nextPageCursor || null;
            }

            function renderTx() {
                list.innerHTML = '';
                countEl.textContent = allTx.length + ' record' + (allTx.length!==1?'s':'');
                if (!allTx.length) { list.innerHTML='<div class="pk-bt-empty">No transactions found.</div>'; return; }
                allTx.forEach(tx => list.appendChild(txRow(tx)));
                loadMoreBtn.style.display = cursor ? 'block' : 'none';
            }

            async function reload() {
                allTx=[]; cursor=null; list.innerHTML=''; countEl.textContent=''; loadMoreBtn.style.display='none';
                list.appendChild(spinner(''));
                try { await fetchTxPage(); } catch(e) { list.innerHTML='<div class="pk-bt-empty">Error: '+e.message+'</div>'; return; }
                list.innerHTML=''; renderTx();
            }

            pane.innerHTML = '';
            pane.appendChild(filterRow); pane.appendChild(list); pane.appendChild(loadMoreBtn);
            typeSelect.addEventListener('change', () => { currentType=typeSelect.value; allTx=[]; cursor=null; reload(); });
            reloadBtn.addEventListener('click', reload);
            loadMoreBtn.addEventListener('click', async () => {
                loadMoreBtn.disabled=true; loadMoreBtn.innerHTML='<span class="pk-bt-spinner"></span>Loading...';
                try { await fetchTxPage(); renderTx(); } catch {}
                loadMoreBtn.disabled=false; loadMoreBtn.textContent='Load more';
            });
            reload();
        }

        // ── Tab router ───────────────────────────────────────────────────────
        function loadTab(tab) {
            const pane = panes[tab];
            if (!pane || pane.dataset.loaded) return;
            if (['inbound','outbound','completed','inactive'].includes(tab)) loadTradeTab(pane, tab);
            else if (tab === 'summary') loadSummaryTab(pane);
            else if (tab === 'transactions') loadTransactionsTab(pane);
        }

        // Load initial tab
        loadTab('inbound');
    }

    NS.TradePage = { Render: RenderBetterTradesPage };
    // Also expose GetSiteAccent if not already on NS (for use above)
    if (!NS.GetSiteAccent) NS.GetSiteAccent = function() { return '#0e6fff'; };
})();
