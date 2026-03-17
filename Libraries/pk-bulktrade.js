// ════════════════════════════════════════════════════════════════════════════
//  pk-bulktrade.js  —  Pekora+ Bulk Trade Module  (v1.4)
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
            idle:    { text: Btn.dataset.idleLabel || 'Send All Trades', bg: '#238636' },
            running: { text: 'Running...', bg: '#444'    },
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
            const MeResp = await fetch('/apisite/users/v1/users/authenticated', { credentials: 'include' });
            if (!MeResp.ok) throw new Error('Auth HTTP ' + MeResp.status);
            const Me = await MeResp.json();
            if (!Me.id) throw new Error('Not logged in');
            const Uid = Me.id;
            Log('Loading inventory for UID ' + Uid + '...');

            let Cursor   = null;
            let AllItems = [];
            let Page     = 0;

            do {
                // Build URL - cursor param always present, empty string on first call
                const Url = '/apisite/inventory/v1/users/' + Uid + '/assets/collectibles?sortOrder=Desc&limit=100&cursor=' + (Cursor ? encodeURIComponent(Cursor) : '');
                const Resp = await fetch(Url, { credentials: 'include' });
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
            } while (Cursor && Page < 20);

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
            return BT_OwnerCache[ItemId];
        }
        try {
            Log('Fetching owners for item ' + ItemId + '...');
            let Cursor = '', All = [], Page = 0;
            do {
                const Url = '/apisite/inventory/v2/assets/' + ItemId + '/owners?cursor=' + encodeURIComponent(Cursor) + '&limit=50&sortOrder=Asc';
                const R = await fetch(Url, { credentials: 'include' });
                if (!R.ok) throw new Error('HTTP ' + R.status);
                const J = await R.json();
                const PageData = J.data || [];
                // Filter out entries with no owner (unowned/null)
                All = All.concat(PageData.filter(E => E.owner != null));
                const Next = J.nextPageCursor;
                Cursor = (Next != null && Next !== '') ? Next : null;
                Page++;
                if (Cursor) Log('Page ' + Page + ': ' + All.length + ' owners so far...');
            } while (Cursor && Page < 40); // 40 pages * 50 = 2000 max

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
            BT_OwnerCache[ItemId] = Owners;
            Log('Found ' + Owners.length + ' unique owners (' + All.length + ' total copies)', '#4db87a');
            return Owners;
        } catch (E) {
            Log('Owner fetch failed: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── CSRF ───────────────────────────────────────────────────────────────
    async function GetCsrf() {
        const M = document.cookie.match(/rbxcsrf4=([^;]+)/);
        if (M) return decodeURIComponent(M[1]);
        try { await fetch('/apisite/trades/v1/trades/send', { method: 'POST', credentials: 'include' }); } catch {}
        const M2 = document.cookie.match(/rbxcsrf4=([^;]+)/);
        return M2 ? decodeURIComponent(M2[1]) : '';
    }

    // ── Trade sender ───────────────────────────────────────────────────────
    async function SendTrade(MyUAIds, TheirUserId, TheirUAIds) {
        const Csrf = await GetCsrf();
        const Resp = await fetch('/apisite/trades/v1/trades/send', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf },
            body: JSON.stringify({ offers: [
                { robux: null, userAssetIds: MyUAIds,    userId: null },
                { robux: null, userAssetIds: TheirUAIds, userId: TheirUserId },
            ]}),
        });
        if (!Resp.ok) {
            let Msg = 'HTTP ' + Resp.status;
            try { const J = await Resp.json(); Msg = J.errors?.[0]?.message || J.message || Msg; } catch {}
            throw new Error(Msg);
        }
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

        const Overlay = El('div', {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,.65)',
            zIndex: '1000000', display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        Overlay.id = 'pk-bulktrade-panel';

        const Panel = El('div', {
            background: '#161b22', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '10px', width: '700px', maxWidth: '96vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,.8)', overflow: 'hidden',
        });

        // ── Header ────────────────────────────────────────────────────────
        const Hdr  = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.1)', background: '#0d1117', flexShrink: '0' });
        const HdrL = El('div', { display: 'flex', alignItems: 'center', gap: '10px' });
        HdrL.appendChild(Span('Pekora+',    { fontSize: '13px', fontWeight: '700', color: 'var(--primary-color,#8A5149)' }));
        HdrL.appendChild(Span('Bulk Trade', { fontSize: '16px', fontWeight: '700', color: '#e6edf3' }));
        const XBtn = El('button', { background: 'none', border: '1px solid rgba(255,255,255,.12)', borderRadius: '5px', color: '#8b949e', cursor: 'pointer', width: '28px', height: '28px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        XBtn.appendChild(Svg(I_X, '14'));
        XBtn.addEventListener('click', () => { BT_Abort = true; CancelAbort = true; Overlay.remove(); });
        Hdr.appendChild(HdrL); Hdr.appendChild(XBtn);

        // ── Tabs ──────────────────────────────────────────────────────────
        const TabBar  = El('div', { display: 'flex', borderBottom: '1px solid rgba(255,255,255,.1)', background: '#0d1117', flexShrink: '0' });
        const TabDefs = [{ label: 'Blast', icon: I_BOLT }, { label: 'Cancel Trades', icon: I_X }];
        const Pages   = [];
        const TabBtns = TabDefs.map((D, I) => {
            const B = El('button', { padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: 'none', background: 'none', display: 'flex', alignItems: 'center', gap: '7px', color: I === 0 ? '#e6edf3' : '#8b949e', borderBottom: I === 0 ? '2px solid #238636' : '2px solid transparent' });
            B.appendChild(Svg(D.icon, '13')); B.appendChild(document.createTextNode(D.label));
            TabBar.appendChild(B); return B;
        });

        const Content = El('div', { flex: '1', overflowY: 'auto', padding: '18px' });

        const SecLbl = (T, Mt) => { const D = El('div', { fontSize: '11px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: '8px', marginTop: Mt || '0' }); D.textContent = T; return D; };

        // ══════════════════════════════════════════════════════════════════
        //  PAGE 0 — BLAST
        // ══════════════════════════════════════════════════════════════════
        const BlastPage = El('div', {});
        BlastPage.appendChild(SecLbl('1. Your Offer Items'));

        const InvRow     = El('div', { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' });
        const LoadInvBtn = El('button', { padding: '6px 16px', fontSize: '12px', fontWeight: '700', color: '#fff', background: '#1f6feb', border: '1px solid #388bfd', borderRadius: '5px', cursor: 'pointer' });
        LoadInvBtn.textContent = 'Load My Inventory';
        const InvStatus = Span('', { fontSize: '12px', color: '#8b949e' });
        InvRow.appendChild(LoadInvBtn); InvRow.appendChild(InvStatus);
        BlastPage.appendChild(InvRow);

        // Inline log for inventory loading progress
        const InvLog = El('div', { background: '#0d1117', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace', color: '#555', minHeight: '18px', marginBottom: '6px', display: 'none' });
        BlastPage.appendChild(InvLog);

        const OfferGrid = El('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '48px', background: 'rgba(255,255,255,.03)', borderRadius: '5px', padding: '8px', border: '1px solid rgba(255,255,255,.07)' });
        const OfferPH   = Span('Click "Load My Inventory" then select up to 4 items to offer', { fontSize: '11px', color: '#555' });
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
                const Chip = El('div', { display: 'flex', alignItems: 'center', gap: '5px', background: '#21262d', border: '1px solid #30363d', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', color: '#e6edf3', cursor: 'pointer', userSelect: 'none' });
                Chip.title = 'Click to remove';
                const NS2 = El('span', {}); NS2.textContent = Item.name; NS2.style.cssText = 'max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                Chip.appendChild(NS2);
                Chip.appendChild(Span(' · ' + (Item.value > 0 ? Fmt(Item.value) : 'RAP ' + Fmt(Item.rap)), { color: '#4db87a', fontWeight: '700' }));
                const XI = Svg(I_X, '10'); XI.style.cssText = 'margin-left:3px;color:#8b949e;';
                Chip.appendChild(XI);
                Chip.addEventListener('click', () => { SelOffer.delete(String(UAId)); RefreshOfferGrid(); CalcRatio(); });
                OfferGrid.appendChild(Chip);
            }
        }

        // ── Inventory picker ──────────────────────────────────────────────
        function OpenPicker() {
            const Picker = El('div', { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.75)', zIndex: '1000001', display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const Box    = El('div', { background: '#161b22', border: '1px solid rgba(255,255,255,.15)', borderRadius: '8px', width: '520px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,.9)' });
            const PH2    = El('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.1)', background: '#0d1117' });
            PH2.appendChild(Span('Select Offer Items (max 4)', { fontSize: '14px', fontWeight: '700', color: '#e6edf3' }));
            const PC = El('button', { background: 'none', border: '1px solid rgba(255,255,255,.12)', borderRadius: '4px', color: '#8b949e', cursor: 'pointer', width: '26px', height: '26px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
            PC.appendChild(Svg(I_X, '13')); PC.addEventListener('click', () => Picker.remove());
            PH2.appendChild(PC); Box.appendChild(PH2);
            const PS = El('input', { padding: '8px 12px', background: '#21262d', color: '#e6edf3', border: 'none', borderBottom: '1px solid rgba(255,255,255,.1)', fontSize: '12px', outline: 'none', width: '100%', boxSizing: 'border-box' });
            PS.placeholder = 'Search items...'; Box.appendChild(PS);
            const PL = El('div', { flex: '1', overflowY: 'auto', padding: '8px' }); Box.appendChild(PL);
            const PF = El('div', { padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px' });
            const OkB = El('button', { padding: '6px 18px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#238636', border: '1px solid #2ea043', borderRadius: '5px', cursor: 'pointer' });
            OkB.textContent = 'Confirm'; OkB.addEventListener('click', () => { RefreshOfferGrid(); CalcRatio(); Picker.remove(); });
            const CaB = El('button', { padding: '6px 14px', fontSize: '13px', color: '#8b949e', background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: '5px', cursor: 'pointer' });
            CaB.textContent = 'Cancel'; CaB.addEventListener('click', () => Picker.remove());
            PF.appendChild(CaB); PF.appendChild(OkB); Box.appendChild(PF);

            function RenderPicker(F) {
                PL.innerHTML = '';
                const Fil = InvItems.filter(I => !F || I.name.toLowerCase().includes(F.toLowerCase()));
                if (!Fil.length) { PL.appendChild(Span('No items found.', { fontSize: '12px', color: '#555', padding: '12px', display: 'block' })); return; }
                Fil.forEach(I => {
                    const Sel = SelOffer.has(String(I.userAssetId));
                    const Row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '5px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(35,134,54,.2)' : 'transparent', border: '1px solid ' + (Sel ? '#238636' : 'transparent'), marginBottom: '3px' });
                    const Lft = El('div', { display: 'flex', flexDirection: 'column', gap: '1px' });
                    Lft.appendChild(Span(I.name, { fontSize: '12px', color: '#e6edf3', fontWeight: '500' }));
                    Lft.appendChild(Span(I.value > 0 ? 'Val: ' + Fmt(I.value) + '  RAP: ' + Fmt(I.rap) : 'RAP: ' + Fmt(I.rap), { fontSize: '10px', color: '#8b949e' }));
                    const CkW = El('div', { width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2ea043' });
                    if (Sel) CkW.appendChild(Svg(I_CHECK, '14'));
                    Row.appendChild(Lft); Row.appendChild(CkW);
                    Row.addEventListener('click', () => {
                        const K = String(I.userAssetId);
                        if (SelOffer.has(K)) { SelOffer.delete(K); Row.style.background = 'transparent'; Row.style.border = '1px solid transparent'; CkW.innerHTML = ''; }
                        else {
                            if (SelOffer.size >= 4) { Toast('Max 4 offer items', 'warn'); return; }
                            SelOffer.add(K); Row.style.background = 'rgba(35,134,54,.2)'; Row.style.border = '1px solid #238636';
                            CkW.innerHTML = ''; const Ck = Svg(I_CHECK, '14'); Ck.style.color = '#2ea043'; CkW.appendChild(Ck);
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
            LoadInvBtn.disabled = true; LoadInvBtn.textContent = 'Loading...';
            InvStatus.textContent = ''; InvLog.style.display = 'block'; InvLog.textContent = '';
            const TmpLog = (T, C) => {
                InvLog.textContent = T;
                InvLog.style.color = C || '#555';
            };
            InvItems = await LoadInventory(TmpLog);
            InvLog.style.display = 'none';
            InvStatus.textContent = InvItems.length + ' items loaded';
            InvStatus.style.color = InvItems.length > 0 ? '#4db87a' : '#e74c3c';
            LoadInvBtn.textContent = 'Reload Inventory'; LoadInvBtn.disabled = false;
            if (InvItems.length) OpenPicker();
        });

        // ── 2. Target item — live search with dropdown ───────────────────────
        BlastPage.appendChild(SecLbl('2. Target Item', '14px'));

        // Wrapper for input + dropdown, positioned relative so dropdown anchors to it
        const TgtWrap = El('div', { position: 'relative', marginBottom: '6px' });
        const TgtInp  = El('input', { width: '100%', boxSizing: 'border-box', padding: '6px 12px', background: '#21262d', color: '#e6edf3', border: '1px solid rgba(255,255,255,.12)', borderRadius: '5px', fontSize: '13px', outline: 'none' });
        TgtInp.placeholder = 'Type item name or paste ID...';
        TgtWrap.appendChild(TgtInp);

        // Dropdown list
        const TgtDrop = El('div', {
            position: 'absolute', top: '100%', left: '0', right: '0', zIndex: '9999',
            background: '#1c2128', border: '1px solid rgba(255,255,255,.15)', borderTop: 'none',
            borderRadius: '0 0 5px 5px', maxHeight: '200px', overflowY: 'auto', display: 'none',
        });
        TgtWrap.appendChild(TgtDrop);
        BlastPage.appendChild(TgtWrap);

        const TgtInfo = El('div', { minHeight: '36px', marginBottom: '10px' });
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
            const Row = El('div', { display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,.04)', borderRadius: '5px', padding: '8px 10px', border: '1px solid rgba(255,255,255,.08)', flexWrap: 'wrap' });
            Row.appendChild(Span(TgtName, { fontSize: '13px', fontWeight: '700', color: '#e6edf3' }));
            if (KV > 0) Row.appendChild(Span('Val: '    + Fmt(KV), { fontSize: '11px', color: '#4db87a', fontWeight: '600' }));
            if (KR > 0) Row.appendChild(Span('RAP: '    + Fmt(KR), { fontSize: '11px', color: '#4a9fd4', fontWeight: '600' }));
            if (KD && KD !== 'None') Row.appendChild(Span('Demand: ' + KD, { fontSize: '11px', color: '#c9a84c' }));
            Row.appendChild(Span('ID: ' + ItemId, { fontSize: '10px', color: '#555' }));
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
                    padding: '6px 12px', cursor: 'pointer', fontSize: '12px',
                    borderBottom: '1px solid rgba(255,255,255,.06)',
                });
                Row.style.transition = 'background .1s';
                Row.addEventListener('mouseenter', () => { Row.style.background = 'rgba(255,255,255,.07)'; });
                Row.addEventListener('mouseleave', () => { Row.style.background = ''; });

                const Left = El('div', { display: 'flex', flexDirection: 'column', gap: '1px', overflow: 'hidden' });
                const NameSpan = El('span', {}); NameSpan.style.cssText = 'color:#e6edf3;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                NameSpan.textContent = K.Name || K.name || ('Item ' + Id);
                const SubSpan = El('span', {}); SubSpan.style.cssText = 'font-size:10px;color:#555;';
                SubSpan.textContent = 'ID: ' + Id + (K.Acronym || K.acronym ? '  · ' + (K.Acronym || K.acronym) : '');
                Left.appendChild(NameSpan); Left.appendChild(SubSpan);

                const Right = El('div', { display: 'flex', gap: '8px', alignItems: 'center', flexShrink: '0', marginLeft: '8px' });
                if (KV > 0) { const V = El('span', {}); V.style.cssText = 'font-size:10px;color:#4db87a;font-weight:600;'; V.textContent = Fmt(KV); Right.appendChild(V); }
                if (KR > 0) { const R2 = El('span', {}); R2.style.cssText = 'font-size:10px;color:#4a9fd4;'; R2.textContent = 'RAP ' + Fmt(KR); Right.appendChild(R2); }

                Row.appendChild(Left); Row.appendChild(Right);
                Row.addEventListener('mousedown', (Ev) => {
                    Ev.preventDefault(); // prevent input blur before click fires
                    SelectItem(Id, Kmap);
                });
                TgtDrop.appendChild(Row);
            });
            TgtDrop.style.display = 'block';
        }

        async function UpdateDropdown(Q) {
            if (!Q || Q.length < 2) { TgtDrop.style.display = 'none'; return; }

            // Load kmap if not yet loaded
            if (!DropKmap) {
                const SearchLog = (T, C) => { console.log('[PK+ search]', T); };
                DropKmap = await EnsureKmap(SearchLog);
            }
            if (!DropKmap || !Object.keys(DropKmap).length) return;

            const QL = Q.toLowerCase();
            const Matches = [];

            // Direct ID match
            if (/^\d+$/.test(Q) && DropKmap[Q]) {
                Matches.push([Q, DropKmap[Q]]);
            } else {
                // Score and collect up to 10 matches
                for (const [Id, Item] of Object.entries(DropKmap)) {
                    const Name    = (Item.Name    || Item.name    || '').toLowerCase();
                    const Acronym = (Item.Acronym || Item.acronym || '').toLowerCase();
                    let Score = 0;
                    if (Acronym && Acronym === QL)       Score = 4;
                    else if (Name === QL)                Score = 3;
                    else if (Name.startsWith(QL))        Score = 2;
                    else if (Name.includes(QL))          Score = 1;
                    if (Score > 0) Matches.push([Id, Item, Score]);
                    if (Matches.length >= 200) break; // cap scan for perf
                }
                Matches.sort((A, B) => B[2] - A[2]);
                Matches.splice(10); // show top 10
            }

            RenderDropdown(Matches.map(M => [M[0], M[1]]), DropKmap);
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

        // Close dropdown when clicking outside
        document.addEventListener('click', (E) => {
            if (!TgtWrap.contains(E.target)) TgtDrop.style.display = 'none';
        }, { capture: false });

        TgtInp.addEventListener('focus', () => {
            if (TgtInp.value.trim().length >= 2) UpdateDropdown(TgtInp.value.trim());
        });

        // ── Ratio bar ─────────────────────────────────────────────────────
        const RBar = El('div', { display: 'flex', gap: '10px', background: 'rgba(255,255,255,.04)', borderRadius: '5px', padding: '6px 12px', marginBottom: '10px', fontSize: '12px', color: '#8b949e', flexWrap: 'wrap' });
        const RO   = Span('Offer: 0', {});
        const RR   = Span('Requesting: 0', {});
        const RV   = Span('Ratio: —', { fontWeight: '700' });
        RBar.appendChild(RO); RBar.appendChild(RR); RBar.appendChild(RV);
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
            const RC    = Ratio !== '—' ? (parseFloat(Ratio) >= 1 ? '#4db87a' : parseFloat(Ratio) >= 0.7 ? '#f59e0b' : '#e74c3c') : '#8b949e';
            RO.textContent = 'Offer: '         + Fmt(OTotal);
            RR.textContent = ' · Requesting: ' + Fmt(RVal);
            RV.textContent = ' · Ratio: '      + Ratio + 'x';
            RV.style.color = RC;
        }

        // ── 3. Options ────────────────────────────────────────────────────
        BlastPage.appendChild(SecLbl('3. Options', '2px'));
        const OG   = El('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: '12px' });
        const Opts = { delaySec: 5, maxUsers: 50, minRatio: 0, skipDupUid: true, skipPending: false, multiItems: false };

        function NumRow(Lbl, Gv, Sv, Min, Max, Step) {
            const Wr = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
            Wr.appendChild(Span(Lbl, { fontSize: '11px', color: '#8b949e' }));
            const Cr = El('div', { display: 'flex', alignItems: 'center', gap: '6px' });
            const MkB = T => { const B = El('button', { width: '24px', height: '24px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '15px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }); B.textContent = T; return B; };
            const Mn = MkB('−'), Pl = MkB('+');
            const Dp = El('span', { minWidth: '36px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#e6edf3' }); Dp.textContent = Gv();
            Mn.addEventListener('click', () => { const V = Math.max(Min, Gv() - Step); Sv(V); Dp.textContent = V; });
            Pl.addEventListener('click',  () => { const V = Math.min(Max, Gv() + Step); Sv(V); Dp.textContent = V; });
            Cr.appendChild(Mn); Cr.appendChild(Dp); Cr.appendChild(Pl); Wr.appendChild(Cr); return Wr;
        }

        function ChkRow(Lbl, Gv, Sv) {
            const Wr  = El('div', { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' });
            const Box = El('div', { width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0', background: Gv() ? '#238636' : '#21262d', border: '1px solid ' + (Gv() ? '#2ea043' : 'rgba(255,255,255,.2)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
            if (Gv()) { const C = Svg(I_CHECK, '11'); C.style.color = '#fff'; Box.appendChild(C); }
            Box.addEventListener('click', () => {
                const V = !Gv(); Sv(V);
                Box.style.background = V ? '#238636' : '#21262d';
                Box.style.border     = '1px solid ' + (V ? '#2ea043' : 'rgba(255,255,255,.2)');
                Box.innerHTML = '';
                if (V) { const C = Svg(I_CHECK, '11'); C.style.color = '#fff'; Box.appendChild(C); }
            });
            Wr.appendChild(Box); Wr.appendChild(Span(Lbl, { fontSize: '12px', color: '#ccc' })); return Wr;
        }

        const MRW = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
        MRW.appendChild(Span('Min ratio (0 = off)', { fontSize: '11px', color: '#8b949e' }));
        const MRI = El('input', { background: '#21262d', color: '#e6edf3', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', padding: '4px 8px', fontSize: '13px', width: '80px', outline: 'none', type: 'number', min: '0', step: '0.1' });
        MRI.value = '0'; MRI.addEventListener('input', () => { Opts.minRatio = parseFloat(MRI.value) || 0; }); MRW.appendChild(MRI);

        OG.appendChild(NumRow('Delay (s)',   () => Opts.delaySec, V => { Opts.delaySec = V; }, 1, 30, 1));
        OG.appendChild(NumRow('Max users',   () => Opts.maxUsers, V => { Opts.maxUsers = V; }, 1, 200, 10));
        OG.appendChild(MRW); OG.appendChild(El('div', {}));
        OG.appendChild(ChkRow('Skip duplicate UIDs',              () => Opts.skipDupUid,  V => { Opts.skipDupUid  = V; }));
        OG.appendChild(ChkRow('Skip users with pending trade',    () => Opts.skipPending, V => { Opts.skipPending = V; }));
        OG.appendChild(ChkRow('Request multiple items (up to 4)', () => Opts.multiItems,  V => { Opts.multiItems  = V; }));
        BlastPage.appendChild(OG);

        // ── Log box ───────────────────────────────────────────────────────
        const LogBox = El('div', { background: '#0d1117', borderRadius: '5px', padding: '8px 10px', height: '130px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px' });
        BlastPage.appendChild(LogBox);
        const Log = (T, C) => LogLine(LogBox, T, C);

        // ── Footer ────────────────────────────────────────────────────────
        const BF      = El('div', { display: 'flex', gap: '8px', alignItems: 'center' });
        const SendBtn = El('button', { flex: '1', padding: '9px 0', fontSize: '14px', fontWeight: '700', color: '#fff', background: '#238636', border: '1px solid #2ea043', borderRadius: '6px', cursor: 'pointer' });
        SendBtn.textContent = 'Send All Trades'; SendBtn.dataset.idleLabel = 'Send All Trades';
        const StopBtn = El('button', { padding: '9px 16px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#b91c1c', border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer' }); StopBtn.textContent = 'Stop';
        const CsvBtn  = El('button', { padding: '9px 12px', fontSize: '12px', fontWeight: '600', color: '#8b949e', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '6px', cursor: 'pointer' }); CsvBtn.textContent = 'CSV';

        let TradeLog = [];
        CsvBtn.addEventListener('click',  () => { if (!TradeLog.length) { Toast('No trades to export', 'warn'); return; } ExportCsv(TradeLog); });
        StopBtn.addEventListener('click', () => { BT_Abort = true; Log('Stopped by user.', '#e74c3c'); SetBtnState(SendBtn, 'idle'); BT_Running = false; });

        SendBtn.addEventListener('click', async () => {
            if (BT_Running) return;
            if (!SelOffer.size) { Toast('Select at least one offer item', 'warn'); return; }
            if (!TgtId)         { Toast('Set a target item first', 'warn'); return; }
            BT_Running = true; BT_Abort = false; TradeLog = [];
            SetBtnState(SendBtn, 'running'); LogBox.innerHTML = '';

            const MyUAIds  = [...SelOffer].map(Number);
            const Kmap     = NS.KCache || {};
            const OfferVal = MyUAIds.reduce((S, UAId) => { const I = InvItems.find(X => X.userAssetId === UAId); return S + (I ? (I.value > 0 ? I.value : I.rap) : 0); }, 0);

            Log('Target: ' + TgtName + ' (ID ' + TgtId + ')');
            Log('Fetching resellers...');
            const Owners = await FetchOwners(TgtId, Log);
            if (!Owners.length) { Log('No owners found.', '#e74c3c'); SetBtnState(SendBtn, 'error'); BT_Running = false; return; }

            const Capped = Owners.slice(0, Opts.maxUsers);
            Log('Sending to ' + Capped.length + ' owners, ' + Opts.delaySec + 's delay', '#4a9fd4');

            let Sent = 0, Skipped = 0, Failed = 0;
            const SeenUids = new Set();

            for (let Idx = 0; Idx < Capped.length; Idx++) {
                if (BT_Abort) break;
                const Owner = Capped[Idx];
                if (Opts.minRatio > 0) {
                    const TK = Kmap[TgtId] || {};
                    const RV2 = (TK.Value || TK.value || 0) > 0 ? (TK.Value || TK.value) : (TK.RAP || TK.rap || 0);
                    const R2  = RV2 > 0 ? OfferVal / RV2 : 0;
                    if (R2 < Opts.minRatio) { Log('Skip ' + Owner.username + ' ratio ' + R2.toFixed(2) + 'x', '#555'); Skipped++; continue; }
                }
                if (Opts.skipDupUid && SeenUids.has(Owner.userId)) { Log('Skip dup ' + Owner.username, '#555'); Skipped++; continue; }
                SeenUids.add(Owner.userId);
                const TheirUAIds = Opts.multiItems ? Owner.userAssetIds.slice(0, 4) : [Owner.userAssetIds[0]];
                try {
                    await SendTrade(MyUAIds, Owner.userId, TheirUAIds);
                    Log('Sent to ' + Owner.username + ' (' + Owner.userId + ')', '#4db87a');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Sent', detail: Owner.username });
                    Sent++;
                } catch (E) {
                    Log('Failed ' + Owner.username + ': ' + E.message, '#e74c3c');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Failed', detail: E.message });
                    Failed++;
                }
                if (!BT_Abort && Idx < Capped.length - 1) { Log('Waiting ' + Opts.delaySec + 's...', '#555'); await Sleep(Opts.delaySec * 1000); }
            }
            const Summ = 'Done — Sent: ' + Sent + '  Skipped: ' + Skipped + '  Failed: ' + Failed;
            Log(Summ, '#4db87a'); Toast(Summ, 'success');
            SetBtnState(SendBtn, 'done'); BT_Running = false;
        });

        BF.appendChild(SendBtn); BF.appendChild(StopBtn); BF.appendChild(CsvBtn);
        BlastPage.appendChild(BF);

        // ══════════════════════════════════════════════════════════════════
        //  PAGE 1 — CANCEL TRADES
        // ══════════════════════════════════════════════════════════════════
        const CancelPage = El('div', { display: 'none' });
        CancelPage.appendChild(SecLbl('Outbound Trades'));

        const CTR    = El('div', { display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' });
        const LTBtn  = El('button', { padding: '6px 16px', fontSize: '12px', fontWeight: '700', color: '#fff', background: '#1f6feb', border: '1px solid #388bfd', borderRadius: '5px', cursor: 'pointer' }); LTBtn.textContent = 'Load Trades';
        const CFInp  = El('input', { flex: '1', minWidth: '120px', padding: '5px 10px', background: '#21262d', color: '#e6edf3', border: '1px solid rgba(255,255,255,.12)', borderRadius: '5px', fontSize: '12px', outline: 'none' }); CFInp.placeholder = 'Filter by username...';
        const AR     = El('div', { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8b949e' });
        let CAgeDays = 7;
        const MkAB   = T => { const B = El('button', { width: '22px', height: '22px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px' }); B.textContent = T; return B; };
        const AMn    = MkAB('−'), APl = MkAB('+');
        const AD     = El('span', { fontSize: '13px', fontWeight: '700', color: '#e6edf3', minWidth: '28px', textAlign: 'center' }); AD.textContent = '7d';
        AMn.addEventListener('click', () => { CAgeDays = Math.max(1,  CAgeDays - 1); AD.textContent = CAgeDays + 'd'; });
        APl.addEventListener('click',  () => { CAgeDays = Math.min(60, CAgeDays + 1); AD.textContent = CAgeDays + 'd'; });
        AR.appendChild(Span('Cancel > ')); AR.appendChild(AMn); AR.appendChild(AD); AR.appendChild(APl); AR.appendChild(Span(' days'));
        CTR.appendChild(LTBtn); CTR.appendChild(CFInp); CTR.appendChild(AR);
        CancelPage.appendChild(CTR);

        const SR   = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer', userSelect: 'none' });
        const SBox = El('div', { width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0', background: '#238636', border: '1px solid #2ea043', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        const SCk  = Svg(I_CHECK, '11'); SCk.style.color = '#fff'; SBox.appendChild(SCk);
        const SCnt = Span('', { fontSize: '11px', color: '#8b949e', marginLeft: 'auto' });
        SR.appendChild(SBox); SR.appendChild(Span('Select all', { fontSize: '12px', color: '#ccc' })); SR.appendChild(SCnt);
        CancelPage.appendChild(SR);

        const TList   = El('div', { height: '160px', overflowY: 'auto', background: '#0d1117', borderRadius: '5px', padding: '4px', border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px' });
        let OBTrades  = [], SelT = new Set();
        CancelPage.appendChild(TList);

        function RenderCancelList(F) {
            TList.innerHTML = '';
            const Now = Date.now(), Cut = CAgeDays * 86400000, FL = (F || '').toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Now - new Date(T.sa).getTime() >= Cut));
            if (!Vis.length) { TList.appendChild(Span('No trades match.', { fontSize: '12px', color: '#555', padding: '10px', display: 'block' })); SCnt.textContent = SelT.size + ' selected'; return; }
            Vis.forEach(T => {
                const Sel = SelT.has(T.id);
                const Row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '4px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(220,38,38,.15)' : 'transparent', border: '1px solid ' + (Sel ? '#dc2626' : 'transparent'), marginBottom: '2px' });
                const CB  = El('div', { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0', background: Sel ? '#dc2626' : '#21262d', border: '1px solid ' + (Sel ? '#dc2626' : 'rgba(255,255,255,.2)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
                if (Sel) { const C = Svg(I_CHECK, '10'); C.style.color = '#fff'; CB.appendChild(C); }
                Row.appendChild(CB); Row.appendChild(Span(T.pn, { flex: '1', fontSize: '12px', color: '#e6edf3' })); Row.appendChild(Span('sent ' + new Date(T.sa).toLocaleDateString('en-GB'), { fontSize: '10px', color: '#555' }));
                Row.addEventListener('click', () => { if (SelT.has(T.id)) SelT.delete(T.id); else SelT.add(T.id); RenderCancelList(CFInp.value); });
                TList.appendChild(Row);
            });
            SCnt.textContent = SelT.size + ' selected';
        }

        SBox.addEventListener('click', () => {
            const Cut = CAgeDays * 86400000, FL = CFInp.value.toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Date.now() - new Date(T.sa).getTime() >= Cut));
            const All = Vis.length > 0 && Vis.every(T => SelT.has(T.id));
            if (All) { Vis.forEach(T => SelT.delete(T.id)); SBox.innerHTML = ''; SBox.style.background = '#21262d'; SBox.style.border = '1px solid rgba(255,255,255,.2)'; }
            else     { Vis.forEach(T => SelT.add(T.id));    SBox.innerHTML = ''; SBox.style.background = '#238636'; SBox.style.border = '1px solid #2ea043'; const C = Svg(I_CHECK,'11'); C.style.color='#fff'; SBox.appendChild(C); }
            RenderCancelList(CFInp.value);
        });
        CFInp.addEventListener('input', () => RenderCancelList(CFInp.value));

        LTBtn.addEventListener('click', async () => {
            LTBtn.textContent = 'Loading...'; LTBtn.disabled = true;
            OBTrades = []; SelT.clear(); TList.innerHTML = '';
            TList.appendChild(Span('Fetching outbound trades...', { fontSize: '12px', color: '#8b949e', padding: '10px', display: 'block' }));
            try {
                let Cur = null, Pg = 1, All = [];
                do {
                    const R = await fetch('/apisite/trades/v1/trades/outbound?limit=100&sortOrder=Desc' + (Cur ? '&cursor=' + Cur : ''), { credentials: 'include' }).then(R2 => R2.json());
                    All = All.concat(R.data || []);
                    const Next = R.nextPageCursor;
                    Cur = (Next != null && Next !== '') ? Next : null;
                    Pg++;
                } while (Cur && Pg <= 10);
                OBTrades = All.map(T => ({ id: T.id, pn: T.user?.name || String(T.user?.id || '?'), sa: T.created }));
                const Cut = CAgeDays * 86400000;
                OBTrades.filter(T => (Date.now() - new Date(T.sa).getTime()) >= Cut).forEach(T => SelT.add(T.id));
                RenderCancelList(''); LTBtn.textContent = 'Loaded ' + OBTrades.length;
            } catch (E) {
                TList.innerHTML = ''; TList.appendChild(Span('Failed: ' + E.message, { fontSize: '12px', color: '#e74c3c', padding: '10px', display: 'block' }));
                LTBtn.textContent = 'Load Trades';
            }
            LTBtn.disabled = false;
        });

        const CDR = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px', color: '#8b949e' });
        CDR.appendChild(Span('Delay between cancels:'));
        let CDel  = 2;
        const MkCB = T => { const B = El('button', { width: '22px', height: '22px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px' }); B.textContent = T; return B; };
        const CMn = MkCB('−'), CPl = MkCB('+');
        const CD  = El('span', { fontSize: '13px', fontWeight: '700', color: '#e6edf3', minWidth: '28px', textAlign: 'center' }); CD.textContent = '2s';
        CMn.addEventListener('click', () => { CDel = Math.max(1,  CDel - 1); CD.textContent = CDel + 's'; });
        CPl.addEventListener('click',  () => { CDel = Math.min(30, CDel + 1); CD.textContent = CDel + 's'; });
        CDR.appendChild(CMn); CDR.appendChild(CD); CDR.appendChild(CPl);
        CancelPage.appendChild(CDR);

        const CLBox = El('div', { background: '#0d1117', borderRadius: '5px', padding: '8px 10px', height: '80px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px' });
        const CLog  = (T, C) => LogLine(CLBox, T, C);
        CancelPage.appendChild(CLBox);

        const CF      = El('div', { display: 'flex', gap: '8px' });
        const DCBtn   = El('button', { flex: '1', padding: '9px 0', fontSize: '14px', fontWeight: '700', color: '#fff', background: '#b91c1c', border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer' }); DCBtn.textContent = 'Cancel Selected';
        const CSBtn   = El('button', { padding: '9px 16px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#333', border: '1px solid rgba(255,255,255,.2)', borderRadius: '6px', cursor: 'pointer' }); CSBtn.textContent = 'Stop';
        CSBtn.addEventListener('click', () => { CancelAbort = true; CLog('Stopped.', '#e74c3c'); DCBtn.disabled = false; DCBtn.textContent = 'Cancel Selected'; CancelRunning = false; });

        DCBtn.addEventListener('click', async () => {
            if (CancelRunning) return;
            if (!SelT.size) { Toast('No trades selected', 'warn'); return; }
            CancelRunning = true; CancelAbort = false;
            DCBtn.textContent = 'Running...'; DCBtn.disabled = true; CLBox.innerHTML = '';
            const Ids = [...SelT]; CLog('Cancelling ' + Ids.length + ' trades...', '#4a9fd4');
            let Done = 0, Fail = 0;
            for (let I = 0; I < Ids.length; I++) {
                if (CancelAbort) break;
                const TId = Ids[I];
                try {
                    const Csrf = await GetCsrf();
                    const R    = await fetch('/apisite/trades/v1/trades/' + TId + '/decline', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf } });
                    if (!R.ok) throw new Error('HTTP ' + R.status);
                    CLog('Cancelled ' + TId, '#4db87a'); SelT.delete(TId); Done++;
                } catch (E) { CLog(TId + ': ' + E.message, '#e74c3c'); Fail++; }
                if (!CancelAbort && I < Ids.length - 1) await Sleep(CDel * 1000);
            }
            CLog('Done — Cancelled: ' + Done + '  Failed: ' + Fail, '#4db87a');
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
                TabBtns.forEach((Btn, J) => { Btn.style.color = J===I ? '#e6edf3' : '#8b949e'; Btn.style.borderBottom = J===I ? '2px solid #238636' : '2px solid transparent'; });
                Pages.forEach((P, J) => { P.style.display = J===I ? '' : 'none'; });
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
