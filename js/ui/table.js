// Virtualised grid. Only the rows and columns in view exist in the DOM, and row elements are
// recycled while scrolling, so scroll cost does not depend on the row count. Rows live in a sticky
// viewport and are placed relative to it, so a very fast scroll can never reveal a blank area.
(function () {
  'use strict';
  const { h, icon, byId } = GL.ui;
  const model = GL.model;
  const ROW_HEIGHT = 26, HEAD_HEIGHT = 30, GUTTER = 62, OVERSCAN_ROWS = 6, OVERSCAN_PX = 240;
  const TYPE_LABEL = { number: 'Number', date: 'Date', boolean: 'True or false', text: 'Text' };

  const grid = {
    root: null, head: null, body: null, viewport: null, empty: null,
    pool: [], offsets: [], columnRange: [0, 0], rowRange: [0, 0], frame: 0,
    active: { row: 0, col: 0, on: false },
  };

  function columnOffsets() {
    const offsets = [GUTTER];
    for (const column of model.visibleColumns) offsets.push(offsets[offsets.length - 1] + column.width);
    grid.offsets = offsets;
  }

  function firstOffsetAtOrAfter(px) {
    let low = 0, high = grid.offsets.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (grid.offsets[mid + 1] <= px) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function visibleColumnRange() {
    const left = grid.root.scrollLeft - OVERSCAN_PX;
    const right = grid.root.scrollLeft + grid.root.clientWidth + OVERSCAN_PX;
    const start = firstOffsetAtOrAfter(Math.max(GUTTER, left));
    const end = Math.min(model.visibleColumns.length, firstOffsetAtOrAfter(right) + 1);
    return [start, end];
  }

  function visibleRowRange() {
    const top = grid.root.scrollTop;
    const height = grid.root.clientHeight - HEAD_HEIGHT;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS);
    const last = Math.min(model.rowIndex.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN_ROWS);
    return [first, Math.max(first, last)];
  }

  /** Text shown in a cell. Dates are normalised; anything else stays exactly as written in the file. */
  function cellText(column, row) {
    if (column.type === 'date' && column.values[row] !== null) return GL.types.formatDateMs(column.values[row]);
    return column.raw[row];
  }

  /** A null can be a blank, a token such as N/A, or a value that does not fit a manually chosen type. */
  function emptyCellClass(raw) {
    if (raw.trim() === '') return ' is-null';
    return GL.types.isNullToken(raw) ? ' is-token' : ' is-invalid';
  }

  function cellClass(column, row, position, columnIndex) {
    let name = `cell cell-${column.type}`;
    if (column.values[row] === null) name += emptyCellClass(column.raw[row]);
    if (grid.active.on && grid.active.row === position && grid.active.col === columnIndex) name += ' is-active';
    return name;
  }

  function createRowSlot() {
    const gutter = h('div', { class: 'cell gutter', role: 'rowheader' });
    const node = h('div', { class: 'row', role: 'row' }, gutter);
    node.style.display = 'none';
    grid.viewport.append(node);
    return { node, gutter, cells: [], position: -1 };
  }

  function ensurePool(size) {
    while (grid.pool.length < size) grid.pool.push(createRowSlot());
  }

  function fitCellCount(slot, count) {
    while (slot.cells.length < count) {
      const cell = h('div', { role: 'gridcell' });
      slot.cells.push(cell);
      slot.node.append(cell);
    }
    while (slot.cells.length > count) slot.cells.pop().remove();
  }

  function paintRow(slot, position, start, end) {
    const row = model.rowIndex[position];
    slot.position = position;
    slot.node.style.display = '';
    slot.node.setAttribute('aria-rowindex', String(position + 2));
    slot.gutter.textContent = String(row + 1);
    fitCellCount(slot, end - start);
    for (let index = start; index < end; index++) paintCell(slot.cells[index - start], index, row, position);
  }

  function paintCell(cell, columnIndex, row, position) {
    const column = model.visibleColumns[columnIndex];
    const text = cellText(column, row);
    if (cell.textContent !== text) cell.textContent = text;
    cell.className = cellClass(column, row, position, columnIndex);
    cell.style.left = `${grid.offsets[columnIndex]}px`;
    cell.style.width = `${column.width}px`;
    cell.setAttribute('aria-colindex', String(columnIndex + 2));
    cell.dataset.col = String(columnIndex);
    cell.dataset.pos = String(position);
    cell.title = text.length > 24 ? text : '';
    cell.id = cell.classList.contains('is-active') ? 'grid-active-cell' : '';
  }

  function paintRows(force) {
    const [first, last] = visibleRowRange();
    const [start, end] = visibleColumnRange();
    const moved = force || start !== grid.columnRange[0] || end !== grid.columnRange[1];
    if (moved || first !== grid.rowRange[0] || last !== grid.rowRange[1]) repaintRange(first, last, start, end, moved);
    positionRows();
  }

  function positionRows() {
    const top = grid.root.scrollTop;
    for (const slot of grid.pool) {
      if (slot.position >= 0) slot.node.style.transform = `translateY(${slot.position * ROW_HEIGHT - top}px)`;
    }
  }

  function repaintRange(first, last, start, end, moved) {
    ensurePool(last - first);
    const needed = new Set();
    for (let position = first; position < last; position++) needed.add(position);
    const free = [];
    for (const slot of grid.pool) {
      if (needed.has(slot.position)) needed.delete(slot.position);
      else free.push(slot);
    }
    for (const slot of grid.pool) {
      if (!moved || slot.position < first || slot.position >= last) continue;
      paintRow(slot, slot.position, start, end);
    }
    for (const position of needed) paintRow(free.pop(), position, start, end);
    for (const slot of free) { slot.position = -1; slot.node.style.display = 'none'; }
    grid.columnRange = [start, end];
    grid.rowRange = [first, last];
  }

  function onScroll() {
    if (grid.frame) return;
    grid.frame = requestAnimationFrame(() => {
      grid.frame = 0;
      paintRows(false);
      paintHeader(false);
    });
  }

  function typeGlyph(column) {
    const glyph = icon(column.computed ? 'function' : column.type, 13);
    glyph.classList.add('type-glyph');
    glyph.setAttribute('aria-hidden', 'false');
    glyph.setAttribute('role', 'img');
    glyph.setAttribute('aria-label', TYPE_LABEL[column.type]);
    glyph.title = column.computed ? `${TYPE_LABEL[column.type]}, computed` : TYPE_LABEL[column.type];
    return glyph;
  }

  function cycleSort(column) {
    const { sort } = model.view;
    if (!sort || sort.col !== column.name) model.setSort(column.name, 'asc');
    else if (sort.dir === 'asc') model.setSort(column.name, 'desc');
    else model.setSort(null, null);
  }

  function columnMenuItems(column) {
    return [
      { label: 'Sort ascending', icon: 'arrowUp', onSelect: () => model.setSort(column.name, 'asc') },
      { label: 'Sort descending', icon: 'arrowDown', onSelect: () => model.setSort(column.name, 'desc') },
      { label: 'Clear sort', disabled: !model.view.sort, onSelect: () => model.setSort(null, null) },
      'separator',
      { label: 'Show profile', onSelect: () => { model.select(column.name); GL.inspector.show('profile'); } },
      { label: 'Filter this column', onSelect: () => { GL.filtersPanel.addFor(column.name); } },
      { label: 'Hide column', icon: 'eyeOff', onSelect: () => model.setHidden([column.name], true) },
    ];
  }

  function startResize(event, column, cell) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX, startWidth = column.width;
    handle.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => {
      model.setWidth(column.name, startWidth + moveEvent.clientX - startX);
      cell.style.width = `${column.width}px`;
      relayout();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function resizeHandle(column, cell) {
    return h('div', {
      class: 'resize-handle', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical',
      'aria-label': `Resize ${column.name}`, 'aria-valuenow': column.width,
      onpointerdown: (event) => startResize(event, column, cell),
      onkeydown: (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        model.setWidth(column.name, column.width + (event.key === 'ArrowRight' ? 12 : -12));
        relayout();
        paintHeader(true);
      },
    });
  }

  function headerCell(column, index) {
    const { sort, selected } = model.view;
    const sorted = sort && sort.col === column.name ? sort.dir : null;
    const label = h('button', {
      class: 'head-name', type: 'button', title: `${column.name}: click to sort`,
      onclick: () => { model.select(column.name); cycleSort(column); },
    }, h('span', { class: 'head-text', text: column.name }));
    const arrow = sorted ? icon(sorted === 'asc' ? 'arrowUp' : 'arrowDown', 12) : null;
    if (arrow) arrow.classList.add('sort-arrow');
    const menuButton = h('button', {
      class: 'head-menu', type: 'button', 'aria-label': `Options for ${column.name}`, 'aria-haspopup': 'menu',
      onclick: (event) => GL.ui.menu(event.currentTarget, columnMenuItems(column), `Options for ${column.name}`),
    }, icon('dots', 14));
    const cell = h('div', {
      class: `head-cell cell-${column.type}${selected === column.name ? ' is-selected' : ''}`, role: 'columnheader',
      'aria-colindex': index + 2, 'aria-sort': sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none',
      'data-name': column.name, 'data-type': column.type,
    }, typeGlyph(column), label, arrow, menuButton);
    cell.style.left = `${grid.offsets[index]}px`;
    cell.style.width = `${column.width}px`;
    cell.append(resizeHandle(column, cell));
    return cell;
  }

  function paintHeader(force) {
    const [start, end] = visibleColumnRange();
    if (!force && grid.headRange && grid.headRange[0] === start && grid.headRange[1] === end) return;
    grid.headRange = [start, end];
    const corner = h('div', { class: 'head-cell gutter', role: 'columnheader', 'aria-colindex': '1', text: 'Row' });
    const cells = [corner];
    for (let index = start; index < end; index++) cells.push(headerCell(model.visibleColumns[index], index));
    const focused = grid.head.contains(document.activeElement) ? document.activeElement : null;
    const owner = focused && focused.closest('.head-cell');
    const restore = owner ? { name: owner.dataset.name, control: focused.className } : null;
    grid.head.replaceChildren(...cells);
    if (restore) refocusHeader(restore);
  }

  function refocusHeader({ name, control }) {
    for (const cell of grid.head.children) {
      if (cell.dataset.name !== name) continue;
      const again = Array.from(cell.querySelectorAll('button, [tabindex]')).find((node) => node.className === control);
      if (again) again.focus();
    }
  }

  function setSizes() {
    columnOffsets();
    const width = grid.offsets[grid.offsets.length - 1];
    grid.head.style.width = `${width}px`;
    grid.body.style.width = `${width}px`;
    const bodyHeight = model.rowIndex.length * ROW_HEIGHT;
    grid.body.style.height = `${bodyHeight}px`;
    grid.viewport.style.height = `${Math.min(bodyHeight, Math.max(0, grid.root.clientHeight - HEAD_HEIGHT))}px`;
    grid.root.setAttribute('aria-rowcount', String(model.rowIndex.length + 1));
    grid.root.setAttribute('aria-colcount', String(model.visibleColumns.length + 1));
  }

  /** Column widths changed: every painted row moves, but the row content is unchanged. */
  function relayout() {
    setSizes();
    grid.columnRange = [-1, -1];
    paintRows(true);
    if (grid.head.children.length) syncHeaderPositions();
  }

  function syncHeaderPositions() {
    for (const cell of grid.head.children) {
      const name = cell.dataset.name;
      if (name === undefined) continue;
      const index = model.visibleColumns.findIndex((c) => c.name === name);
      if (index < 0) continue;
      cell.style.left = `${grid.offsets[index]}px`;
      cell.style.width = `${model.visibleColumns[index].width}px`;
    }
  }

  function renderEmptyState() {
    const { dataset, rowIndex, visibleColumns, view } = model;
    grid.empty.replaceChildren();
    let message = '';
    let action = null;
    if (!visibleColumns.length) {
      message = 'All columns are hidden.';
      action = h('button', { class: 'btn', type: 'button', text: 'Show all columns', onclick: () => model.setHidden(view.hidden, false) });
    } else if (dataset.parsed.rowCount === 0) {
      message = 'This file has a header row but no data rows.';
    } else if (!rowIndex.length) {
      message = 'No rows match the current filters and search.';
      action = h('button', { class: 'btn', type: 'button', text: 'Clear filters and search', onclick: () => GL.filtersPanel.clearAll() });
    }
    grid.empty.hidden = !message;
    if (message) grid.empty.append(h('p', { text: message }), action || '');
  }

  /** Rows changed: reset scroll-independent state, then repaint whatever is on screen. */
  function refresh() {
    if (!model.dataset) return;
    setSizes();
    grid.active.row = Math.min(grid.active.row, Math.max(0, model.rowIndex.length - 1));
    grid.active.col = Math.min(grid.active.col, Math.max(0, model.visibleColumns.length - 1));
    const maxTop = Math.max(0, model.rowIndex.length * ROW_HEIGHT - (grid.root.clientHeight - HEAD_HEIGHT));
    if (grid.root.scrollTop > maxTop) grid.root.scrollTop = maxTop;
    grid.columnRange = [-1, -1];
    for (const slot of grid.pool) slot.position = -1;
    for (const slot of grid.pool) slot.node.style.display = 'none';
    paintRows(true);
    paintHeader(true);
    renderEmptyState();
    syncActiveDescendant();
  }

  function syncActiveDescendant() {
    if (grid.active.on && document.getElementById('grid-active-cell')) grid.root.setAttribute('aria-activedescendant', 'grid-active-cell');
    else grid.root.removeAttribute('aria-activedescendant');
  }

  function revealActive() {
    const { row, col } = grid.active;
    const top = row * ROW_HEIGHT;
    const viewTop = grid.root.scrollTop, viewHeight = grid.root.clientHeight - HEAD_HEIGHT;
    if (top < viewTop) grid.root.scrollTop = top;
    else if (top + ROW_HEIGHT > viewTop + viewHeight) grid.root.scrollTop = top + ROW_HEIGHT - viewHeight;
    const left = grid.offsets[col], right = grid.offsets[col + 1];
    const viewLeft = grid.root.scrollLeft + GUTTER, viewRight = grid.root.scrollLeft + grid.root.clientWidth;
    if (left < viewLeft) grid.root.scrollLeft = left - GUTTER;
    else if (right > viewRight) grid.root.scrollLeft = right - grid.root.clientWidth;
  }

  function moveActive(row, col) {
    const maxRow = model.rowIndex.length - 1, maxCol = model.visibleColumns.length - 1;
    if (maxRow < 0 || maxCol < 0) return;
    grid.active = { row: Math.max(0, Math.min(maxRow, row)), col: Math.max(0, Math.min(maxCol, col)), on: true };
    revealActive();
    grid.columnRange = [-1, -1];
    paintRows(true);
    syncActiveDescendant();
    announceActive();
  }

  function announceActive() {
    const column = model.visibleColumns[grid.active.col];
    if (!column) return;
    const row = model.rowIndex[grid.active.row];
    GL.statusBar.showCell(column.name, row + 1, cellText(column, row));
    if (model.view.selected !== column.name) model.select(column.name);
  }

  function onKeydown(event) {
    if (event.target !== grid.root) return;
    const { row, col } = grid.active;
    const page = Math.max(1, Math.floor((grid.root.clientHeight - HEAD_HEIGHT) / ROW_HEIGHT) - 1);
    const moves = {
      ArrowDown: [row + 1, col], ArrowUp: [row - 1, col], ArrowRight: [row, col + 1], ArrowLeft: [row, col - 1],
      PageDown: [row + page, col], PageUp: [row - page, col],
      Home: event.ctrlKey ? [0, 0] : [row, 0],
      End: event.ctrlKey ? [model.rowIndex.length - 1, model.visibleColumns.length - 1] : [row, model.visibleColumns.length - 1],
    };
    const target = moves[event.key];
    if (!target) return;
    event.preventDefault();
    moveActive(target[0], target[1]);
  }

  function onBodyClick(event) {
    const cell = event.target.closest('[role="gridcell"]');
    if (!cell) return;
    moveActive(Number(cell.dataset.pos), Number(cell.dataset.col));
    grid.root.focus({ preventScroll: true });
  }

  function init() {
    grid.root = byId('grid');
    grid.head = h('div', { class: 'grid-head', role: 'row', 'aria-rowindex': '1' });
    grid.viewport = h('div', { class: 'grid-viewport' });
    grid.body = h('div', { class: 'grid-body', role: 'rowgroup' }, grid.viewport);
    grid.empty = h('div', { class: 'grid-empty', hidden: true });
    grid.root.append(grid.head, grid.body);
    byId('tab-table').append(grid.empty);
    grid.root.addEventListener('scroll', onScroll, { passive: true });
    grid.root.addEventListener('keydown', onKeydown);
    grid.root.addEventListener('focus', () => {
      if (!grid.active.on && model.rowIndex.length && grid.root.matches(':focus-visible')) moveActive(grid.active.row, grid.active.col);
    });
    grid.body.addEventListener('click', onBodyClick);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { if (model.dataset) { setSizes(); paintRows(true); paintHeader(false); } }).observe(grid.root);
    }
    model.on('dataset', () => {
      grid.root.scrollTop = 0;
      grid.root.scrollLeft = 0;
      grid.active = { row: 0, col: 0, on: false };
      refresh();
    });
    model.on('columns', refresh);
    model.on('rows', refresh);
    model.on('view', () => paintHeader(true));
  }

  GL.table = { init, refresh };
})();
