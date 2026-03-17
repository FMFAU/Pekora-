// UiLibrary.js
// UI helpers for Pekora+ — only finished elements cuz lowkey still early dev.

(function () {
    'use strict';
    const lib = {};

    // ────────────────────────────────────────────────────────────────
    //  Helpers
    // ────────────────────────────────────────────────────────────────

    lib.createElement = function (tag, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        Object.assign(el.style, styles);
        Object.assign(el, attrs);
        return el;
    };

    lib.createSpan = function (text, styles = {}) {
        const s = lib.createElement('span', styles);
        s.textContent = text;
        return s;
    };

    lib.fmtNumber = function (n) {
        if (n == null) return 'N/A';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toLocaleString();
    };

    lib.getOrSetRelative = function (container) {
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }
        return container;
    };

    // ────────────────────────────────────────────────────────────────
    //  Value Badge (used on cards, inventory, collectibles, trades, and whatever I want.)
    // ────────────────────────────────────────────────────────────────

    lib.createValueBadge = function (value, rapFallback = 0, options = {}) {
        const val = value > 0 ? value : rapFallback;
        if (!val) return null;

        const isVal = value > 0;
        const bg = isVal ? 'rgba(30,100,60,.92)' : 'rgba(20,70,120,.92)';

        const badge = lib.createElement('div', {
            position: 'absolute',
            top: options.top ?? '3px',
            left: options.left ?? '3px',
            fontSize: '10px',
            fontWeight: '700',
            color: '#fff',
            background: bg,
            borderRadius: '3px',
            padding: '1px 5px',
            zIndex: options.zIndex ?? '5',
            pointerEvents: 'none',
            fontFamily: "'Source Sans Pro', sans-serif",
            lineHeight: '1.4',
            whiteSpace: 'nowrap'
        });

        badge.textContent = lib.fmtNumber(val);
        badge.dataset.pkCardVal = '1';

        if (options.linkItemId && options.onClick) {
            badge.style.pointerEvents = 'auto';
            badge.style.cursor = 'pointer';
            badge.title = 'View on Koromons';
            badge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onClick();
            });
        }

        return badge;
    };

    // ────────────────────────────────────────────────────────────────
    //  Buy Button
    // ────────────────────────────────────────────────────────────────

    lib.createBuyButton = function (itemId, onClick, options = {}) {
        const btn = lib.createElement('button', {
            display: 'block',
            width: options.width ?? '100%',
            margin: options.margin ?? '4px 0 0 0',
            padding: '3px 0',
            fontSize: '12px',
            fontFamily: "'Source Sans Pro', sans-serif",
            fontWeight: '700',
            color: '#fff',
            background: options.bgColor ?? '#8A5149',
            border: `1px solid ${options.borderColor ?? '#5a3530'}`,
            borderRadius: '3px',
            cursor: 'pointer',
            lineHeight: '1.5',
            transition: 'background .12s, opacity .12s',
            boxSizing: 'border-box',
            position: 'relative',
            zIndex: '9999'
        });

        btn.textContent = options.label ?? 'Buy';
        btn.dataset.pkBuy = String(itemId);
        btn.dataset.pkBuyLabel = btn.textContent;

        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) btn.style.background = options.hoverBg ?? '#9C6A5E';
        });

        btn.addEventListener('mouseleave', () => {
            if (!btn.disabled) btn.style.background = options.bgColor ?? '#8A5149';
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick?.(btn, itemId);
        });

        return btn;
    };

    // ────────────────────────────────────────────────────────────────
    //  Toast
    // ────────────────────────────────────────────────────────────────

    lib.showToast = function (message, success = false, position = 'bottom-right') {
        document.getElementById('pk-toast')?.remove();

        const coords = {};
        if (position.includes('bottom')) coords.bottom = '20px'; else coords.top = '20px';
        if (position.includes('right'))  coords.right  = '20px'; else coords.left  = '20px';

        const t = lib.createElement('div', {
            position: 'fixed',
            color: '#fff',
            ...coords,
            background: success ? '#1a3d26' : '#3d1a1a',
            padding: '10px 16px',
            borderRadius: '5px',
            fontSize: '13px',
            fontFamily: "'Source Sans Pro', sans-serif",
            fontWeight: '600',
            zIndex: '999999',
            boxShadow: '0 3px 10px rgba(0,0,0,.55)',
            borderLeft: `4px solid ${success ? '#2ecc71' : '#e74c3c'}`,
            maxWidth: '300px',
            wordBreak: 'break-word',
            opacity: '1',
            transition: 'opacity .3s ease'
        });

        t.id = 'pk-toast';
        t.textContent = message;
        document.body.appendChild(t);

        setTimeout(() => {
            t.style.opacity = '0';
            setTimeout(() => t.remove(), 320);
        }, 3500);
    };

    // ────────────────────────────────────────────────────────────────
    //  Simple ad hiding (Honestly adblocker is so useful i hate banners)
    // ────────────────────────────────────────────────────────────────

    lib.hideAds = function () {
        document.querySelectorAll(
            '[class*="adWrapper"], [class*="adImage"], [class*="bannerAd"], ' +
            '[class*="skyscraper"], [class*="skyScraperLeft"], [class*="skyScraperRight"], ' +
            '[class*="alertBg"]'
        ).forEach(el => { el.style.display = 'none'; });
    };

    // Export
    window.UILib = lib;

})();
