// Generated sample datasets. A fixed seed makes each one repeatable, and dates are computed back
// from today. Every row is built from its parts, so derived fields always agree: a total is always
// quantity x price x (1 - discount), a resolved ticket always has a resolution time, and so on.
(function (root) {
  'use strict';
  const GL = (root.GL = root.GL || {});
  const DAY = 86400000;

  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(random, list) { return list[Math.floor(random() * list.length)]; }

  function weighted(random, entries) {
    let total = 0;
    for (const [, weight] of entries) total += weight;
    let roll = random() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** Standard normal draw (Box-Muller). */
  function gauss(random) {
    return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function isoMinute(ms) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  function todayUtc() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const PRODUCTS = [
    ['Furniture', 'Oak desk, 120 cm', 389, 214], ['Furniture', 'Oak desk, 160 cm', 489, 271],
    ['Furniture', 'Task chair, mesh back', 249, 118], ['Furniture', 'Bookcase, 5 shelves', 179, 92],
    ['Furniture', 'Filing cabinet, 3 drawers', 149, 81], ['Lighting', 'Desk lamp, brass', 69, 28],
    ['Lighting', 'Floor lamp, arc', 139, 63], ['Lighting', 'LED panel, 60 x 60 cm', 54, 24],
    ['Stationery', 'Notebook, A5 dotted', 9.5, 3.1], ['Stationery', 'Gel pens, box of 12', 14, 4.8],
    ['Stationery', 'Archive boxes, pack of 10', 26, 11], ['Stationery', 'Whiteboard, 90 x 60 cm', 58, 27],
    ['Electronics', 'Monitor arm, dual', 119, 58], ['Electronics', 'USB-C dock, 11 ports', 169, 96],
    ['Electronics', 'Conference speaker', 215, 122], ['Electronics', 'Wireless keyboard', 59, 26],
  ];
  const REGION_REPS = {
    North: ['Maren Holt', 'Tobias Renn'], South: ['Ines Vardy', 'Caleb Oyen'],
    East: ['Priya Sandhu', 'Lukas Bremer'], West: ['Noor Haddad', 'Elias Corwin', 'Greta Lindqvist'],
  };
  const SALES_NOTES = [
    'Leave at loading bay 2', 'Call before delivery', 'Invoice to head office, not branch',
    'Gift wrap, no price on slip', 'Deliver after 14:00', 'Customer asked for "matte" finish',
  ];

  function salesStatus(random, ageDays) {
    if (ageDays < 3) return weighted(random, [['Pending', 7], ['Shipped', 3]]);
    if (ageDays < 12) return weighted(random, [['Shipped', 7], ['Delivered', 3], ['Cancelled', 0.3]]);
    return weighted(random, [['Delivered', 92], ['Returned', 5], ['Cancelled', 3]]);
  }

  /** Order dates cluster toward recent months and year-end, so charts over time have a real shape. */
  function salesAgeDays(random, spanDays) {
    for (;;) {
      const age = Math.floor(Math.pow(random(), 1.12) * spanDays);
      const season = 1 + 0.35 * Math.cos(((age % 365) / 365) * 2 * Math.PI);
      if (random() * 1.35 <= season) return age;
    }
  }

  function salesRow(random, id, today, spanDays) {
    const age = salesAgeDays(random, spanDays);
    const orderMs = today - age * DAY;
    const region = weighted(random, [['West', 36], ['East', 27], ['North', 21], ['South', 16]]);
    const [category, product, listPrice, unitCost] = pick(random, PRODUCTS);
    const quantity = category === 'Stationery' ? 2 + Math.floor(random() * 40) : 1 + Math.floor(random() * random() * 12);
    const discount = weighted(random, [[0, 62], [5, 18], [10, 13], [15, 5], [20, 2]]);
    const total = round2(quantity * listPrice * (1 - discount / 100));
    const status = salesStatus(random, age);
    const shipDays = 1 + Math.floor(random() * 6);
    const hasShipped = status !== 'Pending' && status !== 'Cancelled' && shipDays <= age;
    const expedited = hasShipped && shipDays <= 1 && random() < 0.7;
    const note = random() < 0.07 ? pick(random, SALES_NOTES) : '';
    return [
      `SO-${100000 + id}`, isoDate(orderMs), hasShipped ? isoDate(orderMs + shipDays * DAY) : '',
      hasShipped || status === 'Pending' || status === 'Cancelled' ? status : 'Pending',
      region, pick(random, REGION_REPS[region]), category, product, quantity, listPrice, discount, total, unitCost,
      expedited ? 'yes' : 'no', note,
    ];
  }

  function salesOrders(rowCount) {
    const random = seededRandom(20240611);
    const today = todayUtc();
    const header = ['order_id', 'order_date', 'ship_date', 'status', 'region', 'sales_rep', 'category', 'product',
      'quantity', 'unit_price', 'discount_pct', 'total', 'unit_cost', 'expedited', 'customer_note'];
    const rows = [];
    for (let i = 1; i <= rowCount; i++) rows.push(salesRow(random, i, today, 730));
    rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return { header, rows };
  }

  // Invented stations: [name, climate zone, latitude, mean temperature, seasonal swing, wet-day chance].
  const STATIONS = [
    ['Saltfleet', 'Coastal', 53.4, 10.2, 6.5, 0.42], ['Highmoor', 'Upland', 57.1, 6.4, 8.5, 0.48],
    ['Karrow Ridge', 'Alpine', 46.8, 3.1, 11.5, 0.36], ['Dunmere', 'Temperate', 50.2, 11.3, 8.2, 0.33],
    ['Port Alder', 'Coastal', 44.6, 14.8, 7.4, 0.27], ['Vellacourt', 'Continental', 48.9, 10.6, 11.2, 0.24],
    ['Solana Flats', 'Arid', 36.2, 19.4, 9.8, 0.06],
  ];

  function weatherRow(random, station, ms, dayOfYear) {
    const [name, zone, latitude, mean, swing, wetChance] = station;
    const season = Math.cos(((dayOfYear - 200) / 365) * 2 * Math.PI);
    const average = mean + swing * season + gauss(random) * 2.4;
    const spread = 3.5 + random() * 5 + (zone === 'Arid' ? 4 : 0);
    const high = round1(average + spread / 2);
    const low = round1(average - spread / 2);
    const wet = random() < wetChance * (1 - 0.25 * season);
    const precipitation = wet ? round1(0.2 + Math.pow(random(), 2.2) * 34) : 0;
    const humidity = Math.min(100, Math.round((wet ? 80 : 58) + gauss(random) * 8 - (zone === 'Arid' ? 26 : 0)));
    const sensorDown = random() < 0.012;
    const wind = sensorDown ? '' : round1(Math.max(0, 14 + gauss(random) * 7 + (wet ? 6 : 0) + (zone === 'Coastal' ? 7 : 0)));
    const snow = wet && average <= 0.5;
    const condition = snow ? 'Snow' : wet ? 'Rain' : humidity > 66 ? 'Cloudy' : 'Clear';
    return [name, zone, latitude, isoDate(ms), high, low, round1((high + low) / 2), precipitation, wet, snow, wind, humidity, condition];
  }

  function weather(dayCount) {
    const random = seededRandom(5150251);
    const today = todayUtc();
    const header = ['station', 'climate_zone', 'latitude', 'date', 'temp_high_c', 'temp_low_c', 'temp_mean_c',
      'precip_mm', 'had_precip', 'snow', 'wind_kph', 'humidity_pct', 'conditions'];
    const rows = [];
    for (let back = dayCount; back >= 1; back--) {
      const ms = today - back * DAY;
      const dayOfYear = Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY);
      for (const station of STATIONS) rows.push(weatherRow(random, station, ms, dayOfYear));
    }
    return { header, rows };
  }

  const TEAMS = {
    Billing: {
      agents: ['Hana Mirel', 'Owen Tasker'],
      subjects: ['Invoice "INV-{n}" shows the wrong total', 'Charged twice for order {n}', 'Refund for {n} not received, 10 days on', 'Change billing address on account'],
    },
    Technical: {
      agents: ['Sefa Lund', 'Yara Benet', 'Marek Dole'],
      subjects: ['Export fails with error {n}', 'Login loop after password reset', 'Sync stuck at 98%, device {n}', 'App crashes when opening "Reports"'],
    },
    Account: {
      agents: ['Clio Astor', 'Ravi Thorne'],
      subjects: ['Add seats to plan, 5 more users', 'Transfer ownership to a new admin', 'Close account {n}', 'Merge duplicate profiles'],
    },
    Shipping: {
      agents: ['Dana Weir', 'Ilya Marsh'],
      subjects: ['Parcel {n} marked delivered, not received', 'Damaged on arrival, order {n}', 'Change delivery date for {n}', 'Wrong item in box, order {n}'],
    },
  };
  const PRIORITY_RESPONSE_MINUTES = { Urgent: 12, High: 45, Normal: 150, Low: 420 };
  const PRIORITY_HOURS = { Urgent: 5, High: 16, Normal: 36, Low: 80 };

  function ticketRow(random, id, nowMs, spanDays) {
    const age = Math.pow(random(), 1.15) * spanDays;
    const createdMs = Math.floor((nowMs - age * DAY) / 60000) * 60000;
    const team = weighted(random, [['Technical', 38], ['Billing', 26], ['Shipping', 22], ['Account', 14]]);
    const priority = weighted(random, [['Normal', 56], ['Low', 20], ['High', 18], ['Urgent', 6]]);
    const channel = weighted(random, [['Email', 44], ['Chat', 28], ['Web form', 18], ['Phone', 10]]);
    const firstResponse = Math.max(1, Math.round(PRIORITY_RESPONSE_MINUTES[priority] * (0.3 + random() * 1.5)));
    const hours = round2(Math.max(firstResponse / 60 + 0.1, PRIORITY_HOURS[priority] * (0.25 + Math.pow(random(), 2) * 3)));
    const finishedMs = createdMs + Math.round(hours * 3600000);
    const finished = finishedMs < nowMs && random() < 0.97;
    const responded = createdMs + firstResponse * 60000 < nowMs;
    const status = finished ? weighted(random, [['Closed', 80], ['Resolved', 20]]) : responded ? 'Pending' : 'Open';
    const csat = finished && random() < 0.55 ? Math.min(5, Math.max(1, Math.round(4.3 - hours / 90 + gauss(random) * 0.8))) : '';
    const subject = pick(random, TEAMS[team].subjects).replace('{n}', String(10000 + Math.floor(random() * 89999)));
    return [
      `TCK-${20000 + id}`, isoMinute(createdMs), channel, team, priority, status, subject, pick(random, TEAMS[team].agents),
      responded ? firstResponse : '', finished ? isoMinute(finishedMs) : '', finished ? hours : '',
      finished && random() < 0.08 ? 'true' : 'false', csat,
    ];
  }

  function supportTickets(rowCount) {
    const random = seededRandom(90210417);
    const nowMs = todayUtc() + 9 * 3600000;
    const header = ['ticket_id', 'created_at', 'channel', 'team', 'priority', 'status', 'subject', 'assignee',
      'first_response_min', 'resolved_at', 'resolution_hours', 'reopened', 'csat'];
    const rows = [];
    for (let i = 1; i <= rowCount; i++) rows.push(ticketRow(random, i, nowMs, 540));
    rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return { header, rows };
  }

  const CATALOG = [
    { id: 'sales', name: 'sales_orders.csv', label: 'Sales orders', rows: 12000, detail: '12,000 rows, 15 columns', build: () => salesOrders(12000) },
    { id: 'weather', name: 'station_weather.csv', label: 'Weather stations', rows: 5600, detail: '5,600 rows, 13 columns', build: () => weather(800) },
    { id: 'tickets', name: 'support_tickets.csv', label: 'Support tickets', rows: 6500, detail: '6,500 rows, 13 columns', build: () => supportTickets(6500) },
    { id: 'sales100k', name: 'sales_orders_100k.csv', label: 'Sales orders, large', rows: 100000, detail: '100,000 rows, for testing scroll speed', build: () => salesOrders(100000) },
  ];

  function sampleCsv(id) {
    const entry = CATALOG.find((c) => c.id === id);
    if (!entry) return null;
    const { header, rows } = entry.build();
    return GL.csv.stringify(header, rows.map((row) => row.map((cell) => (typeof cell === 'boolean' ? String(cell) : cell))));
  }

  GL.samples = { CATALOG, sampleCsv };
})(typeof self !== 'undefined' ? self : this);
