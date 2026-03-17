// ════════════════════════════════════════════════════════════════════════════
//  pk-bulktrade.js  —  Pekora+ Bulk Trade Module  (v1.5)
//  Exposes: window.PekoraPlus.BulkTrade
//  Requires: pk-core.js, pk-toast.js, main script already loaded
// ════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NS = (window.PekoraPlus = window.PekoraPlus || {});
    const { El, Span, Fmt, Toast } = NS;

    let BT_Running    = false;
    let BT_Abort      = false;
    let CancelRunning = false;
    let CancelAbort   = false;
    let BT_OwnerCache = {};

    const Sleep = Ms => new Promise(R => setTimeout(R, Ms));

    // ── Logging ────────────────────────────────────────────────────────────
    function LogLine(Box, Text, Color) {
        const D = document.createElement('div');
        D.style.cssText = `color:${Color || '#8b949e'};font-size:11px;line-height:1.6;`;
        const N = new Date();
        const TS = `${String(N.getHours()).padStart(2,'0')}:${String(N.getMinutes()).padStart(2,'0')}:${String(N.getSeconds()).padStart(2,'0')}`;
        D.textContent = `[${TS}] ${Text}`;
        Box.appendChild(D);
        Box.scrollTop = Box.scrollHeight;
    }

    function SetBtnState(Btn, State) {
        const M = {
            idle:    { text: Btn.dataset.idleLabel || 'Send All Trades', bg: '#1a7f37' },
            running: { text: 'Running...', bg: '#333'    },
            done:    { text: 'Done',       bg: '#1a3d26' },
            error:   { text: 'Error',      bg: '#7a1a1a' },
        };
        const S = M[State] || M.idle;
        Btn.textContent      = S.text;
        Btn.style.background = S.bg;
        Btn.disabled         = (State === 'running');
    }

    // ── SVG ────────────────────────────────────────────────────────────────
    function Svg(Paths, Size) {
        const S = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        S.setAttribute('width',  Size || '14');
        S.setAttribute('height', Size || '14');
        S.setAttribute('viewBox', '0 0 24 24');
        S.setAttribute('fill', 'none');
        S.setAttribute('stroke', 'currentColor');
        S.setAttribute('stroke-width', '2');
        S.setAttribute('stroke-linecap', 'round');
        S.setAttribute('stroke-linejoin', 'round');
        S.style.cssText = 'flex-shrink:0;vertical-align:middle;';
        (Array.isArray(Paths) ? Paths : [Paths]).forEach(D => {
            const P = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            P.setAttribute('d', D); S.appendChild(P);
        });
        return S;
    }

    const I_BOLT   = 'M13 2L3 14h9l-1 8 10-12h-9l1-8z';
    const I_X      = ['M18 6L6 18','M6 6l12 12'];
    const I_SEARCH = ['M21 21l-4.35-4.35','M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'];
    const I_CHECK  = 'M20 6L9 17l-5-5';
    const I_CANCEL = ['M18 6L6 18','M6 6l12 12'];
    const I_PACK   = ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'];

    // ── Kmap ───────────────────────────────────────────────────────────────
    // Resolution chain (with full debug output):
    //   1. NS.KCache already populated by main script  → instant
    //   2. NS.GetKMap() — main script's GmFetch wrapper (has @connect perms)
    //   3. Direct GM_xmlhttpRequest fallback            → last resort
    async function EnsureKmap(Log) {
        const Dbg = (T, C) => { if (Log) Log('[kmap] ' + T, C); console.log('[PK+ kmap]', T); };

        Dbg('NS.KCache keys: ' + (NS.KCache ? Object.keys(NS.KCache).length : 'null'));
        Dbg('NS.GetKMap type: ' + typeof NS.GetKMap);
        Dbg('NS.GmFetch type: ' + typeof NS.GmFetch);

        if (NS.KCache && Object.keys(NS.KCache).length > 0) {
            Dbg('Using cached map — ' + Object.keys(NS.KCache).length + ' items', '#4db87a');
            return NS.KCache;
        }

        if (typeof NS.GetKMap === 'function') {
            Dbg('Calling NS.GetKMap()...');
            try {
                const Map = await NS.GetKMap();
                Dbg('NS.GetKMap returned: ' + (Map ? Object.keys(Map).length : 'null') + ' items');
                if (Map && Object.keys(Map).length > 0) return Map;
            } catch (E) {
                Dbg('NS.GetKMap threw: ' + E.message, '#e74c3c');
            }
        } else {
            Dbg('NS.GetKMap not available — main script must set window.PekoraPlus.GetKMap = GetKMap', '#f59e0b');
        }

        // Check if KCache was populated as a side effect
        if (NS.KCache && Object.keys(NS.KCache).length > 0) {
            Dbg('KCache populated via side effect — ' + Object.keys(NS.KCache).length + ' items', '#4db87a');
            return NS.KCache;
        }

        // Last resort: try GmFetch directly from NS if available
        if (typeof NS.GmFetch === 'function') {
            Dbg('Trying NS.GmFetch directly...');
            try {
                const Data = await NS.GmFetch('https://www.koromons.xyz/api/items');
                Dbg('GmFetch returned: ' + (Array.isArray(Data) ? Data.length : typeof Data) + ' items');
                if (Array.isArray(Data) && Data.length > 0) {
                    const Map = {};
                    for (const Item of Data) Map[String(Item.itemId)] = Item;
                    NS.KCache = Map;
                    Dbg('Built map from GmFetch — ' + Object.keys(Map).length + ' items', '#4db87a');
                    return Map;
                }
            } catch (E) {
                Dbg('NS.GmFetch threw: ' + E.message, '#e74c3c');
            }
        }

        Dbg('ALL kmap methods failed. Item map is empty.', '#e74c3c');
        return {};
    }

    // ── Inventory loader — full pagination ─────────────────────────────────
    async function LoadInventory(Log) {
        Log('Getting user ID...');
        try {
            console.log('[PK+ Inventory] fetching authenticated user...');
            const MeResp = await fetch('/apisite/users/v1/users/authenticated', { credentials: 'include' });
            console.log('[PK+ Inventory] auth status:', MeResp.status);
            if (!MeResp.ok) throw new Error('Auth HTTP ' + MeResp.status);
            const Me = await MeResp.json();
            console.log('[PK+ Inventory] authenticated user id:', Me.id);
            if (!Me.id) throw new Error('Not logged in');
            const Uid = Me.id;
            Log('Loading inventory for UID ' + Uid + '...');

            let Cursor   = null;
            let AllItems = [];
            let Page     = 0;

            do {
                // Omit cursor param entirely on first page — some APIs reject cursor= (empty string)
                const CursorPart = (Cursor != null && Cursor !== '') ? '&cursor=' + encodeURIComponent(Cursor) : '';
                const Url = '/apisite/inventory/v1/users/' + Uid + '/assets/collectibles?sortOrder=Desc&limit=100' + CursorPart;
                console.log('[PK+ Inventory] fetching page', Page + 1, ':', Url);
                const Resp = await fetch(Url, { credentials: 'include' });
                console.log('[PK+ Inventory] page', Page + 1, 'status:', Resp.status);
                if (!Resp.ok) throw new Error('Inventory HTTP ' + Resp.status);
                const Json = await Resp.json();

                if (!Json.data) throw new Error('No data in inventory response: ' + JSON.stringify(Json).slice(0, 200));

                const PageItems = Json.data;
                AllItems = AllItems.concat(PageItems);
                Page++;

                // nextPageCursor: treat null, undefined, and "" as done
                const Next = Json.nextPageCursor;
                Cursor = (Next != null && Next !== '') ? Next : null;

                Log('Page ' + Page + ': ' + PageItems.length + ' items (total: ' + AllItems.length + ')' + (Cursor ? ' — more pages...' : ' — done.'));
            } while (Cursor && Page < 50);

            Log('Enriching with Koromons values...');
            const Kmap = await EnsureKmap(Log);
            const Inventory = AllItems.map(I => ({
                userAssetId: I.userAssetId,
                itemId:      String(I.assetId),
                name:        I.name,
                value:       Kmap[String(I.assetId)]?.Value || 0,
                rap:         Kmap[String(I.assetId)]?.RAP   || I.recentAveragePrice || 0,
            }));

            Log('Done — ' + Inventory.length + ' tradable items loaded', '#4db87a');
            return Inventory;
        } catch (E) {
            Log('Inventory load failed: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── Owner fetcher — uses /inventory/v2/assets/{id}/owners ────────────────
    // Response shape: { nextPageCursor: "50"|null, data: [{id, owner:{id,name}, serialNumber}] }
    // credentials:'include' uses the logged-in user's session cookie automatically
    async function FetchOwners(ItemId, Log) {
        if (BT_OwnerCache[ItemId]) {
            Log('Using cached owners (' + BT_OwnerCache[ItemId].length + ')', '#4db87a');
            console.log('[PK+ FetchOwners] cache hit for', ItemId, '—', BT_OwnerCache[ItemId].length, 'owners');
            return BT_OwnerCache[ItemId];
        }
        try {
            Log('Fetching owners for item ' + ItemId + '...');
            console.log('[PK+ FetchOwners] starting fetch for item', ItemId);
            let Cursor = null;
            let All    = [];
            let Page   = 0;
            do {
                // Omit cursor param entirely on first page
                const CursorPart = (Cursor != null && Cursor !== '') ? '&cursor=' + encodeURIComponent(Cursor) : '';
                const Url = '/apisite/inventory/v2/assets/' + ItemId + '/owners?limit=100&sortOrder=Asc' + CursorPart;
                console.log('[PK+ FetchOwners] fetching page', Page + 1, ':', Url);
                const R = await fetch(Url, { credentials: 'include' });
                console.log('[PK+ FetchOwners] page', Page + 1, 'status:', R.status);
                if (!R.ok) {
                    const ErrText = await R.text().catch(() => '');
                    console.log('[PK+ FetchOwners] error body:', ErrText);
                    throw new Error('HTTP ' + R.status);
                }
                const J = await R.json();
                console.log('[PK+ FetchOwners] page', Page + 1, 'raw response — data.length:', (J.data || []).length, 'nextPageCursor:', J.nextPageCursor);
                const PageData = J.data || [];
                // Filter out entries with no owner (unowned/null)
                const WithOwner = PageData.filter(E => E.owner != null);
                console.log('[PK+ FetchOwners] page', Page + 1, '— entries with owner:', WithOwner.length, '/', PageData.length);
                All = All.concat(WithOwner);
                const Next = J.nextPageCursor;
                Cursor = (Next != null && Next !== '') ? Next : null;
                Page++;
                if (Cursor) Log('Page ' + Page + ': ' + All.length + ' owners so far...');
            } while (Cursor && Page < 100); // 100 pages * 100 = 10,000 max

            console.log('[PK+ FetchOwners] done — total raw entries with owner:', All.length);
            if (!All.length) { Log('No owners found.', '#f59e0b'); return []; }

            // Deduplicate by userId — collect all their userAssetIds
            const ByUser = new Map();
            for (const E of All) {
                const Uid = String(E.owner.id);
                if (!ByUser.has(Uid)) {
                    ByUser.set(Uid, { userId: Uid, username: E.owner.name || Uid, userAssetIds: [E.id] });
                } else {
                    ByUser.get(Uid).userAssetIds.push(E.id);
                }
            }

            const Owners = [...ByUser.values()];
            console.log('[PK+ FetchOwners] unique owners after dedup:', Owners.length);
            BT_OwnerCache[ItemId] = Owners;
            Log('Found ' + Owners.length + ' unique owners (' + All.length + ' total copies)', '#4db87a');
            return Owners;
        } catch (E) {
            console.error('[PK+ FetchOwners] threw:', E);
            Log('Owner fetch failed: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── CSRF ───────────────────────────────────────────────────────────────
    async function GetCsrf() {
        // Log all cookies so we can see which csrf cookie name is actually present
        console.log('[PK+ CSRF] all cookies:', document.cookie);
        const M = document.cookie.match(/rbxcsrf4=([^;]+)/);
        if (M) { console.log('[PK+ CSRF] found rbxcsrf4 in cookie'); return decodeURIComponent(M[1]); }
        console.log('[PK+ CSRF] rbxcsrf4 not found, probing trade endpoint to set cookie...');
        try {
            const ProbeResp = await fetch('/apisite/trades/v1/trades/send', { method: 'POST', credentials: 'include' });
            console.log('[PK+ CSRF] probe response status:', ProbeResp.status);
            // Some APIs return the token in a response header instead of cookie
            const HeaderToken = ProbeResp.headers.get('x-csrf-token');
            if (HeaderToken) { console.log('[PK+ CSRF] got token from response header'); return HeaderToken; }
        } catch (E) { console.log('[PK+ CSRF] probe fetch threw:', E.message); }
        console.log('[PK+ CSRF] cookies after probe:', document.cookie);
        // Try all common csrf cookie names
        const Names = ['rbxcsrf4', 'rbxcsrf3', 'rbxcsrf2', 'rbxcsrf', '_csrf', 'csrf_token', 'XSRF-TOKEN'];
        for (const Name of Names) {
            const Rx = new RegExp(Name + '=([^;]+)');
            const Mc = document.cookie.match(Rx);
            if (Mc) { console.log('[PK+ CSRF] found token in cookie:', Name); return decodeURIComponent(Mc[1]); }
        }
        console.warn('[PK+ CSRF] no csrf token found anywhere — trade will likely 403');
        return '';
    }

    // ── Trade sender ───────────────────────────────────────────────────────
    async function SendTrade(MyUAIds, TheirUserId, TheirUAIds) {
        const Csrf = await GetCsrf();
        console.log('[PK+ SendTrade] CSRF token:', Csrf ? Csrf.slice(0,8) + '...' : 'EMPTY');
        console.log('[PK+ SendTrade] MyUAIds:', MyUAIds);
        console.log('[PK+ SendTrade] TheirUserId:', TheirUserId);
        console.log('[PK+ SendTrade] TheirUAIds:', TheirUAIds);

        // Build payload — userId on offer[1] must be the recipient's userId as a number
        const Payload = { offers: [
            { robux: null, userAssetIds: MyUAIds,    userId: null },
            { robux: null, userAssetIds: TheirUAIds, userId: Number(TheirUserId) },
        ]};
        console.log('[PK+ SendTrade] payload:', JSON.stringify(Payload));

        const Resp = await fetch('/apisite/trades/v1/trades/send', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf },
            body: JSON.stringify(Payload),
        });
        console.log('[PK+ SendTrade] response status:', Resp.status);
        if (!Resp.ok) {
            let Msg = 'HTTP ' + Resp.status;
            try {
                const J = await Resp.json();
                console.log('[PK+ SendTrade] error body:', JSON.stringify(J));
                Msg = J.errors?.[0]?.message || J.message || Msg;
            } catch (PE) { console.log('[PK+ SendTrade] could not parse error body:', PE.message); }
            throw new Error(Msg);
        }
        const OkBody = await Resp.json().catch(() => ({}));
        console.log('[PK+ SendTrade] success body:', JSON.stringify(OkBody));
    }

    // ── CSV export ─────────────────────────────────────────────────────────
    function ExportCsv(Rows) {
        const Csv = 'Timestamp,Mode,Target,UserID,Status,Detail\n'
                  + Rows.map(R => [R.ts, R.mode, `"${R.target}"`, R.uid, R.status, `"${R.detail}"`].join(',')).join('\n');
        const Url = URL.createObjectURL(new Blob([Csv], { type: 'text/csv' }));
        const A   = document.createElement('a');
        A.href = Url; A.download = 'pekora-bulk-trades.csv'; A.click();
        setTimeout(() => URL.revokeObjectURL(Url), 2000);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PANEL
    // ══════════════════════════════════════════════════════════════════════════
    function BuildBulkTradePanel() {
        const Existing = document.getElementById('pk-bulktrade-panel');
        if (Existing) { Existing.remove(); return; }

        // Inject scoped styles for the panel
        const StyleEl = document.createElement('style');
        StyleEl.id = 'pk-bt-styles';
        StyleEl.textContent = `
            #pk-bulktrade-panel * { box-sizing: border-box; font-family: 'Source Sans Pro', sans-serif; }
            #pk-bulktrade-panel ::-webkit-scrollbar { width: 4px; height: 4px; }
            #pk-bulktrade-panel ::-webkit-scrollbar-track { background: transparent; }
            #pk-bulktrade-panel ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 4px; }
            #pk-bulktrade-panel ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); }
            .pk-bt-btn { transition: opacity .12s, filter .12s; }
            .pk-bt-btn:hover:not(:disabled) { filter: brightness(1.12); }
            .pk-bt-btn:active:not(:disabled) { filter: brightness(0.9); }
            .pk-bt-input:focus { border-color: rgba(255,255,255,.28) !important; box-shadow: 0 0 0 2px rgba(255,255,255,.06); }
            .pk-bt-chip { transition: background .1s, border-color .1s; }
            .pk-bt-chip:hover { background: #2d333b !important; border-color: rgba(255,255,255,.2) !important; }
            .pk-bt-row:hover { background: rgba(255,255,255,.05) !important; }
            .pk-drop-row { transition: background .08s; }
            .pk-drop-row:hover { background: rgba(255,255,255,.07) !important; }
            .pk-tab-btn { transition: color .12s, border-color .12s; }
        `;
        document.head.appendChild(StyleEl);

        const Overlay = El('div', {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,.72)',
            zIndex: '1000000', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(2px)',
        });
        Overlay.id = 'pk-bulktrade-panel';

        const Panel = El('div', {
            background: '#0d1117', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: '12px', width: '720px', maxWidth: '96vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.04)', overflow: 'hidden',
        });

        // ── Header ────────────────────────────────────────────────────────
        const Hdr  = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0d1117', flexShrink: '0' });
        const HdrL = El('div', { display: 'flex', alignItems: 'center', gap: '10px' });
        const LogoWrap = El('div', { display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 10px', background: 'rgba(138,81,73,.15)', borderRadius: '6px', border: '1px solid rgba(138,81,73,.3)' });
        LogoWrap.appendChild(Span('Pekora+', { fontSize: '12px', fontWeight: '700', color: 'var(--primary-color,#8A5149)', letterSpacing: '.3px' }));
        HdrL.appendChild(LogoWrap);
        const Sep = El('div', { width: '1px', height: '18px', background: 'rgba(255,255,255,.1)' });
        HdrL.appendChild(Sep);
        HdrL.appendChild(Span('Bulk Trade', { fontSize: '17px', fontWeight: '700', color: '#e6edf3', letterSpacing: '-.3px' }));
        const XBtn = El('button', { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', color: '#8b949e', cursor: 'pointer', width: '30px', height: '30px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        XBtn.className = 'pk-bt-btn';
        XBtn.appendChild(Svg(I_X, '14'));
        XBtn.addEventListener('click', () => { BT_Abort = true; CancelAbort = true; Overlay.remove(); document.getElementById('pk-bt-styles')?.remove(); document.getElementById('pk-bt-tgtdrop')?.remove(); });
        Hdr.appendChild(HdrL); Hdr.appendChild(XBtn);

        // ── Tabs ──────────────────────────────────────────────────────────
        const TabBar  = El('div', { display: 'flex', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0d1117', flexShrink: '0', padding: '0 20px', gap: '4px' });
        const TabDefs = [
            { label: 'Blast Trade', icon: I_BOLT },
            { label: 'Cancel Trades', icon: I_CANCEL },
        ];
        const Pages   = [];
        const TabBtns = TabDefs.map((D, I) => {
            const B = El('button', { padding: '10px 16px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: 'none', borderBottom: I === 0 ? '2px solid #2ea043' : '2px solid transparent', background: 'none', display: 'flex', alignItems: 'center', gap: '7px', color: I === 0 ? '#e6edf3' : '#555', marginBottom: '-1px' });
            B.className = 'pk-tab-btn';
            B.appendChild(Svg(D.icon, '13')); B.appendChild(document.createTextNode(D.label));
            TabBar.appendChild(B); return B;
        });

        const Content = El('div', { flex: '1', overflowY: 'auto', padding: '20px' });

        const SecLbl = (T, Mt) => {
            const D = El('div', { fontSize: '10px', fontWeight: '700', color: '#3d4451', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', marginTop: Mt || '0', display: 'flex', alignItems: 'center', gap: '8px' });
            D.textContent = T;
            const Line = El('div', { flex: '1', height: '1px', background: 'rgba(255,255,255,.05)' });
            D.appendChild(Line);
            return D;
        };

        // ══════════════════════════════════════════════════════════════════
        //  PAGE 0 — BLAST
        // ══════════════════════════════════════════════════════════════════
        const BlastPage = El('div', {});
        BlastPage.appendChild(SecLbl('1 · Your Offer Items'));

        const InvRow     = El('div', { display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' });
        const LoadInvBtn = El('button', { padding: '7px 16px', fontSize: '12px', fontWeight: '700', color: '#e6edf3', background: 'rgba(31,111,235,.2)', border: '1px solid rgba(56,139,253,.4)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' });
        LoadInvBtn.className = 'pk-bt-btn';
        LoadInvBtn.appendChild(Svg(I_PACK, '12'));
        LoadInvBtn.appendChild(document.createTextNode('Load Inventory'));
        const InvStatus = Span('', { fontSize: '12px', color: '#555' });
        InvRow.appendChild(LoadInvBtn); InvRow.appendChild(InvStatus);
        BlastPage.appendChild(InvRow);

        // Inline log for inventory loading progress
        const InvLog = El('div', { background: '#060a0f', borderRadius: '5px', padding: '5px 10px', fontSize: '10px', fontFamily: 'monospace', color: '#555', minHeight: '18px', marginBottom: '8px', display: 'none', border: '1px solid rgba(255,255,255,.05)' });
        BlastPage.appendChild(InvLog);

        const OfferGrid = El('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '52px', background: 'rgba(255,255,255,.02)', borderRadius: '7px', padding: '10px', border: '1px solid rgba(255,255,255,.06)' });
        const OfferPH   = Span('Load your inventory then select up to 4 items to offer', { fontSize: '11px', color: '#3d4451' });
        OfferGrid.appendChild(OfferPH);
        BlastPage.appendChild(OfferGrid);

        let InvItems = [];
        let SelOffer = new Set();

        function RefreshOfferGrid() {
            OfferGrid.innerHTML = '';
            if (!SelOffer.size) { OfferGrid.appendChild(OfferPH); return; }
            for (const UAId of SelOffer) {
                const Item = InvItems.find(I => String(I.userAssetId) === String(UAId));
                if (!Item) continue;
                const Chip = El('div', { display: 'flex', alignItems: 'center', gap: '6px', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#e6edf3', cursor: 'pointer', userSelect: 'none' });
                Chip.className = 'pk-bt-chip';
                Chip.title = 'Click to remove';
                const NSpan = El('span', {}); NSpan.textContent = Item.name; NSpan.style.cssText = 'max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                Chip.appendChild(NSpan);
                Chip.appendChild(Span(' · ' + (Item.value > 0 ? Fmt(Item.value) : 'RAP ' + Fmt(Item.rap)), { color: '#3fb950', fontWeight: '700', fontSize: '10px' }));
                const XI = Svg(I_X, '9'); XI.style.cssText = 'margin-left:2px;color:#555;';
                Chip.appendChild(XI);
                Chip.addEventListener('click', () => { SelOffer.delete(String(UAId)); RefreshOfferGrid(); CalcRatio(); });
                OfferGrid.appendChild(Chip);
            }
        }

        // ── Inventory picker ──────────────────────────────────────────────
        function OpenPicker() {
            const Picker = El('div', { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.8)', zIndex: '1000001', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' });
            const Box    = El('div', { background: '#0d1117', border: '1px solid rgba(255,255,255,.1)', borderRadius: '10px', width: '520px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.95)' });
            const PH2    = El('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0d1117' });
            PH2.appendChild(Span('Select Offer Items', { fontSize: '15px', fontWeight: '700', color: '#e6edf3' }));
            PH2.appendChild(Span('max 4', { fontSize: '11px', color: '#555', marginLeft: '8px' }));
            const PC = El('button', { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', color: '#8b949e', cursor: 'pointer', width: '28px', height: '28px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' });
            PC.className = 'pk-bt-btn';
            PC.appendChild(Svg(I_X, '13')); PC.addEventListener('click', () => Picker.remove());
            PH2.appendChild(PC); Box.appendChild(PH2);

            // Search bar inside picker
            const PSWrap = El('div', { position: 'relative', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#060a0f' });
            const PSIcon = El('div', { position: 'absolute', left: '24px', top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none', display: 'flex' });
            PSIcon.appendChild(Svg(I_SEARCH, '13'));
            const PS = El('input', { padding: '7px 10px 7px 32px', background: '#0d1117', color: '#e6edf3', border: '1px solid rgba(255,255,255,.08)', borderRadius: '6px', fontSize: '12px', outline: 'none', width: '100%' });
            PS.className = 'pk-bt-input';
            PS.placeholder = 'Search your items...';
            PSWrap.appendChild(PSIcon); PSWrap.appendChild(PS); Box.appendChild(PSWrap);

            const PL = El('div', { flex: '1', overflowY: 'auto', padding: '8px' }); Box.appendChild(PL);

            const PF = El('div', { padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,.07)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#060a0f' });
            const OkB = El('button', { padding: '7px 20px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#1a7f37', border: '1px solid #2ea043', borderRadius: '6px', cursor: 'pointer' });
            OkB.className = 'pk-bt-btn';
            OkB.textContent = 'Confirm'; OkB.addEventListener('click', () => { RefreshOfferGrid(); CalcRatio(); Picker.remove(); });
            const CaB = El('button', { padding: '7px 14px', fontSize: '13px', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', cursor: 'pointer' });
            CaB.className = 'pk-bt-btn';
            CaB.textContent = 'Cancel'; CaB.addEventListener('click', () => Picker.remove());
            PF.appendChild(CaB); PF.appendChild(OkB); Box.appendChild(PF);

            function RenderPicker(F) {
                PL.innerHTML = '';
                const Fil = InvItems.filter(I => !F || I.name.toLowerCase().includes(F.toLowerCase()));
                if (!Fil.length) { PL.appendChild(Span('No items found.', { fontSize: '12px', color: '#555', padding: '12px', display: 'block' })); return; }
                Fil.forEach(I => {
                    const Sel = SelOffer.has(String(I.userAssetId));
                    const Row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(46,160,67,.12)' : 'transparent', border: '1px solid ' + (Sel ? 'rgba(46,160,67,.3)' : 'transparent'), marginBottom: '2px' });
                    Row.className = 'pk-bt-row';
                    const Lft = El('div', { display: 'flex', flexDirection: 'column', gap: '2px' });
                    Lft.appendChild(Span(I.name, { fontSize: '12px', color: '#e6edf3', fontWeight: '500' }));
                    Lft.appendChild(Span(I.value > 0 ? 'Val: ' + Fmt(I.value) + '  RAP: ' + Fmt(I.rap) : 'RAP: ' + Fmt(I.rap), { fontSize: '10px', color: '#555' }));
                    const CkW = El('div', { width: '18px', height: '18px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: Sel ? 'rgba(46,160,67,.25)' : 'transparent', border: '1px solid ' + (Sel ? 'rgba(46,160,67,.5)' : 'rgba(255,255,255,.1)'), flexShrink: '0' });
                    if (Sel) { const Ck = Svg(I_CHECK, '11'); Ck.style.color = '#3fb950'; CkW.appendChild(Ck); }
                    Row.appendChild(Lft); Row.appendChild(CkW);
                    Row.addEventListener('click', () => {
                        const K = String(I.userAssetId);
                        if (SelOffer.has(K)) {
                            SelOffer.delete(K);
                            Row.style.background = 'transparent'; Row.style.border = '1px solid transparent';
                            CkW.innerHTML = ''; CkW.style.background = 'transparent'; CkW.style.border = '1px solid rgba(255,255,255,.1)';
                        } else {
                            if (SelOffer.size >= 4) { Toast('Max 4 offer items', 'warn'); return; }
                            SelOffer.add(K);
                            Row.style.background = 'rgba(46,160,67,.12)'; Row.style.border = '1px solid rgba(46,160,67,.3)';
                            CkW.innerHTML = ''; CkW.style.background = 'rgba(46,160,67,.25)'; CkW.style.border = '1px solid rgba(46,160,67,.5)';
                            const Ck = Svg(I_CHECK, '11'); Ck.style.color = '#3fb950'; CkW.appendChild(Ck);
                        }
                    });
                    PL.appendChild(Row);
                });
            }
            PS.addEventListener('input', () => RenderPicker(PS.value));
            RenderPicker('');
            Picker.appendChild(Box); document.body.appendChild(Picker);
        }

        LoadInvBtn.addEventListener('click', async () => {
            LoadInvBtn.disabled = true; LoadInvBtn.lastChild.textContent = ' Loading...';
            InvStatus.textContent = ''; InvLog.style.display = 'block'; InvLog.textContent = '';
            const TmpLog = (T, C) => {
                InvLog.textContent = T;
                InvLog.style.color = C || '#555';
            };
            InvItems = await LoadInventory(TmpLog);
            InvLog.style.display = 'none';
            InvStatus.textContent = InvItems.length + ' items';
            InvStatus.style.color = InvItems.length > 0 ? '#3fb950' : '#e74c3c';
            LoadInvBtn.lastChild.textContent = ' Reload';
            LoadInvBtn.disabled = false;
            if (InvItems.length) OpenPicker();
        });

        // ── 2. Target item — live search with dropdown ───────────────────────
        BlastPage.appendChild(SecLbl('2 · Target Item', '16px'));

        // Wrapper for input — dropdown is portalled to body to escape overflow:auto clipping
        const TgtWrap = El('div', { position: 'relative', marginBottom: '8px' });
        const TgtInpWrap = El('div', { position: 'relative', display: 'flex', alignItems: 'center' });
        const TgtIcon = El('div', { position: 'absolute', left: '11px', color: '#555', display: 'flex', pointerEvents: 'none', zIndex: '1' });
        TgtIcon.appendChild(Svg(I_SEARCH, '13'));
        const TgtInp  = El('input', { width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 34px', background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '7px', fontSize: '13px', outline: 'none' });
        TgtInp.className = 'pk-bt-input';
        TgtInp.placeholder = 'Type item name or paste ID...';
        TgtInpWrap.appendChild(TgtIcon); TgtInpWrap.appendChild(TgtInp);
        TgtWrap.appendChild(TgtInpWrap);
        BlastPage.appendChild(TgtWrap);

        // Dropdown portalled to body so overflow:auto on Content div does not clip it
        const TgtDrop = El('div', {
            position: 'fixed', zIndex: '2000000',
            background: '#161b22', border: '1px solid rgba(255,255,255,.15)',
            borderRadius: '8px', maxHeight: '260px', overflowY: 'auto', display: 'none',
            boxShadow: '0 12px 32px rgba(0,0,0,.85)',
        });
        TgtDrop.id = 'pk-bt-tgtdrop';
        document.body.appendChild(TgtDrop);

        // Reposition the dropdown directly under the input using its bounding rect
        function PositionDrop() {
            const R = TgtInp.getBoundingClientRect();
            TgtDrop.style.left  = R.left + 'px';
            TgtDrop.style.top   = (R.bottom + 4) + 'px';
            TgtDrop.style.width = R.width + 'px';
        }

        const TgtInfo = El('div', { minHeight: '40px', marginBottom: '12px' });
        BlastPage.appendChild(TgtInfo);

        let TgtId      = null;
        let TgtName    = '';
        let SearchTimer2 = null;

        // Get kmap once and cache it for the dropdown
        let DropKmap = null;

        function SelectItem(ItemId, Kmap) {
            const K  = Kmap[ItemId] || {};
            TgtId    = ItemId;
            TgtName  = K.Name || K.name || ('Item ' + ItemId);
            TgtInp.value = TgtName;
            TgtDrop.style.display = 'none';
            TgtDrop.innerHTML = '';

            TgtInfo.innerHTML = '';
            const KV = K.Value  || K.value  || 0;
            const KR = K.RAP    || K.rap    || 0;
            const KD = K.Demand || K.demand || '';
            const Row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,.03)', borderRadius: '7px', padding: '10px 12px', border: '1px solid rgba(255,255,255,.07)', flexWrap: 'wrap' });
            const NameSpan = Span(TgtName, { fontSize: '13px', fontWeight: '700', color: '#e6edf3' });
            Row.appendChild(NameSpan);
            if (KV > 0) Row.appendChild(Span('Val: ' + Fmt(KV), { fontSize: '11px', color: '#3fb950', fontWeight: '700', padding: '2px 7px', background: 'rgba(63,185,80,.1)', borderRadius: '4px', border: '1px solid rgba(63,185,80,.2)' }));
            if (KR > 0) Row.appendChild(Span('RAP: ' + Fmt(KR), { fontSize: '11px', color: '#58a6ff', fontWeight: '600', padding: '2px 7px', background: 'rgba(88,166,255,.08)', borderRadius: '4px', border: '1px solid rgba(88,166,255,.15)' }));
            if (KD && KD !== 'None') Row.appendChild(Span(KD, { fontSize: '11px', color: '#e3b341', padding: '2px 7px', background: 'rgba(227,179,65,.08)', borderRadius: '4px', border: '1px solid rgba(227,179,65,.15)' }));
            Row.appendChild(Span('ID: ' + ItemId, { fontSize: '10px', color: '#3d4451' }));
            TgtInfo.appendChild(Row);
            CalcRatio();
        }

        function RenderDropdown(Matches, Kmap) {
            TgtDrop.innerHTML = '';
            if (!Matches.length) { TgtDrop.style.display = 'none'; return; }
            Matches.forEach(([Id, Item]) => {
                const K  = Item;
                const KV = K.Value || K.value || 0;
                const KR = K.RAP   || K.rap   || 0;
                const Row = El('div', {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 14px', cursor: 'pointer', fontSize: '12px',
                    borderBottom: '1px solid rgba(255,255,255,.04)',
                });
                Row.className = 'pk-drop-row';

                const Left = El('div', { display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', flex: '1' });
                const NameSpan = El('span', {}); NameSpan.style.cssText = 'color:#e6edf3;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;';
                NameSpan.textContent = K.Name || K.name || ('Item ' + Id);
                const SubSpan = El('span', {}); SubSpan.style.cssText = 'font-size:10px;color:#3d4451;';
                SubSpan.textContent = 'ID: ' + Id + (K.Acronym || K.acronym ? '  · ' + (K.Acronym || K.acronym) : '');
                Left.appendChild(NameSpan); Left.appendChild(SubSpan);

                const Right = El('div', { display: 'flex', gap: '6px', alignItems: 'center', flexShrink: '0', marginLeft: '10px' });
                if (KV > 0) { const V = El('span', {}); V.style.cssText = 'font-size:10px;color:#3fb950;font-weight:700;padding:1px 5px;background:rgba(63,185,80,.1);border-radius:3px;'; V.textContent = Fmt(KV); Right.appendChild(V); }
                if (KR > 0) { const R2 = El('span', {}); R2.style.cssText = 'font-size:10px;color:#58a6ff;padding:1px 5px;background:rgba(88,166,255,.08);border-radius:3px;'; R2.textContent = Fmt(KR); Right.appendChild(R2); }

                Row.appendChild(Left); Row.appendChild(Right);
                Row.addEventListener('mousedown', (Ev) => {
                    Ev.preventDefault(); // prevent input blur before click fires
                    SelectItem(Id, Kmap);
                });
                TgtDrop.appendChild(Row);
            });
            PositionDrop();
            TgtDrop.style.display = 'block';
        }

        async function UpdateDropdown(Q) {
            console.log('[PK+ UpdateDropdown] called with:', JSON.stringify(Q));
            if (!Q || Q.length < 2) { TgtDrop.style.display = 'none'; return; }

            // Load kmap if not yet loaded
            if (!DropKmap) {
                console.log('[PK+ UpdateDropdown] loading kmap...');
                const SearchLog = (T, C) => { console.log('[PK+ search]', T); };
                DropKmap = await EnsureKmap(SearchLog);
                console.log('[PK+ UpdateDropdown] kmap loaded, keys:', DropKmap ? Object.keys(DropKmap).length : 0);
            }
            if (!DropKmap || !Object.keys(DropKmap).length) {
                console.warn('[PK+ UpdateDropdown] kmap empty — cannot search');
                return;
            }

            const QL = Q.toLowerCase();
            const Matches = [];

            // Direct ID match
            if (/^\d+$/.test(Q) && DropKmap[Q]) {
                Matches.push([Q, DropKmap[Q], 99]);
            }

            // Score and collect all matches — no hard cap on scan, show up to 30 results
            for (const [Id, Item] of Object.entries(DropKmap)) {
                if (/^\d+$/.test(Q) && Id === Q) continue; // already added above
                const Name    = (Item.Name    || Item.name    || '').toLowerCase();
                const Acronym = (Item.Acronym || Item.acronym || '').toLowerCase();
                let Score = 0;
                if (Acronym && Acronym === QL)       Score = 4;
                else if (Name === QL)                Score = 3;
                else if (Name.startsWith(QL))        Score = 2;
                else if (Name.includes(QL))          Score = 1;
                if (Score > 0) Matches.push([Id, Item, Score]);
            }

            console.log('[PK+ UpdateDropdown] raw matches for', JSON.stringify(Q), ':', Matches.length);
            // Sort by score descending, show up to 30 so the user can scroll and pick
            Matches.sort((A, B) => B[2] - A[2]);
            const Top = Matches.slice(0, 30);
            console.log('[PK+ UpdateDropdown] showing top', Top.length, 'results');

            RenderDropdown(Top.map(M => [M[0], M[1]]), DropKmap);
        }

        TgtInp.addEventListener('input', () => {
            const Q = TgtInp.value.trim();
            // Clear confirmed selection if user is typing again
            TgtId = null; TgtInfo.innerHTML = '';
            clearTimeout(SearchTimer2);
            SearchTimer2 = setTimeout(() => UpdateDropdown(Q), 150);
        });

        TgtInp.addEventListener('keydown', E => {
            if (E.key === 'Escape') { TgtDrop.style.display = 'none'; }
            if (E.key === 'Enter' && TgtDrop.style.display !== 'none') {
                const First = TgtDrop.firstElementChild;
                if (First) First.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
        });

        // Close dropdown when clicking outside — check against both the input wrap and the portalled dropdown
        document.addEventListener('mousedown', (E) => {
            if (!TgtWrap.contains(E.target) && !TgtDrop.contains(E.target)) {
                TgtDrop.style.display = 'none';
            }
        }, { capture: true });

        TgtInp.addEventListener('focus', () => {
            if (TgtInp.value.trim().length >= 2 && !TgtId) UpdateDropdown(TgtInp.value.trim());
        });

        // ── Ratio bar ─────────────────────────────────────────────────────
        const RBar = El('div', { display: 'flex', gap: '0', background: 'rgba(255,255,255,.03)', borderRadius: '7px', marginBottom: '14px', fontSize: '12px', color: '#8b949e', overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)' });

        const RCell = (Label, ValSpan) => {
            const D = El('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1', padding: '8px 12px', borderRight: '1px solid rgba(255,255,255,.05)' });
            D.appendChild(Span(Label, { fontSize: '9px', color: '#3d4451', textTransform: 'uppercase', letterSpacing: '.7px', fontWeight: '700' }));
            D.appendChild(ValSpan);
            return D;
        };

        const RO  = Span('—', { fontSize: '14px', fontWeight: '700', color: '#e6edf3' });
        const RR  = Span('—', { fontSize: '14px', fontWeight: '700', color: '#e6edf3' });
        const RV  = Span('—', { fontSize: '14px', fontWeight: '700', color: '#555' });
        RBar.appendChild(RCell('Offering', RO));
        RBar.appendChild(RCell('Requesting', RR));
        const RatioCell = RCell('Ratio', RV);
        RatioCell.style.borderRight = 'none';
        RBar.appendChild(RatioCell);
        BlastPage.appendChild(RBar);

        function CalcRatio() {
            const Kmap = NS.KCache || {};
            let OTotal = 0;
            for (const UAId of SelOffer) {
                const I = InvItems.find(X => String(X.userAssetId) === String(UAId));
                if (I) OTotal += I.value > 0 ? I.value : I.rap;
            }
            const TK    = TgtId ? (Kmap[TgtId] || {}) : {};
            const RVal  = (TK.Value || TK.value || 0) > 0 ? (TK.Value || TK.value) : (TK.RAP || TK.rap || 0);
            const Ratio = (RVal > 0 && OTotal > 0) ? (OTotal / RVal).toFixed(2) : '—';
            const RC    = Ratio !== '—' ? (parseFloat(Ratio) >= 1 ? '#3fb950' : parseFloat(Ratio) >= 0.7 ? '#e3b341' : '#f85149') : '#555';
            RO.textContent = OTotal > 0 ? Fmt(OTotal) : '—';
            RR.textContent = RVal  > 0 ? Fmt(RVal)  : '—';
            RV.textContent = Ratio !== '—' ? Ratio + 'x' : '—';
            RV.style.color = RC;
        }

        // ── 3. Options ────────────────────────────────────────────────────
        BlastPage.appendChild(SecLbl('3 · Options', '2px'));
        const OG   = El('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 28px', marginBottom: '14px' });
        const Opts = { delaySec: 5, maxUsers: 50, minRatio: 0, skipDupUid: true, skipPending: false, multiItems: false };

        function NumRow(Lbl, Gv, Sv, Min, Max, Step) {
            const Wr = El('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
            Wr.appendChild(Span(Lbl, { fontSize: '11px', color: '#555', fontWeight: '600' }));
            const Cr = El('div', { display: 'flex', alignItems: 'center', gap: '6px' });
            const MkB = T => {
                const B = El('button', { width: '26px', height: '26px', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', color: '#e6edf3', cursor: 'pointer', fontSize: '15px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' });
                B.className = 'pk-bt-btn';
                B.textContent = T; return B;
            };
            const Mn = MkB('−'), Pl = MkB('+');
            const Dp = El('span', { minWidth: '40px', textAlign: 'center', fontSize: '14px', fontWeight: '700', color: '#e6edf3', background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: '5px', padding: '3px 6px' }); Dp.textContent = Gv();
            Mn.addEventListener('click', () => { const V = Math.max(Min, Gv() - Step); Sv(V); Dp.textContent = V; });
            Pl.addEventListener('click',  () => { const V = Math.min(Max, Gv() + Step); Sv(V); Dp.textContent = V; });
            Cr.appendChild(Mn); Cr.appendChild(Dp); Cr.appendChild(Pl); Wr.appendChild(Cr); return Wr;
        }

        function ChkRow(Lbl, Gv, Sv) {
            const Wr  = El('div', { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' });
            const Box = El('div', { width: '17px', height: '17px', borderRadius: '4px', flexShrink: '0', background: Gv() ? 'rgba(46,160,67,.25)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (Gv() ? 'rgba(46,160,67,.5)' : 'rgba(255,255,255,.12)'), display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, border-color .12s' });
            if (Gv()) { const C = Svg(I_CHECK, '11'); C.style.color = '#3fb950'; Box.appendChild(C); }
            Box.addEventListener('click', () => {
                const V = !Gv(); Sv(V);
                Box.style.background = V ? 'rgba(46,160,67,.25)' : 'rgba(255,255,255,.04)';
                Box.style.border     = '1px solid ' + (V ? 'rgba(46,160,67,.5)' : 'rgba(255,255,255,.12)');
                Box.innerHTML = '';
                if (V) { const C = Svg(I_CHECK, '11'); C.style.color = '#3fb950'; Box.appendChild(C); }
            });
            Wr.appendChild(Box); Wr.appendChild(Span(Lbl, { fontSize: '12px', color: '#8b949e' })); return Wr;
        }

        const MRW = El('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
        MRW.appendChild(Span('Min ratio (0 = off)', { fontSize: '11px', color: '#555', fontWeight: '600' }));
        const MRI = El('input', { background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', padding: '5px 9px', fontSize: '13px', fontWeight: '700', width: '80px', outline: 'none', type: 'number', min: '0', step: '0.1' });
        MRI.className = 'pk-bt-input';
        MRI.value = '0'; MRI.addEventListener('input', () => { Opts.minRatio = parseFloat(MRI.value) || 0; }); MRW.appendChild(MRI);

        OG.appendChild(NumRow('Delay (seconds)',   () => Opts.delaySec, V => { Opts.delaySec = V; }, 1, 30, 1));
        OG.appendChild(NumRow('Max users',         () => Opts.maxUsers, V => { Opts.maxUsers = V; }, 1, 200, 10));
        OG.appendChild(MRW); OG.appendChild(El('div', {}));
        OG.appendChild(ChkRow('Skip duplicate UIDs',              () => Opts.skipDupUid,  V => { Opts.skipDupUid  = V; }));
        OG.appendChild(ChkRow('Skip users with pending trade',    () => Opts.skipPending, V => { Opts.skipPending = V; }));
        OG.appendChild(ChkRow('Request multiple copies (up to 4)', () => Opts.multiItems, V => { Opts.multiItems  = V; }));
        BlastPage.appendChild(OG);

        // ── Log box ───────────────────────────────────────────────────────
        const LogBox = El('div', { background: '#060a0f', borderRadius: '7px', padding: '10px 12px', height: '140px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '12px' });
        BlastPage.appendChild(LogBox);
        const Log = (T, C) => LogLine(LogBox, T, C);

        // ── Footer ────────────────────────────────────────────────────────
        const BF      = El('div', { display: 'flex', gap: '8px', alignItems: 'center' });
        const SendBtn = El('button', { flex: '1', padding: '10px 0', fontSize: '14px', fontWeight: '700', color: '#fff', background: '#1a7f37', border: '1px solid #2ea043', borderRadius: '7px', cursor: 'pointer' });
        SendBtn.className = 'pk-bt-btn';
        SendBtn.textContent = 'Send All Trades'; SendBtn.dataset.idleLabel = 'Send All Trades';
        const StopBtn = El('button', { padding: '10px 18px', fontSize: '13px', fontWeight: '700', color: '#fff', background: 'rgba(248,81,73,.15)', border: '1px solid rgba(248,81,73,.4)', borderRadius: '7px', cursor: 'pointer' });
        StopBtn.className = 'pk-bt-btn';
        StopBtn.textContent = 'Stop';
        const CsvBtn  = El('button', { padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '7px', cursor: 'pointer' });
        CsvBtn.className = 'pk-bt-btn';
        CsvBtn.textContent = 'CSV';

        let TradeLog = [];
        CsvBtn.addEventListener('click',  () => { if (!TradeLog.length) { Toast('No trades to export', 'warn'); return; } ExportCsv(TradeLog); });
        StopBtn.addEventListener('click', () => { BT_Abort = true; Log('Stopped by user.', '#f85149'); SetBtnState(SendBtn, 'idle'); BT_Running = false; });

        SendBtn.addEventListener('click', async () => {
            console.log('[PK+ SendBtn] clicked — BT_Running:', BT_Running, 'SelOffer.size:', SelOffer.size, 'TgtId:', TgtId);
            if (BT_Running) return;
            if (!SelOffer.size) { Toast('Select at least one offer item', 'warn'); return; }
            if (!TgtId)         { Toast('Set a target item first', 'warn'); return; }
            BT_Running = true; BT_Abort = false; TradeLog = [];
            SetBtnState(SendBtn, 'running'); LogBox.innerHTML = '';

            const MyUAIds  = [...SelOffer].map(Number);
            console.log('[PK+ SendBtn] MyUAIds (numbers):', MyUAIds);
            console.log('[PK+ SendBtn] InvItems count:', InvItems.length);
            const Kmap     = NS.KCache || {};
            console.log('[PK+ SendBtn] KCache keys:', Object.keys(Kmap).length);
            const OfferVal = MyUAIds.reduce((S, UAId) => { const I = InvItems.find(X => X.userAssetId === UAId); return S + (I ? (I.value > 0 ? I.value : I.rap) : 0); }, 0);
            console.log('[PK+ SendBtn] OfferVal:', OfferVal);

            Log('Target: ' + TgtName + ' (ID ' + TgtId + ')');
            Log('Fetching owners...');
            const Owners = await FetchOwners(TgtId, Log);
            console.log('[PK+ SendBtn] owners returned:', Owners.length);
            if (!Owners.length) { Log('No owners found.', '#f85149'); SetBtnState(SendBtn, 'error'); BT_Running = false; return; }

            const Capped = Owners.slice(0, Opts.maxUsers);
            Log('Sending to ' + Capped.length + ' owners, ' + Opts.delaySec + 's delay', '#58a6ff');
            console.log('[PK+ SendBtn] first 3 owners:', JSON.stringify(Capped.slice(0, 3)));

            let Sent = 0, Skipped = 0, Failed = 0;
            const SeenUids = new Set();

            for (let Idx = 0; Idx < Capped.length; Idx++) {
                if (BT_Abort) break;
                const Owner = Capped[Idx];
                console.log('[PK+ SendBtn] processing owner', Idx + 1, '/', Capped.length, '—', Owner.username, '(' + Owner.userId + ')');
                if (Opts.minRatio > 0) {
                    const TK = Kmap[TgtId] || {};
                    const RV2 = (TK.Value || TK.value || 0) > 0 ? (TK.Value || TK.value) : (TK.RAP || TK.rap || 0);
                    const R2  = RV2 > 0 ? OfferVal / RV2 : 0;
                    if (R2 < Opts.minRatio) { Log('Skip ' + Owner.username + ' ratio ' + R2.toFixed(2) + 'x', '#3d4451'); Skipped++; continue; }
                }
                if (Opts.skipDupUid && SeenUids.has(Owner.userId)) { Log('Skip dup ' + Owner.username, '#3d4451'); Skipped++; continue; }
                SeenUids.add(Owner.userId);
                // Request multiple copies if the owner has more than one and multiItems is on
                const TheirUAIds = Opts.multiItems ? Owner.userAssetIds.slice(0, 4) : [Owner.userAssetIds[0]];
                console.log('[PK+ SendBtn] TheirUAIds:', TheirUAIds, 'multiItems:', Opts.multiItems);
                try {
                    await SendTrade(MyUAIds, Owner.userId, TheirUAIds);
                    Log('Sent to ' + Owner.username + ' (' + Owner.userId + ')' + (TheirUAIds.length > 1 ? ' [x' + TheirUAIds.length + ']' : ''), '#3fb950');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Sent', detail: Owner.username });
                    Sent++;
                } catch (E) {
                    console.error('[PK+ SendBtn] trade failed for', Owner.username, ':', E.message);
                    Log('Failed ' + Owner.username + ': ' + E.message, '#f85149');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Failed', detail: E.message });
                    Failed++;
                }
                if (!BT_Abort && Idx < Capped.length - 1) { Log('Waiting ' + Opts.delaySec + 's...', '#3d4451'); await Sleep(Opts.delaySec * 1000); }
            }
            const Summ = 'Done — Sent: ' + Sent + '  Skipped: ' + Skipped + '  Failed: ' + Failed;
            Log(Summ, '#3fb950'); Toast(Summ, 'success');
            SetBtnState(SendBtn, 'done'); BT_Running = false;
        });

        BF.appendChild(SendBtn); BF.appendChild(StopBtn); BF.appendChild(CsvBtn);
        BlastPage.appendChild(BF);

        // ══════════════════════════════════════════════════════════════════
        //  PAGE 1 — CANCEL TRADES
        // ══════════════════════════════════════════════════════════════════
        const CancelPage = El('div', { display: 'none' });
        CancelPage.appendChild(SecLbl('Outbound Trades'));

        const CTR    = El('div', { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' });
        const LTBtn  = El('button', { padding: '7px 16px', fontSize: '12px', fontWeight: '700', color: '#e6edf3', background: 'rgba(31,111,235,.2)', border: '1px solid rgba(56,139,253,.4)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' });
        LTBtn.className = 'pk-bt-btn';
        LTBtn.appendChild(Svg(I_PACK, '12'));
        LTBtn.appendChild(document.createTextNode(' Load Trades'));

        const CFInpWrap = El('div', { position: 'relative', flex: '1', minWidth: '120px', display: 'flex', alignItems: 'center' });
        const CFIcon = El('div', { position: 'absolute', left: '9px', color: '#555', display: 'flex', pointerEvents: 'none' });
        CFIcon.appendChild(Svg(I_SEARCH, '12'));
        const CFInp  = El('input', { width: '100%', padding: '6px 10px 6px 28px', background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', fontSize: '12px', outline: 'none' });
        CFInp.className = 'pk-bt-input';
        CFInp.placeholder = 'Filter by username...';
        CFInpWrap.appendChild(CFIcon); CFInpWrap.appendChild(CFInp);

        const AR     = El('div', { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#555', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', padding: '4px 10px' });
        let CAgeDays = 7;
        const MkAB   = T => { const B = El('button', { width: '20px', height: '20px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '3px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }); B.className = 'pk-bt-btn'; B.textContent = T; return B; };
        const AMn    = MkAB('−'), APl = MkAB('+');
        const AD     = El('span', { fontSize: '12px', fontWeight: '700', color: '#e6edf3', minWidth: '24px', textAlign: 'center' }); AD.textContent = '7d';
        AMn.addEventListener('click', () => { CAgeDays = Math.max(1,  CAgeDays - 1); AD.textContent = CAgeDays + 'd'; });
        APl.addEventListener('click',  () => { CAgeDays = Math.min(60, CAgeDays + 1); AD.textContent = CAgeDays + 'd'; });
        AR.appendChild(Span('Older than', { fontSize: '11px' })); AR.appendChild(AMn); AR.appendChild(AD); AR.appendChild(APl);
        CTR.appendChild(LTBtn); CTR.appendChild(CFInpWrap); CTR.appendChild(AR);
        CancelPage.appendChild(CTR);

        const SR   = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', userSelect: 'none' });
        const SBox = El('div', { width: '17px', height: '17px', borderRadius: '4px', flexShrink: '0', background: 'rgba(46,160,67,.25)', border: '1px solid rgba(46,160,67,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        const SCk  = Svg(I_CHECK, '11'); SCk.style.color = '#3fb950'; SBox.appendChild(SCk);
        const SCnt = Span('', { fontSize: '11px', color: '#555', marginLeft: 'auto' });
        SR.appendChild(SBox); SR.appendChild(Span('Select all', { fontSize: '12px', color: '#8b949e' })); SR.appendChild(SCnt);
        CancelPage.appendChild(SR);

        const TList   = El('div', { height: '170px', overflowY: 'auto', background: '#060a0f', borderRadius: '7px', padding: '6px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '12px' });
        let OBTrades  = [], SelT = new Set();
        CancelPage.appendChild(TList);

        function RenderCancelList(F) {
            TList.innerHTML = '';
            const Now = Date.now(), Cut = CAgeDays * 86400000, FL = (F || '').toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Now - new Date(T.sa).getTime() >= Cut));
            if (!Vis.length) { TList.appendChild(Span('No trades match.', { fontSize: '12px', color: '#3d4451', padding: '10px', display: 'block' })); SCnt.textContent = SelT.size + ' selected'; return; }
            Vis.forEach(T => {
                const Sel = SelT.has(T.id);
                const Row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '5px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(248,81,73,.1)' : 'transparent', border: '1px solid ' + (Sel ? 'rgba(248,81,73,.3)' : 'transparent'), marginBottom: '2px' });
                Row.className = 'pk-bt-row';
                const CB  = El('div', { width: '15px', height: '15px', borderRadius: '3px', flexShrink: '0', background: Sel ? 'rgba(248,81,73,.25)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (Sel ? 'rgba(248,81,73,.5)' : 'rgba(255,255,255,.12)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
                if (Sel) { const C = Svg(I_CHECK, '9'); C.style.color = '#f85149'; CB.appendChild(C); }
                Row.appendChild(CB); Row.appendChild(Span(T.pn, { flex: '1', fontSize: '12px', color: '#e6edf3' })); Row.appendChild(Span(new Date(T.sa).toLocaleDateString('en-GB'), { fontSize: '10px', color: '#3d4451' }));
                Row.addEventListener('click', () => { if (SelT.has(T.id)) SelT.delete(T.id); else SelT.add(T.id); RenderCancelList(CFInp.value); });
                TList.appendChild(Row);
            });
            SCnt.textContent = SelT.size + ' selected';
        }

        SBox.addEventListener('click', () => {
            const Cut = CAgeDays * 86400000, FL = CFInp.value.toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Date.now() - new Date(T.sa).getTime() >= Cut));
            const All = Vis.length > 0 && Vis.every(T => SelT.has(T.id));
            if (All) { Vis.forEach(T => SelT.delete(T.id)); SBox.innerHTML = ''; SBox.style.background = 'rgba(255,255,255,.04)'; SBox.style.border = '1px solid rgba(255,255,255,.12)'; }
            else     { Vis.forEach(T => SelT.add(T.id));    SBox.innerHTML = ''; SBox.style.background = 'rgba(46,160,67,.25)'; SBox.style.border = '1px solid rgba(46,160,67,.5)'; const C = Svg(I_CHECK,'11'); C.style.color='#3fb950'; SBox.appendChild(C); }
            RenderCancelList(CFInp.value);
        });
        CFInp.addEventListener('input', () => RenderCancelList(CFInp.value));

        LTBtn.addEventListener('click', async () => {
            LTBtn.lastChild.textContent = ' Loading...'; LTBtn.disabled = true;
            OBTrades = []; SelT.clear(); TList.innerHTML = '';
            TList.appendChild(Span('Fetching outbound trades...', { fontSize: '12px', color: '#555', padding: '10px', display: 'block' }));
            try {
                let Cur = null, Pg = 1, All = [];
                do {
                    const CursorPart = (Cur != null && Cur !== '') ? '&cursor=' + Cur : '';
                    const R = await fetch('/apisite/trades/v1/trades/outbound?limit=100&sortOrder=Desc' + CursorPart, { credentials: 'include' }).then(R2 => R2.json());
                    All = All.concat(R.data || []);
                    const Next = R.nextPageCursor;
                    Cur = (Next != null && Next !== '') ? Next : null;
                    Pg++;
                } while (Cur && Pg <= 10);
                OBTrades = All.map(T => ({ id: T.id, pn: T.user?.name || String(T.user?.id || '?'), sa: T.created }));
                const Cut = CAgeDays * 86400000;
                OBTrades.filter(T => (Date.now() - new Date(T.sa).getTime()) >= Cut).forEach(T => SelT.add(T.id));
                RenderCancelList(''); LTBtn.lastChild.textContent = ' ' + OBTrades.length + ' loaded';
            } catch (E) {
                TList.innerHTML = ''; TList.appendChild(Span('Failed: ' + E.message, { fontSize: '12px', color: '#f85149', padding: '10px', display: 'block' }));
                LTBtn.lastChild.textContent = ' Load Trades';
            }
            LTBtn.disabled = false;
        });

        const CDR = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '12px', color: '#555', background: '#161b22', border: '1px solid rgba(255,255,255,.07)', borderRadius: '6px', padding: '8px 12px' });
        CDR.appendChild(Span('Delay between cancels:', { fontSize: '11px', color: '#555' }));
        let CDel  = 2;
        const MkCB = T => { const B = El('button', { width: '22px', height: '22px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }); B.className = 'pk-bt-btn'; B.textContent = T; return B; };
        const CMn = MkCB('−'), CPl = MkCB('+');
        const CD  = El('span', { fontSize: '13px', fontWeight: '700', color: '#e6edf3', minWidth: '28px', textAlign: 'center' }); CD.textContent = '2s';
        CMn.addEventListener('click', () => { CDel = Math.max(1,  CDel - 1); CD.textContent = CDel + 's'; });
        CPl.addEventListener('click',  () => { CDel = Math.min(30, CDel + 1); CD.textContent = CDel + 's'; });
        CDR.appendChild(CMn); CDR.appendChild(CD); CDR.appendChild(CPl);
        CancelPage.appendChild(CDR);

        const CLBox = El('div', { background: '#060a0f', borderRadius: '7px', padding: '10px 12px', height: '90px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '12px' });
        const CLog  = (T, C) => LogLine(CLBox, T, C);
        CancelPage.appendChild(CLBox);

        const CF      = El('div', { display: 'flex', gap: '8px' });
        const DCBtn   = El('button', { flex: '1', padding: '10px 0', fontSize: '14px', fontWeight: '700', color: '#fff', background: 'rgba(248,81,73,.2)', border: '1px solid rgba(248,81,73,.4)', borderRadius: '7px', cursor: 'pointer' });
        DCBtn.className = 'pk-bt-btn';
        DCBtn.textContent = 'Cancel Selected';
        const CSBtn   = El('button', { padding: '10px 18px', fontSize: '13px', fontWeight: '700', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '7px', cursor: 'pointer' });
        CSBtn.className = 'pk-bt-btn';
        CSBtn.textContent = 'Stop';
        CSBtn.addEventListener('click', () => { CancelAbort = true; CLog('Stopped.', '#f85149'); DCBtn.disabled = false; DCBtn.textContent = 'Cancel Selected'; CancelRunning = false; });

        DCBtn.addEventListener('click', async () => {
            if (CancelRunning) return;
            if (!SelT.size) { Toast('No trades selected', 'warn'); return; }
            CancelRunning = true; CancelAbort = false;
            DCBtn.textContent = 'Running...'; DCBtn.disabled = true; CLBox.innerHTML = '';
            const Ids = [...SelT]; CLog('Cancelling ' + Ids.length + ' trades...', '#58a6ff');
            let Done = 0, Fail = 0;
            for (let I = 0; I < Ids.length; I++) {
                if (CancelAbort) break;
                const TId = Ids[I];
                try {
                    const Csrf = await GetCsrf();
                    const R    = await fetch('/apisite/trades/v1/trades/' + TId + '/decline', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf } });
                    if (!R.ok) throw new Error('HTTP ' + R.status);
                    CLog('Cancelled ' + TId, '#3fb950'); SelT.delete(TId); Done++;
                } catch (E) { CLog(TId + ': ' + E.message, '#f85149'); Fail++; }
                if (!CancelAbort && I < Ids.length - 1) await Sleep(CDel * 1000);
            }
            CLog('Done — Cancelled: ' + Done + '  Failed: ' + Fail, '#3fb950');
            Toast('Cancelled ' + Done + ' trades', 'success');
            DCBtn.textContent = 'Cancel Selected'; DCBtn.disabled = false; CancelRunning = false;
            RenderCancelList(CFInp.value);
        });

        CF.appendChild(DCBtn); CF.appendChild(CSBtn); CancelPage.appendChild(CF);

        // ── Assemble ──────────────────────────────────────────────────────
        Pages.push(BlastPage, CancelPage);
        Pages.forEach(P => Content.appendChild(P));
        TabBtns.forEach((B, I) => {
            B.addEventListener('click', () => {
                TabBtns.forEach((Btn, J) => {
                    Btn.style.color       = J === I ? '#e6edf3' : '#555';
                    Btn.style.borderBottom = J === I ? '2px solid #2ea043' : '2px solid transparent';
                });
                Pages.forEach((P, J) => { P.style.display = J === I ? '' : 'none'; });
            });
        });

        Panel.appendChild(Hdr); Panel.appendChild(TabBar); Panel.appendChild(Content);
        Overlay.appendChild(Panel); document.body.appendChild(Overlay);
    }

    // ── Also expose GetKMap on NS so the module can call it ───────────────
    // The main script defines GetKMap locally but we need it here.
    // We hook into the NS object — if the main script sets NS.KCache,
    // we can read it. If not yet set, we call NS.GetKMap if available.
    // IMPORTANT: The main userscript.js must also do:
    //   window.PekoraPlus.GetKMap = GetKMap;
    // Add that one line after the GetKMap definition in the main script.

    NS.BulkTrade = { OpenPanel: BuildBulkTradePanel };

})();
