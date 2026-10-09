import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustmentNote,
  annualToMonthly,
  comparisonSentence,
  formatAmount,
  formatCompactMoney,
  formatDuration,
  formatMoney,
  formatPercent,
  monthlyToAnnual,
  niceTicks,
  parseDecimal,
  parseMoneyCents,
  pricePayment,
  priceSchedule,
  roundHalfUp,
  sacSchedule,
  scheduleCSV,
  simulate,
} from '../src/financiamento.js';

const NBSP = '\u00a0';
const base = { mode: 'financiado', valorFinanciado: '100.000,00', juros: '1', unidade: 'mes', prazo: '12', extra: '' };

test('PMT de referência: R$ 100.000 a 1% a.m. em 12 meses dá R$ 8.884,88', () => {
  const price = priceSchedule(10_000_000, 0.01, 12);
  assert.equal(price.installment, 888_488);
  assert.equal(formatMoney(price.installment), `R$${NBSP}8.884,88`);
  assert.ok(Math.abs(pricePayment(100_000, 0.01, 12) - 8884.8788) < 1e-4);
  for (const row of price.rows.slice(0, -1)) assert.equal(row.payment, 888_488);
});

test('Price: juros sobre o saldo e amortização = PMT - juros', () => {
  const price = priceSchedule(10_000_000, 0.01, 12);
  const [first, second] = price.rows;
  assert.equal(first.interest, 100_000);
  assert.equal(first.amortization, 788_488);
  assert.equal(first.balance, 9_211_512);
  assert.equal(second.interest, 92_115); // 92.115,12 × 1% = 921,1512 → 921,15
  assert.equal(second.amortization, 888_488 - 92_115);
});

test('SAC: primeira parcela = PV/n + PV×i e amortização constante', () => {
  const sac = sacSchedule(10_000_000, 0.01, 12);
  assert.equal(sac.rows[0].payment, 833_333 + 100_000);
  assert.equal(formatMoney(sac.totals.first), `R$${NBSP}9.333,33`);
  for (const row of sac.rows.slice(0, -1)) assert.equal(row.amortization, 833_333);
  assert.equal(sac.rows[1].interest, 91_667); // 91.666,67 × 1%
  assert.ok(sac.rows.every((row, i) => i === 0 || row.payment < sac.rows[i - 1].payment), 'parcelas decrescentes');
});

test('o saldo termina exatamente em zero, com a última parcela ajustada', () => {
  const cases = [
    [10_000_000, 0.01, 12],
    [24_000_000, annualToMonthly(0.1), 360],
    [30_000_000, 0.0099, 420],
    [5_000_000, 0.025, 60],
    [123_457, 0.0137, 7],
    [100, 0.02, 600],
  ];
  for (const [pv, i, n] of cases) {
    for (const schedule of [sacSchedule(pv, i, n), priceSchedule(pv, i, n)]) {
      assert.equal(schedule.rows.length, n);
      assert.equal(schedule.rows[n - 1].balance, 0, `${schedule.system} ${pv} ${i} ${n}`);
      assert.equal(schedule.totals.amortization, pv);
      assert.ok(schedule.rows.every((row) => Number.isInteger(row.payment) && row.balance >= 0));
    }
  }
  const price = priceSchedule(10_000_000, 0.01, 12);
  assert.equal(price.rows[11].payment, 888_485);
  assert.equal(price.adjustment, -3);
});

test('totais: total pago = valor financiado + juros + seguro e taxas', () => {
  const result = simulate({ ...base, extra: '50,00' });
  assert.equal(result.ok, true);
  for (const schedule of [result.sac, result.price]) {
    const t = schedule.totals;
    assert.equal(t.paid, 10_000_000 + t.interest + t.extras);
    assert.equal(t.extras, 12 * 5_000);
    assert.equal(t.interest, schedule.rows.reduce((acc, row) => acc + row.interest, 0));
  }
  assert.equal(result.sac.totals.interest, 650_000);
  assert.equal(result.price.totals.interest, 661_853);
  assert.equal(result.price.rows[0].payment, 888_488 + 5_000);
});

