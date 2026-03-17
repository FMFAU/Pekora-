// pk-adblock.js — Pekora+ Adblock
// Provides: ApplyAdblock, StartAdblockObserver, StopAdblockObserver
// Depends on: window.PekoraPlus.Cfg
(function (Global) {
    'use strict';

    const AD_SELECTORS = [
        '[class*="adWrapper"]',
        '[class*="adImage"]',
        '[class*="bannerAd"]',
        '[class*="skyscraper"]',
        '[class*="skyScraperLeft"]',
        '[class*="skyScraperRight"]',
        '[class*="alertBg"]'
    ].join(', ');

    /** Hide all known ad elements on the current page */
    function ApplyAdblock() {
        if (!Global.Cfg?.Adblock) return;
        document.querySelectorAll(AD_SELECTORS).forEach(E => { E.style.display = 'none'; });
    }

    /** Show ad elements again (called when user disables adblock) */
    function RemoveAdblock() {
        document.querySelectorAll('[class*="adWrapper"]').forEach(E => { E.style.display = ''; });
    }

    let _obs = null;

    /** Start watching for dynamically injected ads */
    function StartAdblockObserver() {
        if (_obs) return;
        _obs = new MutationObserver(() => { if (Global.Cfg?.Adblock) ApplyAdblock(); });
        _obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    function StopAdblockObserver() {
        _obs?.disconnect();
        _obs = null;
    }

    // Auto-start the observer immediately
    StartAdblockObserver();

    Global.ApplyAdblock = ApplyAdblock;
    Global.RemoveAdblock = RemoveAdblock;
    Global.StartAdblockObserver = StartAdblockObserver;
    Global.StopAdblockObserver = StopAdblockObserver;

})(window.PekoraPlus = window.PekoraPlus || {});
