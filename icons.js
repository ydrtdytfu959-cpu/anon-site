/* ANOX_ICONS_START */
/* Original AnoX interface glyphs. MIT license: LICENSE-icons.txt.
   Optical grid: 24 × 24; round 1.75-unit strokes, normally inset 3 units.
   Brand marks and product illustrations intentionally live outside this set. */
(function exposeAnoXIcons(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnoXIcons = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const paths = Object.freeze({
    home:'<path d="m3.5 10 7.3-6a1.9 1.9 0 0 1 2.4 0l7.3 6M5.5 9v10a1.5 1.5 0 0 0 1.5 1.5h3v-6h4v6h3a1.5 1.5 0 0 0 1.5-1.5V9"/>',
    search:'<circle cx="10.75" cy="10.75" r="6.75"/><path d="m16 16 4.5 4.5"/>',
    bag:'<path d="M6.25 8h11.5a1 1 0 0 1 1 .9l.9 10a1.5 1.5 0 0 1-1.5 1.6H5.85a1.5 1.5 0 0 1-1.5-1.6l.9-10a1 1 0 0 1 1-.9Z"/><path d="M8.5 9V6a3.5 3.5 0 0 1 7 0v3"/>',
    cart:'<path d="M3 4h2l2.15 10.3a1.5 1.5 0 0 0 1.47 1.2h8.9a1.5 1.5 0 0 0 1.45-1.12L20.5 8H6"/><circle cx="9" cy="19.75" r="1.25"/><circle cx="17.5" cy="19.75" r="1.25"/>',
    heart:'<path d="M12 20s-8.5-5.1-8.5-11A4.75 4.75 0 0 1 12 6.1 4.75 4.75 0 0 1 20.5 9C20.5 14.9 12 20 12 20Z"/>',
    user:'<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5V20"/>',
    moon:'<path d="M19.9 14.4A8.25 8.25 0 0 1 9.6 4.1 8.4 8.4 0 1 0 19.9 14.4Z"/>',
    sun:'<circle cx="12" cy="12" r="3.75"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1m10.6 10.6 1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/>',
    menu:'<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15"/>',
    close:'<path d="m6.5 6.5 11 11m0-11-11 11"/>',
    arrow:'<path d="M4.5 12h15m-6-6 6 6-6 6"/>',
    check:'<path d="m5 12 4.5 4.5L19 7"/>',
    plus:'<path d="M12 5.5v13m-6.5-6.5h13"/>',
    minus:'<path d="M5.5 12h13"/>',
    info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
    warning:'<path d="m10.7 4.8-7 12.5a1.5 1.5 0 0 0 1.3 2.2h14a1.5 1.5 0 0 0 1.3-2.2l-7-12.5a1.5 1.5 0 0 0-2.6 0Z"/><path d="M12 9v4.5m0 3h.01"/>',
    box:'<path d="m4.5 7.5 7.5-4 7.5 4v9L12 20.5l-7.5-4v-9Zm0 0 7.5 4 7.5-4M12 11.5v9m-3.75-15 7.5 4v3.25"/>',
    truck:'<path d="M5.5 17.5H3.5V6h10v11.5h-4m4-8h4l3 4v4h-2m-5 0h1M16 10v3.5h4"/><circle cx="7.5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    shield:'<path d="M12 3.5 5 6v5.5c0 4 2.75 6.8 7 9 4.25-2.2 7-5 7-9V6l-7-2.5Z"/><path d="m8.75 11.75 2.25 2.25 4.25-4.25"/>',
    filter:'<path d="M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    compare:'<rect x="4" y="8" width="6" height="12" rx="1.5"/><rect x="14" y="4" width="6" height="16" rx="1.5"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M15.5 8V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2"/>',
    external:'<path d="M13.5 4h6.5v6.5M19.5 4.5 10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
    refresh:'<path d="M19.5 5v5H15M4.5 19v-5H9M19 10a7.25 7.25 0 0 0-12.5-3.5M5 14a7.25 7.25 0 0 0 12.5 3.5"/>',
    assistant:'<path d="M20 11.5a8 8 0 0 1-8 8H4l1.6-4A8 8 0 1 1 20 11.5Z"/><path d="M8.5 10h7m-7 4h4"/>',
    send:'<path d="M12 19.5v-15m-6 6 6-6 6 6"/>',
    chevron:'<path d="m7 9.5 5 5 5-5"/>',
    shirt:'<path d="m8 4.5-5 3.5 2.5 4L8 10.5V20h8v-9.5l2.5 1.5L21 8l-5-3.5c-.5 1.8-2 2.75-4 2.75S8.5 6.3 8 4.5Z"/>',
    shoe:'<path d="m3.5 11.5 1.5-4L8 9l1.5-3.5 3 4.5 5.5 2.5c2 .9 2.5 1.8 2.5 3.5v3h-17v-7.5ZM3.5 16h17M10.5 10l-1 2m3.5-.5-1 2"/>',
    beauty:'<rect x="7.5" y="11" width="9" height="9.5" rx="1.5"/><path d="M9.5 11V6l5-2.5V11m-7 5.5h9"/>',
    device:'<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M12 16.5v4m-4 0h8"/>',
    watch:'<rect x="6.5" y="6.5" width="11" height="11" rx="3.5"/><path d="m8.5 6.5.75-3h5.5l.75 3m-7 11 .75 3h5.5l.75-3M12 9.5v3l2 1"/>',
    lamp:'<path d="M8 4h8l3.5 9h-15L8 4Zm4 9v7m-4 0h8M17 13v3"/>',
    sport:'<rect x="5" y="5.5" width="3.5" height="13" rx="1.5"/><rect x="15.5" y="5.5" width="3.5" height="13" rx="1.5"/><path d="M8.5 12h7M2.5 9v6m19-6v6"/>',
    leaf:'<path d="M19.5 4.5c-7-1-14 1-14 7.5a6.5 6.5 0 0 0 6.5 6.5c6.5 0 8.5-7 7.5-14ZM4.5 20l10-10"/>'
  });
  const categories = Object.freeze({Fashion:'shirt',Shoes:'shoe',Electronics:'device',Beauty:'beauty',Accessories:'watch',Home:'lamp',Sports:'sport',Lifestyle:'leaf'});
  function render(name, extra = '') {
    const key = typeof name === 'string' && Object.hasOwn(paths, name) ? name : 'info';
    const classes = typeof extra === 'string' ? extra.slice(0, 120).split(/\s+/).filter(value => /^[a-z][a-z0-9-]*$/i.test(value)).join(' ') : '';
    return '<svg class="icon'+(classes?' '+classes:'')+'" data-icon="'+key+'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+paths[key]+'</svg>';
  }
  return Object.freeze({paths,categories,render});
});
