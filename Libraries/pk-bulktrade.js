// ════════════════════════════════════════════════════════════════════════════
//  pk-bulktrade.js  —  Pekora+ Bulk Trade Module  (v1.2)
//  Exposes: window.PekoraPlus.BulkTrade
//  Requires: pk-core.js, pk-toast.js already loaded
// ════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Namespace guard ────────────────────────────────────────────────────
    const NS  = (window.PekoraPlus = window.PekoraPlus || {});
    const { El, Span, Fmt, GmFetch, Toast } = NS;
    const Cfg = NS.Cfg;

    // ── Internal state ─────────────────────────────────────────────────────
    let BT_Running    = false;
    let BT_Abort      = false;
    let CancelRunning = false;
    let CancelAbort   = false;
    let BT_Inventory  = null;   // [{userAssetId, itemId, name, value, rap}]
    let BT_OwnerCache = {};     // itemId → [{userId, username, userAssetIds, bestPrice}]
    let KmapCache     = null;   // local kmap cache for this module

    // ── Helpers ────────────────────────────────────────────────────────────
    const Sleep = Ms => new Promise(R => setTimeout(R, Ms));

    function LogLine(BoxEl, Text, Color) {
        const D = document.createElement('div');
        D.style.cssText = `color:${Color || '#8b949e'};font-size:11px;line-height:1.6;`;
        const N  = new Date();
        const TS = `${String(N.getHours()).padStart(2,'0')}:${String(N.getMinutes()).padStart(2,'0')}:${String(N.getSeconds()).padStart(2,'0')}`;
        D.textContent = `[${TS}] ${Text}`;
        BoxEl.appendChild(D);
        BoxEl.scrollTop = BoxEl.scrollHeight;
    }

    function SetBtnState(Btn, State) {
        const States = {
            idle:    { text: Btn.dataset.idleLabel || 'Send All Trades', bg: '#238636' },
            running: { text: 'Running',  bg: '#444'    },
            done:    { text: 'Done',     bg: '#1a3d26' },
            error:   { text: 'Error',    bg: '#7a1a1a' },
        };
        const S = States[State] || States.idle;
        Btn.textContent = S.text;
        Btn.style.background = S.bg;
        Btn.disabled = (State === 'running');
    }

    // ── SVG icon helper ────────────────────────────────────────────────────
    function SvgIcon(Paths, Size) {
        const Svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        Svg.setAttribute('width',  Size || '14');
        Svg.setAttribute('height', Size || '14');
        Svg.setAttribute('viewBox', '0 0 24 24');
        Svg.setAttribute('fill', 'none');
        Svg.setAttribute('stroke', 'currentColor');
        Svg.setAttribute('stroke-width', '2');
        Svg.setAttribute('stroke-linecap', 'round');
        Svg.setAttribute('stroke-linejoin', 'round');
        Svg.style.cssText = 'flex-shrink:0;vertical-align:middle;';
        (Array.isArray(Paths) ? Paths : [Paths]).forEach(D => {
            const P = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            P.setAttribute('d', D);
            Svg.appendChild(P);
        });
        return Svg;
    }

    const SVG_BOLT   = 'M13 2L3 14h9l-1 8 10-12h-9l1-8z';
    const SVG_X      = ['M18 6L6 18', 'M6 6l12 12'];
    const SVG_SEARCH = ['M21 21l-4.35-4.35', 'M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z'];

    // ── Koromons items API ─────────────────────────────────────────────────
    // Always uses GmFetch to hit koromons.xyz/api/items — the authoritative source.
    async function GetKmap() {
        if (KmapCache)  return KmapCache;
        if (NS.KCache)  { KmapCache = NS.KCache; return KmapCache; }
        try {
            const Data = await GmFetch('https://www.koromons.xyz/api/items');
            KmapCache  = {};
            for (const Item of Data) KmapCache[String(Item.itemId)] = Item;
            NS.KCache  = KmapCache; // share back to main script
        } catch (E) {
            KmapCache = {};
        }
        return KmapCache;
    }

    // ── Inventory loader ───────────────────────────────────────────────────
    // Paginates through ALL pages via nextPageCursor.
    async function LoadInventory(Log) {
        Log('Fetching your inventory...');
        try {
            const Me  = await fetch('/apisite/users/v1/users/authenticated', { credentials: 'include' }).then(R => R.json());
            const Uid = Me.id;
            if (!Uid) throw new Error('Not logged in');

            let Cursor   = null;
            let AllItems = [];
            let Page     = 0;
            do {
                const Url = `/apisite/inventory/v1/users/${Uid}/assets/collectibles?sortOrder=Desc&limit=100`
                          + (Cursor ? `&cursor=${encodeURIComponent(Cursor)}` : '');
                const Raw      = await fetch(Url, { credentials: 'include' }).then(R => R.json());
                const PageData = Raw.data || [];
                AllItems       = AllItems.concat(PageData);
                Cursor         = Raw.nextPageCursor || null;
                Page++;
                if (Cursor) Log(`Page ${Page}: ${AllItems.length} items so far...`);
            } while (Cursor && Page < 20); // safety cap: 20 pages = up to 2000 items

            Log('Fetching values from Koromons...');
            const Kmap = await GetKmap();
            BT_Inventory = AllItems.map(I => ({
                userAssetId: I.userAssetId,
                itemId:      String(I.assetId),
                name:        I.name,
                value:       Kmap[String(I.assetId)]?.Value || 0,
                rap:         Kmap[String(I.assetId)]?.RAP   || I.recentAveragePrice || 0,
            }));
            Log('Loaded ' + BT_Inventory.length + ' tradable items', '#4db87a');
            return BT_Inventory;
        } catch (E) {
            Log('Failed to load inventory: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── Owner fetcher ──────────────────────────────────────────────────────
    // Collects ALL userAssetIds per seller for multiItems mode.
    async function FetchOwners(ItemId, Log) {
        if (BT_OwnerCache[ItemId]) {
            Log('Using cached resellers (' + BT_OwnerCache[ItemId].length + ')', '#4db87a');
            return BT_OwnerCache[ItemId];
        }
        try {
            Log('Fetching resellers for item ' + ItemId + '...');
            let Cursor = null, All = [];
            do {
                const Url = '/apisite/economy/v1/assets/' + ItemId + '/resellers?limit=100'
                          + (Cursor ? '&cursor=' + encodeURIComponent(Cursor) : '&cursor=');
                const R = await fetch(Url, { credentials: 'include' });
                if (!R.ok) throw new Error('HTTP ' + R.status);
                const J = await R.json();
                All    = All.concat(J.data || []);
                Cursor = J.nextPageCursor || null;
            } while (Cursor);

            if (!All.length) {
                Log('No resellers found — item may not be on sale.', '#f59e0b');
                return [];
            }

            // Collect all userAssetIds per seller, track cheapest price
            const ByUser = new Map();
            for (const Entry of All) {
                const Uid = String(Entry.seller?.id);
                if (!ByUser.has(Uid)) {
                    ByUser.set(Uid, {
                        userId:       Uid,
                        username:     Entry.seller?.name || Uid,
                        userAssetIds: [Entry.userAssetId],
                        bestPrice:    Entry.price,
                    });
                } else {
                    const Ex = ByUser.get(Uid);
                    Ex.userAssetIds.push(Entry.userAssetId);
                    if (Entry.price < Ex.bestPrice) Ex.bestPrice = Entry.price;
                }
            }

            // Sort cheapest first
            const Owners = [...ByUser.values()].sort((A, B) => A.bestPrice - B.bestPrice);
            BT_OwnerCache[ItemId] = Owners;
            Log('Found ' + Owners.length + ' resellers to trade with', '#4db87a');
            return Owners;
        } catch (E) {
            Log('Resellers fetch failed: ' + E.message, '#e74c3c');
            return [];
        }
    }

    // ── CSRF helper ────────────────────────────────────────────────────────
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
        const Body = { offers: [
            { robux: null, userAssetIds: MyUAIds,    userId: null },
            { robux: null, userAssetIds: TheirUAIds, userId: TheirUserId },
        ]};
        const Resp = await fetch('/apisite/trades/v1/trades/send', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf },
            body: JSON.stringify(Body),
        });
        if (!Resp.ok) {
            let Msg = 'HTTP ' + Resp.status;
            try { const J = await Resp.json(); Msg = J.errors?.[0]?.message || J.message || Msg; } catch {}
            throw new Error(Msg);
        }
        return true;
    }

    // ── CSV export ─────────────────────────────────────────────────────────
    function ExportCsv(Rows) {
        const Head = 'Timestamp,Mode,Target,UserID,Status,Detail\n';
        const Body = Rows.map(R => [R.ts, R.mode, `"${R.target}"`, R.uid, R.status, `"${R.detail}"`].join(',')).join('\n');
        const Blob = new Blob([Head + Body], { type: 'text/csv' });
        const Url  = URL.createObjectURL(Blob);
        const A    = document.createElement('a');
        A.href = Url; A.download = 'pekora-bulk-trades.csv'; A.click();
        setTimeout(() => URL.revokeObjectURL(Url), 2000);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PANEL BUILDER
    // ══════════════════════════════════════════════════════════════════════════
    function BuildBulkTradePanel() {
        const Existing = document.getElementById('pk-bulktrade-panel');
        if (Existing) { Existing.remove(); return; }

        // ── Overlay ──────────────────────────────────────────────────────────
        const Overlay = El('div', {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,.65)',
            zIndex: '1000000', display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        Overlay.id = 'pk-bulktrade-panel';
        // NO click-outside-to-close — must use X button

        const Panel = El('div', {
            background: '#161b22', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '10px', width: '700px', maxWidth: '96vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,.8)',
            overflow: 'hidden',
        });

        // ── Header ───────────────────────────────────────────────────────────
        const Header = El('div', {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.1)',
            background: '#0d1117', flexShrink: '0',
        });
        const HTW = El('div', { display: 'flex', alignItems: 'center', gap: '10px' });
        HTW.appendChild(Span('Pekora+',    { fontSize: '13px', fontWeight: '700', color: 'var(--primary-color,#8A5149)' }));
        HTW.appendChild(Span('Bulk Trade', { fontSize: '16px', fontWeight: '700', color: '#e6edf3' }));

        const CloseBtn = El('button', {
            background: 'none', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: '5px', color: '#8b949e', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', padding: '0',
        });
        CloseBtn.title = 'Close';
        CloseBtn.appendChild(SvgIcon(SVG_X, '14'));
        CloseBtn.addEventListener('click', () => { BT_Abort = true; CancelAbort = true; Overlay.remove(); });
        Header.appendChild(HTW); Header.appendChild(CloseBtn);

        // ── Tab bar ──────────────────────────────────────────────────────────
        const TabBar  = El('div', { display: 'flex', borderBottom: '1px solid rgba(255,255,255,.1)', background: '#0d1117', flexShrink: '0' });
        const TabDefs = [
            { label: 'Blast',         icon: SVG_BOLT },
            { label: 'Cancel Trades', icon: SVG_X    },
        ];
        const Pages   = [];

        const TabBtns = TabDefs.map((Def, I) => {
            const B = El('button', {
                padding: '10px 20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                border: 'none', background: 'none',
                display: 'flex', alignItems: 'center', gap: '7px',
                color:        I === 0 ? '#e6edf3' : '#8b949e',
                borderBottom: I === 0 ? '2px solid #238636' : '2px solid transparent',
                transition: 'color .15s',
            });
            B.appendChild(SvgIcon(Def.icon, '13'));
            B.appendChild(document.createTextNode(Def.label));
            TabBar.appendChild(B);
            return B;
        });

        // ── Scrollable content area ───────────────────────────────────────────
        const Content = El('div', { flex: '1', overflowY: 'auto', padding: '18px' });

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        //  PAGE 0 — BLAST
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const BlastPage = El('div', {});

        const SecLabel = (Text, MTop) => {
            const D = El('div', {
                fontSize: '11px', fontWeight: '700', color: '#555',
                textTransform: 'uppercase', letterSpacing: '.8px',
                marginBottom: '8px', marginTop: MTop || '0',
            });
            D.textContent = Text; return D;
        };

        // ── 1. Offer items ───────────────────────────────────────────────────
        BlastPage.appendChild(SecLabel('1. Your Offer Items'));

        const InvRow     = El('div', { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' });
        const LoadInvBtn = El('button', {
            padding: '6px 16px', fontSize: '12px', fontWeight: '700', color: '#fff',
            background: '#1f6feb', border: '1px solid #388bfd', borderRadius: '5px', cursor: 'pointer',
        });
        LoadInvBtn.textContent = 'Load My Inventory';
        const InvCountSpan = Span('', { fontSize: '12px', color: '#8b949e' });
        InvRow.appendChild(LoadInvBtn); InvRow.appendChild(InvCountSpan);
        BlastPage.appendChild(InvRow);

        const OfferGrid = El('div', {
            display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '48px',
            background: 'rgba(255,255,255,.03)', borderRadius: '5px', padding: '8px',
            border: '1px solid rgba(255,255,255,.07)',
        });
        const OfferPlaceholder = Span('Click "Load My Inventory" then select up to 4 items to offer', { fontSize: '11px', color: '#555' });
        OfferGrid.appendChild(OfferPlaceholder);
        BlastPage.appendChild(OfferGrid);

        let InventoryItems   = [];
        let SelectedOfferIds = new Set();

        function RefreshOfferGrid() {
            OfferGrid.innerHTML = '';
            if (!SelectedOfferIds.size) { OfferGrid.appendChild(OfferPlaceholder); return; }
            for (const UAId of SelectedOfferIds) {
                const Item = InventoryItems.find(I => String(I.userAssetId) === String(UAId));
                if (!Item) continue;
                const Chip = El('div', {
                    display: 'flex', alignItems: 'center', gap: '5px',
                    background: '#21262d', border: '1px solid #30363d',
                    borderRadius: '4px', padding: '3px 8px', fontSize: '11px',
                    color: '#e6edf3', cursor: 'pointer', userSelect: 'none',
                });
                Chip.title = 'Click to remove';
                const NSpan = El('span', {});
                NSpan.textContent = Item.name;
                NSpan.style.cssText = 'max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                const VSpan = Span(' · ' + (Item.value > 0 ? Fmt(Item.value) : 'RAP ' + Fmt(Item.rap)), { color: '#4db87a', fontWeight: '700' });
                const XSpan = SvgIcon(SVG_X, '10');
                XSpan.style.marginLeft = '2px';
                XSpan.style.color = '#8b949e';
                Chip.appendChild(NSpan); Chip.appendChild(VSpan); Chip.appendChild(XSpan);
                Chip.addEventListener('click', () => { SelectedOfferIds.delete(String(UAId)); RefreshOfferGrid(); UpdateRatioBar(); });
                OfferGrid.appendChild(Chip);
            }
        }

        // ── Inventory picker sub-modal ────────────────────────────────────────
        function OpenInventoryPicker() {
            const Picker = El('div', {
                position: 'fixed', inset: '0', background: 'rgba(0,0,0,.75)',
                zIndex: '1000001', display: 'flex', alignItems: 'center', justifyContent: 'center',
            });
            const Box = El('div', {
                background: '#161b22', border: '1px solid rgba(255,255,255,.15)',
                borderRadius: '8px', width: '520px', maxWidth: '95vw', maxHeight: '80vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 8px 40px rgba(0,0,0,.9)',
            });

            const PH = El('div', {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.1)', background: '#0d1117',
            });
            PH.appendChild(Span('Select Offer Items (max 4)', { fontSize: '14px', fontWeight: '700', color: '#e6edf3' }));
            const PC = El('button', {
                background: 'none', border: '1px solid rgba(255,255,255,.12)', borderRadius: '4px',
                color: '#8b949e', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '26px', height: '26px', padding: '0',
            });
            PC.appendChild(SvgIcon(SVG_X, '13'));
            PC.addEventListener('click', () => Picker.remove());
            PH.appendChild(PC); Box.appendChild(PH);

            const PSearch = El('input', {
                padding: '8px 12px', background: '#21262d', color: '#e6edf3',
                border: 'none', borderBottom: '1px solid rgba(255,255,255,.1)',
                fontSize: '12px', outline: 'none', width: '100%', boxSizing: 'border-box',
            });
            PSearch.placeholder = 'Search items...'; Box.appendChild(PSearch);

            const PList = El('div', { flex: '1', overflowY: 'auto', padding: '8px' }); Box.appendChild(PList);

            const PFoot   = El('div', { padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', justifyContent: 'flex-end', gap: '8px' });
            const ConfBtn = El('button', { padding: '6px 18px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#238636', border: '1px solid #2ea043', borderRadius: '5px', cursor: 'pointer' });
            ConfBtn.textContent = 'Confirm';
            ConfBtn.addEventListener('click', () => { RefreshOfferGrid(); UpdateRatioBar(); Picker.remove(); });
            const CanBtn = El('button', { padding: '6px 14px', fontSize: '13px', color: '#8b949e', background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: '5px', cursor: 'pointer' });
            CanBtn.textContent = 'Cancel'; CanBtn.addEventListener('click', () => Picker.remove());
            PFoot.appendChild(CanBtn); PFoot.appendChild(ConfBtn); Box.appendChild(PFoot);

            function RenderPicker(Filter) {
                PList.innerHTML = '';
                const Filtered = InventoryItems.filter(I => !Filter || I.name.toLowerCase().includes(Filter.toLowerCase()));
                if (!Filtered.length) { PList.appendChild(Span('No items found.', { fontSize: '12px', color: '#555', padding: '12px', display: 'block' })); return; }
                Filtered.forEach(I => {
                    const Sel = SelectedOfferIds.has(String(I.userAssetId));
                    const Row = El('div', {
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
                        background: Sel ? 'rgba(35,134,54,.2)' : 'transparent',
                        border: '1px solid ' + (Sel ? '#238636' : 'transparent'),
                        marginBottom: '3px', transition: 'background .1s',
                    });
                    const Left = El('div', { display: 'flex', flexDirection: 'column', gap: '1px' });
                    Left.appendChild(Span(I.name, { fontSize: '12px', color: '#e6edf3', fontWeight: '500' }));
                    Left.appendChild(Span(I.value > 0 ? 'Val: ' + Fmt(I.value) + '  RAP: ' + Fmt(I.rap) : 'RAP: ' + Fmt(I.rap), { fontSize: '10px', color: '#8b949e' }));
                    const ChkWrap = El('div', { width: '16px', height: '16px', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
                    if (Sel) ChkWrap.appendChild(SvgIcon('M20 6L9 17l-5-5', '14'));
                    ChkWrap.style.color = '#2ea043';
                    Row.appendChild(Left); Row.appendChild(ChkWrap);
                    Row.addEventListener('click', () => {
                        const Key = String(I.userAssetId);
                        if (SelectedOfferIds.has(Key)) {
                            SelectedOfferIds.delete(Key);
                            Row.style.background = 'transparent'; Row.style.border = '1px solid transparent';
                            ChkWrap.innerHTML = '';
                        } else {
                            if (SelectedOfferIds.size >= 4) { Toast('Max 4 offer items', 'warn'); return; }
                            SelectedOfferIds.add(Key);
                            Row.style.background = 'rgba(35,134,54,.2)'; Row.style.border = '1px solid #238636';
                            ChkWrap.innerHTML = '';
                            const Ck = SvgIcon('M20 6L9 17l-5-5', '14');
                            Ck.style.color = '#2ea043';
                            ChkWrap.appendChild(Ck);
                        }
                    });
                    PList.appendChild(Row);
                });
            }
            PSearch.addEventListener('input', () => RenderPicker(PSearch.value));
            RenderPicker('');
            Picker.appendChild(Box);
            document.body.appendChild(Picker);
        }

        LoadInvBtn.addEventListener('click', async () => {
            LoadInvBtn.textContent = 'Loading...'; LoadInvBtn.disabled = true;
            BT_Inventory = null; // force fresh paginated load every time
            const TmpLog = (T, C) => { InvCountSpan.textContent = T; InvCountSpan.style.color = C || '#8b949e'; };
            InventoryItems = await LoadInventory(TmpLog);
            BT_Inventory   = InventoryItems;
            InvCountSpan.textContent = InventoryItems.length + ' items';
            InvCountSpan.style.color = '#8b949e';
            LoadInvBtn.textContent   = 'Load My Inventory';
            LoadInvBtn.disabled      = false;
            if (InventoryItems.length) OpenInventoryPicker();
        });

        // ── 2. Target item ────────────────────────────────────────────────────
        BlastPage.appendChild(SecLabel('2. Target Item', '14px'));

        const TgtRow   = El('div', { display: 'flex', gap: '8px', marginBottom: '6px' });
        const TgtInput = El('input', {
            flex: '1', padding: '6px 12px', background: '#21262d', color: '#e6edf3',
            border: '1px solid rgba(255,255,255,.12)', borderRadius: '5px', fontSize: '13px', outline: 'none',
        });
        TgtInput.placeholder = 'Item name or ID...';

        const FindBtn = El('button', {
            padding: '6px 14px', fontSize: '12px', fontWeight: '700', color: '#fff',
            background: '#21262d', border: '1px solid rgba(255,255,255,.15)',
            borderRadius: '5px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
        });
        FindBtn.appendChild(SvgIcon(SVG_SEARCH, '13'));
        FindBtn.appendChild(document.createTextNode('Find'));
        TgtRow.appendChild(TgtInput); TgtRow.appendChild(FindBtn);
        BlastPage.appendChild(TgtRow);

        const TgtInfo = El('div', { minHeight: '36px', marginBottom: '10px' });
        BlastPage.appendChild(TgtInfo);

        let TargetItemId   = null;
        let TargetItemName = '';

        // Search uses GetKmap() which calls koromons.xyz/api/items directly
        async function SearchTarget() {
            const Q = TgtInput.value.trim();
            if (!Q) return;
            TgtInfo.innerHTML = '';
            TgtInfo.appendChild(Span('Searching...', { fontSize: '12px', color: '#8b949e' }));
            try {
                const Kmap = await GetKmap();

                let ItemId = null;

                if (/^\d+$/.test(Q)) {
                    // Numeric ID — look up directly
                    ItemId = Q;
                    if (!Kmap[ItemId]) throw new Error('Item ID ' + ItemId + ' not found in Koromons database');
                    TargetItemName = Kmap[ItemId]?.Name || Kmap[ItemId]?.name || 'Item ' + ItemId;
                } else {
                    // Name search — scan all entries with priority scoring
                    const QL = Q.toLowerCase();
                    let BestMatch = null, BestScore = -1;
                    for (const [Id, Item] of Object.entries(Kmap)) {
                        const Name    = (Item.Name    || Item.name    || '').toLowerCase();
                        const Acronym = (Item.Acronym || Item.acronym || '').toLowerCase();
                        if (Acronym === QL)              { BestMatch = [Id, Item]; break; }      // exact acronym = top priority
                        if (Name === QL && BestScore < 2) { BestMatch = [Id, Item]; BestScore = 2; } // exact name
                        else if (Name.startsWith(QL) && BestScore < 1) { BestMatch = [Id, Item]; BestScore = 1; } // starts-with
                        else if (Name.includes(QL)   && BestScore < 0) { BestMatch = [Id, Item]; BestScore = 0; } // contains
                    }
                    if (!BestMatch) throw new Error('No item found for "' + Q + '" — try the item ID');
                    ItemId         = BestMatch[0];
                    TargetItemName = BestMatch[1].Name || BestMatch[1].name || Q;
                }

                TargetItemId = ItemId;
                const KItem   = Kmap[ItemId] || {};
                const KVal    = KItem.Value  || KItem.value  || 0;
                const KRAP    = KItem.RAP    || KItem.rap    || 0;
                const KDemand = KItem.Demand || KItem.demand || '';

                TgtInfo.innerHTML = '';
                const IR = El('div', {
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: 'rgba(255,255,255,.04)', borderRadius: '5px',
                    padding: '8px 10px', border: '1px solid rgba(255,255,255,.08)', flexWrap: 'wrap',
                });
                IR.appendChild(Span(TargetItemName, { fontSize: '13px', fontWeight: '700', color: '#e6edf3' }));
                if (KVal  > 0)                              IR.appendChild(Span('Val: '     + Fmt(KVal),    { fontSize: '11px', color: '#4db87a', fontWeight: '600' }));
                if (KRAP  > 0)                              IR.appendChild(Span('RAP: '     + Fmt(KRAP),    { fontSize: '11px', color: '#4a9fd4', fontWeight: '600' }));
                if (KDemand && KDemand !== 'None')          IR.appendChild(Span('Demand: '  + KDemand,      { fontSize: '11px', color: '#c9a84c' }));
                IR.appendChild(Span('ID: ' + ItemId, { fontSize: '10px', color: '#555' }));
                TgtInfo.appendChild(IR);
                UpdateRatioBar();
            } catch (E) {
                TgtInfo.innerHTML = '';
                TgtInfo.appendChild(Span('Not found: ' + E.message, { fontSize: '12px', color: '#e74c3c' }));
            }
        }

        FindBtn.addEventListener('click', SearchTarget);
        TgtInput.addEventListener('keydown', E => { if (E.key === 'Enter') SearchTarget(); });

        // ── Live ratio bar ────────────────────────────────────────────────────
        const RatioBar   = El('div', { display: 'flex', gap: '10px', background: 'rgba(255,255,255,.04)', borderRadius: '5px', padding: '6px 12px', marginBottom: '10px', fontSize: '12px', color: '#8b949e', flexWrap: 'wrap' });
        const RatioOffer = Span('Offer: 0', {});
        const RatioReq   = Span('Requesting: 0', {});
        const RatioVal   = Span('Ratio: —', { fontWeight: '700' });
        RatioBar.appendChild(RatioOffer); RatioBar.appendChild(RatioReq); RatioBar.appendChild(RatioVal);
        BlastPage.appendChild(RatioBar);

        function UpdateRatioBar() {
            const Kmap  = KmapCache || NS.KCache || {};
            let OTotal  = 0;
            for (const UAId of SelectedOfferIds) {
                const I = InventoryItems.find(X => String(X.userAssetId) === String(UAId));
                if (I) OTotal += I.value > 0 ? I.value : I.rap;
            }
            const TItem = TargetItemId ? (Kmap[TargetItemId] || {}) : {};
            const RVal  = (TItem.Value || TItem.value || 0) > 0 ? (TItem.Value || TItem.value) : (TItem.RAP || TItem.rap || 0);
            const Ratio = RVal > 0 && OTotal > 0 ? (OTotal / RVal).toFixed(2) : '—';
            const RC    = Ratio !== '—' ? (parseFloat(Ratio) >= 1 ? '#4db87a' : parseFloat(Ratio) >= 0.7 ? '#f59e0b' : '#e74c3c') : '#8b949e';
            RatioOffer.textContent = 'Offer: '       + Fmt(OTotal);
            RatioReq.textContent   = ' · Requesting: ' + Fmt(RVal);
            RatioVal.textContent   = ' · Ratio: '    + Ratio + 'x';
            RatioVal.style.color   = RC;
        }

        // ── 3. Options ────────────────────────────────────────────────────────
        BlastPage.appendChild(SecLabel('3. Options', '2px'));

        const OptsGrid = El('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: '12px' });
        const Opts     = { delaySec: 5, maxUsers: 50, minRatio: 0, skipDupUid: true, skipPending: false, multiItems: false };

        function NumRow(Label, GetV, SetV, Min, Max, Step) {
            const Wr   = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
            Wr.appendChild(Span(Label, { fontSize: '11px', color: '#8b949e' }));
            const Ctrl = El('div', { display: 'flex', alignItems: 'center', gap: '6px' });
            const Mk   = Txt => {
                const B = El('button', { width: '24px', height: '24px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '15px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' });
                B.textContent = Txt; return B;
            };
            const Mn   = Mk('−'), Pl = Mk('+');
            const Disp = El('span', { minWidth: '36px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#e6edf3' });
            Disp.textContent = GetV();
            Mn.addEventListener('click', () => { const V = Math.max(Min, GetV() - Step); SetV(V); Disp.textContent = V; });
            Pl.addEventListener('click',  () => { const V = Math.min(Max, GetV() + Step); SetV(V); Disp.textContent = V; });
            Ctrl.appendChild(Mn); Ctrl.appendChild(Disp); Ctrl.appendChild(Pl); Wr.appendChild(Ctrl);
            return Wr;
        }

        function ChkRow(Label, GetV, SetV) {
            const Wr  = El('div', { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' });
            const Box = El('div', {
                width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0',
                background: GetV() ? '#238636' : '#21262d',
                border: '1px solid ' + (GetV() ? '#2ea043' : 'rgba(255,255,255,.2)'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            });
            if (GetV()) { const Ck = SvgIcon('M20 6L9 17l-5-5', '11'); Ck.style.color = '#fff'; Box.appendChild(Ck); }
            Box.addEventListener('click', () => {
                const V = !GetV(); SetV(V);
                Box.style.background = V ? '#238636' : '#21262d';
                Box.style.border     = '1px solid ' + (V ? '#2ea043' : 'rgba(255,255,255,.2)');
                Box.innerHTML        = '';
                if (V) { const Ck = SvgIcon('M20 6L9 17l-5-5', '11'); Ck.style.color = '#fff'; Box.appendChild(Ck); }
            });
            Wr.appendChild(Box); Wr.appendChild(Span(Label, { fontSize: '12px', color: '#ccc' }));
            return Wr;
        }

        const MinRatioWr = El('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
        MinRatioWr.appendChild(Span('Min ratio (0 = off)', { fontSize: '11px', color: '#8b949e' }));
        const RatioInp = El('input', { background: '#21262d', color: '#e6edf3', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', padding: '4px 8px', fontSize: '13px', width: '80px', outline: 'none', type: 'number', min: '0', step: '0.1' });
        RatioInp.value = '0';
        RatioInp.addEventListener('input', () => { Opts.minRatio = parseFloat(RatioInp.value) || 0; });
        MinRatioWr.appendChild(RatioInp);

        OptsGrid.appendChild(NumRow('Delay (s)',   () => Opts.delaySec, V => { Opts.delaySec = V; }, 1, 30, 1));
        OptsGrid.appendChild(NumRow('Max users',   () => Opts.maxUsers, V => { Opts.maxUsers = V; }, 1, 200, 10));
        OptsGrid.appendChild(MinRatioWr);
        OptsGrid.appendChild(El('div', {}));
        OptsGrid.appendChild(ChkRow('Skip duplicate UIDs',              () => Opts.skipDupUid,  V => { Opts.skipDupUid  = V; }));
        OptsGrid.appendChild(ChkRow('Skip users with pending trade',    () => Opts.skipPending, V => { Opts.skipPending = V; }));
        OptsGrid.appendChild(ChkRow('Request multiple items (up to 4)', () => Opts.multiItems,  V => { Opts.multiItems  = V; }));
        BlastPage.appendChild(OptsGrid);

        // ── Log box ───────────────────────────────────────────────────────────
        const LogBox = El('div', {
            background: '#0d1117', borderRadius: '5px', padding: '8px 10px',
            height: '130px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px',
            border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px',
        });
        BlastPage.appendChild(LogBox);
        const Log = (T, C) => LogLine(LogBox, T, C);

        // ── Footer ────────────────────────────────────────────────────────────
        const BlaFoot = El('div', { display: 'flex', gap: '8px', alignItems: 'center' });
        const SendBtn = El('button', {
            flex: '1', padding: '9px 0', fontSize: '14px', fontWeight: '700', color: '#fff',
            background: '#238636', border: '1px solid #2ea043', borderRadius: '6px',
            cursor: 'pointer', transition: 'background .15s',
        });
        SendBtn.textContent = 'Send All Trades'; SendBtn.dataset.idleLabel = 'Send All Trades';

        const StopBtn = El('button', {
            padding: '9px 16px', fontSize: '13px', fontWeight: '700', color: '#fff',
            background: '#b91c1c', border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer',
        });
        StopBtn.textContent = 'Stop';

        const CsvBtn = El('button', {
            padding: '9px 12px', fontSize: '12px', fontWeight: '600', color: '#8b949e',
            background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '6px', cursor: 'pointer',
        });
        CsvBtn.textContent = 'CSV';

        let TradeLog = [];

        CsvBtn.addEventListener('click',  () => { if (!TradeLog.length) { Toast('No trades to export yet', 'warn'); return; } ExportCsv(TradeLog); });
        StopBtn.addEventListener('click', () => { BT_Abort = true; Log('Stopped by user.', '#e74c3c'); SetBtnState(SendBtn, 'idle'); BT_Running = false; });

        SendBtn.addEventListener('click', async () => {
            if (BT_Running) return;
            if (!SelectedOfferIds.size) { Toast('Select at least one offer item', 'warn'); return; }
            if (!TargetItemId)          { Toast('Set a target item first', 'warn'); return; }

            BT_Running = true; BT_Abort = false; TradeLog = [];
            SetBtnState(SendBtn, 'running'); LogBox.innerHTML = '';

            const MyUAIds  = [...SelectedOfferIds].map(Number);
            const Kmap     = KmapCache || NS.KCache || {};
            const OfferVal = MyUAIds.reduce((S, UAId) => {
                const I = InventoryItems.find(X => X.userAssetId === UAId);
                return S + (I ? (I.value > 0 ? I.value : I.rap) : 0);
            }, 0);

            Log('Target: ' + TargetItemName + ' (ID ' + TargetItemId + ')');
            Log('Fetching owners...');
            const Owners = await FetchOwners(TargetItemId, Log);
            if (!Owners.length) { Log('No owners found.', '#e74c3c'); SetBtnState(SendBtn, 'error'); BT_Running = false; return; }

            const Capped = Owners.slice(0, Opts.maxUsers);
            Log('Sending to up to ' + Capped.length + ' owners  delay ' + Opts.delaySec + 's', '#4a9fd4');

            let Sent = 0, Skipped = 0, Failed = 0;
            const SeenUids = new Set();

            for (let Idx = 0; Idx < Capped.length; Idx++) {
                if (BT_Abort) break;
                const Owner = Capped[Idx];

                if (Opts.minRatio > 0) {
                    const TItem = Kmap[TargetItemId] || {};
                    const RVal  = (TItem.Value || TItem.value || 0) > 0 ? (TItem.Value || TItem.value) : (TItem.RAP || TItem.rap || 0);
                    const Ratio = RVal > 0 ? OfferVal / RVal : 0;
                    if (Ratio < Opts.minRatio) { Log('Skip ' + Owner.username + ' — ratio ' + Ratio.toFixed(2) + 'x < min', '#555'); Skipped++; continue; }
                }

                if (Opts.skipDupUid && SeenUids.has(Owner.userId)) { Log('Skip dup UID ' + Owner.username, '#555'); Skipped++; continue; }
                SeenUids.add(Owner.userId);

                const TheirUAIds = Opts.multiItems ? Owner.userAssetIds.slice(0, 4) : [Owner.userAssetIds[0]];

                try {
                    await SendTrade(MyUAIds, Owner.userId, TheirUAIds);
                    Log('Sent to ' + Owner.username + ' (' + Owner.userId + ')', '#4db87a');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TargetItemName, uid: Owner.userId, status: 'Sent', detail: Owner.username });
                    Sent++;
                } catch (E) {
                    Log('Failed  ' + Owner.username + ': ' + E.message, '#e74c3c');
                    TradeLog.push({ ts: new Date().toISOString(), mode: 'Blast', target: TargetItemName, uid: Owner.userId, status: 'Failed', detail: E.message });
                    Failed++;
                }

                if (!BT_Abort && Idx < Capped.length - 1) { Log('Waiting ' + Opts.delaySec + 's...', '#555'); await Sleep(Opts.delaySec * 1000); }
            }

            const Summ = `Done — Sent: ${Sent}  Skipped: ${Skipped}  Failed: ${Failed}`;
            Log(Summ, '#4db87a');
            Toast(Summ, 'success');
            SetBtnState(SendBtn, 'done');
            BT_Running = false;
        });

        BlaFoot.appendChild(SendBtn); BlaFoot.appendChild(StopBtn); BlaFoot.appendChild(CsvBtn);
        BlastPage.appendChild(BlaFoot);

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        //  PAGE 1 — CANCEL TRADES
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const CancelPage = El('div', { display: 'none' });
        CancelPage.appendChild(SecLabel('Outbound Trades'));

        const CTRow    = El('div', { display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' });
        const LoadTrBtn = El('button', { padding: '6px 16px', fontSize: '12px', fontWeight: '700', color: '#fff', background: '#1f6feb', border: '1px solid #388bfd', borderRadius: '5px', cursor: 'pointer' });
        LoadTrBtn.textContent = 'Load Trades';
        const CFilterInp = El('input', { flex: '1', minWidth: '120px', padding: '5px 10px', background: '#21262d', color: '#e6edf3', border: '1px solid rgba(255,255,255,.12)', borderRadius: '5px', fontSize: '12px', outline: 'none' });
        CFilterInp.placeholder = 'Filter by username...';

        const AgeRow  = El('div', { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8b949e' });
        let CancelAgeDays = 7;
        const MkAgeBtn = Txt => { const B = El('button', { width: '22px', height: '22px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px' }); B.textContent = Txt; return B; };
        const AgeMn   = MkAgeBtn('−'), AgePl = MkAgeBtn('+');
        const AgeDisp = El('span', { fontSize: '13px', fontWeight: '700', color: '#e6edf3', minWidth: '28px', textAlign: 'center' });
        AgeDisp.textContent = '7d';
        AgeMn.addEventListener('click', () => { CancelAgeDays = Math.max(1,  CancelAgeDays - 1); AgeDisp.textContent = CancelAgeDays + 'd'; });
        AgePl.addEventListener('click',  () => { CancelAgeDays = Math.min(60, CancelAgeDays + 1); AgeDisp.textContent = CancelAgeDays + 'd'; });
        AgeRow.appendChild(Span('Cancel > ')); AgeRow.appendChild(AgeMn); AgeRow.appendChild(AgeDisp); AgeRow.appendChild(AgePl); AgeRow.appendChild(Span(' days'));
        CTRow.appendChild(LoadTrBtn); CTRow.appendChild(CFilterInp); CTRow.appendChild(AgeRow);
        CancelPage.appendChild(CTRow);

        const SelRow = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer', userSelect: 'none' });
        const SelBox = El('div', { width: '16px', height: '16px', borderRadius: '3px', flexShrink: '0', background: '#238636', border: '1px solid #2ea043', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        const SelCk  = SvgIcon('M20 6L9 17l-5-5', '11'); SelCk.style.color = '#fff'; SelBox.appendChild(SelCk);
        const SelCnt = Span('', { fontSize: '11px', color: '#8b949e', marginLeft: 'auto' });
        SelRow.appendChild(SelBox); SelRow.appendChild(Span('Select all', { fontSize: '12px', color: '#ccc' })); SelRow.appendChild(SelCnt);
        CancelPage.appendChild(SelRow);

        const TradeList    = El('div', { height: '160px', overflowY: 'auto', background: '#0d1117', borderRadius: '5px', padding: '4px', border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px' });
        let OutboundTrades = [];
        let SelTrades      = new Set();
        CancelPage.appendChild(TradeList);

        function RenderCancelList(Filter) {
            TradeList.innerHTML = '';
            const Now    = Date.now();
            const Cutoff = CancelAgeDays * 86400000;
            const FL     = (Filter || '').toLowerCase();
            const Visible = OutboundTrades.filter(T => (!FL || T.partnerName.toLowerCase().includes(FL)) && (Now - new Date(T.sentAt).getTime() >= Cutoff));
            if (!Visible.length) { TradeList.appendChild(Span('No trades match.', { fontSize: '12px', color: '#555', padding: '10px', display: 'block' })); SelCnt.textContent = SelTrades.size + ' selected'; return; }
            Visible.forEach(T => {
                const Sel = SelTrades.has(T.tradeId);
                const Row = El('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '4px', cursor: 'pointer', userSelect: 'none', background: Sel ? 'rgba(220,38,38,.15)' : 'transparent', border: '1px solid ' + (Sel ? '#dc2626' : 'transparent'), marginBottom: '2px', transition: 'background .1s' });
                const CB  = El('div', { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0', background: Sel ? '#dc2626' : '#21262d', border: '1px solid ' + (Sel ? '#dc2626' : 'rgba(255,255,255,.2)'), display: 'flex', alignItems: 'center', justifyContent: 'center' });
                if (Sel) { const Ck = SvgIcon('M20 6L9 17l-5-5', '10'); Ck.style.color = '#fff'; CB.appendChild(Ck); }
                Row.appendChild(CB);
                Row.appendChild(Span(T.partnerName, { flex: '1', fontSize: '12px', color: '#e6edf3' }));
                Row.appendChild(Span('sent ' + new Date(T.sentAt).toLocaleDateString('en-GB'), { fontSize: '10px', color: '#555' }));
                Row.addEventListener('click', () => {
                    if (SelTrades.has(T.tradeId)) SelTrades.delete(T.tradeId);
                    else SelTrades.add(T.tradeId);
                    RenderCancelList(CFilterInp.value);
                });
                TradeList.appendChild(Row);
            });
            SelCnt.textContent = SelTrades.size + ' selected';
        }

        SelBox.addEventListener('click', () => {
            const Cutoff  = CancelAgeDays * 86400000;
            const FL      = CFilterInp.value.toLowerCase();
            const Visible = OutboundTrades.filter(T => (!FL || T.partnerName.toLowerCase().includes(FL)) && (Date.now() - new Date(T.sentAt).getTime() >= Cutoff));
            const AllSel  = Visible.length > 0 && Visible.every(T => SelTrades.has(T.tradeId));
            if (AllSel) {
                Visible.forEach(T => SelTrades.delete(T.tradeId));
                SelBox.innerHTML = ''; SelBox.style.background = '#21262d'; SelBox.style.border = '1px solid rgba(255,255,255,.2)';
            } else {
                Visible.forEach(T => SelTrades.add(T.tradeId));
                SelBox.innerHTML = ''; SelBox.style.background = '#238636'; SelBox.style.border = '1px solid #2ea043';
                const Ck = SvgIcon('M20 6L9 17l-5-5', '11'); Ck.style.color = '#fff'; SelBox.appendChild(Ck);
            }
            RenderCancelList(CFilterInp.value);
        });

        CFilterInp.addEventListener('input', () => RenderCancelList(CFilterInp.value));

        LoadTrBtn.addEventListener('click', async () => {
            LoadTrBtn.textContent = 'Loading...'; LoadTrBtn.disabled = true;
            OutboundTrades = []; SelTrades.clear(); TradeList.innerHTML = '';
            TradeList.appendChild(Span('Fetching outbound trades...', { fontSize: '12px', color: '#8b949e', padding: '10px', display: 'block' }));
            try {
                let Cursor = null, Page = 1, All = [];
                do {
                    const Url = '/apisite/trades/v1/trades/outbound?limit=100&sortOrder=Desc' + (Cursor ? '&cursor=' + Cursor : '');
                    const R   = await fetch(Url, { credentials: 'include' }).then(R2 => R2.json());
                    All    = All.concat(R.data || []);
                    Cursor = R.nextPageCursor || null;
                    Page++;
                } while (Cursor && Page <= 10);

                OutboundTrades = All.map(T => ({
                    tradeId:     T.id,
                    partnerName: T.user?.name || String(T.user?.id || '?'),
                    sentAt:      T.created,
                }));

                const Cutoff = CancelAgeDays * 86400000;
                OutboundTrades.filter(T => (Date.now() - new Date(T.sentAt).getTime()) >= Cutoff).forEach(T => SelTrades.add(T.tradeId));
                RenderCancelList('');
                LoadTrBtn.textContent = 'Loaded ' + OutboundTrades.length;
            } catch (E) {
                TradeList.innerHTML = '';
                TradeList.appendChild(Span('Failed: ' + E.message, { fontSize: '12px', color: '#e74c3c', padding: '10px', display: 'block' }));
                LoadTrBtn.textContent = 'Load Trades';
            }
            LoadTrBtn.disabled = false;
        });

        const CDelRow = El('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px', color: '#8b949e' });
        CDelRow.appendChild(Span('Delay between cancels:'));
        let CancelDelay = 2;
        const MkCDBtn  = Txt => { const B = El('button', { width: '22px', height: '22px', background: '#21262d', border: '1px solid rgba(255,255,255,.15)', borderRadius: '4px', color: '#e6edf3', cursor: 'pointer', fontSize: '13px' }); B.textContent = Txt; return B; };
        const CDMn    = MkCDBtn('−'), CDPl = MkCDBtn('+');
        const CDDisp  = El('span', { fontSize: '13px', fontWeight: '700', color: '#e6edf3', minWidth: '28px', textAlign: 'center' });
        CDDisp.textContent = '2s';
        CDMn.addEventListener('click', () => { CancelDelay = Math.max(1,  CancelDelay - 1); CDDisp.textContent = CancelDelay + 's'; });
        CDPl.addEventListener('click',  () => { CancelDelay = Math.min(30, CancelDelay + 1); CDDisp.textContent = CancelDelay + 's'; });
        CDelRow.appendChild(CDMn); CDelRow.appendChild(CDDisp); CDelRow.appendChild(CDPl);
        CancelPage.appendChild(CDelRow);

        const CLogBox  = El('div', { background: '#0d1117', borderRadius: '5px', padding: '8px 10px', height: '80px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', border: '1px solid rgba(255,255,255,.08)', marginBottom: '10px' });
        const CLog     = (T, C) => LogLine(CLogBox, T, C);
        CancelPage.appendChild(CLogBox);

        const CancelFoot  = El('div', { display: 'flex', gap: '8px' });
        const DoCancelBtn = El('button', { flex: '1', padding: '9px 0', fontSize: '14px', fontWeight: '700', color: '#fff', background: '#b91c1c', border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer' });
        DoCancelBtn.textContent = 'Cancel Selected';
        const CStopBtn = El('button', { padding: '9px 16px', fontSize: '13px', fontWeight: '700', color: '#fff', background: '#333', border: '1px solid rgba(255,255,255,.2)', borderRadius: '6px', cursor: 'pointer' });
        CStopBtn.textContent = 'Stop';

        CStopBtn.addEventListener('click', () => { CancelAbort = true; CLog('Stopped.', '#e74c3c'); DoCancelBtn.disabled = false; DoCancelBtn.textContent = 'Cancel Selected'; CancelRunning = false; });

        DoCancelBtn.addEventListener('click', async () => {
            if (CancelRunning) return;
            if (!SelTrades.size) { Toast('No trades selected', 'warn'); return; }
            CancelRunning = true; CancelAbort = false;
            DoCancelBtn.textContent = 'Running...'; DoCancelBtn.disabled = true; CLogBox.innerHTML = '';
            const Ids = [...SelTrades];
            CLog('Cancelling ' + Ids.length + ' trades...', '#4a9fd4');
            let Done = 0, Fail = 0;
            for (let Idx = 0; Idx < Ids.length; Idx++) {
                if (CancelAbort) break;
                const TId = Ids[Idx];
                try {
                    const Csrf = await GetCsrf();
                    const R    = await fetch('/apisite/trades/v1/trades/' + TId + '/decline', {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf },
                    });
                    if (!R.ok) throw new Error('HTTP ' + R.status);
                    CLog('Cancelled trade ' + TId, '#4db87a');
                    SelTrades.delete(TId); Done++;
                } catch (E) { CLog(TId + ': ' + E.message, '#e74c3c'); Fail++; }
                if (!CancelAbort && Idx < Ids.length - 1) await Sleep(CancelDelay * 1000);
            }
            CLog('Done — Cancelled: ' + Done + '  Failed: ' + Fail, '#4db87a');
            Toast('Cancelled ' + Done + ' trades', 'success');
            DoCancelBtn.textContent = 'Cancel Selected'; DoCancelBtn.disabled = false; CancelRunning = false;
            RenderCancelList(CFilterInp.value);
        });

        CancelFoot.appendChild(DoCancelBtn); CancelFoot.appendChild(CStopBtn);
        CancelPage.appendChild(CancelFoot);

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        //  ASSEMBLE
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        Pages.push(BlastPage, CancelPage);
        Pages.forEach(P => Content.appendChild(P));

        TabBtns.forEach((Btn, I) => {
            Btn.addEventListener('click', () => {
                TabBtns.forEach((B, J) => {
                    B.style.color        = J === I ? '#e6edf3' : '#8b949e';
                    B.style.borderBottom = J === I ? '2px solid #238636' : '2px solid transparent';
                });
                Pages.forEach((P, J) => { P.style.display = J === I ? '' : 'none'; });
            });
        });

        Panel.appendChild(Header);
        Panel.appendChild(TabBar);
        Panel.appendChild(Content);
        Overlay.appendChild(Panel);
        document.body.appendChild(Overlay);
    }

    // ── Public API ─────────────────────────────────────────────────────────
    NS.BulkTrade = { OpenPanel: BuildBulkTradePanel };

})();
