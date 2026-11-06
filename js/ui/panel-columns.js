// Column list (visibility, type override) and the computed-column editor.
(function () {
  'use strict';
  const { h, byId, clear, select, field, icon } = GL.ui;
  const model = GL.model;
  const TYPE_OPTIONS = [
    { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' },
    { value: 'boolean', label: 'True or false' }, { value: 'text', label: 'Text' },
  ];
  const PREVIEW_ROWS = 4;
  let query = '';

  function typeSelect(column) {
    return select(TYPE_OPTIONS, column.type, {
      class: 'column-type', 'aria-label': `Type of ${column.name}`, 'data-col': column.name,
      onchange: (event) => model.setType(column.name, event.target.value),
    });
  }

  function computedActions(column) {
    const index = model.view.computed.findIndex((c) => c.name === column.name);
    return h('span', { class: 'column-actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit ${column.name}`, onclick: () => openEditor(index) }, icon('edit', 14)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${column.name}`, onclick: () => deleteComputed(index) }, icon('trash', 14)));
  }

  function columnRow(column) {
    const checkbox = h('input', {
      type: 'checkbox', checked: !column.hidden, 'aria-label': `Show ${column.name}`,
      onchange: (event) => model.setHidden([column.name], !event.target.checked),
    });
    const label = h('label', { class: 'column-name', title: column.name }, checkbox, h('span', { text: column.name }));
    const changed = !column.computed && column.type !== column.inferred;
    const notes = [];
    if (column.error) notes.push(h('p', { class: 'error-note', text: column.error }));
    if (changed) {
      notes.push(h('p', { class: 'profile-note' },
        h('span', { text: `Detected as ${column.inferred}. ` }),
        h('button', { class: 'link-btn', type: 'button', text: 'Use detected type', onclick: () => model.setType(column.name, column.inferred) })));
    }
    return h('li', { class: 'column-row', 'data-name': column.name },
      h('div', { class: 'column-line' }, label, column.computed ? computedActions(column) : typeSelect(column)),
      notes);
  }

  function matchesQuery(column) {
    return !query || column.name.toLowerCase().includes(query.toLowerCase());
  }

  function renderList(list) {
    const matching = model.columns.filter(matchesQuery);
    list.replaceChildren(...matching.map(columnRow));
    if (!matching.length) list.append(h('li', { class: 'muted', text: 'No columns match.' }));
  }

  function render() {
    const panel = byId('panel-columns');
    GL.ui.keepFocus(panel, () => fill(panel));
  }

  function fill(panel) {
    clear(panel);
    const list = h('ul', { class: 'column-list', id: 'column-list' });
    const search = h('input', {
      type: 'search', placeholder: 'Find a column', 'aria-label': 'Find a column', class: 'panel-search', value: query,
      oninput: (event) => { query = event.target.value; renderList(list); },
    });
    panel.append(
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn btn-small', type: 'button', id: 'add-computed', onclick: () => openEditor(-1) }, icon('plus', 14), h('span', { text: 'Computed column' })),
        h('button', { class: 'btn btn-small', type: 'button', text: 'Show all', disabled: !model.view.hidden.length, onclick: () => model.setHidden(model.view.hidden, false) })),
      search, list);
    renderList(list);
  }

  function deleteComputed(index) {
    const removed = model.view.computed[index];
    model.setComputed(model.view.computed.filter((_, i) => i !== index));
    GL.ui.toast(`Deleted ${removed.name}.`, {
      onUndo: () => {
        const next = model.view.computed.slice();
        next.splice(index, 0, removed);
        model.setComputed(next);
      },
    });
  }

  /** Columns a formula at this position can see: all source columns and computed columns before it. */
  function scopeFor(index) {
    const limit = index < 0 ? model.view.computed.length : index;
    const allowed = new Set(model.view.computed.slice(limit).map((c) => c.name));
    return model.columns.filter((c) => !allowed.has(c.name));
  }

  function nameError(name, index) {
    const trimmed = name.trim();
    if (!trimmed) return 'Give the column a name.';
    if (trimmed.length > 60) return 'Keep the name under 60 characters.';
    const existing = model.column(trimmed);
    const editing = index >= 0 ? model.view.computed[index].name : null;
    if (existing && existing.name !== editing) return 'A column with this name already exists.';
    return null;
  }

  function previewRows(expression, scope) {
    const { type, run } = GL.expr.compile(expression, scope);
    const rows = Array.from(model.rowIndex.slice(0, PREVIEW_ROWS));
    return { type, samples: rows.map((row) => GL.types.formatValue(run(row), type) || '(empty)') };
  }

  function insertAtCursor(textarea, snippet) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    textarea.value = value.slice(0, start) + snippet + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
  }

  function columnReference(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `[${name}]`;
  }

  function insertableChips(label, items, onPick) {
    return h('div', { class: 'chips-block' },
      h('p', { class: 'chips-title', text: label }),
      h('div', { class: 'chips' }, items.map((item) => h('button', { class: 'chip', type: 'button', text: item, onclick: () => onPick(item) }))));
  }

  function openEditor(index) {
    const existing = index >= 0 ? model.view.computed[index] : null;
    const scope = scopeFor(index);
    const nameInput = h('input', { type: 'text', id: 'computed-name', value: existing ? existing.name : '', maxlength: '60', autocomplete: 'off' });
    const nameMessage = h('p', { class: 'error-note', id: 'computed-name-error', role: 'alert', hidden: true });
    const exprInput = h('textarea', { id: 'computed-expr', rows: '3', spellcheck: 'false', value: existing ? existing.expr : '', placeholder: 'quantity * unit_price' });
    const result = h('div', { class: 'expr-result', id: 'computed-result', 'aria-live': 'polite' });
    const save = h('button', { class: 'btn btn-primary', type: 'button', id: 'computed-save', text: existing ? 'Save column' : 'Add column' });

    const refresh = () => {
      clear(result);
      const check = exprInput.value.trim() ? GL.expr.check(exprInput.value, scope) : { ok: false, error: '' };
      if (!check.ok) {
        if (check.error) result.append(h('p', { class: 'error-note', id: 'computed-error', text: check.error }));
        else result.append(h('p', { class: 'muted', text: 'Formulas use column names, numbers, quoted text and the functions below.' }));
        return;
      }
      const { type, samples } = previewRows(exprInput.value, scope);
      result.append(h('p', { class: 'expr-ok', id: 'computed-preview', text: `Gives ${type}: ${samples.join(', ')}` }));
    };

    const submit = () => {
      const problem = nameError(nameInput.value, index);
      nameMessage.textContent = problem || '';
      nameMessage.hidden = !problem;
      const check = GL.expr.check(exprInput.value, scope);
      if (problem || !check.ok) { refresh(); if (!exprInput.value.trim()) result.replaceChildren(h('p', { class: 'error-note', id: 'computed-error', text: 'Enter a formula.' })); return; }
      const definition = { name: nameInput.value.trim(), expr: exprInput.value.trim() };
      if (existing) model.renameComputed(index, definition);
      else model.setComputed(model.view.computed.concat([definition]));
      model.select(definition.name);
      GL.ui.closeModal();
      GL.ui.toast(existing ? `Updated ${definition.name}.` : `Added ${definition.name}.`);
    };

    exprInput.addEventListener('input', refresh);
    save.addEventListener('click', submit);
    const content = h('div', { class: 'computed-form' },
      field('Column name', nameInput), nameMessage,
      field('Formula', exprInput), result,
      insertableChips('Columns', scope.map((c) => columnReference(c.name)), (item) => insertAtCursor(exprInput, item)),
      insertableChips('Functions', GL.exprFunctions.list(), (item) => insertAtCursor(exprInput, `${item.split('(')[0]}(`)));
    GL.ui.modal({
      title: existing ? `Edit ${existing.name}` : 'Add a computed column',
      wide: true, content,
      footer: [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: GL.ui.closeModal }), save],
    });
    refresh();
  }

  GL.columnsPanel = {
    init() {
      model.on('dataset', render);
      model.on('columns', render);
    },
    openEditor,
  };
})();
