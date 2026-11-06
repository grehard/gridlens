// Filter builder. Conditions are always ANDed. Typing updates only the row count and the
// error message in place, so the input being typed in keeps its focus.
(function () {
  'use strict';
  const { h, byId, clear, select, icon } = GL.ui;
  const model = GL.model;
  const F = GL.filter;
  const applySoon = GL.ui.debounce(() => model.setFilters(model.view.filters), 140);

  function inputKind(type) { return type === 'date' ? 'date' : 'text'; }

  function newCondition(columnName) {
    const column = model.column(columnName) || model.visibleColumns[0] || model.columns[0];
    return { col: column.name, op: F.defaultOperator(column.type), a: '', b: '' };
  }

  function showErrorOn(row, condition) {
    const message = F.validate(condition, model.column(condition.col));
    const error = row.querySelector('.condition-error');
    const touched = condition.a !== '' || condition.b !== '';
    const visible = message && (touched || !model.column(condition.col));
    error.textContent = visible ? message : '';
    error.hidden = !visible;
    row.classList.toggle('is-invalid', !!visible);
    row.querySelectorAll('input').forEach((input) => {
      input.setAttribute('aria-invalid', visible ? 'true' : 'false');
    });
  }

  function valueInput(condition, key, label, row) {
    const column = model.column(condition.col);
    const kind = inputKind(column.type);
    return h('input', {
      type: kind, class: 'condition-value', value: condition[key], 'aria-label': `${label} for ${condition.col}`,
      placeholder: column.type === 'number' ? 'Number' : column.type === 'text' ? 'Text' : null,
      inputmode: column.type === 'number' ? 'decimal' : null,
      'data-part': key, autocomplete: 'off',
      oninput: (event) => {
        condition[key] = event.target.value;
        showErrorOn(row(), condition);
        applySoon();
      },
    });
  }

  function columnOptions(condition) {
    const options = model.columns.map((c) => ({ value: c.name, label: c.name }));
    if (!model.column(condition.col)) options.unshift({ value: condition.col, label: `${condition.col} (missing)`, disabled: true });
    return options;
  }

  function conditionRow(condition, index) {
    const column = model.column(condition.col);
    let rowNode = null;
    const columnSelect = select(columnOptions(condition), condition.col, {
      class: 'condition-col', 'aria-label': `Column for condition ${index + 1}`,
      onchange: (event) => {
        const next = model.column(event.target.value);
        Object.assign(condition, { col: next.name, op: F.defaultOperator(next.type), a: '', b: '' });
        model.setFilters(model.view.filters);
        render();
      },
    });
    const removeButton = h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': `Remove condition ${index + 1}`,
      onclick: () => { model.view.filters.splice(index, 1); model.setFilters(model.view.filters); render(); },
    }, icon('close', 14));
    const parts = [h('div', { class: 'condition-top' }, columnSelect, removeButton)];
    if (column) {
      const operators = F.operatorsFor(column.type);
      const operatorSelect = select(operators.map((o) => ({ value: o.id, label: o.label })), condition.op, {
        class: 'condition-op', 'aria-label': `Operator for ${condition.col}`,
        onchange: (event) => {
          condition.op = event.target.value;
          model.setFilters(model.view.filters);
          render();
        },
      });
      const op = F.operator(column.type, condition.op) || operators[0];
      const inputs = [];
      if (op.arity >= 1) inputs.push(valueInput(condition, 'a', op.arity === 2 ? 'From' : 'Value', () => rowNode));
      if (op.arity === 2) {
        inputs.push(h('span', { class: 'and-word', text: 'and' }));
        inputs.push(valueInput(condition, 'b', 'To', () => rowNode));
      }
      parts.push(h('div', { class: 'condition-values' }, operatorSelect, inputs));
    }
    parts.push(h('p', { class: 'condition-error', role: 'alert', hidden: true }));
    rowNode = h('li', { class: 'condition', 'data-col': condition.col }, parts);
    showErrorOn(rowNode, condition);
    return rowNode;
  }

  function render() {
    const panel = byId('panel-filters');
    GL.ui.keepFocus(panel, () => fill(panel));
  }

  function fill(panel) {
    clear(panel);
    const { filters } = model.view;
    const addButton = h('button', {
      class: 'btn btn-small', type: 'button', id: 'add-filter', disabled: !model.columns.length,
      onclick: () => { addFor(model.view.selected); },
    }, icon('plus', 14), h('span', { text: 'Add condition' }));
    const clearButton = h('button', {
      class: 'btn btn-small', type: 'button', disabled: !filters.length && !model.view.search, id: 'clear-filters', text: 'Clear all',
      onclick: clearAll,
    });
    panel.append(
      h('div', { class: 'panel-actions' }, addButton, clearButton),
      filters.length
        ? h('ol', { class: 'condition-list', id: 'condition-list' }, filters.map(conditionRow))
        : h('p', { class: 'muted', text: 'No conditions yet. Rows must match every condition you add here, plus the search box.' }));
    if (filters.length > 1) panel.append(h('p', { class: 'muted', text: 'Rows must match all of these conditions.' }));
  }

  function focusLastCondition() {
    const items = byId('panel-filters').querySelectorAll('.condition');
    const last = items[items.length - 1];
    if (!last) return;
    const target = last.querySelector('.condition-value') || last.querySelector('.condition-op');
    if (target) target.focus();
  }

  function addFor(columnName) {
    model.view.filters.push(newCondition(columnName));
    model.setFilters(model.view.filters);
    render();
    GL.inspector.show('filters');
    GL.inspector.refreshBadges();
    focusLastCondition();
  }

  /** From a top-values row: boolean columns get is true/false, everything else an exact match. */
  function addValueFilter(column, label) {
    let condition = { col: column.name, op: 'equals', a: label, b: '' };
    if (column.type === 'boolean') condition = { col: column.name, op: label === 'true' ? 'isTrue' : 'isFalse', a: '', b: '' };
    model.view.filters.push(condition);
    model.setFilters(model.view.filters);
    render();
    GL.ui.toast(`Filtered ${column.name} to ${label}.`, {
      onUndo: () => {
        const at = model.view.filters.indexOf(condition);
        if (at >= 0) model.view.filters.splice(at, 1);
        model.setFilters(model.view.filters);
        render();
      },
    });
  }

  function clearAll() {
    const previous = { filters: model.view.filters, search: model.view.search };
    if (!previous.filters.length && !previous.search) return;
    byId('search').value = '';
    model.view.search = '';
    model.setFilters([]);
    render();
    GL.ui.toast('Filters and search cleared.', {
      onUndo: () => {
        byId('search').value = previous.search;
        model.view.search = previous.search;
        model.setFilters(previous.filters);
        render();
      },
    });
  }

  GL.filtersPanel = {
    init() {
      model.on('dataset', render);
      model.on('columns', render);
    },
    render, addFor, addValueFilter, clearAll,
  };
})();
