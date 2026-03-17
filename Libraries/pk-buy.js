// pk-buy.js — Pekora+ Buy Buttons
// Provides: MakeBtn, HandleBuy, DoPurchase, GetItemDetails, ResetBtn, ItemIsForSale
// Depends on: pk-core.js, pk-toast.js, and window.PekoraPlus.Cfg
(function (Global) {
    'use strict';

    const { El, GetCsrf, Toast } = Global;

    // ── API helpers ──────────────────────────────────────────────────────────

    async function GetItemDetails(Id) {
        try {
            const R = await fetch('/apisite/catalog/v1/catalog/items/details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ items: [{ itemType: 'Asset', id: parseInt(Id, 10) }] })
            });
            if (!R.ok) return null;
            return (await R.json())?.data?.[0] || null;
        } catch { return null; }
    }

    async function DoPurchase(Id, Price, Currency) {
        let Csrf = GetCsrf();
        // If no CSRF from cookie, trigger a preflight to get the token from the response header
        if (!Csrf) {
            try {
                const P = await fetch('/apisite/economy/v1/purchases/products/' + Id, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({})
                });
                Csrf = P.headers.get('x-csrf-token') || '';
            } catch {}
        }
        const R = await fetch('/apisite/economy/v1/purchases/products/' + Id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': Csrf },
            credentials: 'include',
            body: JSON.stringify({
                assetId: parseInt(Id, 10),
                expectedPrice: parseInt(Price, 10),
                expectedSellerId: 1,
                userAssetId: null,
                expectedCurrency: Currency ?? 1
            })
        });
        let Data = null;
        try { Data = await R.json(); } catch {}
        return { status: R.status, data: Data };
    }

    // ── Button state ─────────────────────────────────────────────────────────

    function ResetBtn(Btn) {
        Btn.disabled = false;
        Btn.textContent = Btn.getAttribute('data-pk-buy-label') || 'Buy';
        Btn.style.opacity = '1';
        Btn.style.cursor = 'pointer';
        Btn.style.background = Global.Cfg?.CustomTheme ? '#0041ceff' : '#8A5149';
    }

    // ── Purchase handler ─────────────────────────────────────────────────────

    async function HandleBuy(Btn, Id) {
        Btn.disabled = true;
        Btn.textContent = 'Loading...';
        Btn.style.opacity = '.6';
        Btn.style.cursor = 'wait';

        const Details = await GetItemDetails(Id);
        if (!Details) {
            Toast('Failed to fetch item info', false);
            ResetBtn(Btn);
            return;
        }

        const Price = Details.price || 0;
        const Name = Details.name || ('Item ' + Id);
        const Currency = Details.currencyType ?? (Details.isTix === 1 ? 0 : 1);
        Btn.textContent = 'Buying...';

        let Result;
        try { Result = await DoPurchase(Id, Price, Currency); }
        catch (E) { Toast('Network error: ' + E.message, false); ResetBtn(Btn); return; }

        const Label = Currency === 0 ? 'Tix' : 'R$';
        if (Result.status === 200 && Result.data?.reason === 'Success') {
            Toast('Purchased "' + Name + '" for ' + Price.toLocaleString() + ' ' + Label, true);
            document.querySelectorAll('[data-pk-buy="' + Id + '"]').forEach(B => {
                B.textContent = 'Bought!';
                B.style.background = '#1a3d26';
                B.style.borderColor = '#2ecc71';
                B.disabled = true;
            });
        } else {
            let Err = String(Result.data?.reason || Result.data?.message || Result.data?.error || ('HTTP ' + Result.status)).slice(0, 100);
            if (Result.status === 400) Err = '400 Bad Request\n\nOwned or Too Expensive';
            Toast('Failed: ' + Err, false);
            ResetBtn(Btn);
        }
    }

    // ── Button factory ───────────────────────────────────────────────────────

    /**
     * Create a Buy button for a catalog item.
     * @param {string}  Id       - Item asset ID
     * @param {boolean} InPopup  - Slightly narrower margin variant for popups
     */
    function MakeBtn(Id, InPopup) {
        const UseTheme = Global.Cfg?.CustomTheme;
        const Btn = El('button', {
            display: 'block',
            width: InPopup ? 'calc(100% - 8px)' : '100%',
            margin: InPopup ? '6px 4px 2px 4px' : '4px 0 0 0',
            padding: '3px 0', fontSize: '12px',
            fontFamily: "'Source Sans Pro',sans-serif",
            fontWeight: '700', color: '#fff',
            background: UseTheme ? '#0041ceff' : '#8A5149',
            border: '1px solid ' + (UseTheme ? '#003088' : '#5a3530'),
            borderRadius: '3px', cursor: 'pointer',
            lineHeight: '1.5', transition: 'background .12s',
            boxSizing: 'border-box', position: 'relative', zIndex: '9999'
        });
        Btn.textContent = 'Buy';
        Btn.setAttribute('data-pk-buy', Id);
        Btn.addEventListener('mouseenter', () => {
            if (!Btn.disabled) Btn.style.background = Global.Cfg?.CustomTheme ? '#0052ccff' : '#9C6A5E';
        });
        Btn.addEventListener('mouseleave', () => {
            if (!Btn.disabled) Btn.style.background = Global.Cfg?.CustomTheme ? '#0041ceff' : '#8A5149';
        });
        Btn.addEventListener('click', E => {
            E.preventDefault();
            E.stopPropagation();
            HandleBuy(Btn, Id);
        });
        return Btn;
    }

    // ── Sale detection helper ─────────────────────────────────────────────────

    /**
     * Returns true if the item card linked by Anchor appears to be for sale.
     */
    function ItemIsForSale(Anchor) {
        const Card = Anchor.closest('[class*="cardContainer"], [class*="cardWrapper"], [class*="item-card"], [class*="item-container"]');
        if (Card) {
            const PriceEls = Card.querySelectorAll('[class*="currencyText"], [class*="text-robux"], [class*="text-tix"], [class*="text-free"], [class*="price"]');
            for (const E of PriceEls) {
                const Txt = E.textContent.trim().toLowerCase();
                if (Txt !== 'offsale' && Txt !== 'no resellers' && Txt !== 'not for sale' && (Txt === 'free' || /\d/.test(Txt))) return true;
            }
            return false;
        }
        const Ov = Anchor.querySelector('div[class*="overviewDetails"]');
        if (!Ov) return false;
        const Ps = Ov.querySelectorAll('p.mb-0');
        if (!Ps.length) return false;
        const Txt = Ps[Ps.length - 1].textContent.trim().toLowerCase();
        return Txt !== 'offsale' && (Txt === 'free' || /\d/.test(Txt));
    }

    Global.GetItemDetails = GetItemDetails;
    Global.DoPurchase = DoPurchase;
    Global.ResetBtn = ResetBtn;
    Global.HandleBuy = HandleBuy;
    Global.MakeBtn = MakeBtn;
    Global.ItemIsForSale = ItemIsForSale;

})(window.PekoraPlus = window.PekoraPlus || {});
