// js/doe.js の計算を tests/reference.json（statsmodels・scipy・numpy で別に計算した値）と照合する
// 実行: node tests/test.js   （不一致があれば終了コード 1）
'use strict';
const path = require('path');
const fs = require('fs');
const D = require('../js/doe.js');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));

let fails = 0, checks = 0;
function close(name, got, want, rel = 1e-7, abs = 1e-9) {
  checks++;
  const ok = Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= Math.max(abs, rel * Math.abs(want));
  if (!ok) { fails++; console.log(`✗ ${name}: ${got} ≠ ${want}`); }
}
function same(name, got, want) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
}
function truthy(name, v) { checks++; if (!v) { fails++; console.log(`✗ ${name}`); } }

// ---- 直交表：教科書の表と一致し、直交している ----
for (const name of D.ARRAY_NAMES) {
  const a = D.getArray(name);
  same(`${name} の表`, a.rows.map(r => r.map(v => v + 1)), ref.arrays[name]);
  truthy(`${name} の直交性`, D.isOrthogonal(a));
}
// 交互作用の列
same('L8 列1×列2 → 列3', D.interCols(D.getArray('L8'), 0, 1).cols, [2]);
same('L16 列5×列10 → 列15', D.interCols(D.getArray('L16'), 4, 9).cols, [14]);
same('L9 列1×列2 → 列3・列4', D.interCols(D.getArray('L9'), 0, 1).cols, [2, 3]);
same('L9 列2×列3 → 列1・列4', D.interCols(D.getArray('L9'), 1, 2).cols, [0, 3]);
truthy('L18 列1×列2 は列を使わずに求まる', D.interCols(D.getArray('L18'), 0, 1).hidden);
truthy('L18 列2×列3 は求められない', D.interCols(D.getArray('L18'), 1, 2) === null);
truthy('L12 の交互作用は求められない', D.interCols(D.getArray('L12'), 0, 1) === null);
truthy('L12 はどの 2 列でも値が決まる列がない', D.getArray('L12').det.every(r => r.every(x => !x.length)));
same('L18 列2×列4 → 列5（列5 = 列2 + 列4 mod 3）', D.interCols(D.getArray('L18'), 1, 3).cols, [4]);
truthy('L18 の値が決まる列は列2・列4・列5 の組だけ', D.getArray('L18').det.flat().filter(x => x.length).length === 6);
// L18 の列1×列2 の交互作用（2 水準 × 3 水準のセル）が、ほかの列と直交している：どの列の水準でもセルの出現回数が等しい
{
  const a = D.getArray('L18');
  let ok = true;
  for (let c = 2; c < 8; c++) {
    const cnt = new Map();
    for (const r of a.rows) { const k = r[0] * 100 + r[1] * 10 + r[c]; cnt.set(k, (cnt.get(k) || 0) + 1); }
    if (cnt.size !== 18 || [...cnt.values()].some(v => v !== 1)) ok = false;
  }
  truthy('L18 列1×列2 とほかの列の直交', ok);
}

