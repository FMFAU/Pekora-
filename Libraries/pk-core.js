// pk-core.js — Pekora+ Core Utilities
// Provides: El, Span, Pill, PkLabel, Fmt, GmFetch, GetCsrf, GetNextData, GetOrSetRelative, CatalogUrl
(function (Global) {
    'use strict';

    /** Create a DOM element with optional inline styles and properties */
    function El(Tag, Styles, Attrs) {
        const E = document.createElement(Tag);
        if (Styles) Object.assign(E.style, Styles);
        if (Attrs) Object.assign(E, Attrs);
        return E;
    }

    /** Create a <span> with text and optional inline styles */
    function Span(Text, Styles) {
        const S = El('span', Styles);
        S.textContent = Text;
        return S;
    }

    /** Small colored pill badge */
    function Pill(Text, Color) {
        return Span(Text, {
            fontSize: '10px', fontFamily: "'Source Sans Pro',sans-serif",
            fontWeight: '700', color: '#fff', background: Color,
            borderRadius: '3px', padding: '1px 5px', whiteSpace: 'nowrap'
        });
    }

    /** Pekora+ section label (e.g. "Pekora+" prefix in stat rows) */
    function PkLabel(Text) {
        return Span(Text, {
            fontSize: '11px', fontWeight: '600',
            color: 'var(--text-color-secondary,#999)',
            fontFamily: "'Source Sans Pro',sans-serif", marginRight: '4px'
        });
    }

    /** Format a number: 1,500,000 → 1.5M, 3500 → 3.5K */
    function Fmt(N) {
        if (N == null) return 'N/A';
        if (N >= 1e6) return (N / 1e6).toFixed(1) + 'M';
        if (N >= 1e3) return (N / 1e3).toFixed(1) + 'K';
        return N.toLocaleString();
    }

    /** Build a catalog URL from item id + name */
    function CatalogUrl(Id, Name) {
        const Slug = (Name || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Id);
        return '/catalog/' + Id + '/' + Slug;
    }

    /** Ensure container has non-static positioning */
    function GetOrSetRelative(Container) {
        if (getComputedStyle(Container).position === 'static')
            Container.style.position = 'relative';
        return Container;
    }

    /** GM_xmlhttpRequest wrapped as a Promise that auto-parses JSON */
    function GmFetch(Url) {
        return new Promise((Res, Rej) => {
            GM_xmlhttpRequest({
                method: 'GET', url: Url,
                onload: R => {
                    if (R.status >= 200 && R.status < 300) {
                        try { Res(JSON.parse(R.responseText)); } catch (E) { Rej(E); }
                    } else Rej(new Error('HTTP ' + R.status));
                },
                onerror: Rej
            });
        });
    }

    /** Read CSRF token from cookies */
    function GetCsrf() {
        for (let P of document.cookie.split(';')) {
            P = P.trim();
            if (P.startsWith('.RBXCSRF=') || P.startsWith('rbxcsrf='))
                return decodeURIComponent(P.split('=')[1]);
        }
        return '';
    }

    /** Read __NEXT_DATA__ from the page */
    function GetNextData() {
        try { return JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}'); } catch { return {}; }
    }

    // Expose on the global PekoraPlus namespace
    Global.El = El;
    Global.Span = Span;
    Global.Pill = Pill;
    Global.PkLabel = PkLabel;
    Global.Fmt = Fmt;
    Global.CatalogUrl = CatalogUrl;
    Global.GetOrSetRelative = GetOrSetRelative;
    Global.GmFetch = GmFetch;
    Global.GetCsrf = GetCsrf;
    Global.GetNextData = GetNextData;

})(window.PekoraPlus = window.PekoraPlus || {});
