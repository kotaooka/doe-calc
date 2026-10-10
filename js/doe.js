// 実験計画法の計算（直交表・割り付け・SN比・分散分析・プーリング・推定）。外部ライブラリなし。Node でも読み込み可
// 水準・列番号は内部ではすべて 0 始まり（画面では 1 始まりで表示する）
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.CpkStats;

  // =========================================================================
  // 直交表（田口の標準形の列の並び）
  // =========================================================================
  // 2 水準系（L4・L8・L16）：列 j（1 始まり）を 2 進数で表したとき、ビット i が立っている基本列の和（mod 2）。
  // 基本列 2^i は行番号の上位から i 番目のビットに対応する。このとき列 a と列 b の交互作用は列 a XOR b に現れる
  function twoLevel(k) {
    const N = 1 << k, rows = [];
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let j = 1; j < N; j++) {
        let p = 0;
        for (let i = 0; i < k; i++) if ((j >> i) & 1 && (r >> (k - 1 - i)) & 1) p ^= 1;
        row.push(p);
      }
      rows.push(row);
    }
    return rows;
  }
  // L9：列1 = a、列2 = b、列3 = a + b、列4 = 2a + b（mod 3）
  function l9() {
    const rows = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) rows.push([a, b, (a + b) % 3, (2 * a + b) % 3]);
    return rows;
  }
  const L12 = [
    '11111111111', '11111222222', '11222111222', '12122122112', '12212212121', '12221221211',
    '21221122121', '21212221112', '21122212211', '22211112212', '22121211122', '22112121221',
  ];
  const L18 = [
    '11111111', '11222222', '11333333', '12112233', '12223311', '12331122', '13121323', '13232131', '13313212',
    '21133221', '21211332', '21322113', '22123132', '22231213', '22312321', '23132312', '23213123', '23321231',
  ];
  const parse = list => list.map(s => [...s].map(ch => +ch - 1));

  const ARRAY_DEFS = {
    L4: { rows: () => twoLevel(2), note: '2 水準 3 列' },
    L8: { rows: () => twoLevel(3), note: '2 水準 7 列' },
    L9: { rows: l9, note: '3 水準 4 列' },
    L12: { rows: () => parse(L12), note: '2 水準 11 列。交互作用は割り付けられない', partial: true },
    L16: { rows: () => twoLevel(4), note: '2 水準 15 列' },
    // 列1 と列2 の交互作用（自由度 2）はほかのどの列とも直交していて、列を使わずに求められる
    L18: { rows: () => parse(L18), note: '2 水準 1 列 ＋ 3 水準 7 列。交互作用は列1×列2 だけ', partial: true, hidden: [[0, 1]] },
  };
  const ARRAY_NAMES = Object.keys(ARRAY_DEFS);
  const cache = {};
  function getArray(name) {
    if (cache[name]) return cache[name];
    const d = ARRAY_DEFS[name];
    if (!d) throw new Error(`直交表 ${name} はありません`);
    const rows = d.rows(), nc = rows[0].length;
    const levels = [];
    for (let c = 0; c < nc; c++) levels.push(Math.max(...rows.map(r => r[c])) + 1);
    const a = { name, N: rows.length, nc, rows, levels, note: d.note, partial: !!d.partial, hidden: d.hidden || [] };
    // 列の組 (i, j) の水準の組み合わせで値が決まってしまう列（＝その2列の交互作用が現れる列）
    a.det = [];
    for (let i = 0; i < nc; i++) {
      a.det.push([]);
      for (let j = 0; j < nc; j++) {
        const out = [];
        if (i !== j) {
          for (let k = 0; k < nc; k++) {
            if (k === i || k === j) continue;
            const m = new Map(); let ok = true;
            for (const r of rows) {
              const key = r[i] * 10 + r[j];
              if (m.has(key) && m.get(key) !== r[k]) { ok = false; break; }
              m.set(key, r[k]);
            }
            if (ok) out.push(k);
          }
        }
        a.det[i].push(out);
      }
    }
    return (cache[name] = a);
  }
  // 列 i と列 j の交互作用の扱い：{ cols: [...] }（列に現れる）、{ hidden: true }（列を使わずに求まる）、null（求められない）
  function interCols(a, i, j) {
    if (a.hidden.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) return { cols: [], hidden: true };
    const d = a.det[i][j];
    return d.length ? { cols: d.slice(), hidden: false } : null;
  }
  // どの 2 列の組でも水準の組み合わせが同じ回数ずつ現れるか（直交性の確認。テスト用）
  function isOrthogonal(a) {
    for (let i = 0; i < a.nc; i++) for (let j = i + 1; j < a.nc; j++) {
      const cnt = new Map();
      for (const r of a.rows) { const k = r[i] * 10 + r[j]; cnt.set(k, (cnt.get(k) || 0) + 1); }
      const want = a.N / (a.levels[i] * a.levels[j]);
      if (cnt.size !== a.levels[i] * a.levels[j] || [...cnt.values()].some(v => v !== want)) return false;
    }
    return true;
  }

  // =========================================================================
  // 割り付け
  // =========================================================================
  // design = { array: 'L18', factors: [{ name, nlev (2|3), col: null|列(0始まり), dup: 0|1（擬水準で重複させる水準） }], inter: [[因子a, 因子b], …] }
  // 戻り値 = { ok, cols: [因子ごとの列], pseudo: [因子ごとに擬水準か], inter: [{ a, b, cols, hidden }], errors, warnings, table }
  function canPlace(a, f, c) {
    const L = a.levels[c];
    if (f.nlev === L) return true;
    if (f.nlev === 2 && L === 3) return true; // 擬水準法
    return false;
  }
  function assign(design) {
    const a = getArray(design.array);
    const F = design.factors, I = design.inter || [];
    const errors = [], warnings = [];
    F.forEach((f, i) => {
      if (f.nlev !== 2 && f.nlev !== 3) errors.push(`因子「${f.name}」の水準数は 2 か 3 にしてください`);
      if (f.nlev === 3 && !a.levels.includes(3)) errors.push(`因子「${f.name}」は 3 水準ですが、${a.name} は 2 水準の表です（多水準作成法は未対応です）`);
      if (f.col != null && (f.col < 0 || f.col >= a.nc)) errors.push(`因子「${f.name}」の列番号は 1〜${a.nc} にしてください`);
      else if (f.col != null && !canPlace(a, f, f.col)) errors.push(`因子「${f.name}」（${f.nlev} 水準）は列${f.col + 1}（${a.levels[f.col]} 水準）に割り付けられません`);
    });
    const fixed = F.map(f => f.col).filter(c => c != null);
    if (new Set(fixed).size !== fixed.length) errors.push('同じ列に 2 つの因子を割り付けています');
    const seenI = new Set();
    I.forEach(([p, q]) => {
      const key = Math.min(p, q) + '-' + Math.max(p, q);
      if (p === q || seenI.has(key)) errors.push('交互作用の指定が重複しています');
      seenI.add(key);
      if (!F[p] || !F[q]) errors.push('交互作用の因子が見つかりません');
    });
    if (I.length && a.name === 'L12') errors.push('L12 では交互作用を割り付けられません（2 因子の交互作用がほかの列に部分的に分散するため）');
    if (I.length && a.name === 'L18') {
      if (I.length > 1) errors.push('L18 で割り付けられる交互作用は 1 つ（列1 × 列2）だけです');
      for (const [p, q] of I) {
        const lv = [F[p].nlev, F[q].nlev].sort();
        if (lv[0] !== 2 || lv[1] !== 3) errors.push('L18 の交互作用は、2 水準の因子（列1）と 3 水準の因子（列2）の組だけです');
      }
    }
    if (F.length > a.nc) errors.push(`因子が ${a.nc} 個を超えています（${a.name} の列数は ${a.nc}）`);
    if (errors.length) return { ok: false, errors, warnings, array: a };

    // 探索の順番：列を指定した因子 → 交互作用に関わる因子（多い順）→ 残り
    const nInter = F.map((_, i) => I.filter(([p, q]) => p === i || q === i).length);
    const order = F.map((_, i) => i).sort((x, y) => (F[y].col != null) - (F[x].col != null) || nInter[y] - nInter[x] || x - y);
    // 各因子の候補の列（本来の水準数が合う列を先に、擬水準は後に）
    const cand = F.map((f, i) => {
      if (f.col != null) return [f.col];
      let cs = [];
      for (let c = 0; c < a.nc; c++) if (canPlace(a, f, c)) cs.push(c);
      // 交互作用に関わる因子は擬水準にしない（交互作用の自由度・水準の対応が崩れるため）
      if (nInter[i]) cs = cs.filter(c => a.levels[c] === f.nlev);
      if (a.name === 'L18' && nInter[i]) cs = cs.filter(c => c === (f.nlev === 2 ? 0 : 1));
      return cs.sort((x, y) => (a.levels[x] !== f.nlev) - (a.levels[y] !== f.nlev) || x - y);
    });
    F.forEach((f, i) => { if (f.col != null && nInter[i] && a.levels[f.col] !== f.nlev) errors.push(`因子「${f.name}」は交互作用に関わるので、擬水準にはできません`); });
    if (errors.length) return { ok: false, errors, warnings, array: a };

    const colOf = new Array(F.length).fill(null);
    const used = new Map(); // 列 → 使っているもの
    let steps = 0, found = null;
    function interOK(f) {
      // 因子 f を置いたことで両方の因子がそろった交互作用の列が空いているか。戻り値：使う列の一覧（失敗なら null）
      const take = [];
      for (const [p, q] of I) {
        if (p !== f && q !== f) continue;
        if (colOf[p] == null || colOf[q] == null) continue;
        const ic = interCols(a, colOf[p], colOf[q]);
        if (!ic) return null;
        for (const c of ic.cols) { if (used.has(c) || take.includes(c)) return null; take.push(c); }
      }
      return take;
    }
    function dfs(k) {
      if (found || ++steps > 200000) return;
      if (k === order.length) { found = colOf.slice(); return; }
      const f = order[k];
      for (const c of cand[f]) {
        if (used.has(c)) continue;
        colOf[f] = c; used.set(c, 'f' + f);
        const take = interOK(f);
        if (take) {
          // 交互作用の列を使用中にして次の因子へ
          take.forEach(t => used.set(t, 'i'));
          dfs(k + 1);
          take.forEach(t => used.delete(t));
        }
        used.delete(c); colOf[f] = null;
        if (found) return;
      }
    }
    dfs(0);
    if (!found) {
      return { ok: false, errors: [steps > 200000 ? '割り付けの探索が打ち切られました。列を一部指定してください' : `${a.name} にこの因子と交互作用の組み合わせは割り付けられません。大きい直交表にするか、交互作用を減らしてください`], warnings, array: a };
    }
    const inter = I.map(([p, q]) => ({ a: p, b: q, ...interCols(a, found[p], found[q]) }));
    const pseudo = F.map((f, i) => a.levels[found[i]] !== f.nlev);
    // 列ごとの使い方と交絡の表
    const table = [];
    for (let c = 0; c < a.nc; c++) {
      const fi = found.indexOf(c);
      const it = inter.find(x => x.cols.includes(c));
      const row = { col: c, levels: a.levels[c], use: fi >= 0 ? 'factor' : it ? 'inter' : 'empty', factor: fi >= 0 ? fi : null, inter: it ? inter.indexOf(it) : null, alias: [] };
      // 割り付けていない 2 因子の交互作用がこの列に現れるか
      for (let p = 0; p < F.length; p++) for (let q = p + 1; q < F.length; q++) {
        if (inter.some(x => (x.a === p && x.b === q) || (x.a === q && x.b === p))) continue;
        if (pseudo[p] || pseudo[q]) continue;
        const ic = interCols(a, found[p], found[q]);
        if (ic && ic.cols.includes(c)) row.alias.push([p, q]);
      }
      table.push(row);
    }
    if (table.some(r => r.use !== 'empty' && r.alias.length)) warnings.push('割り付けた列に、割り付けていない交互作用が現れる（交絡する）列があります。その交互作用がないと考えてよいか確認してください');
    if (a.partial) warnings.push(`${a.name} では、割り付けていない 2 因子の交互作用がほかの列に部分的に分散します。確認実験で利得が再現するかを確かめてください`);
    return { ok: true, errors, warnings, array: a, cols: found, pseudo, inter, table };
  }

  // 実験 r（0 始まり）での因子 f の水準（0 始まり）
  function levelOf(a, asg, F, f, r) {
    const v = a.rows[r][asg.cols[f]];
    if (!asg.pseudo[f]) return v;
    return v < 2 ? v : (F[f].dup || 0); // 擬水準：列の水準3 を指定した水準に置き換える
  }
  // 実験ごとの因子の水準の表（N 行 × 因子数）
  function runLevels(design, asg) {
    const a = asg.array;
    return a.rows.map((_, r) => design.factors.map((_, f) => levelOf(a, asg, design.factors, f, r)));
  }

  // =========================================================================
  // 特性値の指標（1 行分の値から）
  // =========================================================================
  // char: 'smaller'（望小）・'larger'（望大）・'nominal1'（望目タイプI）・'nominal2'（望目タイプII）
  // metric: 'mean'（平均）・'sd'（標準偏差）・'sn'（SN比）・'sens'（感度）
  const log10 = Math.log10;
  function metricOf(y, metric, char) {
    const n = y.length;
    const sum = y.reduce((s, v) => s + v, 0), mean = sum / n;
    const ss = y.reduce((s, v) => s + (v - mean) ** 2, 0);
    const Ve = n > 1 ? ss / (n - 1) : NaN;
    const Sm = sum * sum / n;
    if (metric === 'mean') return { v: mean };
    if (metric === 'sd') return n < 2 ? { err: 'データが 1 個では標準偏差を計算できません' } : { v: Math.sqrt(Ve) };
    if (metric === 'sens') {
      if (char === 'nominal1') {
        if (n < 2) return { err: '望目特性はデータが 2 個以上必要です' };
        if (!(Sm - Ve > 0)) return { err: 'Sm ≦ Ve のため感度を計算できません' };
        return { v: 10 * log10((Sm - Ve) / n) };
      }
      return { v: mean };
    }
    // SN比（db）
    if (char === 'smaller') {
      const q = y.reduce((s, v) => s + v * v, 0) / n;
      return q > 0 ? { v: -10 * log10(q) } : { err: 'すべて 0 のため望小特性の SN比を計算できません' };
    }
    if (char === 'larger') {
      if (y.some(v => v <= 0)) return { err: '望大特性の SN比は正の値でないと計算できません' };
      return { v: -10 * log10(y.reduce((s, v) => s + 1 / (v * v), 0) / n) };
    }
    if (n < 2) return { err: '望目特性はデータが 2 個以上必要です' };
    if (!(Ve > 0)) return { err: 'データがすべて同じ値（Ve = 0）のため SN比を計算できません' };
    if (char === 'nominal1') {
      if (!(Sm - Ve > 0)) return { err: 'Sm ≦ Ve のため SN比を計算できません（平均が 0 に近い・負の値を含む特性はタイプII を使ってください）' };
      return { v: 10 * log10(((Sm - Ve) / n) / Ve) };
    }
    return { v: -10 * log10(Ve) }; // nominal2
  }
  // 特性の種類ごとに使える指標
  function metricsFor(char, k) {
    const m = ['mean'];
    if (k >= 2) m.push('sd');
    if (char === 'smaller' || char === 'larger' || k >= 2) m.push('sn');
    if (char === 'nominal1' && k >= 2) m.push('sens');
    return m;
  }
  const METRIC_LABEL = { mean: '平均', sd: '標準偏差', sn: 'SN比', sens: '感度' };
  // 指標の良い向き：+1 大きいほど良い、−1 小さいほど良い、0 決まらない（目標値に合わせる）
  function goodDir(metric, char) {
    if (metric === 'sn') return 1;
    if (metric === 'sd') return -1;
    if (metric === 'mean') return char === 'smaller' ? -1 : char === 'larger' ? 1 : 0;
    return 0;
  }

  // =========================================================================
  // 行列の小道具（最小二乗による推定と、その分散）
  // =========================================================================
  // 対称正定値行列の逆行列（ガウス・ジョルダン法、部分ピボット）
  function inverse(A) {
    const n = A.length, M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-10) throw new Error('特異行列');
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r.slice(n));
  }

  // =========================================================================
  // 分散分析
  // =========================================================================
  // 項の一覧：主効果（因子）と交互作用
  function termsOf(design, asg) {
    const F = design.factors;
    const terms = F.map((f, i) => ({ key: 'f' + i, type: 'main', f: i, label: f.name, df: f.nlev - 1 }));
    asg.inter.forEach((it, k) => terms.push({ key: 'i' + it.a + '-' + it.b, type: 'inter', a: it.a, b: it.b, label: `${F[it.a].name}×${F[it.b].name}`, df: (F[it.a].nlev - 1) * (F[it.b].nlev - 1) }));
    return terms;
  }
  // 群ごとの合計から平方和：Σ T²/n − CT
  function groupSS(values, keys) {
    const m = new Map();
    let tot = 0;
    values.forEach((v, i) => { const g = m.get(keys[i]) || [0, 0]; g[0] += v; g[1]++; m.set(keys[i], g); tot += v; });
    let s = 0;
    for (const [t, n] of m.values()) s += t * t / n;
    return s - tot * tot / values.length;
  }

  // data: N 行 × k 列の数値。opts: { kind: 'repeat'|'noise', char, metric, pool: 項の key の配列（null なら候補を使う）, alpha }
  // 戻り値：{ units, terms（S・df・V・F・p・寄与率・pooled）, ST, dfT, Se, dfe, Vp, dfp, …, errors, warnings }
  function analyze(design, asg, data, opts) {
    const a = asg.array, F = design.factors, N = a.N;
    const char = opts.char || 'nominal1', metric = opts.metric || 'mean', kind = opts.kind || 'repeat';
    const errors = [], warnings = [];
    if (!Array.isArray(data) || data.length !== N) return { errors: [`データの行数が実験数（${N}）と合いません`] };
    const k = data[0].length;
    for (let r = 0; r < N; r++) {
      if (data[r].length !== k || data[r].some(v => !Number.isFinite(v))) { errors.push(`実験 No.${r + 1} に空欄か数値でない値があります（欠測があると直交性が崩れるため、すべて埋めてください）`); }
    }
    if (errors.length) return { errors };
    const lev = runLevels(design, asg);
    // 解析する単位：繰り返しの平均は全データ、それ以外は行ごとの指標
    let units = [], unitRow = [];
    const raw = metric === 'mean' && kind === 'repeat' && k > 1;
    if (raw) {
      for (let r = 0; r < N; r++) for (let j = 0; j < k; j++) { units.push(data[r][j]); unitRow.push(r); }
    } else {
      for (let r = 0; r < N; r++) {
        const m = metricOf(data[r], metric, char);
        if (m.err) errors.push(`実験 No.${r + 1}：${m.err}`);
        units.push(m.v); unitRow.push(r);
      }
      if (errors.length) return { errors };
    }
    if (char === 'nominal1' && metric !== 'mean' && data.some(row => row.some(v => v <= 0))) warnings.push('0 以下の値があります。望目特性タイプI は正の値で、ばらつきが平均に比例する特性を想定しています');
    const n = units.length, mean = units.reduce((s, v) => s + v, 0) / n;
    const ST = units.reduce((s, v) => s + (v - mean) ** 2, 0), dfT = n - 1;
    const terms = termsOf(design, asg);
    const lvU = unitRow.map(r => lev[r]);
    const ssMain = f => groupSS(units, lvU.map(l => l[f]));
    for (const t of terms) {
      if (t.type === 'main') t.S = ssMain(t.f);
      else t.S = groupSS(units, lvU.map(l => l[t.a] * 3 + l[t.b])) - ssMain(t.a) - ssMain(t.b);
      if (Math.abs(t.S) < 1e-12 * (ST || 1)) t.S = Math.max(0, t.S);
    }
    let Se = ST - terms.reduce((s, t) => s + t.S, 0);
    const dfe = dfT - terms.reduce((s, t) => s + t.df, 0);
    if (Math.abs(Se) < 1e-10 * (ST || 1)) Se = 0;
    // 繰り返しの誤差（行の中のばらつき）と、それ以外（空き列など）の誤差
    let e2 = null;
    if (raw) {
      let s = 0;
      for (let r = 0; r < N; r++) { const m = data[r].reduce((x, v) => x + v, 0) / k; s += data[r].reduce((x, v) => x + (v - m) ** 2, 0); }
      e2 = { S: s, df: N * (k - 1) };
    }
    terms.forEach(t => { t.V = t.S / t.df; });
    const suggestion = suggestPool(terms, Se, dfe);
    const pool = new Set(opts.pool == null ? suggestion : opts.pool.filter(key => terms.some(t => t.key === key)));
    // 交互作用がプールされずに残るなら、その主効果は推定に含める（主効果自体のプールは F 検定上の扱いだけ）
    const Sp = Se + terms.filter(t => pool.has(t.key)).reduce((s, t) => s + t.S, 0);
    const dfp = dfe + terms.filter(t => pool.has(t.key)).reduce((s, t) => s + t.df, 0);
    const Vp = dfp > 0 ? Sp / dfp : NaN;
    const alpha = opts.alpha || 0.05;
    for (const t of terms) {
      t.pooled = pool.has(t.key);
      t.F = !t.pooled && dfp > 0 && Vp > 0 ? t.V / Vp : NaN;
      t.p = Number.isFinite(t.F) ? S.fSf(t.F, t.df, dfp) : NaN;
      t.sig = Number.isFinite(t.p) && t.p < alpha;
      t.rho = !t.pooled && ST > 0 && Number.isFinite(Vp) ? (t.S - t.df * Vp) / ST : NaN;
    }
    const rhoE = ST > 0 && Number.isFinite(Vp) ? (Sp + terms.filter(t => !t.pooled).reduce((s, t) => s + t.df, 0) * Vp) / ST : NaN;
    for (const t of terms) if (t.type === 'inter' && !t.pooled && (pool.has('f' + t.a) || pool.has('f' + t.b))) warnings.push(`交互作用 ${t.label} を残したまま、その主効果をプールしています。推定には主効果も含めます`);
    if (dfp === 0) warnings.push('誤差の自由度が 0 です。効果の小さい項をプールしないと検定と区間推定ができません');
    else if (dfp < 3) warnings.push(`誤差の自由度が ${dfp} と小さいため、検定の検出力と区間推定の精度が低くなります`);

    // 水準ごとの平均（要因効果図）と、交互作用のセルの平均
    const levelMeans = F.map((f, i) => {
      const s = new Array(f.nlev).fill(0), c = new Array(f.nlev).fill(0);
      units.forEach((v, u) => { s[lvU[u][i]] += v; c[lvU[u][i]]++; });
      return s.map((x, j) => (c[j] ? x / c[j] : NaN));
    });
    const cellMeans = asg.inter.map(it => {
      const s = [], c = [];
      for (let i = 0; i < F[it.a].nlev; i++) { s.push(new Array(F[it.b].nlev).fill(0)); c.push(new Array(F[it.b].nlev).fill(0)); }
      units.forEach((v, u) => { s[lvU[u][it.a]][lvU[u][it.b]] += v; c[lvU[u][it.a]][lvU[u][it.b]]++; });
      return s.map((row, i) => row.map((x, j) => x / c[i][j]));
    });
    const res = { metric, char, kind, raw, k, N, n, units, unitRow, lev, mean, ST, dfT, terms, Se, dfe, e2, suggestion, pool: [...pool], Sp, dfp, Vp, rhoE, alpha, levelMeans, cellMeans, errors, warnings };
    // 推定に使うモデル（プールしていない項）と外れ値の確認
    try {
      res.model = fitModel(res, F);
      if (dfp >= 3 && Vp > 0) {
        const lim = 3 * Math.sqrt(Vp), out = [];
        units.forEach((v, u) => { if (Math.abs(v - res.model.fitted[u]) > lim) out.push(unitRow[u]); });
        if (out.length) warnings.push(`外れ値の可能性：実験 No.${[...new Set(out)].map(r => r + 1).join('・')}（残差が誤差の標準偏差の 3 倍を超えています）。記録・測定の誤りがないか確認してください`);
      }
    } catch (e) { res.model = null; }
    return res;
  }

  // プールの候補：誤差の自由度が 0 なら効果（V）の小さい半分をまずプールし、そのあと F < 2 の項を順に加える
  function suggestPool(terms, Se, dfe) {
    const pool = new Set();
    const err = () => {
      let s = Se, d = dfe;
      for (const t of terms) if (pool.has(t.key)) { s += t.S; d += t.df; }
      return { s, d };
    };
    if (dfe === 0) {
      const sorted = terms.slice().sort((x, y) => x.V - y.V);
      for (let i = 0; i < Math.floor(terms.length / 2); i++) pool.add(sorted[i].key);
    }
    for (let guard = 0; guard < terms.length; guard++) {
      const { s, d } = err();
      if (d === 0) break;
      const Ve = s / d;
      const add = terms.filter(t => !pool.has(t.key) && (Ve > 0 ? t.V / Ve < 2 : t.V === 0));
      if (!add.length) break;
      add.sort((x, y) => x.V - y.V);
      pool.add(add[0].key); // 1 つずつ加えて誤差分散を更新する
    }
    // 交互作用を残すなら、その主効果も残す（階層の原則）
    for (const t of terms) if (t.type === 'inter' && !pool.has(t.key)) { pool.delete('f' + t.a); pool.delete('f' + t.b); }
    // すべてプールしてしまう場合は、最も大きい項を残す
    if (pool.size === terms.length && terms.length) { const big = terms.slice().sort((x, y) => y.V - x.V)[0]; pool.delete(big.key); }
    return [...pool];
  }

  // プールしていない項による最小二乗モデル（推定値と、その分散 = Vp・xᵀ(XᵀX)⁻¹x）
  // 交互作用が残るときは、その主効果をプールしていても推定に含める
  function fitModel(res, F) {
    const kept = res.terms.filter(t => !t.pooled);
    const mains = new Set();
    for (const t of kept) { if (t.type === 'main') mains.add(t.f); else { mains.add(t.a); mains.add(t.b); } }
    const inters = kept.filter(t => t.type === 'inter');
    const mainList = [...mains].sort((x, y) => x - y);
    // 処理対比（水準1 を基準）のダミー変数
    const row = lv => {
      const x = [1];
      for (const f of mainList) for (let j = 1; j < F[f].nlev; j++) x.push(lv[f] === j ? 1 : 0);
      for (const t of inters) for (let i = 1; i < F[t.a].nlev; i++) for (let j = 1; j < F[t.b].nlev; j++) x.push(lv[t.a] === i && lv[t.b] === j ? 1 : 0);
      return x;
    };
    const X = res.unitRow.map(r => row(res.lev[r])), y = res.units, p = X[0].length;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
    X.forEach((x, u) => { for (let i = 0; i < p; i++) { Xty[i] += x[i] * y[u]; for (let j = 0; j < p; j++) XtX[i][j] += x[i] * x[j]; } });
    const inv = inverse(XtX);
    const beta = inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
    const fitted = X.map(x => x.reduce((s, v, j) => s + v * beta[j], 0));
    const df = mainList.reduce((s, f) => s + F[f].nlev - 1, 0) + inters.reduce((s, t) => s + t.df, 0);
    return { mainList, inters, beta, inv, fitted, row, df };
  }

  // 条件（因子ごとの水準）での推定値と信頼区間。m は確認実験で平均するデータ数（予測区間に使う）
  function estimate(res, cond, m = 1) {
    const md = res.model;
    if (!md) return null;
    const x = md.row(cond);
    const est = x.reduce((s, v, j) => s + v * md.beta[j], 0);
    const q = x.reduce((s, v, i) => s + v * md.inv[i].reduce((t, w, j) => t + w * x[j], 0), 0); // xᵀ(XᵀX)⁻¹x
    const out = { est, ne: q > 0 ? 1 / q : NaN, m };
    if (res.dfp > 0 && res.Vp >= 0) {
      const t = S.tPpf(1 - res.alpha / 2, res.dfp);
      const se = Math.sqrt(res.Vp * q), sePred = Math.sqrt(res.Vp * (q + 1 / m));
      out.t = t; out.se = se; out.ci = [est - t * se, est + t * se]; out.pi = [est - t * sePred, est + t * sePred];
    }
    return out;
  }
  // 2 つの条件の差（利得）の推定値と信頼区間
  function gain(res, condA, condB) {
    const md = res.model;
    if (!md) return null;
    const xa = md.row(condA), xb = md.row(condB), d = xa.map((v, i) => v - xb[i]);
    const est = d.reduce((s, v, j) => s + v * md.beta[j], 0);
    const q = d.reduce((s, v, i) => s + v * md.inv[i].reduce((t, w, j) => t + w * d[j], 0), 0);
    const out = { est };
    if (res.dfp > 0) { const t = S.tPpf(1 - res.alpha / 2, res.dfp), se = Math.sqrt(res.Vp * q); out.ci = [est - t * se, est + t * se]; }
    return out;
  }
  // 推定値が最も良くなる条件。推定に使う因子の水準の組み合わせを総当たりし、使わない因子は水準ごとの平均で選ぶ
  // dir: +1 最大化、−1 最小化
  function bestCondition(res, F, dir) {
    const md = res.model;
    const cond = F.map((f, i) => {
      const lm = res.levelMeans[i];
      let b = 0;
      lm.forEach((v, j) => { if (dir * v > dir * lm[b] + 1e-12) b = j; });
      return b;
    });
    if (!md || !md.mainList.length) return cond;
    const fs = md.mainList, total = fs.reduce((s, f) => s * F[f].nlev, 1);
    if (total > 50000) {
      return cond; // 組み合わせが多すぎるときは水準ごとの平均で選んだ条件のまま
    }
    let best = null, bestV = -Infinity;
    const cur = cond.slice();
    for (let idx = 0; idx < total; idx++) {
      let r = idx;
      for (const f of fs) { cur[f] = r % F[f].nlev; r = Math.floor(r / F[f].nlev); }
      const x = md.row(cur), v = dir * x.reduce((s, w, j) => s + w * md.beta[j], 0);
      if (v > bestV + 1e-12) { bestV = v; best = cur.slice(); }
    }
    return best;
  }

  // 2 段階設計：SN比の分析と平均（望目タイプIは感度）の分析から因子を分類する
  function classify(F, snRes, adjRes) {
    return F.map((f, i) => {
      const snT = snRes ? snRes.terms.find(t => t.key === 'f' + i) : null;
      const adT = adjRes ? adjRes.terms.find(t => t.key === 'f' + i) : null;
      const sn = !!(snT && !snT.pooled), adj = !!(adT && !adT.pooled);
      const kind = sn && adj ? 'both' : sn ? 'sn' : adj ? 'adjust' : 'none';
      const range = r => r ? Math.max(...r.levelMeans[i]) - Math.min(...r.levelMeans[i]) : NaN;
      return { f: i, kind, sn, adj, snRange: range(snRes), adjRange: range(adjRes) };
    });
  }

  const toNum = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    const s = String(v).trim().replace(/,/g, '').replace(/[０-９．－＋]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/−/g, '-');
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
  };

  const api = {
    ARRAY_NAMES, ARRAY_DEFS, getArray, interCols, isOrthogonal, assign, runLevels, levelOf,
    metricOf, metricsFor, METRIC_LABEL, goodDir, termsOf, analyze, suggestPool, estimate, gain, bestCondition, classify, inverse, toNum,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DoeCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
