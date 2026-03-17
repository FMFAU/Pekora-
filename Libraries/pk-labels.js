// pk-labels.js — Pekora+ Value Labels & Badges
// Provides: MakeTopBadge, MakeRapDiffBadge, ParseDisplayPrice,
//           InjectItemCardBadge, InjectInventoryBadges, InjectCollectibles
// Depends on: pk-core.js, and window.PekoraPlus.Cfg
(function (Global) {
    'use strict';

    const { El, Span, PkLabel, Fmt, GetOrSetRelative } = Global;

    // ── Price parsing ─────────────────────────────────────────────────────────

    /**
     * Parse a displayed price string like "1.5K" → 1500 or "Free" → null.
     */
    function ParseDisplayPrice(Text) {
        if (!Text) return null;
        const T = Text.trim().toLowerCase();
        if (T === 'offsale' || T === 'no resellers' || T === 'not for sale' || T === 'free') return null;
        const M = T.match(/([\d.]+)\s*([km])?/);
        if (!M) return null;
        let N = parseFloat(M[1]);
        if (M[2] === 'k') N *= 1000;
        if (M[2] === 'm') N *= 1000000;
        return isNaN(N) ? null : N;
    }

    // ── Badge factories ───────────────────────────────────────────────────────

    /**
     * Top-left corner badge showing item Value or RAP.
     * @param {object}  Item   - Koromons item object { Value, RAP }
     * @param {string}  ItemId - Asset ID (for Koromons link if BadgeLinks enabled)
     */
    function MakeTopBadge(Item, ItemId) {
        const Val = Item.Value > 0 ? Item.Value : Item.RAP;
        if (!Val) return null;

        const Badge = El('div', {
            position: 'absolute', top: '3px', left: '3px',
            fontSize: '10px', fontWeight: '700', color: '#fff',
            background: Item.Value > 0 ? 'rgba(30,100,60,.92)' : 'rgba(20,70,120,.92)',
            borderRadius: '3px', padding: '1px 5px', zIndex: '5',
            pointerEvents: 'none', fontFamily: "'Source Sans Pro',sans-serif",
            lineHeight: '1.4'
        });
        Badge.setAttribute('data-pk-card-val', '1');
        Badge.textContent = Fmt(Val);

        if (Global.Cfg?.BadgeLinks && ItemId) {
            Badge.style.pointerEvents = 'auto';
            Badge.style.cursor = 'pointer';
            Badge.title = 'View on Koromons';
            Badge.addEventListener('click', E => {
                E.preventDefault();
                E.stopPropagation();
                window.open('https://www.koromons.xyz/item/' + ItemId, '_blank');
            });
        }
        return Badge;
    }

    /**
     * Top-right corner badge showing price vs RAP as a percentage.
     * @param {number} BestPrice
     * @param {number} Rap
     */
    function MakeRapDiffBadge(BestPrice, Rap) {
        if (!Rap || Rap <= 0 || BestPrice == null) return null;
        const Pct = Math.round(((BestPrice - Rap) / Rap) * 100);
        let Color;
        if      (Pct < -30) Color = '#10b981';
        else if (Pct < 0)   Color = '#4a9fd4';
        else if (Pct === 0) Color = '#888';
        else if (Pct <= 30) Color = '#f59e0b';
        else                Color = '#e74c3c';

        const Badge = El('div', {
            position: 'absolute', top: '3px', right: '3px',
            fontSize: '10px', fontWeight: '700', color: '#fff',
            background: Color, borderRadius: '3px', padding: '1px 5px',
            zIndex: '6', pointerEvents: 'none',
            fontFamily: "'Source Sans Pro',sans-serif", lineHeight: '1.4'
        });
        Badge.setAttribute('data-pk-rap-diff', '1');
        Badge.textContent = (Pct >= 0 ? '+' : '') + Pct + '% RAP';
        return Badge;
    }

    // ── Card injection helpers ────────────────────────────────────────────────

    /**
     * Inject a value badge onto an item-card anchor (used in non-catalog pages).
     */
    function InjectItemCardBadge(Anchor, Kmap) {
        const M = (Anchor.getAttribute('href') || '').match(/\/catalog\/(\d+)\//);
        if (!M || !Kmap?.[M[1]]) return;
        const Item = Kmap[M[1]];
        const Val = Item.Value > 0 ? Item.Value : Item.RAP;
        if (!Val) return;
        const Card = Anchor.closest('[class*="itemCard"], [class*="avatarCardContainer"], [class*="recomCardContainer"], [class*="cardContainer"], [class*="cardWrapper"]') || Anchor.parentElement;
        if (!Card || Card.querySelector('[data-pk-card-val]')) return;
        const ImgArea = Card.querySelector('[class*="itemImage"], [class*="avatarCardImage"], [class*="thumbContainer"], [class*="cardImage"]') || Card;
        GetOrSetRelative(ImgArea);
        const Badge = MakeTopBadge(Item, M[1]);
        if (Badge) ImgArea.appendChild(Badge);
    }

    /**
     * Inject badges across all catalog anchors on an inventory page.
     */
    function InjectInventoryBadges(Kmap) {
        if (!Kmap || !Global.Cfg?.ShowValBadges) return;
        document.querySelectorAll('a[href*="/catalog/"]').forEach(Anchor => {
            const M = (Anchor.getAttribute('href') || '').match(/\/catalog\/(\d+)\//);
            if (!M) return;
            const Item = Kmap[M[1]];
            if (!Item) return;
            const Card = Anchor.querySelector('[class*="itemCard"]') || Anchor.firstElementChild;
            if (!Card) return;
            if (Card.querySelector('[data-pk-card-val]') || Card.getAttribute('data-pk-inv-processed')) return;
            Card.setAttribute('data-pk-inv-processed', '1');
            GetOrSetRelative(Card);
            const Badge = MakeTopBadge(Item, M[1]);
            if (Badge) { Badge.style.top = '14px'; Card.appendChild(Badge); }
        });
    }

    /**
     * Inject badges on /internal/collectibles cards and add a summary bar near the page title.
     */
    function InjectCollectibles(Kmap) {
        if (!Kmap) return;
        document.querySelectorAll('[class*="itemCard"], [class*="collectibleCard"], [class*="card"]').forEach(Card => {
            if (Card.querySelector('[data-pk-card-val]')) return;
            const A = Card.querySelector('a[href*="/catalog/"]');
            const M = A ? (A.getAttribute('href') || '').match(/\/catalog\/(\d+)\//) : null;
            if (!M) return;
            const Item = Kmap[M[1]];
            if (!Item || !Global.Cfg?.ShowValBadges) return;
            const Val = Item.Value > 0 ? Item.Value : Item.RAP;
            if (!Val) return;
            const ImgArea = Card.querySelector('img')?.parentElement || Card;
            GetOrSetRelative(ImgArea);
            const Badge = MakeTopBadge(Item, M[1]);
            if (Badge) ImgArea.appendChild(Badge);
        });

        if (document.getElementById('pk-collectibles-bar')) return;
        let Total = 0, Count = 0;
        document.querySelectorAll('a[href*="/catalog/"]').forEach(A => {
            const M = (A.getAttribute('href') || '').match(/\/catalog\/(\d+)\//);
            if (!M) return;
            const Item = Kmap[M[1]];
            if (!Item) return;
            const Val = Item.Value > 0 ? Item.Value : Item.RAP;
            if (Val) { Total += Val; Count++; }
        });
        if (Count === 0) return;

        const H = document.querySelector('h1, h2, [class*="pageTitle"], [class*="title"]');
        if (!H) return;

        const Bar = El('div', {
            display: 'inline-flex', gap: '12px', alignItems: 'center',
            background: 'var(--white-color,#191919)', borderRadius: '4px',
            padding: '6px 12px', marginLeft: '12px', verticalAlign: 'middle',
            border: '1px solid rgba(255,255,255,.1)'
        });
        Bar.id = 'pk-collectibles-bar';
        Bar.appendChild(PkLabel('Pekora+'));
        Bar.appendChild(Span('Total: ' + Fmt(Total), { fontSize: '14px', fontWeight: '700', color: '#4db87a', fontFamily: "'Source Sans Pro',sans-serif" }));
        Bar.appendChild(Span(Count + ' valued items', { fontSize: '11px', color: '#999', fontFamily: "'Source Sans Pro',sans-serif" }));
        H.appendChild(Bar);
    }

    Global.ParseDisplayPrice = ParseDisplayPrice;
    Global.MakeTopBadge = MakeTopBadge;
    Global.MakeRapDiffBadge = MakeRapDiffBadge;
    Global.InjectItemCardBadge = InjectItemCardBadge;
    Global.InjectInventoryBadges = InjectInventoryBadges;
    Global.InjectCollectibles = InjectCollectibles;

})(window.PekoraPlus = window.PekoraPlus || {});
