// ════════════════════════════════════════════════════════════════════════════
//  pk-bulktrade.js  —  Pekora+ Bulk Trade Module  (v2.0)
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

    // ── GM fetch wrapper — uses GM_xmlhttpRequest so cookies are sent properly ──
    function GmGet(Url) {
        return new Promise((Res, Rej) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: Url,
                withCredentials: true,
                headers: { 'Accept': 'application/json' },
                onload: R => {
                    console.log('[PK+ GmGet]', Url, '→', R.status);
                    if (R.status >= 200 && R.status < 300) {
                        try { Res(JSON.parse(R.responseText)); }
                        catch (E) { Rej(new Error('JSON parse error: ' + E.message)); }
                    } else {
                        Rej(new Error('HTTP ' + R.status + ' — ' + R.responseText.slice(0, 200)));
                    }
                },
                onerror: E => Rej(new Error('Network error: ' + JSON.stringify(E))),
            });
        });
    }

    function GmPost(Url, Body, ExtraHeaders) {
        return new Promise((Res, Rej) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: Url,
                withCredentials: true,
                headers: Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, ExtraHeaders || {}),
                data: JSON.stringify(Body),
                onload: R => {
                    console.log('[PK+ GmPost]', Url, '→', R.status, R.responseText.slice(0, 200));
                    Res({ status: R.status, text: R.responseText, headers: R.responseHeaders });
                },
                onerror: E => Rej(new Error('Network error: ' + JSON.stringify(E))),
            });
        });
    }

    // ── Logging ────────────────────────────────────────────────────────────
    function LogLine(Box, Text, Color) {
        const D = document.createElement('div');
        D.style.cssText = 'color:' + (Color || '#8b949e') + ';font-size:11px;line-height:1.6;font-family:monospace;';
        const N = new Date();
        const TS = String(N.getHours()).padStart(2,'0') + ':' + String(N.getMinutes()).padStart(2,'0') + ':' + String(N.getSeconds()).padStart(2,'0');
        D.textContent = '[' + TS + '] ' + Text;
        Box.appendChild(D);
        Box.scrollTop = Box.scrollHeight;
    }

    function SetBtnState(Btn, State) {
        const M = {
            idle:    { text: Btn.dataset.idleLabel || 'Send All Trades', bg: '#1a7f37' },
            running: { text: 'Running...', bg: '#333' },
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
            P.setAttribute('d', D);
            S.appendChild(P);
        });
        return S;
    }

    const I_BOLT   = 'M13 2L3 14h9l-1 8 10-12h-9l1-8z';
    const I_X      = ['M18 6L6 18', 'M6 6l12 12'];
    const I_SEARCH = ['M21 21l-4.35-4.35', 'M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'];
    const I_CHECK  = 'M20 6L9 17l-5-5';

    // ── Kmap ───────────────────────────────────────────────────────────────
    async function EnsureKmap(Log) {
        if (NS.KCache && Object.keys(NS.KCache).length > 0) {
            if (Log) Log('Using cached kmap — ' + Object.keys(NS.KCache).length + ' items', '#4db87a');
            return NS.KCache;
        }
        if (typeof NS.GetKMap === 'function') {
            if (Log) Log('Loading item map from Koromons...');
            try {
                const Map = await NS.GetKMap();
                if (Map && Object.keys(Map).length > 0) {
                    if (Log) Log('Item map loaded — ' + Object.keys(Map).length + ' items', '#4db87a');
                    return Map;
                }
            } catch (E) {
                if (Log) Log('GetKMap failed: ' + E.message, '#e74c3c');
            }
        }
        if (Log) Log('Item map unavailable — values will not show', '#f59e0b');
        return {};
    }

    // ── Inventory loader ───────────────────────────────────────────────────
    async function LoadInventory(Log) {
        Log('Getting user ID...');
        try {
            const Me = await GmGet('https://www.pekora.zip/apisite/users/v1/users/authenticated');
            if (!Me.id) throw new Error('Not logged in');
            const Uid = Me.id;
            Log('Loading inventory for UID ' + Uid + '...');

            let Cursor   = null;
            let AllItems = [];
            let Page     = 0;

            do {
                const CursorPart = (Cursor != null && Cursor !== '') ? '&cursor=' + encodeURIComponent(Cursor) : '';
                const Url = 'https://www.pekora.zip/apisite/inventory/v1/users/' + Uid + '/assets/collectibles?sortOrder=Desc&limit=100' + CursorPart;
                const Json = await GmGet(Url);

                if (!Json.data) throw new Error('No data field in response');

                AllItems = AllItems.concat(Json.data);
                Page++;
                const Next = Json.nextPageCursor;
                Cursor = (Next != null && Next !== '') ? Next : null;
                Log('Page ' + Page + ': ' + Json.data.length + ' items (total: ' + AllItems.length + ')' + (Cursor ? ' — more...' : ' — done.'));
            } while (Cursor && Page < 50);

            Log('Enriching with Koromons values...');
            const Kmap = await EnsureKmap(Log);
            const Inventory = AllItems.map(I => ({
                userAssetId: I.userAssetId,
                itemId:      String(I.assetId),
                name:        I.name,
                value:       (Kmap[String(I.assetId)] || {}).Value || 0,
                rap:         (Kmap[String(I.assetId)] || {}).RAP   || I.recentAveragePrice || 0,
            }));

            Log('Done — ' + Inventory.length + ' items loaded', '#4db87a');
            return Inventory;
        } catch (E) {
            Log('Inventory load failed: ' + E.message, '#e74c3c');
            console.error('[PK+ Inventory]', E);
            return [];
        }
    }

    // ── Owner fetcher ──────────────────────────────────────────────────────
    async function FetchOwners(ItemId, Log) {
        if (BT_OwnerCache[ItemId]) {
            Log('Using cached owners (' + BT_OwnerCache[ItemId].length + ')', '#4db87a');
            return BT_OwnerCache[ItemId];
        }
        try {
            Log('Fetching owners for item ' + ItemId + '...');
            let Cursor = null;
            let All    = [];
            let Page   = 0;

            do {
                const CursorPart = (Cursor != null && Cursor !== '') ? '&cursor=' + encodeURIComponent(Cursor) : '';
                const Url = 'https://www.pekora.zip/apisite/inventory/v2/assets/' + ItemId + '/owners?limit=100&sortOrder=Asc' + CursorPart;
                console.log('[PK+ FetchOwners] page', Page + 1, Url);
                const J = await GmGet(Url);
                console.log('[PK+ FetchOwners] page', Page + 1, '— total entries:', (J.data || []).length, 'nextCursor:', J.nextPageCursor);

                const WithOwner = (J.data || []).filter(E => E.owner != null);
                console.log('[PK+ FetchOwners] entries with owner:', WithOwner.length);
                All = All.concat(WithOwner);

                const Next = J.nextPageCursor;
                Cursor = (Next != null && Next !== '') ? Next : null;
                Page++;
                if (Cursor) Log('Page ' + Page + ': ' + All.length + ' owners so far...');
            } while (Cursor && Page < 100);

            console.log('[PK+ FetchOwners] total with owner:', All.length);

            if (!All.length) {
                Log('No owners found.', '#f59e0b');
                return [];
            }

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
            console.error('[PK+ FetchOwners]', E);
            Log('Owner fetch failed: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── CSRF ───────────────────────────────────────────────────────────────
    async function GetCsrf() {
        console.log('[PK+ CSRF] probing for token...');
        try {
            const R = await GmPost('https://www.pekora.zip/apisite/trades/v1/trades/send', {}, {});
            const Headers = R.headers || '';
            const Match = Headers.match(/x-csrf-token:\s*([^\r\n]+)/i);
            if (Match) {
                console.log('[PK+ CSRF] got token from probe response header');
                return Match[1].trim();
            }
        } catch (E) {
            console.log('[PK+ CSRF] probe threw:', E.message);
        }
        console.warn('[PK+ CSRF] could not get token');
        return '';
    }

    // ── Trade sender ───────────────────────────────────────────────────────
    async function SendTrade(MyUAIds, TheirUserId, TheirUAIds) {
        const Csrf = await GetCsrf();
        console.log('[PK+ SendTrade] csrf:', Csrf ? Csrf.slice(0, 10) + '...' : 'EMPTY');
        console.log('[PK+ SendTrade] MyUAIds:', MyUAIds, 'TheirUserId:', TheirUserId, 'TheirUAIds:', TheirUAIds);

        const Payload = {
            offers: [
                { robux: null, userAssetIds: MyUAIds,    userId: null },
                { robux: null, userAssetIds: TheirUAIds, userId: Number(TheirUserId) },
            ]
        };
        console.log('[PK+ SendTrade] payload:', JSON.stringify(Payload));

        const R = await GmPost('https://www.pekora.zip/apisite/trades/v1/trades/send', Payload, { 'x-csrf-token': Csrf });
        console.log('[PK+ SendTrade] status:', R.status, 'body:', R.text.slice(0, 300));

        if (R.status < 200 || R.status >= 300) {
            let Msg = 'HTTP ' + R.status;
            try {
                const J = JSON.parse(R.text);
                Msg = (J.errors && J.errors[0] && J.errors[0].message) || J.message || Msg;
            } catch {}
            throw new Error(Msg);
        }
    }

    // ── CSV export ─────────────────────────────────────────────────────────
    function ExportCsv(Rows) {
        const Csv = 'Timestamp,Mode,Target,UserID,Status,Detail\n'
                  + Rows.map(R => [R.ts, R.mode, '"' + R.target + '"', R.uid, R.status, '"' + R.detail + '"'].join(',')).join('\n');
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
        if (Existing) { Existing.remove(); document.getElementById('pk-bt-tgtdrop')?.remove(); return; }

        const StyleEl = document.createElement('style');
        StyleEl.id = 'pk-bt-styles';
        StyleEl.textContent = `
            #pk-bulktrade-panel * { box-sizing:border-box; font-family:'Source Sans Pro',sans-serif; }
            #pk-bulktrade-panel ::-webkit-scrollbar { width:4px; }
            #pk-bulktrade-panel ::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:4px; }
            .pk-bt-btn { transition:filter .12s; cursor:pointer; }
            .pk-bt-btn:hover:not(:disabled) { filter:brightness(1.15); }
            .pk-bt-btn:active:not(:disabled) { filter:brightness(0.9); }
            .pk-bt-input:focus { border-color:rgba(255,255,255,.3) !important; outline:none; }
            .pk-bt-row:hover { background:rgba(255,255,255,.05) !important; }
            .pk-drop-row:hover { background:rgba(255,255,255,.08) !important; }
        `;
        document.head.appendChild(StyleEl);

        // ── Portalled dropdown (must be outside overflow:auto) ────────────
        const TgtDrop = El('div', {
            position: 'fixed', zIndex: '2000000',
            background: '#161b22', border: '1px solid rgba(255,255,255,.15)',
            borderRadius: '8px', maxHeight: '260px', overflowY: 'auto', display: 'none',
            boxShadow: '0 12px 32px rgba(0,0,0,.9)',
        });
        TgtDrop.id = 'pk-bt-tgtdrop';
        document.body.appendChild(TgtDrop);

        const Overlay = El('div', {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,.7)',
            zIndex: '1000000', display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        Overlay.id = 'pk-bulktrade-panel';

        const Panel = El('div', {
            background: '#0d1117', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: '12px', width: '700px', maxWidth: '96vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.9)', overflow: 'hidden',
        });

        // ── Header ────────────────────────────────────────────────────────
        const Hdr = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: '0' });
        const HdrL = El('div', { display: 'flex', alignItems: 'center', gap: '10px' });
        const Logo = El('div', { padding: '3px 8px', background: 'rgba(138,81,73,.15)', borderRadius: '5px', border: '1px solid rgba(138,81,73,.3)' });
        Logo.appendChild(Span('Pekora+', { fontSize: '11px', fontWeight: '700', color: 'var(--primary-color,#8A5149)' }));
        HdrL.appendChild(Logo);
        HdrL.appendChild(Span('Bulk Trade', { fontSize: '16px', fontWeight: '700', color: '#e6edf3' }));
        const XBtn = El('button', { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', color: '#8b949e', width: '28px', height: '28px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        XBtn.className = 'pk-bt-btn';
        XBtn.appendChild(Svg(I_X, '13'));
        XBtn.addEventListener('click', () => { BT_Abort = true; CancelAbort = true; Overlay.remove(); TgtDrop.remove(); StyleEl.remove(); });
        Hdr.appendChild(HdrL); Hdr.appendChild(XBtn);

        // ── Tabs ──────────────────────────────────────────────────────────
        const TabBar = El('div', { display: 'flex', borderBottom: '1px solid rgba(255,255,255,.08)', padding: '0 18px', gap: '2px', flexShrink: '0' });
        const Pages  = [];
        const TabBtns = [
            { label: 'Blast Trade', icon: I_BOLT },
            { label: 'Cancel Trades', icon: I_X },
        ].map((D, I) => {
            const B = El('button', { padding: '9px 14px', fontSize: '12px', fontWeight: '600', border: 'none', borderBottom: I === 0 ? '2px solid #2ea043' : '2px solid transparent', background: 'none', display: 'flex', alignItems: 'center', gap: '6px', color: I === 0 ? '#e6edf3' : '#555', marginBottom: '-1px' });
            B.className = 'pk-bt-btn';
            B.appendChild(Svg(D.icon, '12')); B.appendChild(document.createTextNode(D.label));
            TabBar.appendChild(B); return B;
        });

        const Content = El('div', { flex: '1', overflowY: 'auto', padding: '18px' });

        function SecLbl(T, Mt) {
            const D = El('div', { fontSize: '10px', fontWeight: '700', color: '#444', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', marginTop: Mt || '0', display: 'flex', alignItems: 'center', gap: '8px' });
            D.textContent = T;
            const Line = El('div', { flex: '1', height: '1px', background: 'rgba(255,255,255,.05)' });
            D.appendChild(Line);
            return D;
        }

        // ══════════════════════════════════════════════════════════════════
        //  PAGE 0 — BLAST
        // ══════════════════════════════════════════════════════════════════
        const BlastPage = El('div', {});
        BlastPage.appendChild(SecLbl('1 · Your Offer Items'));

        const InvRow = El('div', { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' });
        const LoadInvBtn = El('button', { padding: '6px 14px', fontSize: '12px', fontWeight: '700', color: '#e6edf3', background: 'rgba(31,111,235,.2)', border: '1px solid rgba(56,139,253,.4)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' });
        LoadInvBtn.className = 'pk-bt-btn';
        LoadInvBtn.appendChild(document.createTextNode('Load Inventory'));
        const InvStatus = Span('', { fontSize: '12px', color: '#555' });
        InvRow.appendChild(LoadInvBtn); InvRow.appendChild(InvStatus);
        BlastPage.appendChild(InvRow);

        const InvLog = El('div', { background: '#060a0f', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace', color: '#555', marginBottom: '6px', display: 'none' });
        BlastPage.appendChild(InvLog);

        const OfferGrid = El('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '44px', background: 'rgba(255,255,255,.02)', borderRadius: '6px', padding: '8px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '4px' });
        const OfferPH = Span('Load inventory then select up to 4 items', { fontSize: '11px', color: '#444' });
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
                const Chip = El('div', { display: 'flex', alignItems: 'center', gap: '5px', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', color: '#e6edf3', cursor: 'pointer' });
                Chip.title = 'Click to remove';
                const NSpan = El('span', {}); NSpan.textContent = Item.name; NSpan.style.cssText = 'max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                Chip.appendChild(NSpan);
                Chip.appendChild(Span(' · ' + (Item.value > 0 ? Fmt(Item.value) : 'RAP ' + Fmt(Item.rap)), { color: '#3fb950', fontWeight: '700', fontSize: '10px' }));
                const XI = Svg(I_X, '9'); XI.style.cssText = 'margin-left:2px;color:#555;flex-shrink:0;';
                Chip.appendChild(XI);
                Chip.addEventListener('click', () => { SelOffer.delete(String(UAId)); RefreshOfferGrid(); CalcRatio(); });
                OfferGrid.appendChild(Chip);
            }
        }

        // ── Inventory picker modal ────────────────────────────────────────
        function OpenPicker() {
            const Picker = El('div', { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.8)', zIndex: '1000001', display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const Box = El('div', { background: '#0d1117', border: '1px solid rgba(255,255,255,.1)', borderRadius: '10px', width: '500px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.95)' });

            const PH = El('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.07)' });
            PH.appendChild(Span('Select Offer Items (max 4)', { fontSize: '14px', fontWeight: '700', color: '#e6edf3' }));
            const PC = El('button', { background: 'none', border: 'none', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px' });
            PC.className = 'pk-bt-btn';
            PC.appendChild(Svg(I_X, '13')); PC.addEventListener('click', () => Picker.remove());
            PH.appendChild(PC); Box.appendChild(PH);

            const SWrap = El('div', { position: 'relative', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#060a0f' });
            const SIcon = El('div', { position: 'absolute', left: '22px', top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none', display: 'flex' });
            SIcon.appendChild(Svg(I_SEARCH, '12'));
            const SI = El('input', { width: '100%', padding: '6px 8px 6px 28px', background: '#0d1117', color: '#e6edf3', border: '1px solid rgba(255,255,255,.08)', borderRadius: '5px', fontSize: '12px' });
            SI.className = 'pk-bt-input'; SI.placeholder = 'Search items...';
            SWrap.appendChild(SIcon); SWrap.appendChild(SI); Box.appendChild(SWrap);

            const PL = El('div', { flex: '1', overflowY: 'auto', padding: '6px' }); Box.appendChild(PL);

            const PF = El('div', { padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,.07)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#060a0f' });
            const OkB = El('button', { padding: '6px 16px', fontSize: '12px', fontWeight: '700', color: '#fff', background: '#1a7f37', border: '1px solid #2ea043', borderRadius: '5px' });
            OkB.className = 'pk-bt-btn'; OkB.textContent = 'Confirm';
            OkB.addEventListener('click', () => { RefreshOfferGrid(); CalcRatio(); Picker.remove(); });
            const CaB = El('button', { padding: '6px 12px', fontSize: '12px', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px' });
            CaB.className = 'pk-bt-btn'; CaB.textContent = 'Cancel';
            CaB.addEventListener('click', () => Picker.remove());
            PF.appendChild(CaB); PF.appendChild(OkB); Box.appendChild(PF);

            function RenderPicker(F) {
                PL.innerHTML = '';
                const Fil = InvItems.filter(I => !F || I.name.toLowerCase().includes(F.toLowerCase()));
                if (!Fil.length) { PL.appendChild(Span('No items.', { fontSize: '12px', color: '#555', padding: '10px', display: 'block' })); return; }
                Fil.forEach(I => {
                    const Sel = SelOffer.has(String(I.userAssetId));
                    const Row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '5px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(46,160,67,.12)' : 'transparent', border: '1px solid ' + (Sel ? 'rgba(46,160,67,.3)' : 'transparent'), marginBottom: '2px' });
                    Row.className = 'pk-bt-row';
                    const Lft = El('div', { display: 'flex', flexDirection: 'column', gap: '1px' });
                    Lft.appendChild(Span(I.name, { fontSize: '12px', color: '#e6edf3', fontWeight: '500' }));
                    Lft.appendChild(Span(I.value > 0 ? 'Val: ' + Fmt(I.value) + '  RAP: ' + Fmt(I.rap) : 'RAP: ' + Fmt(I.rap), { fontSize: '10px', color: '#555' }));
                    const Ck = El('div', { width: '16px', height: '16px', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', background: Sel ? 'rgba(46,160,67,.3)' : 'transparent', border: '1px solid ' + (Sel ? '#3fb950' : 'rgba(255,255,255,.15)') });
                    if (Sel) { const C = Svg(I_CHECK, '10'); C.style.color = '#3fb950'; Ck.appendChild(C); }
                    Row.appendChild(Lft); Row.appendChild(Ck);
                    Row.addEventListener('click', () => {
                        const K = String(I.userAssetId);
                        if (SelOffer.has(K)) {
                            SelOffer.delete(K);
                            Row.style.background = 'transparent'; Row.style.border = '1px solid transparent';
                            Ck.innerHTML = ''; Ck.style.background = 'transparent'; Ck.style.border = '1px solid rgba(255,255,255,.15)';
                        } else {
                            if (SelOffer.size >= 4) { Toast('Max 4 offer items', 'warn'); return; }
                            SelOffer.add(K);
                            Row.style.background = 'rgba(46,160,67,.12)'; Row.style.border = '1px solid rgba(46,160,67,.3)';
                            Ck.innerHTML = ''; Ck.style.background = 'rgba(46,160,67,.3)'; Ck.style.border = '1px solid #3fb950';
                            const C = Svg(I_CHECK, '10'); C.style.color = '#3fb950'; Ck.appendChild(C);
                        }
                    });
                    PL.appendChild(Row);
                });
            }
            SI.addEventListener('input', () => RenderPicker(SI.value));
            RenderPicker('');
            Picker.appendChild(Box); document.body.appendChild(Picker);
        }

        LoadInvBtn.addEventListener('click', async () => {
            LoadInvBtn.disabled = true; LoadInvBtn.textContent = 'Loading...';
            InvStatus.textContent = ''; InvLog.style.display = 'block'; InvLog.textContent = '';
            InvItems = await LoadInventory(T => { InvLog.textContent = T; });
            InvLog.style.display = 'none';
            InvStatus.textContent = InvItems.length + ' items';
            InvStatus.style.color = InvItems.length > 0 ? '#3fb950' : '#e74c3c';
            LoadInvBtn.textContent = 'Reload'; LoadInvBtn.disabled = false;
            if (InvItems.length) OpenPicker();
        });

        // ── 2. Target item ─────────────────────────────────────────────────
        BlastPage.appendChild(SecLbl('2 · Target Item', '14px'));

        const TgtWrap = El('div', { position: 'relative', marginBottom: '6px' });
        const TgtInpWrap = El('div', { position: 'relative', display: 'flex', alignItems: 'center' });
        const TgtIconEl = El('div', { position: 'absolute', left: '10px', color: '#555', display: 'flex', pointerEvents: 'none', zIndex: '1' });
        TgtIconEl.appendChild(Svg(I_SEARCH, '13'));
        const TgtInp = El('input', { width: '100%', boxSizing: 'border-box', padding: '8px 10px 8px 32px', background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', fontSize: '13px' });
        TgtInp.className = 'pk-bt-input'; TgtInp.placeholder = 'Type item name or paste ID...';
        TgtInpWrap.appendChild(TgtIconEl); TgtInpWrap.appendChild(TgtInp);
        TgtWrap.appendChild(TgtInpWrap);
        BlastPage.appendChild(TgtWrap);

        const TgtInfo = El('div', { minHeight: '36px', marginBottom: '10px' });
        BlastPage.appendChild(TgtInfo);

        let TgtId = null, TgtName = '', SearchTimer = null, DropKmap = null;

        function PositionDrop() {
            const R = TgtInp.getBoundingClientRect();
            TgtDrop.style.left  = R.left + 'px';
            TgtDrop.style.top   = (R.bottom + 4) + 'px';
            TgtDrop.style.width = R.width + 'px';
        }

        function SelectItem(ItemId, Kmap) {
            const K = Kmap[ItemId] || {};
            TgtId   = ItemId;
            TgtName = K.Name || K.name || ('Item ' + ItemId);
            TgtInp.value = TgtName;
            TgtDrop.style.display = 'none';
            TgtDrop.innerHTML = '';
            TgtInfo.innerHTML = '';

            const KV = K.Value || K.value || 0;
            const KR = K.RAP   || K.rap   || 0;
            const KD = K.Demand || K.demand || '';
            const Row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,.03)', borderRadius: '6px', padding: '8px 10px', border: '1px solid rgba(255,255,255,.07)', flexWrap: 'wrap' });
            Row.appendChild(Span(TgtName, { fontSize: '13px', fontWeight: '700', color: '#e6edf3' }));
            if (KV > 0) Row.appendChild(Span('Val: ' + Fmt(KV), { fontSize: '11px', color: '#3fb950', fontWeight: '700', padding: '2px 6px', background: 'rgba(63,185,80,.1)', borderRadius: '3px' }));
            if (KR > 0) Row.appendChild(Span('RAP: ' + Fmt(KR), { fontSize: '11px', color: '#58a6ff', fontWeight: '600', padding: '2px 6px', background: 'rgba(88,166,255,.08)', borderRadius: '3px' }));
            if (KD && KD !== 'None') Row.appendChild(Span(KD, { fontSize: '11px', color: '#e3b341', padding: '2px 6px', background: 'rgba(227,179,65,.08)', borderRadius: '3px' }));
            Row.appendChild(Span('ID: ' + ItemId, { fontSize: '10px', color: '#444' }));
            TgtInfo.appendChild(Row);
            CalcRatio();
        }

        function RenderDropdown(Matches, Kmap) {
            TgtDrop.innerHTML = '';
            if (!Matches.length) { TgtDrop.style.display = 'none'; return; }
            Matches.forEach(([Id, Item]) => {
                const KV = Item.Value || Item.value || 0;
                const KR = Item.RAP   || Item.rap   || 0;
                const Row = El('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.04)' });
                Row.className = 'pk-drop-row';
                const Left = El('div', { display: 'flex', flexDirection: 'column', gap: '1px', overflow: 'hidden', flex: '1' });
                const NSpan = El('span', {}); NSpan.style.cssText = 'color:#e6edf3;font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                NSpan.textContent = Item.Name || Item.name || ('Item ' + Id);
                const Sub = El('span', {}); Sub.style.cssText = 'font-size:10px;color:#444;';
                Sub.textContent = 'ID: ' + Id + ((Item.Acronym || Item.acronym) ? '  · ' + (Item.Acronym || Item.acronym) : '');
                Left.appendChild(NSpan); Left.appendChild(Sub);
                const Right = El('div', { display: 'flex', gap: '5px', alignItems: 'center', flexShrink: '0', marginLeft: '8px' });
                if (KV > 0) { const V = El('span', {}); V.style.cssText = 'font-size:10px;color:#3fb950;font-weight:700;padding:1px 4px;background:rgba(63,185,80,.1);border-radius:3px;'; V.textContent = Fmt(KV); Right.appendChild(V); }
                if (KR > 0) { const RR = El('span', {}); RR.style.cssText = 'font-size:10px;color:#58a6ff;padding:1px 4px;background:rgba(88,166,255,.08);border-radius:3px;'; RR.textContent = Fmt(KR); Right.appendChild(RR); }
                Row.appendChild(Left); Row.appendChild(Right);
                Row.addEventListener('mousedown', Ev => { Ev.preventDefault(); SelectItem(Id, Kmap); });
                TgtDrop.appendChild(Row);
            });
            PositionDrop();
            TgtDrop.style.display = 'block';
        }

        async function UpdateDropdown(Q) {
            console.log('[PK+ search] query:', Q);
            if (!Q || Q.length < 2) { TgtDrop.style.display = 'none'; return; }
            if (!DropKmap) {
                console.log('[PK+ search] loading kmap...');
                DropKmap = await EnsureKmap(null);
                console.log('[PK+ search] kmap keys:', DropKmap ? Object.keys(DropKmap).length : 0);
            }
            if (!DropKmap || !Object.keys(DropKmap).length) { console.warn('[PK+ search] kmap empty'); return; }

            const QL = Q.toLowerCase();
            const Matches = [];
            if (/^\d+$/.test(Q) && DropKmap[Q]) Matches.push([Q, DropKmap[Q], 99]);
            for (const [Id, Item] of Object.entries(DropKmap)) {
                if (/^\d+$/.test(Q) && Id === Q) continue;
                const Name    = (Item.Name    || Item.name    || '').toLowerCase();
                const Acronym = (Item.Acronym || Item.acronym || '').toLowerCase();
                let Score = 0;
                if (Acronym && Acronym === QL) Score = 4;
                else if (Name === QL)          Score = 3;
                else if (Name.startsWith(QL))  Score = 2;
                else if (Name.includes(QL))    Score = 1;
                if (Score > 0) Matches.push([Id, Item, Score]);
            }
            console.log('[PK+ search] matches:', Matches.length);
            Matches.sort((A, B) => B[2] - A[2]);
            RenderDropdown(Matches.slice(0, 30).map(M => [M[0], M[1]]), DropKmap);
        }

        TgtInp.addEventListener('input', () => {
            TgtId = null; TgtInfo.innerHTML = '';
            clearTimeout(SearchTimer);
            SearchTimer = setTimeout(() => UpdateDropdown(TgtInp.value.trim()), 150);
        });
        TgtInp.addEventListener('keydown', E => {
            if (E.key === 'Escape') TgtDrop.style.display = 'none';
            if (E.key === 'Enter' && TgtDrop.style.display !== 'none') {
                const First = TgtDrop.firstElementChild;
                if (First) First.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
        });
        TgtInp.addEventListener('focus', () => {
            if (TgtInp.value.trim().length >= 2 && !TgtId) UpdateDropdown(TgtInp.value.trim());
        });
        document.addEventListener('mousedown', E => {
            if (!TgtWrap.contains(E.target) && !TgtDrop.contains(E.target)) TgtDrop.style.display = 'none';
        }, { capture: true });

        // ── Ratio bar ─────────────────────────────────────────────────────
        const RBar = El('div', { display: 'flex', background: 'rgba(255,255,255,.03)', borderRadius: '6px', marginBottom: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)' });
        function RCell(Label, ValEl) {
            const D = El('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1', padding: '7px 10px', borderRight: '1px solid rgba(255,255,255,.05)' });
            D.appendChild(Span(Label, { fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '.7px', fontWeight: '700' }));
            D.appendChild(ValEl);
            return D;
        }
        const RO = Span('—', { fontSize: '13px', fontWeight: '700', color: '#e6edf3' });
        const RR = Span('—', { fontSize: '13px', fontWeight: '700', color: '#e6edf3' });
        const RV = Span('—', { fontSize: '13px', fontWeight: '700', color: '#555' });
        RBar.appendChild(RCell('Offering', RO));
        RBar.appendChild(RCell('Requesting', RR));
        const RC3 = RCell('Ratio', RV); RC3.style.borderRight = 'none';
        RBar.appendChild(RC3);
        BlastPage.appendChild(RBar);

        function CalcRatio() {
            const Kmap = NS.KCache || {};
            let OTotal = 0;
            for (const UAId of SelOffer) {
                const I = InvItems.find(X => String(X.userAssetId) === String(UAId));
                if (I) OTotal += I.value > 0 ? I.value : I.rap;
            }
            const TK   = TgtId ? (Kmap[TgtId] || {}) : {};
            const RVal = (TK.Value || TK.value || 0) > 0 ? (TK.Value || TK.value) : (TK.RAP || TK.rap || 0);
            const Ratio = (RVal > 0 && OTotal > 0) ? (OTotal / RVal).toFixed(2) : '—';
            const Col   = Ratio !== '—' ? (parseFloat(Ratio) >= 1 ? '#3fb950' : parseFloat(Ratio) >= 0.7 ? '#e3b341' : '#f85149') : '#555';
            RO.textContent = OTotal > 0 ? Fmt(OTotal) : '—';
            RR.textContent = RVal  > 0 ? Fmt(RVal)   : '—';
            RV.textContent = Ratio !== '—' ? Ratio + 'x' : '—';
            RV.style.color = Col;
        }

        // ── 3. Options ────────────────────────────────────────────────────
        BlastPage.appendChild(SecLbl('3 · Options', '2px'));
        const OG   = El('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: '12px' });
        const Opts = { delaySec: 5, maxUsers: 50, minRatio: 0, skipDupUid: true, skipPending: false, multiItems: false };

        function NumRow(Lbl, Gv, Sv, Min, Max, Step) {
            const Wr = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
            Wr.appendChild(Span(Lbl, { fontSize: '11px', color: '#555', fontWeight: '600' }));
            const Cr = El('div', { display: 'flex', alignItems: 'center', gap: '5px' });
            const MkB = T => {
                const B = El('button', { width: '24px', height: '24px', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '4px', color: '#e6edf3', fontSize: '14px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' });
                B.className = 'pk-bt-btn'; B.textContent = T; return B;
            };
            const Mn = MkB('−'), Pl = MkB('+');
            const Dp = El('span', { minWidth: '36px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#e6edf3', background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: '4px', padding: '2px 5px' });
            Dp.textContent = Gv();
            Mn.addEventListener('click', () => { const V = Math.max(Min, Gv() - Step); Sv(V); Dp.textContent = V; });
            Pl.addEventListener('click',  () => { const V = Math.min(Max, Gv() + Step); Sv(V); Dp.textContent = V; });
            Cr.appendChild(Mn); Cr.appendChild(Dp); Cr.appendChild(Pl); Wr.appendChild(Cr); return Wr;
        }

        function ChkRow(Lbl, Gv, Sv) {
            const Wr  = El('div', { display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', userSelect: 'none' });
            const Box = El('div', { width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0', background: Gv() ? 'rgba(46,160,67,.25)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (Gv() ? '#3fb950' : 'rgba(255,255,255,.15)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
            if (Gv()) { const C = Svg(I_CHECK, '10'); C.style.color = '#3fb950'; Box.appendChild(C); }
            Box.addEventListener('click', () => {
                const V = !Gv(); Sv(V);
                Box.style.background = V ? 'rgba(46,160,67,.25)' : 'rgba(255,255,255,.04)';
                Box.style.border     = '1px solid ' + (V ? '#3fb950' : 'rgba(255,255,255,.15)');
                Box.innerHTML = '';
                if (V) { const C = Svg(I_CHECK, '10'); C.style.color = '#3fb950'; Box.appendChild(C); }
            });
            Wr.appendChild(Box); Wr.appendChild(Span(Lbl, { fontSize: '12px', color: '#8b949e' })); return Wr;
        }

        const MRW = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
        MRW.appendChild(Span('Min ratio (0 = off)', { fontSize: '11px', color: '#555', fontWeight: '600' }));
        const MRI = El('input', { background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '4px', padding: '4px 7px', fontSize: '12px', fontWeight: '700', width: '70px', type: 'number', min: '0', step: '0.1' });
        MRI.className = 'pk-bt-input'; MRI.value = '0';
        MRI.addEventListener('input', () => { Opts.minRatio = parseFloat(MRI.value) || 0; }); MRW.appendChild(MRI);

        OG.appendChild(NumRow('Delay (seconds)', () => Opts.delaySec, V => { Opts.delaySec = V; }, 1, 30, 1));
        OG.appendChild(NumRow('Max users',        () => Opts.maxUsers, V => { Opts.maxUsers = V; }, 1, 200, 10));
        OG.appendChild(MRW); OG.appendChild(El('div', {}));
        OG.appendChild(ChkRow('Skip duplicate UIDs',               () => Opts.skipDupUid,  V => { Opts.skipDupUid  = V; }));
        OG.appendChild(ChkRow('Skip users with pending trade',     () => Opts.skipPending, V => { Opts.skipPending = V; }));
        OG.appendChild(ChkRow('Request multiple copies (up to 4)', () => Opts.multiItems,  V => { Opts.multiItems  = V; }));
        BlastPage.appendChild(OG);

        // ── Log box ───────────────────────────────────────────────────────
        const LogBox = El('div', { background: '#060a0f', borderRadius: '6px', padding: '8px 10px', height: '130px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '10px' });
        BlastPage.appendChild(LogBox);
        const Log = (T, C) => LogLine(LogBox, T, C);

        // ── Footer ────────────────────────────────────────────────────────
        const BF = El('div', { display: 'flex', gap: '8px', alignItems: 'center' });
        const SendBtn = El('button', { flex: '1', padding: '9px 0', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#1a7f37', border: '1px solid #2ea043', borderRadius: '6px' });
        SendBtn.className = 'pk-bt-btn'; SendBtn.textContent = 'Send All Trades'; SendBtn.dataset.idleLabel = 'Send All Trades';
        const StopBtn = El('button', { padding: '9px 16px', fontSize: '12px', fontWeight: '700', color: '#fff', background: 'rgba(248,81,73,.15)', border: '1px solid rgba(248,81,73,.4)', borderRadius: '6px' });
        StopBtn.className = 'pk-bt-btn'; StopBtn.textContent = 'Stop';
        const CsvBtn = El('button', { padding: '9px 12px', fontSize: '11px', fontWeight: '600', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px' });
        CsvBtn.className = 'pk-bt-btn'; CsvBtn.textContent = 'CSV';

        let TradeLog = [];
        CsvBtn.addEventListener('click',  () => { if (!TradeLog.length) { Toast('No trades to export', 'warn'); return; } ExportCsv(TradeLog); });
        StopBtn.addEventListener('click', () => { BT_Abort = true; Log('Stopped.', '#f85149'); SetBtnState(SendBtn, 'idle'); BT_Running = false; });

        SendBtn.addEventListener('click', async () => {
            console.log('[PK+ SendBtn] SelOffer:', [...SelOffer], 'TgtId:', TgtId);
            if (BT_Running) return;
            if (!SelOffer.size) { Toast('Select at least one offer item', 'warn'); return; }
            if (!TgtId)         { Toast('Set a target item first', 'warn'); return; }
            BT_Running = true; BT_Abort = false; TradeLog = [];
            SetBtnState(SendBtn, 'running'); LogBox.innerHTML = '';

            const MyUAIds  = [...SelOffer].map(Number);
            const Kmap     = NS.KCache || {};
            const OfferVal = MyUAIds.reduce((S, UAId) => {
                const I = InvItems.find(X => X.userAssetId === UAId);
                return S + (I ? (I.value > 0 ? I.value : I.rap) : 0);
            }, 0);

            Log('Target: ' + TgtName + ' (ID ' + TgtId + ')');
            Log('Fetching owners...');
            const Owners = await FetchOwners(TgtId, Log);
            if (!Owners.length) { Log('No owners found.', '#f85149'); SetBtnState(SendBtn, 'error'); BT_Running = false; return; }

            const Capped = Owners.slice(0, Opts.maxUsers);
            Log('Sending to ' + Capped.length + ' owners (' + Opts.delaySec + 's delay)', '#58a6ff');

            let Sent = 0, Skipped = 0, Failed = 0;
            const SeenUids = new Set();

            for (let Idx = 0; Idx < Capped.length; Idx++) {
                if (BT_Abort) break;
                const Owner = Capped[Idx];
                if (Opts.minRatio > 0) {
                    const TK  = Kmap[TgtId] || {};
                    const RV2 = (TK.Value || TK.value || 0) > 0 ? (TK.Value || TK.value) : (TK.RAP || TK.rap || 0);
                    const R2  = RV2 > 0 ? OfferVal / RV2 : 0;
                    if (R2 < Opts.minRatio) { Log('Skip ' + Owner.username + ' (ratio ' + R2.toFixed(2) + 'x)', '#444'); Skipped++; continue; }
                }
                if (Opts.skipDupUid && SeenUids.has(Owner.userId)) { Log('Skip dup ' + Owner.username, '#444'); Skipped++; continue; }
                SeenUids.add(Owner.userId);
                const TheirUAIds = Opts.multiItems ? Owner.userAssetIds.slice(0, 4) : [Owner.userAssetIds[0]];
                try {
                    await SendTrade(MyUAIds, Owner.userId, TheirUAIds);
                    Log('Sent to ' + Owner.username + ' (' + Owner.userId + ')' + (TheirUAIds.length > 1 ? ' [x' + TheirUAIds.length + ']' : ''), '#3fb950');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Sent', detail: Owner.username });
                    Sent++;
                } catch (E) {
                    Log('Failed ' + Owner.username + ': ' + E.message, '#f85149');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TgtName, uid: Owner.userId, status: 'Failed', detail: E.message });
                    Failed++;
                }
                if (!BT_Abort && Idx < Capped.length - 1) {
                    Log('Waiting ' + Opts.delaySec + 's...', '#444');
                    await Sleep(Opts.delaySec * 1000);
                }
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

        const CTR   = El('div', { display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' });
        const LTBtn = El('button', { padding: '6px 14px', fontSize: '12px', fontWeight: '700', color: '#e6edf3', background: 'rgba(31,111,235,.2)', border: '1px solid rgba(56,139,253,.4)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' });
        LTBtn.className = 'pk-bt-btn'; LTBtn.textContent = 'Load Trades';

        const CFWrap = El('div', { position: 'relative', flex: '1', minWidth: '120px', display: 'flex', alignItems: 'center' });
        const CFIcon = El('div', { position: 'absolute', left: '8px', color: '#555', display: 'flex', pointerEvents: 'none' });
        CFIcon.appendChild(Svg(I_SEARCH, '12'));
        const CFInp = El('input', { width: '100%', padding: '5px 8px 5px 26px', background: '#161b22', color: '#e6edf3', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', fontSize: '12px' });
        CFInp.className = 'pk-bt-input'; CFInp.placeholder = 'Filter by username...';
        CFWrap.appendChild(CFIcon); CFWrap.appendChild(CFInp);

        const ARWrap = El('div', { display: 'flex', alignItems: 'center', gap: '5px', background: '#161b22', border: '1px solid rgba(255,255,255,.1)', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', color: '#555' });
        let CAgeDays = 7;
        const MkAB = T => { const B = El('button', { width: '18px', height: '18px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '3px', color: '#e6edf3', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }); B.className = 'pk-bt-btn'; B.textContent = T; return B; };
        const AMn = MkAB('−'), APl = MkAB('+');
        const AD = El('span', { fontSize: '11px', fontWeight: '700', color: '#e6edf3', minWidth: '22px', textAlign: 'center' }); AD.textContent = '7d';
        AMn.addEventListener('click', () => { CAgeDays = Math.max(1,  CAgeDays - 1); AD.textContent = CAgeDays + 'd'; });
        APl.addEventListener('click',  () => { CAgeDays = Math.min(60, CAgeDays + 1); AD.textContent = CAgeDays + 'd'; });
        ARWrap.appendChild(Span('Older than')); ARWrap.appendChild(AMn); ARWrap.appendChild(AD); ARWrap.appendChild(APl);
        CTR.appendChild(LTBtn); CTR.appendChild(CFWrap); CTR.appendChild(ARWrap);
        CancelPage.appendChild(CTR);

        const SR   = El('div', { display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px', cursor: 'pointer', userSelect: 'none' });
        const SBox = El('div', { width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0', background: 'rgba(46,160,67,.25)', border: '1px solid #3fb950', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        const SCk  = Svg(I_CHECK, '10'); SCk.style.color = '#3fb950'; SBox.appendChild(SCk);
        const SCnt = Span('', { fontSize: '11px', color: '#555', marginLeft: 'auto' });
        SR.appendChild(SBox); SR.appendChild(Span('Select all', { fontSize: '12px', color: '#8b949e' })); SR.appendChild(SCnt);
        CancelPage.appendChild(SR);

        const TList  = El('div', { height: '160px', overflowY: 'auto', background: '#060a0f', borderRadius: '6px', padding: '4px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '10px' });
        let OBTrades = [], SelT = new Set();
        CancelPage.appendChild(TList);

        function RenderCancelList(F) {
            TList.innerHTML = '';
            const Now = Date.now(), Cut = CAgeDays * 86400000, FL = (F || '').toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Now - new Date(T.sa).getTime() >= Cut));
            if (!Vis.length) { TList.appendChild(Span('No trades match.', { fontSize: '12px', color: '#444', padding: '10px', display: 'block' })); SCnt.textContent = SelT.size + ' selected'; return; }
            Vis.forEach(T => {
                const Sel = SelT.has(T.id);
                const Row = El('div', { display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 8px', borderRadius: '4px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(248,81,73,.1)' : 'transparent', border: '1px solid ' + (Sel ? 'rgba(248,81,73,.3)' : 'transparent'), marginBottom: '2px' });
                Row.className = 'pk-bt-row';
                const CB = El('div', { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0', background: Sel ? 'rgba(248,81,73,.25)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (Sel ? '#f85149' : 'rgba(255,255,255,.15)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
                if (Sel) { const C = Svg(I_CHECK, '9'); C.style.color = '#f85149'; CB.appendChild(C); }
                Row.appendChild(CB);
                Row.appendChild(Span(T.pn, { flex: '1', fontSize: '12px', color: '#e6edf3' }));
                Row.appendChild(Span(new Date(T.sa).toLocaleDateString('en-GB'), { fontSize: '10px', color: '#444' }));
                Row.addEventListener('click', () => { if (SelT.has(T.id)) SelT.delete(T.id); else SelT.add(T.id); RenderCancelList(CFInp.value); });
                TList.appendChild(Row);
            });
            SCnt.textContent = SelT.size + ' selected';
        }

        SBox.addEventListener('click', () => {
            const Cut = CAgeDays * 86400000, FL = CFInp.value.toLowerCase();
            const Vis = OBTrades.filter(T => (!FL || T.pn.toLowerCase().includes(FL)) && (Date.now() - new Date(T.sa).getTime() >= Cut));
            const All = Vis.length > 0 && Vis.every(T => SelT.has(T.id));
            if (All) { Vis.forEach(T => SelT.delete(T.id)); SBox.innerHTML = ''; SBox.style.background = 'rgba(255,255,255,.04)'; SBox.style.border = '1px solid rgba(255,255,255,.15)'; }
            else     { Vis.forEach(T => SelT.add(T.id));    SBox.innerHTML = ''; SBox.style.background = 'rgba(46,160,67,.25)'; SBox.style.border = '1px solid #3fb950'; const C = Svg(I_CHECK,'10'); C.style.color='#3fb950'; SBox.appendChild(C); }
            RenderCancelList(CFInp.value);
        });
        CFInp.addEventListener('input', () => RenderCancelList(CFInp.value));

        LTBtn.addEventListener('click', async () => {
            LTBtn.textContent = 'Loading...'; LTBtn.disabled = true;
            OBTrades = []; SelT.clear(); TList.innerHTML = '';
            TList.appendChild(Span('Fetching outbound trades...', { fontSize: '12px', color: '#555', padding: '8px', display: 'block' }));
            try {
                let Cur = null, Pg = 1, All = [];
                do {
                    const CursorPart = (Cur != null && Cur !== '') ? '&cursor=' + Cur : '';
                    const J = await GmGet('https://www.pekora.zip/apisite/trades/v1/trades/outbound?limit=100&sortOrder=Desc' + CursorPart);
                    All = All.concat(J.data || []);
                    const Next = J.nextPageCursor;
                    Cur = (Next != null && Next !== '') ? Next : null;
                    Pg++;
                } while (Cur && Pg <= 10);
                OBTrades = All.map(T => ({ id: T.id, pn: (T.user && T.user.name) || String((T.user && T.user.id) || '?'), sa: T.created }));
                const Cut = CAgeDays * 86400000;
                OBTrades.filter(T => (Date.now() - new Date(T.sa).getTime()) >= Cut).forEach(T => SelT.add(T.id));
                RenderCancelList(''); LTBtn.textContent = OBTrades.length + ' loaded';
            } catch (E) {
                TList.innerHTML = ''; TList.appendChild(Span('Failed: ' + E.message, { fontSize: '12px', color: '#f85149', padding: '8px', display: 'block' }));
                LTBtn.textContent = 'Load Trades';
            }
            LTBtn.disabled = false;
        });

        const CDR = El('div', { display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', fontSize: '11px', color: '#555', background: '#161b22', border: '1px solid rgba(255,255,255,.07)', borderRadius: '5px', padding: '6px 10px' });
        CDR.appendChild(Span('Delay between cancels:'));
        let CDel = 2;
        const MkCB = T => { const B = El('button', { width: '20px', height: '20px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '3px', color: '#e6edf3', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }); B.className = 'pk-bt-btn'; B.textContent = T; return B; };
        const CMn = MkCB('−'), CPl = MkCB('+');
        const CD = El('span', { fontSize: '12px', fontWeight: '700', color: '#e6edf3', minWidth: '26px', textAlign: 'center' }); CD.textContent = '2s';
        CMn.addEventListener('click', () => { CDel = Math.max(1,  CDel - 1); CD.textContent = CDel + 's'; });
        CPl.addEventListener('click',  () => { CDel = Math.min(30, CDel + 1); CD.textContent = CDel + 's'; });
        CDR.appendChild(CMn); CDR.appendChild(CD); CDR.appendChild(CPl);
        CancelPage.appendChild(CDR);

        const CLBox = El('div', { background: '#060a0f', borderRadius: '6px', padding: '8px 10px', height: '80px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.06)', marginBottom: '10px' });
        const CLog  = (T, C) => LogLine(CLBox, T, C);
        CancelPage.appendChild(CLBox);

        const CF    = El('div', { display: 'flex', gap: '8px' });
        const DCBtn = El('button', { flex: '1', padding: '9px 0', fontSize: '13px', fontWeight: '700', color: '#fff', background: 'rgba(248,81,73,.2)', border: '1px solid rgba(248,81,73,.4)', borderRadius: '6px' });
        DCBtn.className = 'pk-bt-btn'; DCBtn.textContent = 'Cancel Selected';
        const CSBtn = El('button', { padding: '9px 14px', fontSize: '12px', fontWeight: '700', color: '#8b949e', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px' });
        CSBtn.className = 'pk-bt-btn'; CSBtn.textContent = 'Stop';
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
                    const R    = await GmPost('https://www.pekora.zip/apisite/trades/v1/trades/' + TId + '/decline', {}, { 'x-csrf-token': Csrf });
                    if (R.status < 200 || R.status >= 300) throw new Error('HTTP ' + R.status);
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
                TabBtns.forEach((Btn, J) => { Btn.style.color = J === I ? '#e6edf3' : '#555'; Btn.style.borderBottom = J === I ? '2px solid #2ea043' : '2px solid transparent'; });
                Pages.forEach((P, J) => { P.style.display = J === I ? '' : 'none'; });
            });
        });

        Panel.appendChild(Hdr); Panel.appendChild(TabBar); Panel.appendChild(Content);
        Overlay.appendChild(Panel); document.body.appendChild(Overlay);
    }

    NS.BulkTrade = { OpenPanel: BuildBulkTradePanel };

})();