// ---- 自動割り付け ----
{
  const fac = (n, k) => n.split('').map(name => ({ name, nlev: k }));
  const A1 = D.assign({ array: 'L8', factors: fac('ABCD', 2), inter: [[0, 1], [0, 2]] });
  truthy('L8 A×B・A×C の割り付け', A1.ok);
  // 割り付けた交互作用の列がほかの因子・交互作用と重ならない
  const usedCols = A1.cols.concat(...A1.inter.map(x => x.cols));
  same('L8 列の重なりなし', new Set(usedCols).size, usedCols.length);
  A1.inter.forEach(x => same(`L8 ${x.a}×${x.b} の列`, x.cols, [A1.cols[x.a] + 1 ^ A1.cols[x.b] + 1].map(v => v - 1)));
  truthy('L8 4因子+交互作用4つは不可', !D.assign({ array: 'L8', factors: fac('ABCD', 2), inter: [[0, 1], [0, 2], [1, 2], [0, 3]] }).ok);
  const A2 = D.assign({ array: 'L16', factors: fac('ABCDEF', 2), inter: [[0, 1], [0, 2], [1, 2], [3, 4], [0, 5]] });
  truthy('L16 交互作用5つ', A2.ok);
  const u2 = A2.cols.concat(...A2.inter.map(x => x.cols));
  same('L16 列の重なりなし', new Set(u2).size, u2.length);
  truthy('L9 A×B があると3つ目の因子は置けない', !D.assign({ array: 'L9', factors: [{ name: 'A', nlev: 3 }, { name: 'B', nlev: 3 }, { name: 'C', nlev: 2 }], inter: [[0, 1]] }).ok);
  const A3 = D.assign({ array: 'L9', factors: [{ name: 'A', nlev: 3 }, { name: 'B', nlev: 2 }], inter: [] });
  truthy('L9 2水準は擬水準', A3.ok && A3.pseudo[1] && !A3.pseudo[0]);
  const A4 = D.assign({ array: 'L18', factors: [{ name: 'H', nlev: 3 }, { name: 'A', nlev: 2 }, { name: 'B', nlev: 3 }], inter: [[1, 2]] });
  truthy('L18 交互作用は列1・列2', A4.ok && A4.cols[1] === 0 && A4.cols[2] === 1 && A4.inter[0].hidden);
  const A5 = D.assign({ array: 'L18', factors: [{ name: 'A', nlev: 2 }, { name: 'B', nlev: 2 }], inter: [] });
  truthy('L18 2水準の2つ目は擬水準', A5.ok && A5.cols[0] === 0 && A5.pseudo[1]);
  truthy('L12 交互作用は不可', !D.assign({ array: 'L12', factors: fac('AB', 2), inter: [[0, 1]] }).ok);
  truthy('2水準の表に3水準は不可', !D.assign({ array: 'L16', factors: fac('A', 3), inter: [] }).ok);
  truthy('同じ列の指定は不可', !D.assign({ array: 'L8', factors: [{ name: 'A', nlev: 2, col: 0 }, { name: 'B', nlev: 2, col: 0 }], inter: [] }).ok);
  const A6 = D.assign({ array: 'L8', factors: [{ name: 'A', nlev: 2 }, { name: 'B', nlev: 2 }, { name: 'C', nlev: 2, col: 2 }], inter: [] });
  same('L8 列3 の C は A×B と交絡', A6.table[2].alias, [[0, 1]]);
}

// ---- 指標（SN比など）：手計算の値 ----
{
  const y = [9.8, 10.1, 10.4];
  const n = 3, sum = 30.3, Sm = sum * sum / n, Ve = ((9.8 - 10.1) ** 2 + 0 + (10.4 - 10.1) ** 2) / 2;
  close('望目I SN比', D.metricOf(y, 'sn', 'nominal1').v, 10 * Math.log10((Sm - Ve) / n / Ve));
  close('望目I 感度', D.metricOf(y, 'sens', 'nominal1').v, 10 * Math.log10((Sm - Ve) / n));
  close('望目II SN比', D.metricOf(y, 'sn', 'nominal2').v, -10 * Math.log10(Ve));
  close('望小 SN比', D.metricOf(y, 'sn', 'smaller').v, -10 * Math.log10((9.8 ** 2 + 10.1 ** 2 + 10.4 ** 2) / 3));
  close('望大 SN比', D.metricOf(y, 'sn', 'larger').v, -10 * Math.log10((1 / 9.8 ** 2 + 1 / 10.1 ** 2 + 1 / 10.4 ** 2) / 3));
  truthy('Ve = 0 はエラー', D.metricOf([5, 5], 'sn', 'nominal1').err);
  truthy('Sm ≦ Ve はエラー', D.metricOf([-1, 1.2], 'sn', 'nominal1').err);
  truthy('望大で 0 以下はエラー', D.metricOf([0, 1], 'sn', 'larger').err);
  truthy('望目は 1 個ではエラー', D.metricOf([1], 'sn', 'nominal2').err);
}

