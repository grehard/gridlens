// Small DOM helpers. Strings always go in through textContent, so file contents can never become markup.
(function () {
  'use strict';
  const ui = (GL.ui = GL.ui || {});

  const ICONS = {
    upload: '<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10"/>',
    download: '<path d="M8 3v8M4.5 7.5 8 11l3.5-3.5M3 13h10"/>',
    sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
    moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    search: '<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    dots: '<circle cx="8" cy="3.5" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="8" cy="12.5" r=".6"/>',
    edit: '<path d="M3 13h2.5L13 5.5 10.5 3 3 10.5V13Z"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
    save: '<path d="M4 2.5h8v11L8 10.5l-4 3v-11Z"/>',
    eyeOff: '<path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.5M4.3 4.6C3 5.5 2 6.8 1.5 8c1 2.5 3.6 4.5 6.5 4.5 1.1 0 2.2-.3 3.1-.8M7 3.600A7 7 0 0 1 8 3.500c2.9 0 5.5 2 6.5 4.5-.3.7-.7 1.4-1.3 2"/>',
    check: '<path d="m3 8.5 3.5 3.500L13 4.5"/>',
    arrowUp: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    arrowDown: '<path d="M8 3v10M4 9l4 4 4-4"/>',
    table: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.500h12M2 10h12M6 6.500V13"/>',
    pivot: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M6 2.500v11"/>',
    chart: '<path d="M2.5 2.500v11h11M5.5 11V8M8.5 11V5M11.5 11V7"/>',
    bar: '<path d="M3 13.500V8M8 13.500V3M13 13.500V6"/>',
    line: '<path d="m2 11.5 4-4 3 2.5 5-6"/>',
    scatter: '<circle cx="4" cy="11" r="1"/><circle cx="7" cy="6.5" r="1"/><circle cx="10.5" cy="9.5" r="1"/><circle cx="12.5" cy="4" r="1"/>',
    histogram: '<path d="M2 13.500V9h3V5h3v3h3v2.500h3v3"/>',
    number: '<path d="M6 3 4.5 13M11.5 3 10 13M3 6.200h10.500M2.5 9.800H13"/>',
    date: '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6.500h11M5.5 2v3M10.5 2v3"/>',
    boolean: '<rect x="1.5" y="4.5" width="13" height="7" rx="3.5"/><circle cx="11" cy="8" r="1.8"/>',
    text: '<path d="M3 4.500V3h10v1.500M8 3v10M6 13h4"/>',
    function: '<path d="M11 3H9.500A1.5 1.5 0 0 0 8 4.500V11.500A1.5 1.5 0 0 1 6.5 13H5M5.5 7.500h5"/>',
  };

  function setProp(node, key, value) {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  /** Creates an element. Strings among the children become text nodes, never markup. */
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) for (const key of Object.keys(props)) setProp(node, key, props[key]);
    append(node, children);
    return node;
  }

  function append(node, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) append(node, child);
      else node.append(child);
    }
  }

  /** Icon markup comes only from the constant table above. */
  function icon(name, size = 16) {
    const holder = document.createElement('span');
    holder.className = 'icon';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return holder;
  }

  function clear(node) { node.replaceChildren(); }
  function byId(id) { return document.getElementById(id); }

  function select(options, value, props) {
    const node = h('select', props);
    for (const option of options) {
      node.append(h('option', { value: option.value, selected: option.value === value, disabled: option.disabled, text: option.label }));
    }
    node.value = value;
    return node;
  }

  /** A label and a control side by side or stacked, always correctly associated. */
  let fieldCounter = 0;
  function field(labelText, control, props) {
    if (!control.id) control.id = `gl-field-${++fieldCounter}`;
    return h('div', Object.assign({ class: 'field' }, props), h('label', { for: control.id, text: labelText }), control);
  }

  function plural(n, one, many) {
    return `${n.toLocaleString('en-US')} ${n === 1 ? one : many || `${one}s`}`;
  }

  function formatBytes(chars) {
    if (chars < 1024) return `${chars} B`;
    if (chars < 1048576) return `${(chars / 1024).toFixed(1)} KB`;
    return `${(chars / 1048576).toFixed(1)} MB`;
  }

  /** Blob download; used for every export. */
  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename, class: 'sr-only' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /** Re-rendering a panel replaces its controls; this puts focus back on the equivalent control. */
  function keepFocus(panel, render) {
    const active = document.activeElement;
    const identity = active && panel.contains(active) ? active.id || active.getAttribute('aria-label') : null;
    render();
    if (!identity) return;
    const match = Array.from(panel.querySelectorAll('button, input, select, textarea'))
      .find((node) => node.id === identity || node.getAttribute('aria-label') === identity);
    if (match) match.focus();
  }

  Object.assign(ui, { keepFocus, h, icon, clear, byId, select, field, plural, formatBytes, download, debounce });
})();
