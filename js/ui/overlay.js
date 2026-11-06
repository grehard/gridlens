// In-page modal, menu and toast. Plain positioned divs rather than <dialog> or the popover API.
(function () {
  'use strict';
  const { h, icon, byId } = GL.ui;
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';
  let openModalState = null;
  let openMenuState = null;
  let toastTimer = 0;

  function trapTab(event, container) {
    const items = Array.from(container.querySelectorAll(FOCUSABLE));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function closeModal() {
    if (!openModalState) return;
    const { backdrop, restore } = openModalState;
    openModalState = null;
    backdrop.remove();
    if (restore && restore.isConnected) restore.focus();
  }

  /** content is a node; footer buttons are supplied by the caller. Escape and the backdrop both close it. */
  function modal({ title, content, footer, wide }) {
    closeModal();
    const heading = h('h2', { id: 'modal-title', text: title });
    const closeButton = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: closeModal }, icon('close'));
    const box = h('div', { class: wide ? 'modal modal-wide' : 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
      h('div', { class: 'modal-head' }, heading, closeButton),
      h('div', { class: 'modal-body' }, content),
      footer ? h('div', { class: 'modal-foot' }, footer) : null);
    const backdrop = h('div', { class: 'modal-backdrop' }, box);
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) closeModal(); });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeModal(); }
      if (event.key === 'Tab') trapTab(event, box);
    });
    openModalState = { backdrop, restore: document.activeElement };
    byId('overlay-root').append(backdrop);
    const firstField = box.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || box.querySelector('.modal-foot button');
    if (firstField) firstField.focus();
    return { close: closeModal, box };
  }

  function confirmAction({ title, message, confirmLabel, onConfirm }) {
    const yes = h('button', { class: 'btn btn-danger', type: 'button', id: 'confirm-yes', text: confirmLabel, onclick: () => { closeModal(); onConfirm(); } });
    const no = h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeModal });
    modal({ title, content: h('p', { class: 'modal-text', text: message }), footer: [no, yes] });
  }

  function closeMenu() {
    if (!openMenuState) return;
    const { node, restore, onOutside } = openMenuState;
    openMenuState = null;
    node.remove();
    document.removeEventListener('mousedown', onOutside, true);
    if (restore && restore.isConnected) restore.focus();
  }

  function moveMenuFocus(node, delta) {
    const items = Array.from(node.querySelectorAll('button:not([disabled])'));
    const index = items.indexOf(document.activeElement);
    const next = items[(index + delta + items.length) % items.length];
    if (next) next.focus();
  }

  function placeMenu(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - size.width - 8, rect.right - size.width));
    const below = rect.bottom + 4;
    const top = below + size.height > window.innerHeight - 8 ? Math.max(8, rect.top - size.height - 4) : below;
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  /** items: [{ label, icon, onSelect, disabled } | 'separator'] */
  function menu(anchor, items, label) {
    closeMenu();
    const node = h('div', { class: 'menu', role: 'menu', 'aria-label': label });
    for (const item of items) {
      if (item === 'separator') { node.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      node.append(h('button', {
        type: 'button', role: 'menuitem', disabled: item.disabled, class: 'menu-item',
        onclick: () => { closeMenu(); item.onSelect(); },
      }, item.icon ? icon(item.icon, 14) : h('span', { class: 'icon-space' }), h('span', { text: item.label })));
    }
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); moveMenuFocus(node, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveMenuFocus(node, -1); }
      else if (event.key === 'Tab') closeMenu();
    });
    const onOutside = (event) => { if (!node.contains(event.target)) closeMenu(); };
    openMenuState = { node, restore: anchor, onOutside };
    byId('overlay-root').append(node);
    placeMenu(node, anchor);
    document.addEventListener('mousedown', onOutside, true);
    const first = node.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  function dismissToast() {
    clearTimeout(toastTimer);
    GL.ui.clear(byId('toast-root'));
  }

  /** Short message at the bottom. With onUndo it offers an Undo button for a few seconds. */
  function toast(message, { onUndo, kind = 'info', ms = 6000 } = {}) {
    dismissToast();
    const actions = onUndo
      ? h('button', { class: 'toast-action', type: 'button', text: 'Undo', onclick: () => { dismissToast(); onUndo(); } })
      : null;
    const node = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast-text', text: message }), actions,
      h('button', { class: 'icon-btn toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: dismissToast }, icon('close', 14)));
    byId('toast-root').append(node);
    toastTimer = setTimeout(dismissToast, ms);
  }

  Object.assign(GL.ui, { modal, closeModal, confirmAction, menu, toast });
})();
