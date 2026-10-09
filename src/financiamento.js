// Cálculos do simulador SAC × Price. Módulo puro (sem DOM).
// Valores monetários circulam como centavos inteiros para evitar erros de arredondamento.

export const MAX_MONTHS = 600;
export const MAX_MONTHLY_RATE = 1; // 100% ao mês
export const MAX_PRINCIPAL_CENTS = 1e12; // R$ 10 bilhões

const NBSP = '\u00a0';

/** Arredonda meio centavo para cima, tolerando o ruído do ponto flutuante. */
export function roundHalfUp(value) {
  const cleaned = Number(Math.abs(value).toFixed(6));
  return Math.sign(value) * Math.round(cleaned);
}

function isGrouped(text, separator) {
  const groups = text.split(separator);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

// Separa sinal, parte inteira e parte decimal de um número digitado.
function splitNumber(text, allowThousands) {
  let s = String(text).replace(/R\$/gi, '').replace(/[\s\u00a0%]/g, '');
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let int = s;
  let frac = '';

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    const at = s.lastIndexOf(decimalSep);
    int = s.slice(0, at);
    frac = s.slice(at + 1);
    if (int.includes(decimalSep) || !isGrouped(int, groupSep)) return null;
    int = int.split(groupSep).join('');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    [int, frac] = parts;
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    if (parts.length > 2) {
      if (!allowThousands || !isGrouped(s, '.')) return null;
      int = parts.join('');
    } else if (allowThousands && parts[0] !== '0' && isGrouped(s, '.')) {
      // No padrão brasileiro, "1.234" é mil duzentos e trinta e quatro.
      int = parts.join('');
    } else {
      [int, frac] = parts;
    }
  }
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac)) return null;
  return { sign, int: int || '0', frac };
}

/**
 * Lê números no padrão brasileiro ("1.234,56") ou com ponto decimal ("1234.56").
 * Com allowThousands, "1.234" vira 1234; sem ele (útil para taxas), vira 1,234.
 * Retorna NaN quando o texto não é um número válido.
 */
export function parseDecimal(text, { allowThousands = true } = {}) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : NaN;
  if (typeof text !== 'string') return NaN;
  const parts = splitNumber(text, allowThousands);
  if (!parts) return NaN;
  return parts.sign * Number(`${parts.int}.${parts.frac || '0'}`);
}

/** Converte um valor em reais digitado para centavos inteiros (no máximo duas casas decimais). */
export function parseMoneyCents(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : NaN;
  if (typeof text !== 'string') return NaN;
  const parts = splitNumber(text, true);
  if (!parts || parts.frac.length > 2) return NaN;
  return parts.sign * (Number(parts.int) * 100 + Number(parts.frac.padEnd(2, '0')));
}

/** Taxa anual → mensal equivalente: (1 + a)^(1/12) − 1. Taxas em fração (0,12 = 12%). */
export function annualToMonthly(annualRate) {
  return Math.expm1(Math.log1p(annualRate) / 12);
}

/** Taxa mensal → anual equivalente: (1 + i)^12 − 1. */
export function monthlyToAnnual(monthlyRate) {
  return Math.expm1(12 * Math.log1p(monthlyRate));
}

/** Parcela da Tabela Price sem arredondar: PV × i / (1 − (1 + i)^−n). */
export function pricePayment(principal, monthlyRate, months) {
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / -Math.expm1(-months * Math.log1p(monthlyRate));
}

function totalsOf(rows) {
  const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0);
  return {
    paid: sum('payment'),
    interest: sum('interest'),
    amortization: sum('amortization'),
    extras: sum('extra'),
    first: rows[0].payment,
    last: rows[rows.length - 1].payment,
  };
}

/** SAC: amortização constante (PV / n) e juros sobre o saldo. A última parcela zera o saldo. */
export function sacSchedule(principal, monthlyRate, months, extra = 0) {
  const amortization = roundHalfUp(principal / months);
  const rows = [];
  let balance = principal;
  for (let month = 1; month <= months; month += 1) {
    const interest = roundHalfUp(balance * monthlyRate);
    const amort = month === months ? balance : Math.min(amortization, balance);
    balance -= amort;
    rows.push({ month, payment: amort + interest + extra, amortization: amort, interest, extra, balance });
  }
  return {
    system: 'SAC',
    amortization,
    adjustment: rows[rows.length - 1].amortization - amortization,
    rows,
    totals: totalsOf(rows),
  };
}