// ---- 分散分析・推定：statsmodels の値と照合 ----
for (const c of ref.cases) {
  const design = { array: c.array, factors: c.factors.map((f, i) => ({ ...f, col: c.cols[i] })), inter: c.inter };
  const asg = D.assign(design);
  truthy(`${c.name} 割り付け`, asg.ok);
  if (!asg.ok) { console.log(asg.errors); continue; }
  for (const m of c.metrics) {
    const R = D.analyze(design, asg, c.data, { kind: c.kind, char: c.char, metric: m, pool: c.ref.metrics[m] ? c.pool[m] : [] });
    const W = c.ref.metrics[m], tag = `${c.name} [${m}]`;
    if (R.errors && R.errors.length) { fails++; console.log(`✗ ${tag}: ${R.errors}`); continue; }
    close(`${tag} ST`, R.ST, W.ST);
    same(`${tag} dfT`, R.dfT, W.dfT);
    if (W.units) W.units.forEach((v, i) => close(`${tag} 指標 No.${i + 1}`, R.units[i], v));
    for (const t of R.terms) {
      const w = W.terms[t.key];
      close(`${tag} ${t.label} S`, t.S, w.S, 1e-7, 1e-9 * W.ST);
      same(`${tag} ${t.label} df`, t.df, w.df);
      if (!t.pooled) {
        close(`${tag} ${t.label} F`, t.F, w.F, 1e-6);
        close(`${tag} ${t.label} p`, t.p, w.p, 1e-5, 1e-12);
        close(`${tag} ${t.label} 寄与率`, t.rho, w.rho, 1e-6, 1e-9);
      }
    }
    close(`${tag} Se`, R.Se, W.Se, 1e-6, 1e-9 * W.ST);
    same(`${tag} dfe`, R.dfe, W.dfe);
    if (W.e2 != null) close(`${tag} 繰り返しの誤差`, R.e2.S, W.e2);
    close(`${tag} Vp`, R.Vp, W.Vp, 1e-6);
    same(`${tag} dfp`, R.dfp, W.dfp);
    c.conds.forEach((cond, i) => {
      const E = D.estimate(R, cond, W.est[i].m), w = W.est[i];
      close(`${tag} 推定値${i + 1}`, E.est, w.est, 1e-7);
      close(`${tag} 有効反復数${i + 1}`, E.ne, w.ne, 1e-7);
      close(`${tag} 信頼区間下限${i + 1}`, E.ci[0], w.ci[0], 1e-6);
      close(`${tag} 信頼区間上限${i + 1}`, E.ci[1], w.ci[1], 1e-6);
      close(`${tag} 予測区間下限${i + 1}`, E.pi[0], w.pi[0], 1e-6);
      close(`${tag} 予測区間上限${i + 1}`, E.pi[1], w.pi[1], 1e-6);
    });
    const G = D.gain(R, c.conds[0], c.conds[1]);
    close(`${tag} 利得`, G.est, W.gain.est, 1e-7, 1e-9);
    close(`${tag} 利得の下限`, G.ci[0], W.gain.ci[0], 1e-6, 1e-9);
    close(`${tag} 利得の上限`, G.ci[1], W.gain.ci[1], 1e-6, 1e-9);
  }
}

// ---- プールの候補 ----
{
  // 誤差の自由度 0：効果の小さい半分をまずプールする
  const T = [{ key: 'a', S: 10, df: 1 }, { key: 'b', S: 0.1, df: 1 }, { key: 'c', S: 5, df: 1 }, { key: 'd', S: 0.2, df: 1 }].map(t => ({ ...t, V: t.S / t.df }));
  same('自由度0 のプール候補', D.suggestPool(T, 0, 0).sort(), ['b', 'd']);
  // F < 2 を順に加える：Ve = 1（df 4）で V = 1.5 の項はプール、V = 3 は残す
  const T2 = [{ key: 'a', S: 1.5, df: 1 }, { key: 'b', S: 30, df: 1 }].map(t => ({ ...t, V: t.S / t.df }));
  same('F<2 のプール候補', D.suggestPool(T2, 4, 4), ['a']);
  // 交互作用を残すならその主効果は残す
  const T3 = [{ key: 'f0', S: 0.1, df: 1 }, { key: 'f1', S: 9, df: 1 }, { key: 'i0-1', S: 9, df: 1, type: 'inter', a: 0, b: 1 }].map(t => ({ ...t, V: t.S / t.df }));
  same('交互作用の主効果は残す', D.suggestPool(T3, 4, 4), []);
}

// ---- 最適条件：交互作用を含めた総当たり ----
{
  const c = ref.cases.find(x => x.name.startsWith('L8'));
  const design = { array: c.array, factors: c.factors.map((f, i) => ({ ...f, col: c.cols[i] })), inter: c.inter };
  const asg = D.assign(design);
  const R = D.analyze(design, asg, c.data, { kind: c.kind, char: c.char, metric: 'mean', pool: c.pool.mean });
  const best = D.bestCondition(R, design.factors, 1);
  // 総当たりの結果は、どの条件の推定値よりも大きい
  let maxv = -Infinity;
  for (let i = 0; i < 16; i++) maxv = Math.max(maxv, D.estimate(R, [i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1]).est);
  close('最適条件の推定値', D.estimate(R, best).est, maxv);
}

// ---- 入力の確認 ----
{
  const design = { array: 'L4', factors: [{ name: 'A', nlev: 2 }], inter: [] };
  const asg = D.assign(design);
  truthy('空欄はエラー', D.analyze(design, asg, [[1], [2], [NaN], [4]], { metric: 'mean' }).errors.length);
  truthy('行数違いはエラー', D.analyze(design, asg, [[1], [2]], { metric: 'mean' }).errors.length);
}

console.log(`${checks - fails} / ${checks} 件一致`);
process.exit(fails ? 1 : 0);
