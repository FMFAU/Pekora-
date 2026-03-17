// pk-styles.js — Pekora+ Base Styles
// Injects the global stylesheet and handles white-background overrides.
// Depends on: pk-core.js (window.PekoraPlus must exist)
(function (Global) {
    'use strict';

    // ── Base stylesheet ──────────────────────────────────────────────────────
    const StyleEl = document.createElement('style');
    StyleEl.id = 'pk-styles';
    StyleEl.textContent = `
        [class*="avatarCardContainer"] { aspect-ratio: unset !important; height: auto !important; min-height: 160px; }
        [class*="avatarCardWrapper"]   { aspect-ratio: unset !important; height: auto !important; }
        [class*="avatarCardImage"]     { min-height: 100px; }
        [class*="avatarCardItemLink"]  { padding-bottom: 4px !important; }

        [class*="game-card"] img,
        [class*="gameCard"] img,
        [class*="game-thumbnail"] img,
        [class*="gameTile"] img,
        [class*="game-tile"] img,
        [class*="homePageGameGrid"] img,
        [class*="gamesPage"] img,
        .games-list img,
        [data-testid*="game"] img {
            aspect-ratio: 16/9 !important;
            object-fit: cover !important;
            width: 100% !important;
            height: auto !important;
        }

        [class*="game-card"],
        [class*="gameCard"],
        [class*="gameTile"],
        [class*="game-tile"] { aspect-ratio: unset !important; }

        body.pk-custom-theme nav#stylable-nav-bar,
        body.pk-custom-theme nav.fixed-top,
        body.pk-custom-theme [class*="navbar"] {
            background: var(--dark, #0d1117) !important;
            background-color: var(--dark, #0d1117) !important;
            background-image: none !important;
        }

        [data-pk-card-val] { transition: opacity .15s ease !important; }
        [data-pk-card-val]:hover { opacity: .8 !important; }

        [class*="itemStatusNew"]     { display: none !important; }
        [class*="itemStatusSaleNew"] { display: none !important; }
        [class*="cardWrapper"]       { display: flex; flex-direction: column; }
        [data-pk-buy]                { box-sizing: border-box !important; }
    `;
    document.head.appendChild(StyleEl);

    // ── White-background override ────────────────────────────────────────────
    function IsWhiteBackground() {
        const Bg = getComputedStyle(document.body).backgroundColor;
        if (Bg === 'rgb(255, 255, 255)' || Bg === '#ffffff' || Bg === 'white') return true;
        const Rgb = Bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (Rgb) {
            const [, R, G, B] = Rgb.map(Number);
            return R > 240 && G > 240 && B > 240;
        }
        const Hex = Bg.match(/#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})/);
        if (Hex) {
            const H = Hex[1].length === 3 ? Hex[1].split('').map(C => C + C).join('') : Hex[1];
            const R = parseInt(H.substr(0, 2), 16), G = parseInt(H.substr(2, 2), 16), B = parseInt(H.substr(4, 2), 16);
            return R > 240 && G > 240 && B > 240;
        }
        return false;
    }

    function ApplyWhiteBackgroundFixes() {
        if (!IsWhiteBackground()) return;
        document.getElementById('pk-white-bg-fix')?.remove();
        const Fix = document.createElement('style');
        Fix.id = 'pk-white-bg-fix';
        Fix.textContent = `
            [id*="pk-"]                              { color: #1a1a1a !important; }
            #pk-nav-badge                            { color: #8A5149 !important; }
            #pk-config-panel                         { background: #2a2a2a !important; color: #fff !important; }
            #pk-toast                                { background: #2a2a2a !important; color: #fff !important; }
            [id*="pk-"] span                         { color: #1a1a1a !important; }
            [data-pk-badge] span,
            [data-pk-card-val],
            [data-pk-item-val]                       { color: #fff !important; }
        `;
        document.head.appendChild(Fix);
    }

    setTimeout(ApplyWhiteBackgroundFixes, 100);
    setInterval(ApplyWhiteBackgroundFixes, 2000);

    // Expose helpers in case other modules need them
    Global.IsWhiteBackground = IsWhiteBackground;
    Global.ApplyWhiteBackgroundFixes = ApplyWhiteBackgroundFixes;

})(window.PekoraPlus = window.PekoraPlus || {});