/** Price: parcela fixa (PMT), juros sobre o saldo e amortização = PMT − juros. A última parcela zera o saldo. */
export function priceSchedule(principal, monthlyRate, months, extra = 0) {
  const installment = roundHalfUp(pricePayment(principal, monthlyRate, months));
  const rows = [];
  let balance = principal;
  for (let month = 1; month <= months; month += 1) {
    const interest = roundHalfUp(balance * monthlyRate);
    const amort = month === months ? balance : Math.min(Math.max(installment - interest, 0), balance);
    balance -= amort;
    rows.push({ month, payment: amort + interest + extra, amortization: amort, interest, extra, balance });
  }
  const last = rows[rows.length - 1];
  return {
    system: 'Price',
    installment,
    adjustment: last.amortization + last.interest - installment,
    rows,
    totals: totalsOf(rows),
  };
}

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/**
 * Valida o formulário e simula os dois sistemas.
 * raw: { mode: 'bem' | 'financiado', valorBem, entrada, valorFinanciado, juros, unidade: 'mes' | 'ano', prazo, extra }
 */
export function simulate(raw) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  let principal = NaN;

  if (raw.mode === 'financiado') {
    const value = parseMoneyCents(raw.valorFinanciado ?? '');
    if (isBlank(raw.valorFinanciado)) fail('valorFinanciado', 'Informe o valor financiado.');
    else if (Number.isNaN(value)) fail('valorFinanciado', 'Valor inválido. Exemplo: 240.000,00');
    else if (value <= 0) fail('valorFinanciado', 'O valor financiado precisa ser maior que zero.');
    else principal = value;
  } else {
    const asset = parseMoneyCents(raw.valorBem ?? '');
    const downPayment = isBlank(raw.entrada) ? 0 : parseMoneyCents(raw.entrada);
    let assetOk = false;
    if (isBlank(raw.valorBem)) fail('valorBem', 'Informe o valor do bem.');
    else if (Number.isNaN(asset)) fail('valorBem', 'Valor inválido. Exemplo: 300.000,00');
    else if (asset <= 0) fail('valorBem', 'O valor do bem precisa ser maior que zero.');
    else assetOk = true;

    if (Number.isNaN(downPayment)) fail('entrada', 'Entrada inválida. Exemplo: 60.000,00');
    else if (downPayment < 0) fail('entrada', 'A entrada não pode ser negativa.');
    else if (assetOk && downPayment >= asset) fail('entrada', 'A entrada precisa ser menor que o valor do bem.');
    else if (assetOk) principal = asset - downPayment;
  }
  if (principal > MAX_PRINCIPAL_CENTS) {
    fail(raw.mode === 'financiado' ? 'valorFinanciado' : 'valorBem', 'Valor alto demais para simular (máximo de R$ 10 bilhões).');
  }

  const rate = parseDecimal(raw.juros ?? '', { allowThousands: false });
  let monthlyRate = NaN;
  if (isBlank(raw.juros)) fail('juros', 'Informe a taxa de juros.');
  else if (Number.isNaN(rate)) fail('juros', 'Taxa inválida. Exemplo: 0,85');
  else if (rate < 0) fail('juros', 'A taxa de juros não pode ser negativa.');
  else {
    monthlyRate = raw.unidade === 'ano' ? annualToMonthly(rate / 100) : rate / 100;
    if (monthlyRate > MAX_MONTHLY_RATE) fail('juros', 'Taxa alta demais para simular (máximo de 100% ao mês).');
  }

  const months = parseDecimal(raw.prazo ?? '', { allowThousands: false });
  if (isBlank(raw.prazo)) fail('prazo', 'Informe o prazo em meses.');
  else if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    fail('prazo', `Use um número inteiro de meses entre 1 e ${MAX_MONTHS}.`);
  }

  const extra = isBlank(raw.extra) ? 0 : parseMoneyCents(raw.extra);
  if (Number.isNaN(extra)) fail('extra', 'Valor inválido. Exemplo: 85,50');
  else if (extra < 0) fail('extra', 'O valor de seguro e taxas não pode ser negativo.');

  if (errors.length > 0) return { ok: false, errors };

  const sac = sacSchedule(principal, monthlyRate, months, extra);
  const price = priceSchedule(principal, monthlyRate, months, extra);
  return {
    ok: true,
    errors: [],
    input: { principal, monthlyRate, months, extra },
    sac,
    price,
    comparison: comparisonSentence(sac, price),
  };
}

/** Frase-resumo da comparação, do ponto de vista do SAC. */
export function comparisonSentence(sac, price) {
  const saving = price.totals.interest - sac.totals.interest;
  const firstDiff = sac.totals.first - price.totals.first;
  if (saving === 0 && firstDiff === 0) {
    return 'Nesta simulação, SAC e Price dão o mesmo resultado (isso acontece com juros zero ou prazo de um mês).';
  }
  if (saving === 0) {
    return `Os dois sistemas cobram o mesmo total de juros, e a primeira parcela do SAC é ${formatMoney(Math.abs(firstDiff))} ${firstDiff > 0 ? 'maior' : 'menor'}.`;
  }
  const start = `No SAC você paga ${formatMoney(Math.abs(saving))} ${saving > 0 ? 'a menos' : 'a mais'} de juros`;
  if (firstDiff > 0) return `${start}, mas a primeira parcela é ${formatMoney(firstDiff)} maior.`;
  if (firstDiff < 0) return `${start}, e a primeira parcela é ${formatMoney(-firstDiff)} menor.`;
  return `${start}, com a mesma primeira parcela.`;
}

