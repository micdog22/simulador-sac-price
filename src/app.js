import {
  adjustmentNote,
  annualToMonthly,
  formatAmount,
  formatCompactMoney,
  formatDuration,
  formatMoney,
  formatPercent,
  monthlyToAnnual,
  niceTicks,
  parseDecimal,
  parseMoneyCents,
  scheduleCSV,
  simulate,
} from './financiamento.js';

const STORAGE_KEY = 'simulador-sac-price:v1';
const FIELDS = ['valorBem', 'entrada', 'valorFinanciado', 'juros', 'unidade', 'prazo', 'extra'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const form = document.getElementById('sim-form');
const chartBox = document.getElementById('grafico');
const chartReadout = document.getElementById('grafico-leitura');
const comparison = document.getElementById('comparacao');
const csvButton = document.getElementById('baixar-csv');
const csvStatus = document.getElementById('csv-status');
const tables = {
  sac: document.getElementById('detalhe-sac'),
  price: document.getElementById('detalhe-price'),
};
const staleTargets = [...document.querySelectorAll('#resultado .summary, #resultado .card, #ajustes')];

let current = null; // última simulação válida
let selectedMonth = null;
let chart = null;

const text = (id, value) => {
  document.getElementById(id).textContent = value;
};

function readForm() {
  const data = { mode: form.elements.mode.value };
  for (const name of FIELDS) data[name] = form.elements[name].value;
  return data;
}

function restoreForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    for (const name of FIELDS) {
      if (typeof saved[name] === 'string') form.elements[name].value = saved[name];
    }
    if (saved.mode === 'bem' || saved.mode === 'financiado') form.elements.mode.value = saved.mode;
  } catch {
    // Sem acesso ao armazenamento local: segue com os valores padrão.
  }
}

function saveForm(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Armazenamento indisponível (modo privado, cota cheia): ignorar.
  }
}

function syncMode() {
  const mode = form.elements.mode.value;
  for (const field of form.querySelectorAll('[data-mode]')) field.hidden = field.dataset.mode !== mode;
}