test('frase de comparação usa as diferenças de juros e da primeira parcela', () => {
  const result = simulate(base);
  assert.equal(
    result.comparison,
    `No SAC você paga R$${NBSP}118,53 a menos de juros, mas a primeira parcela é R$${NBSP}448,45 maior.`,
  );
});

test('taxa anual vira mensal equivalente: 12% a.a. → 0,9489% a.m.', () => {
  assert.equal(formatPercent(annualToMonthly(0.12) * 100, 4), '0,9489');
  assert.ok(Math.abs(annualToMonthly(0.12) - 0.009488793) < 1e-9);
  assert.equal(formatPercent(monthlyToAnnual(0.01) * 100, 4), '12,6825');
  assert.ok(Math.abs(monthlyToAnnual(annualToMonthly(0.105)) - 0.105) < 1e-12);
  const viaForm = simulate({ ...base, juros: '12', unidade: 'ano' });
  assert.ok(Math.abs(viaForm.input.monthlyRate - 0.009488793) < 1e-9);
});

test('juros zero: SAC e Price ficam iguais e sem juros', () => {
  const result = simulate({ ...base, valorFinanciado: '1.000,00', juros: '0', prazo: '3' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.sac.rows.map((r) => r.payment), [33_333, 33_333, 33_334]);
  assert.deepEqual(result.price.rows.map((r) => r.payment), [33_333, 33_333, 33_334]);
  assert.equal(result.sac.totals.interest, 0);
  assert.equal(result.price.totals.interest, 0);
  assert.equal(pricePayment(1000, 0, 4), 250);
  assert.match(result.comparison, /mesmo resultado/);
});

test('prazo de um mês: os dois sistemas coincidem', () => {
  const result = simulate({ ...base, prazo: '1' });
  assert.equal(result.sac.rows[0].payment, 10_100_000);
  assert.equal(result.price.rows[0].payment, 10_100_000);
});

test('modo valor do bem: financia o bem menos a entrada', () => {
  const result = simulate({ mode: 'bem', valorBem: '300.000', entrada: '60.000,00', juros: '10', unidade: 'ano', prazo: '360' });
  assert.equal(result.ok, true);
  assert.equal(result.input.principal, 24_000_000);
  assert.equal(result.sac.amortization, 66_667);
  const semEntrada = simulate({ mode: 'bem', valorBem: '50.000', entrada: '', juros: '1,5', unidade: 'mes', prazo: '48' });
  assert.equal(semEntrada.input.principal, 5_000_000);
});

test('entradas inválidas geram mensagens por campo', () => {
  const fields = (raw) => simulate(raw).errors.map((e) => e.field);
  assert.deepEqual(fields({ mode: 'financiado', valorFinanciado: '', juros: '', prazo: '' }), ['valorFinanciado', 'juros', 'prazo']);
  assert.deepEqual(fields({ ...base, valorFinanciado: 'abc' }), ['valorFinanciado']);
  assert.deepEqual(fields({ ...base, valorFinanciado: '0' }), ['valorFinanciado']);
  assert.deepEqual(fields({ ...base, juros: '-1' }), ['juros']);
  assert.deepEqual(fields({ ...base, juros: '150' }), ['juros']);
  assert.deepEqual(fields({ ...base, prazo: '0' }), ['prazo']);
  assert.deepEqual(fields({ ...base, prazo: '12,5' }), ['prazo']);
  assert.deepEqual(fields({ ...base, prazo: '601' }), ['prazo']);
  assert.deepEqual(fields({ ...base, extra: '-10' }), ['extra']);
  assert.deepEqual(fields({ mode: 'bem', valorBem: '100.000', entrada: '100.000', juros: '1', prazo: '12' }), ['entrada']);
  assert.deepEqual(fields({ mode: 'bem', valorBem: '100.000', entrada: '-5', juros: '1', prazo: '12' }), ['entrada']);
  assert.deepEqual(fields({ mode: 'bem', valorBem: '', entrada: '10', juros: '1', prazo: '12' }), ['valorBem']);
  const result = simulate({ ...base, valorFinanciado: '1,2,3' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /inválido/);
});

test('leitura de números no padrão brasileiro', () => {
  assert.equal(parseDecimal('1.234,56'), 1234.56);
  assert.equal(parseDecimal('1234.56'), 1234.56);
  assert.equal(parseDecimal('1.234'), 1234);
  assert.equal(parseDecimal('1.234', { allowThousands: false }), 1.234);
  assert.equal(parseDecimal('0,85'), 0.85);
  assert.equal(parseDecimal('0.949'), 0.949);
  assert.equal(parseDecimal('R$ 10'), 10);
  assert.equal(parseDecimal('12%'), 12);
  assert.ok(Number.isNaN(parseDecimal('abc')));
  assert.ok(Number.isNaN(parseDecimal('1.23,4')));
  assert.equal(parseMoneyCents('R$ 300.000,00'), 30_000_000);
  assert.equal(parseMoneyCents('1,5'), 150);
  assert.ok(Number.isNaN(parseMoneyCents('10,555')));
});

test('formatação', () => {
  assert.equal(formatAmount(123_456_789), '1.234.567,89');
  assert.equal(formatAmount(5), '0,05');
  assert.equal(formatMoney(-150), `-R$${NBSP}1,50`);
  assert.equal(formatPercent(12874.6345, 2), '12.874,63');
  assert.equal(formatDuration(360), '30 anos');
  assert.equal(formatDuration(30), '2 anos e 6 meses');
  assert.equal(formatDuration(13), '1 ano e 1 mês');
  assert.equal(formatDuration(11), '11 meses');
  assert.equal(formatCompactMoney(2500), `R$${NBSP}2,5${NBSP}mil`);
  assert.equal(formatCompactMoney(2_000_000), `R$${NBSP}2${NBSP}mi`);
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(1.0049999999999999 * 100), 101);
});

test('marcas do eixo são redondas e cobrem o máximo', () => {
  assert.deepEqual(niceTicks(9333.33), [0, 2000, 4000, 6000, 8000, 10000]);
  assert.deepEqual(niceTicks(2000), [0, 500, 1000, 1500, 2000]);
  const ticks = niceTicks(123_456);
  assert.ok(ticks[ticks.length - 1] >= 123_456 && ticks.length <= 7);
});

test('CSV para Excel brasileiro: ponto e vírgula e vírgula decimal', () => {
  const result = simulate({ ...base, extra: '10' });
  const csv = scheduleCSV(result.sac, result.price);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 1 + 12 + 1);
  assert.equal(
    lines[0],
    'Mês;SAC - Parcela;SAC - Amortização;SAC - Juros;SAC - Seguro e taxas;SAC - Saldo devedor;'
      + 'Price - Parcela;Price - Amortização;Price - Juros;Price - Seguro e taxas;Price - Saldo devedor',
  );
  assert.equal(lines[1], '1;9343,33;8333,33;1000,00;10,00;91666,67;8894,88;7884,88;1000,00;10,00;92115,12');
  assert.match(lines[13], /^Total;/);
  const semExtra = scheduleCSV(simulate(base).sac, simulate(base).price).split('\r\n')[0];
  assert.ok(!semExtra.includes('Seguro'));
});

test('nota de ajuste explica a última parcela', () => {
  const result = simulate(base);
  assert.equal(
    adjustmentNote(result.sac, result.price),
    `Ajuste de centavos: a última parcela da Price ficou R$${NBSP}0,03 menor que as demais e a última amortização do SAC ficou R$${NBSP}0,04 maior, para o saldo terminar exatamente em zero.`,
  );
  const semAjuste = simulate({ ...base, valorFinanciado: '1.200,00', juros: '0' });
  assert.equal(adjustmentNote(semAjuste.sac, semAjuste.price), '');
  const longo = simulate({ ...base, valorFinanciado: '300.000', juros: '2', prazo: '420' });
  assert.match(adjustmentNote(longo.sac, longo.price), /ajuste final cresce/);
});

test('comparação trata empate e diferença sem juros', () => {
  const sac = { totals: { interest: 0, first: 100 } };
  const price = { totals: { interest: 0, first: 100 } };
  assert.match(comparisonSentence(sac, price), /mesmo resultado/);
});
