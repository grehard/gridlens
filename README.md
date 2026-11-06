# Gridlens

A private data explorer: open a CSV in the browser and get answers without a spreadsheet or an upload.

Author: Grehard

## Features

- RFC 4180 CSV parsing: quoted commas and newlines, escaped quotes, BOM, and detection of comma, semicolon and tab delimiters
- Parsing in a Web Worker, with an automatic fallback to the main thread when workers are unavailable (Chrome under `file://`)
- Drag and drop or file picker, plus three generated sample datasets and a 100,000-row stress dataset
- Column type inference (number, date, boolean, text) with manual override
- Virtualised table with sort, resize, hide and keyboard navigation
- Column profile: empties, unique count, min, max, mean, median, sum, histogram or top values
- Filter builder with AND conditions per type, plus text search
- Pivot with up to two row groupings, a column split, and sum, average, count, min and max
- Bar, line, scatter and histogram charts with axes, tooltips, keyboard access and a table view
- Computed columns in a small formula language
- Saved views, remembered recent files, and JSON export and import of views
- Export filtered rows or pivot results as CSV, and charts as PNG

Files never leave the browser. There is no server and the app makes no network requests.

## How to run

Open `index.html`, or serve the folder with any static file server.

## How the code is organized

- `js/core/`: logic with no DOM access. CSV (`csv.js`), type inference (`types.js`), the parse pipeline and worker (`parse-job.js`, `parse-worker.js`), statistics, filters, pivot, the formula language (`expr-parser.js`, `expr-functions.js`, `expr.js`), sample data and chart data.
- `js/ui/`: the interface. `model.js` holds the open dataset and view and is the only place state changes. `table.js` is the virtual grid, `chart-draw.js` the canvas renderer, and the `panel-*.js` files are the inspector tabs.
- `js/app.js`: startup, opening datasets, and top-level controls.
- `css/`: tokens and controls, layout, grid, panels, analysis views.

## Key engineering decisions

- **The parser is resumable.** `CsvReader.step()` consumes a budget of characters, so the same code posts progress from a worker or yields to the event loop on the main thread. Rows are stored by column to keep large files compact.
- **Inference requires every value to fit.** A column is a number only if all non-empty values parse. Values with leading zeros stay text because they are identifiers. In text columns only blanks are empty, because "NA" may be a region code.
- **The grid recycles a small pool of row elements.** Row and column ranges are computed from the scroll position, so scrolling cost does not depend on the row count.
- **Formulas cannot reach JavaScript.** The grammar has no property access, indexing, assignment or statements. Names resolve through Maps against the column list and a fixed function table, and the checker rejects type errors before anything runs. There is no `eval` or `Function`.
- **Totals come from raw values.** A pivot's total average is the true average rather than an average of group averages.
- **Dates are UTC wall-clock milliseconds,** so a file gives the same values in every time zone.
- **Series colors follow the entity.** Series are chosen from all rows, not filtered ones, so a filter never repaints what remains.
- **Storage is treated as unreliable.** Every read and write is guarded, the oldest remembered files are evicted when the quota is full, and the UI says when a file is open for this session only.

## Formula language

`round(total - quantity * unit_cost, 2)`, `if(status = 'Returned', 0, total)`, `ship_date - order_date`, `[Column with spaces] > 10 and not reopened`.

Operators: `+ - * / %`, `= != < <= > >=`, `and or not`. Blank cells produce blank results, and dividing by zero gives a blank.