/** Explica os ajustes de centavos da última parcela; retorna "" quando não houve ajuste. */
export function adjustmentNote(sac, price) {
  const parts = [];
  const signed = (cents, more, less) => `${formatMoney(Math.abs(cents))} ${cents > 0 ? more : less}`;
  if (price.adjustment !== 0) {
    parts.push(`a última parcela da Price ficou ${signed(price.adjustment, 'maior', 'menor')} que as demais`);
  }
  if (sac.adjustment !== 0) {
    parts.push(`a última amortização do SAC ficou ${signed(sac.adjustment, 'maior', 'menor')}`);
  }
  if (parts.length === 0) return '';
  let note = `Ajuste de centavos: ${parts.join(' e ')}, para o saldo terminar exatamente em zero.`;
  if (Math.abs(price.adjustment) > price.installment / 100) {
    note += ' Em prazos longos com juros altos, a fração de centavo arredondada na parcela da Price rende juros mês a mês, e o ajuste final cresce.';
  }
  return note;
}

function groupThousands(integerText) {
  return integerText.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 123456 → "1.234,56" */
export function formatAmount(cents) {
  const abs = Math.abs(Math.round(cents));
  const text = `${groupThousands(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** 123456 → "R$ 1.234,56" (com espaço não separável). */
export function formatMoney(cents) {
  const text = `R$${NBSP}${formatAmount(Math.abs(cents))}`;
  return cents < 0 ? `-${text}` : text;
}

/** Percentual com vírgula decimal: formatPercent(0.94887, 4) → "0,9489". */
export function formatPercent(value, digits = 2) {
  const [int, frac] = Math.abs(value).toFixed(digits).split('.');
  const text = frac ? `${groupThousands(int)},${frac}` : groupThousands(int);
  return value < 0 ? `-${text}` : text;
}

/** 30 → "2 anos e 6 meses" */
export function formatDuration(months) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? '1 ano' : `${years} anos`;
  const m = rest === 1 ? '1 mês' : `${rest} meses`;
  if (years === 0) return m;
  return rest === 0 ? y : `${y} e ${m}`;
}

/** Valor curto para eixos de gráfico, em reais: 2500 → "R$ 2,5 mil". */
export function formatCompactMoney(reais) {
  const trim = (n) => formatPercent(n, 1).replace(/,0$/, '');
  if (reais >= 1e6) return `R$${NBSP}${trim(reais / 1e6)}${NBSP}mi`;
  if (reais >= 1e3) return `R$${NBSP}${trim(reais / 1e3)}${NBSP}mil`;
  return `R$${NBSP}${trim(reais)}`;
}

/** Marcas "redondas" de 0 até cobrir maxValue, com no máximo `target` intervalos. */
export function niceTicks(maxValue, target = 5) {
  if (!(maxValue > 0)) return [0, 1];
  const magnitude = 10 ** Math.floor(Math.log10(maxValue / target));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => maxValue / s <= target);
  const ticks = [];
  for (let i = 0; i * step < maxValue + step * 1e-9; i += 1) ticks.push(Number((i * step).toPrecision(12)));
  if (ticks[ticks.length - 1] < maxValue) ticks.push(Number((ticks.length * step).toPrecision(12)));
  return ticks;
}

function csvNumber(cents) {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** CSV para Excel em português: separador ";" e vírgula decimal. */
export function scheduleCSV(sac, price) {
  const hasExtra = sac.totals.extras > 0;
  const columns = ['Parcela', 'Amortização', 'Juros', ...(hasExtra ? ['Seguro e taxas'] : []), 'Saldo devedor'];
  const header = ['Mês', ...columns.map((c) => `SAC - ${c}`), ...columns.map((c) => `Price - ${c}`)];
  const cells = (row) => [row.payment, row.amortization, row.interest, ...(hasExtra ? [row.extra] : []), row.balance].map(csvNumber);
  const totals = (t) => [t.paid, t.amortization, t.interest, ...(hasExtra ? [t.extras] : [])].map(csvNumber).concat('');
  const lines = [header];
  sac.rows.forEach((row, index) => lines.push([String(row.month), ...cells(row), ...cells(price.rows[index])]));
  lines.push(['Total', ...totals(sac.totals), ...totals(price.totals)]);
  return `${lines.map((line) => line.join(';')).join('\r\n')}\r\n`;
}
