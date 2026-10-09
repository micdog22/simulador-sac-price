# Simulador SAC × Price — compare financiamentos parcela a parcela (HTML + JS)

Na hora de financiar um imóvel ou um carro, a dúvida é sempre a mesma: SAC ou Price? Este simulador mostra, lado a lado, quanto você paga em cada sistema (primeira e última parcela, total pago e total de juros), com gráfico, tabelas completas e exportação para o Excel.

Roda inteiro no navegador, sem cadastro e sem enviar seus dados para lugar nenhum.

**Acesse online:** https://micdog22.github.io/simulador-sac-price/

## Recursos
- Informe o valor do bem e a entrada, ou direto o valor financiado.
- Taxa de juros ao mês ou ao ano, com a taxa equivalente mostrada na hora.
- Seguro e taxas mensais opcionais, somados às parcelas dos dois sistemas.
- Resumo por sistema: 1ª e última parcela, total pago e total de juros.
- Frase de comparação direta: "No SAC você paga R$ X a menos de juros, mas a primeira parcela é R$ Y maior".
- Gráfico das parcelas mês a mês, navegável com o mouse ou com as setas do teclado.
- Tabelas completas (mês, parcela, amortização, juros e saldo devedor).
- Exportação em CSV no padrão do Excel brasileiro (`;` como separador e vírgula decimal).
- Lembra os últimos valores digitados no próprio navegador.
- Tema claro e escuro, funciona bem no celular.

## Como usar
1. Escolha se vai informar o valor do bem e a entrada ou o valor financiado.
2. Preencha a taxa de juros (escolha "% ao mês" ou "% ao ano") e o prazo em meses.
3. O resultado atualiza enquanto você digita. Abra as tabelas para ver mês a mês ou baixe o CSV.

Exemplo: R$ 100.000,00 a 1% ao mês em 12 meses.

| | SAC | Price |
|---|---|---|
| 1ª parcela | R$ 9.333,33 | R$ 8.884,88 |
| Última parcela | R$ 8.416,70 | R$ 8.884,85 |
| Total de juros | R$ 6.500,00 | R$ 6.618,53 |

"No SAC você paga R$ 118,53 a menos de juros, mas a primeira parcela é R$ 448,45 maior."

## Como rodar localmente
Na pasta do projeto:

```bash
python3 -m http.server 8000
```

Depois abra http://localhost:8000 (módulos ES não carregam via `file://`).

## Testes
```bash
npm test
```

Usa o `node:test` nativo, sem nenhuma dependência.

## Como funciona
- **SAC** (Sistema de Amortização Constante): amortização = PV ÷ n; juros = saldo devedor × i; parcela = amortização + juros.
- **Price** (Sistema Francês): PMT = PV × i ÷ (1 − (1 + i)^−n); juros = saldo devedor × i; amortização = PMT − juros. Com juros zero, PMT = PV ÷ n.
- **Taxa anual para mensal:** (1 + a)^(1/12) − 1, que é a taxa equivalente (12% ao ano = 0,9489% ao mês, e não 1%).
- **Centavos:** os cálculos usam centavos inteiros. Juros e amortização são arredondados mês a mês e a última parcela é ajustada para o saldo terminar exatamente em zero; a página mostra de quanto foi esse ajuste.
- A lógica fica em `src/financiamento.js` (sem DOM) e é coberta pelos testes em `tests/`.

## Aviso
Esta é uma simulação para comparar cenários, não uma proposta de crédito nem recomendação financeira. Contratos reais incluem o CET (Custo Efetivo Total), seguros obrigatórios, tarifas e, muitas vezes, correção do saldo pela TR ou pelo IPCA. Confira sempre a proposta da instituição financeira.

## Contribuindo
Issues e pull requests são bem-vindos.

## Licença
MIT — veja [LICENSE](LICENSE).
