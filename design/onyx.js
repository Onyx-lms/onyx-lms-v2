/* ==========================================================================
   Onyx LMS prototypes — shared icon sprite + the two interactions the static
   screens actually need.

   The sprite is injected rather than referenced as an external <use href>
   because these files are opened straight off disk (file://), where a
   cross-file SVG reference is blocked in every browser worth testing in.

   One sprite, one stroke weight, one 24px grid: the icons are the thing that
   most obviously reads as "unfinished" when each screen picks its own.
   ========================================================================== */
(function () {
  var ICONS = {
    home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/>',
    book:      '<path d="M4 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
    code:      '<path d="m8.5 8.5-4 3.5 4 3.5"/><path d="m15.5 8.5 4 3.5-4 3.5"/><path d="m13.5 5-3 14"/>',
    layers:    '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    edit:      '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    award:     '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7"/>',
    trophy:    '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5v1.5a3 3 0 0 0 3 3"/><path d="M17 6h2.5v1.5a3 3 0 0 1-3 3"/><path d="M12 14v3.5"/><path d="M8.5 20.5h7"/><path d="M10 17.5h4v3h-4z"/>',
    calendar:  '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
    wallet:    '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
    help:      '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4"/><path d="M12 17.2v.1"/>',
    briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/>',
    mic:       '<rect x="9.5" y="3" width="5" height="10" rx="2.5"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/>',
    user:      '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    users:     '<circle cx="9" cy="8.5" r="3.4"/><path d="M2.5 20a6.6 6.6 0 0 1 13 0"/><path d="M16 5.4a3.4 3.4 0 0 1 0 6.3"/><path d="M17.5 14.2A6.6 6.6 0 0 1 21.5 20"/>',
    menu:      '<path d="M4 7h16M4 12h16M4 17h16"/>',
    bell:      '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    play:      '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    chevron:   '<path d="m9.5 5.5 7 6.5-7 6.5"/>',
    dots:      '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    check:     '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>',
    chart:     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    flag:      '<path d="M5.5 21V4.5h13l-2.5 4 2.5 4h-13"/>',
    shield:    '<path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z"/>',
    building:  '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2"/><path d="M10 20.5v-4h4v4"/>',
    save:      '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h8V4"/><path d="M8 20v-6h8v6"/>',
    camera:    '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v11H4z"/><circle cx="12" cy="14" r="3.5"/>',
    trash:     '<path d="M5 7h14"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M7 7l1 13h8l1-13"/>',
    search:    '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    filter:    '<path d="M3.5 6h17l-6.5 7.5V20l-4-2v-4.5z"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    download:  '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    upload:    '<path d="M12 20V9"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/>',
    mail:      '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    lock:      '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    eye:       '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    alert:     '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17v.1"/>',
    x:         '<path d="M6 6l12 12M18 6 6 18"/>',
    arrow:     '<path d="M4 12h15"/><path d="m14 7 5 5-5 5"/>',
    external:  '<path d="M14 4h6v6"/><path d="m20 4-8.5 8.5"/><path d="M18 14v5.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 3 19.5v-12A1.5 1.5 0 0 1 4.5 6H10"/>',
    star:      '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z"/>',
    message:   '<path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5z"/>',
    video:     '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 11 5.5-3v8l-5.5-3z"/>',
    grid:      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
    list:      '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5v.1M4 12v.1M4 17.5v.1"/>',
    refresh:   '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v5h-5"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8"/>',
    logout:    '<path d="M9.5 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4h4"/><path d="M15 8.5 19 12l-4 3.5"/><path d="M19 12H9.5"/>',
    card:      '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
    file:      '<path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z"/><path d="M13 3.5V9h5.5"/>',
    pie:       '<path d="M12 3v9h9a9 9 0 1 0-9-9z"/><path d="M21 12a9 9 0 0 1-9 9"/>',
    target:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    sparkle:   '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5 19 17l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 17l1.5-.5z"/>'
  };

  var svg = '<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">';
  for (var k in ICONS) {
    if (Object.prototype.hasOwnProperty.call(ICONS, k)) {
      svg += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + '</symbol>';
    }
  }
  svg += '</svg>';

  function inject() {
    var host = document.createElement('div');
    host.innerHTML = svg;
    document.body.insertBefore(host.firstChild, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