function showErrors(errors) {
  for (const name of FIELDS) {
    const input = form.elements[name];
    const slot = document.getElementById(`${name}-erro`);
    const error = errors.find((e) => e.field === name);
    if (slot) slot.textContent = error ? error.message : '';
    if (error) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function updateHints(data) {
  const rate = parseDecimal(data.juros, { allowThousands: false });
  let rateHint = '';
  if (Number.isFinite(rate) && rate >= 0) {
    rateHint = data.unidade === 'ano'
      ? `Equivale a ${formatPercent(annualToMonthly(rate / 100) * 100, 4)}% ao mês.`
      : `Equivale a ${formatPercent(monthlyToAnnual(rate / 100) * 100, 2)}% ao ano.`;
  }
  text('juros-info', rateHint);

  const months = parseDecimal(data.prazo, { allowThousands: false });
  text('prazo-info', Number.isInteger(months) && months >= 12 ? `${formatDuration(months)}.` : '');

  const asset = parseMoneyCents(data.valorBem);
  const down = data.entrada.trim() === '' ? 0 : parseMoneyCents(data.entrada);
  let downHint = '';
  if (asset > 0 && down >= 0 && down < asset) {
    const share = formatPercent(((asset - down) / asset) * 100, 0);
    downHint = `Valor financiado: ${formatMoney(asset - down)} (${share}% do bem).`;
  }
  text('entrada-info', downHint);
}

function setStale(stale) {
  for (const el of staleTargets) el.classList.toggle('is-stale', stale);
  csvButton.disabled = stale;
}

function update() {
  const data = readForm();
  syncMode();
  updateHints(data);
  saveForm(data);
  const result = simulate(data);
  showErrors(result.errors);
  if (!result.ok) {
    comparison.textContent = 'Corrija os campos destacados para ver a simulação.';
    comparison.classList.add('is-error');
    setStale(true);
    return;
  }
  comparison.classList.remove('is-error');
  setStale(false);
  current = result;
  comparison.textContent = result.comparison;
  for (const key of ['sac', 'price']) {
    const t = result[key].totals;
    text(`${key}-primeira`, formatMoney(t.first));
    text(`${key}-ultima`, formatMoney(t.last));
    text(`${key}-total`, formatMoney(t.paid));
    text(`${key}-juros`, formatMoney(t.interest));
    const details = tables[key];
    details.querySelector('summary').textContent = `Tabela ${key === 'sac' ? 'SAC' : 'Price'} (${result.input.months} parcelas)`;
    details.dataset.stale = 'true';
    if (details.open) renderTable(key);
  }
  text('ajustes', adjustmentNote(result.sac, result.price));
  if (selectedMonth !== null && selectedMonth > result.input.months) selectedMonth = result.input.months;
  renderChart();
}

/* ---------- Tabelas ---------- */

function cell(tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
}

function renderTable(key) {
  const details = tables[key];
  if (!current || details.dataset.stale !== 'true') return;
  const schedule = current[key];
  const hasExtra = schedule.totals.extras > 0;
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const title of ['Mês', 'Parcela (R$)', 'Amortização (R$)', 'Juros (R$)', ...(hasExtra ? ['Seguro e taxas (R$)'] : []), 'Saldo devedor (R$)']) {
    const th = cell('th', title);
    th.scope = 'col';
    head.append(th);
  }
  table.createTHead().append(head);
  const body = document.createElement('tbody');
  for (const row of schedule.rows) {
    const tr = document.createElement('tr');
    tr.append(cell('td', String(row.month)), cell('td', formatAmount(row.payment)), cell('td', formatAmount(row.amortization)), cell('td', formatAmount(row.interest)));
    if (hasExtra) tr.append(cell('td', formatAmount(row.extra)));
    tr.append(cell('td', formatAmount(row.balance)));
    body.append(tr);
  }
  table.append(body);
  const foot = table.createTFoot().insertRow();
  const t = schedule.totals;
  foot.append(cell('td', 'Total'), cell('td', formatAmount(t.paid)), cell('td', formatAmount(t.amortization)), cell('td', formatAmount(t.interest)));
  if (hasExtra) foot.append(cell('td', formatAmount(t.extras)));
  foot.append(cell('td', ''));
  details.querySelector('.table-wrap').replaceChildren(table);
  details.dataset.stale = 'false';
}

for (const key of Object.keys(tables)) {
  tables[key].addEventListener('toggle', () => {
    if (tables[key].open) renderTable(key);
  });
}

/* ---------- CSV ---------- */

csvButton.addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([`\ufeff${scheduleCSV(current.sac, current.price)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'simulacao-sac-price.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  csvStatus.textContent = 'Arquivo simulacao-sac-price.csv gerado (separador ";" e vírgula decimal, pronto para o Excel).';
});

/* ---------- Gráfico ---------- */

function svgEl(name, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (parent) parent.append(el);
  return el;
}

function monthTicks(months, maxTicks) {
  const step = [1, 2, 3, 6, 12, 24, 36, 60, 120].find((s) => months / s <= maxTicks) || 120;
  const ticks = [1];
  for (let m = step; m <= months; m += step) if (m !== 1) ticks.push(m);
  return ticks;
}

function renderChart() {
  if (!current) return;
  const width = Math.max(chartBox.clientWidth, 280);
  const height = Math.round(Math.min(340, Math.max(220, width * 0.45)));
  const margin = { top: 12, right: 56, bottom: 30, left: 76 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const { months } = current.input;
  const sac = current.sac.rows.map((r) => r.payment / 100);
  const price = current.price.rows.map((r) => r.payment / 100);
  const ticks = niceTicks(Math.max(...sac, ...price), 4);
  const yMax = ticks[ticks.length - 1];
  const x = (month) => margin.left + (months === 1 ? plotW / 2 : ((month - 1) / (months - 1)) * plotW);
  const y = (value) => margin.top + plotH - (value / yMax) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true', focusable: 'false' });
  for (const tick of ticks) {
    svgEl('line', { class: tick === 0 ? 'baseline' : 'gridline', x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick) }, svg);
    svgEl('text', { class: 'tick', x: margin.left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, svg).textContent = formatCompactMoney(tick);
  }
  const xTicks = monthTicks(months, Math.max(2, Math.floor(plotW / 56)));
  for (const month of xTicks) {
    svgEl('text', { class: 'tick', x: x(month), y: height - 8, 'text-anchor': 'middle' }, svg).textContent = String(month);
  }
  const lastTick = xTicks[xTicks.length - 1];
  const captionX = x(lastTick) + String(lastTick).length * 3.6 + 8;
  if (captionX + 28 <= width) {
    svgEl('text', { class: 'tick', x: captionX, y: height - 8, 'text-anchor': 'start' }, svg).textContent = 'mês';
  }

  const path = (values) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('');
  svgEl('path', { class: 'series series-price', d: path(price) }, svg);
  svgEl('path', { class: 'series series-sac', d: path(sac) }, svg);

  const endSac = y(sac[months - 1]);
  const endPrice = y(price[months - 1]);
  if (Math.abs(endSac - endPrice) >= 14) {
    svgEl('text', { class: 'end-label', x: width - margin.right + 8, y: endSac + 4 }, svg).textContent = 'SAC';
    svgEl('text', { class: 'end-label', x: width - margin.right + 8, y: endPrice + 4 }, svg).textContent = 'Price';
  }

  const crosshair = svgEl('line', { class: 'crosshair', y1: margin.top, y2: margin.top + plotH, visibility: 'hidden' }, svg);
  const dotPrice = svgEl('circle', { class: 'dot dot-price', r: 4.5, visibility: 'hidden' }, svg);
  const dotSac = svgEl('circle', { class: 'dot dot-sac', r: 4.5, visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: margin.left - 8, y: margin.top, width: plotW + 16, height: plotH, fill: 'transparent' }, svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  chartBox.replaceChildren(svg, tooltip);
  chart = { x, y, months, sac, price, width, margin, crosshair, dotSac, dotPrice, tooltip, hit };

  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const month = months === 1 ? 1 : Math.round(((px - margin.left) / plotW) * (months - 1)) + 1;
    showMonth(Math.min(months, Math.max(1, month)));
  });
  hit.addEventListener('pointerleave', () => {
    if (document.activeElement !== chartBox) hideMonth();
  });
  if (selectedMonth !== null && document.activeElement === chartBox) showMonth(selectedMonth);
}

function tooltipRow(label, value, keyClass) {
  const row = document.createElement('div');
  const key = document.createElement('span');
  key.className = `line-key ${keyClass}`;
  const strong = document.createElement('strong');
  strong.textContent = value;
  row.append(key, document.createTextNode(label), strong);
  return row;
}

function showMonth(month) {
  if (!chart) return;
  selectedMonth = month;
  const { x, y, sac, price, crosshair, dotSac, dotPrice, tooltip, width } = chart;
  const cx = x(month);
  crosshair.setAttribute('x1', cx);
  crosshair.setAttribute('x2', cx);
  dotSac.setAttribute('cx', cx);
  dotSac.setAttribute('cy', y(sac[month - 1]));
  dotPrice.setAttribute('cx', cx);
  dotPrice.setAttribute('cy', y(price[month - 1]));
  for (const el of [crosshair, dotSac, dotPrice]) el.setAttribute('visibility', 'visible');

  const sacValue = formatMoney(Math.round(sac[month - 1] * 100));
  const priceValue = formatMoney(Math.round(price[month - 1] * 100));
  const title = document.createElement('p');
  title.textContent = `Mês ${month}`;
  tooltip.replaceChildren(title, tooltipRow('SAC', sacValue, 'key-sac'), tooltipRow('Price', priceValue, 'key-price'));
  tooltip.hidden = false;
  const scale = chartBox.clientWidth / width;
  const left = cx * scale;
  const tipWidth = tooltip.offsetWidth;
  tooltip.style.left = `${left + 12 + tipWidth > chartBox.clientWidth ? Math.max(0, left - 12 - tipWidth) : left + 12}px`;
  chartReadout.textContent = `Mês ${month}: SAC ${sacValue}, Price ${priceValue}.`;
}

function hideMonth() {
  if (!chart) return;
  for (const el of [chart.crosshair, chart.dotSac, chart.dotPrice]) el.setAttribute('visibility', 'hidden');
  chart.tooltip.hidden = true;
}

chartBox.addEventListener('keydown', (event) => {
  if (!chart) return;
  const steps = { ArrowRight: 1, ArrowLeft: -1, PageDown: 12, PageUp: -12 };
  let month = selectedMonth ?? 1;
  if (event.key in steps) month += steps[event.key];
  else if (event.key === 'Home') month = 1;
  else if (event.key === 'End') month = chart.months;
  else return;
  event.preventDefault();
  showMonth(Math.min(chart.months, Math.max(1, month)));
});
chartBox.addEventListener('focus', () => showMonth(selectedMonth ?? 1));
chartBox.addEventListener('blur', hideMonth);

/* ---------- Inicialização ---------- */

let timer = null;
form.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(update, 200);
});
form.addEventListener('change', update);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  update();
});

let lastWidth = 0;
new ResizeObserver(() => {
  const width = chartBox.clientWidth;
  if (width !== lastWidth) {
    lastWidth = width;
    renderChart();
  }
}).observe(chartBox);

restoreForm();
update();
