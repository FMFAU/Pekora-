// pk-toast.js — Pekora+ Toast Notifications
// Provides: Toast(msg, ok)
// Depends on: pk-core.js, and window.PekoraPlus.Cfg (set by the userscript)
(function (Global) {
    'use strict';

    const { El } = Global;

    function GetToastCoords() {
        const Pos = (Global.Cfg?.ToastPos) || 'bottom-right';
        const S = { bottom: 'auto', top: 'auto', left: 'auto', right: 'auto' };
        if (Pos.includes('bottom')) S.bottom = '20px'; else S.top = '20px';
        if (Pos.includes('right')) S.right = '20px'; else S.left = '20px';
        return S;
    }

    /**
     * Show a toast notification.
     * @param {string} Msg  - Message to display
     * @param {boolean} Ok  - true = success (green), false = error (red)
     */
    function Toast(Msg, Ok) {
        document.getElementById('pk-toast')?.remove();
        const C = GetToastCoords();
        const T = El('div', {
            position: 'fixed', color: '#fff',
            bottom: C.bottom, top: C.top, left: C.left, right: C.right,
            background: Ok ? '#1a3d26' : '#3d1a1a',
            padding: '10px 16px', borderRadius: '5px', fontSize: '13px',
            fontFamily: "'Source Sans Pro',sans-serif", fontWeight: '600',
            zIndex: '999999', boxShadow: '0 3px 10px rgba(0,0,0,.55)',
            borderLeft: '4px solid ' + (Ok ? '#2ecc71' : '#e74c3c'),
            maxWidth: '300px', wordBreak: 'break-word', opacity: '1',
            transition: 'opacity .3s ease'
        });
        T.id = 'pk-toast';
        T.textContent = Msg;
        document.body.appendChild(T);
        setTimeout(() => { T.style.opacity = '0'; setTimeout(() => T.remove(), 320); }, 3500);
    }

    Global.Toast = Toast;
    Global.GetToastCoords = GetToastCoords;

})(window.PekoraPlus = window.PekoraPlus || {});
