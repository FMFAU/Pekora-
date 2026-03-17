// pk-theme.js — Pekora+ Custom Theme
// Provides: LoadCustomTheme, RemoveCustomTheme, ApplyNavbarFix, RefreshThemeOnNav
// Depends on: window.PekoraPlus.Cfg
// The CSS file URL is configurable via PekoraPlus.THEME_URL before this module loads.
(function (Global) {
    'use strict';

    const DEFAULT_THEME_URL = 'https://pekora-three.vercel.app/Src/Pekora%2BTheme.css';

    function GetThemeUrl() {
        return Global.THEME_URL || DEFAULT_THEME_URL;
    }

    // ── Load ─────────────────────────────────────────────────────────────────

    async function LoadCustomTheme() {
        try {
            RemoveCustomTheme();
            const ThemeCss = await new Promise((Resolve, Reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: GetThemeUrl(),
                    onload: R => R.status >= 200 && R.status < 300
                        ? Resolve(R.responseText)
                        : Reject(new Error('HTTP ' + R.status)),
                    onerror: Reject
                });
            });
            const El = document.createElement('style');
            El.id = 'pk-custom-theme';
            El.textContent = ThemeCss;
            document.head.appendChild(El);
            ApplyNavbarFix();
        } catch (Err) {
            console.error('[Pekora+] Error loading custom theme:', Err);
        }
    }

    function RemoveCustomTheme() {
        document.getElementById('pk-custom-theme')?.remove();
    }

    // ── Navbar fix ────────────────────────────────────────────────────────────

    function ApplyNavbarFix() {
        if (!Global.Cfg?.CustomTheme) return;
        const PageBg = getComputedStyle(document.documentElement).getPropertyValue('--dark').trim() || '#0d1117';
        const TopNav = document.getElementById('stylable-nav-bar');
        if (TopNav) {
            TopNav.style.setProperty('background', PageBg, 'important');
            TopNav.style.setProperty('background-color', PageBg, 'important');
            TopNav.style.setProperty('background-image', 'none', 'important');
        }
        document.querySelectorAll('div').forEach(E => {
            if (E.children.length < 1) return;
            if (E.querySelector('a[href*="Upgrade.ashx"]') && E.querySelector('a[href="/My/Avatar"]')) {
                E.style.setProperty('background', PageBg, 'important');
                E.style.setProperty('background-color', PageBg, 'important');
            }
        });
    }

    function RefreshThemeOnNav() {
        if (!Global.Cfg?.CustomTheme) return;
        if (!document.getElementById('pk-custom-theme')) LoadCustomTheme();
        else ApplyNavbarFix();
        document.body.classList.add('pk-custom-theme');
    }

    // Keep navbar in sync every 100ms while theme is active
    setInterval(() => { if (Global.Cfg?.CustomTheme) ApplyNavbarFix(); }, 100);

    // Auto-apply if enabled at load time
    if (Global.Cfg?.CustomTheme) {
        LoadCustomTheme();
        document.body.classList.add('pk-custom-theme');
    }

    Global.LoadCustomTheme = LoadCustomTheme;
    Global.RemoveCustomTheme = RemoveCustomTheme;
    Global.ApplyNavbarFix = ApplyNavbarFix;
    Global.RefreshThemeOnNav = RefreshThemeOnNav;

})(window.PekoraPlus = window.PekoraPlus || {});
