// 画面処理：実験の設定、因子と割り付け、実験順序表、データ入力、分散分析・要因効果図・2 段階設計・推定・確認実験、保存・印刷
(function () {
  'use strict';
  const D = window.DoeCalc, C = window.CpkCharts, G = window.DoeCharts, T = window.MsaTable;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = D.toNum;

  // ---------- 共通 ----------
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2800);
  }
  const sig = (v, n = 4) => v == null || !Number.isFinite(v) ? '―' : (Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(n))));
  const fix = (v, d = 2) => v == null || !Number.isFinite(v) ? '―' : v.toFixed(d);
  const pval = p => p == null || !Number.isFinite(p) ? '―' : p < 0.0001 ? '< 0.0001' : p.toFixed(4);
  const pctv = v => v == null || !Number.isFinite(v) ? '―' : (100 * v).toFixed(1) + '%';
  function download(data, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
  const debounce = (f, ms = 300) => { let h; return () => { clearTimeout(h); h = setTimeout(f, ms); }; };
  const safeName = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();

  // ---------- 状態と保存 ----------
  const KEY = 'doe-calc-v1';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const newFactor = (i, nlev = 2) => ({ name: LETTERS[i] || `因子${i + 1}`, unit: '', nlev, levels: ['', '', ''], col: 'auto', dup: 0 });
  function defaults() {
    return {
      title: '', charName: '', charUnit: '', char: 'nominal1', array: 'L8',
      factors: [newFactor(0), newFactor(1), newFactor(2)], inter: [],
      outer: { kind: 'repeat', k: 2, names: [] }, seed: 1, data: [],
      metric: 'sn', alpha: 0.05, pool: {}, optCond: null, curCond: null,
      conf: { opt: [], cur: [] }, tol: 30, sig: '', tab: 'plan',
    };
  }
  let st = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.factors)) st = Object.assign(defaults(), s);
  } catch (e) { /* 保存できない環境・壊れた保存データは既定値で始める */ }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); $('#saved').textContent = 'この端末に保存しました'; } catch (e) { /* 無視 */ } }, 400);
  }

  // ---------- テーマ・タブ ----------
  const charts = [];
  function mount(id, render) {
    const el = document.getElementById(id); if (!el) return;
    const draw = () => { const btn = el.querySelector('.save'); el.innerHTML = render(); if (btn) el.appendChild(btn); };
    draw(); charts.push({ el, render: draw });
  }
  function redrawCharts() { for (let i = charts.length - 1; i >= 0; i--) { if (!document.body.contains(charts[i].el)) charts.splice(i, 1); else charts[i].render(); } }
  const chartHtml = (id, name, wide) => `<div class="chart${wide ? ' wide' : ''}" id="${id}"><button class="btn small save no-print" type="button" data-png="${id}" data-name="${esc(name)}">画像を保存</button></div>`;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-png]'); if (!b) return;
    const svg = document.getElementById(b.dataset.png).querySelector('svg');
    if (svg) C.svgToPng(svg, `${stamp()}_${b.dataset.name}.png`);
  });
  const THEMES = ['auto', 'light', 'dark'], THEME_LABEL = { auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク' };
  const THEME_KEY = 'qc-workbench-theme';
  const readTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return THEMES.includes(t) ? t : 'auto'; } catch (e) { return 'auto'; } };
  let theme = readTheme();
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    $('#themeBtn').textContent = THEME_LABEL[t]; redrawCharts();
  }
  $('#themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 無視 */ } applyTheme(theme); });
  window.addEventListener('storage', e => { if (e.key === THEME_KEY || e.key === null) { theme = readTheme(); applyTheme(theme); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') redrawCharts(); });
  const TABS = ['plan', 'analysis', 'explain'];
  function showTab(tab) {
    if (!TABS.includes(tab)) tab = 'plan';
    $$('nav.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === tab)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
    st.tab = tab;
    if (tab === 'analysis') { grid.render(); compute(); }
    redrawCharts();
  }
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); save(); window.scrollTo({ top: 0 }); }));

  // ---------- 計画の組み立て ----------
  const arr = () => D.getArray(st.array);
  const K = () => Math.max(1, Math.min(10, st.outer.k | 0));
  function outerName(j) {
    const n = (st.outer.names[j] || '').trim();
    if (n) return n;
    return st.outer.kind === 'noise' ? `N${j + 1}` : (K() === 1 ? 'データ' : `${j + 1}回目`);
  }
  const levelLabel = (f, j) => (f.levels[j] || '').trim() || `水準${j + 1}`;
  const levelFull = (f, j) => { const v = (f.levels[j] || '').trim(); return v ? (f.unit ? `${v} ${f.unit}` : v) : `水準${j + 1}`; };
  const facName = (f, i) => (f.name || '').trim() || LETTERS[i] || `因子${i + 1}`;
  function design() {
    return {
      array: st.array,
      factors: st.factors.map((f, i) => ({ name: facName(f, i), nlev: f.nlev, col: f.col === 'auto' ? null : (f.col | 0) - 1, dup: f.dup | 0 })),
      inter: st.inter.filter(([p, q]) => st.factors[p] && st.factors[q]),
    };
  }
  let DES = null, ASG = null;
  function recomputeAssign() {
    DES = design();
    ASG = D.assign(DES);
    // 割り付けや特性の種類が変わったら、プールの指定と条件の選択を初期化する
    const sigNow = JSON.stringify([st.array, ASG.ok ? ASG.cols : null, DES.inter, st.factors.map(f => f.nlev), st.char, st.outer.kind, K()]);
    if (st.sig !== sigNow) { st.sig = sigNow; st.pool = {}; st.optCond = null; st.curCond = null; }
  }
  function fixShape() {
    const N = arr().N, k = K();
    st.data = st.data.slice(0, N);
    while (st.data.length < N) st.data.push([]);
    st.data = st.data.map(r => { const x = (r || []).slice(0, k); while (x.length < k) x.push(''); return x; });
    for (const key of ['opt', 'cur']) { const x = (st.conf[key] || []).slice(0, k); while (x.length < k) x.push(''); st.conf[key] = x; }
  }

  // ---------- 1. 実験の設定 ----------
  $('#arraySel').innerHTML = D.ARRAY_NAMES.map(n => `<option value="${n}">${n}（${D.getArray(n).N} 実験・${D.ARRAY_DEFS[n].note}）</option>`).join('');
  const CHAR_HINT = {
    smaller: 'SN比 η = −10 log₁₀(Σy²/n)。0 に近いほど良い特性（摩耗量・不良率・騒音など）。',
    larger: 'SN比 η = −10 log₁₀(Σ(1/y²)/n)。大きいほど良い特性（強度・寿命など）。正の値だけ使えます。',
    nominal1: 'SN比 η = 10 log₁₀[(Sm − Ve)/n ÷ Ve]、感度 S = 10 log₁₀[(Sm − Ve)/n]。ばらつきが平均に比例する正の値（寸法・重さなど）。1 つの実験でデータが 2 個以上必要です。',
    nominal2: 'SN比 η = −10 log₁₀(Ve)。0 をまたぐ値や、平均を変えてもばらつきが変わらない特性（ずれ量・位置など）。1 つの実験でデータが 2 個以上必要です。',
  };
  function renderSetup() {
    $('#titleIn').value = st.title; $('#charNameIn').value = st.charName; $('#charUnitIn').value = st.charUnit;
    $('#charSel').value = st.char; $('#arraySel').value = st.array; $('#kIn').value = K();
    $('#charHint').textContent = CHAR_HINT[st.char];
    $$('#outerSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.outer.kind)));
    $('#outerHint').textContent = st.outer.kind === 'noise'
      ? '誤差因子（使用環境・材料のばらつきなど）を、特性値が小さくなる条件（N1）と大きくなる条件（N2）などにまとめ、同じ実験 No. で全条件を測ります。条件の名前を変えられます。'
      : '同じ条件で繰り返して測ります。平均の分散分析は全データで行い、繰り返しの誤差を誤差に含めます。';
    const k = K();
    $('#outerNames').innerHTML = st.outer.kind === 'noise' || k > 1
      ? Array.from({ length: k }, (_, j) => `<input type="text" data-oname="${j}" size="${Math.max(6, [...(st.outer.names[j] || '')].length * 2)}" value="${esc(st.outer.names[j] || '')}" placeholder="${esc(st.outer.kind === 'noise' ? `N${j + 1}` : `${j + 1}回目`)}" aria-label="データ${j + 1}の名前">`).join('')
      : '';
  }
  const onSetup = debounce(() => { refreshPlan(); }, 250);
  $('#titleIn').addEventListener('input', e => { st.title = e.target.value; save(); });
  $('#charNameIn').addEventListener('input', e => { st.charName = e.target.value; save(); });
  $('#charUnitIn').addEventListener('input', e => { st.charUnit = e.target.value; save(); });
  $('#charSel').addEventListener('change', e => { st.char = e.target.value; if (st.char.startsWith('nominal') && K() < 2) st.outer.k = 2; refreshPlan(); });
  $('#arraySel').addEventListener('change', e => {
    st.array = e.target.value;
    // 指定した列が新しい表にないなら自動に戻す
    const a = arr();
    st.factors.forEach(f => { if (f.col !== 'auto' && ((f.col | 0) > a.nc || !canUse(f, (f.col | 0) - 1))) f.col = 'auto'; });
    refreshPlan();
  });
  $$('#outerSeg button').forEach(b => b.addEventListener('click', () => { st.outer.kind = b.dataset.v; refreshPlan(); }));
  $('#kIn').addEventListener('input', e => { const v = num(e.target.value); if (v != null && v >= 1 && v <= 10) { st.outer.k = Math.round(v); onSetup(); } });
  $('#outerNames').addEventListener('input', e => { const j = e.target.dataset.oname; if (j == null) return; st.outer.names[+j] = e.target.value; save(); renderOrder(); grid.render(); });
  const canUse = (f, c) => { const L = arr().levels[c]; return L === f.nlev || (f.nlev === 2 && L === 3); };

  // ---------- 2. 因子と割り付け ----------
  function renderFactors() {
    const a = arr();
    $('#facBody').innerHTML = st.factors.map((f, i) => {
      const colOpts = ['<option value="auto">自動</option>'].concat(Array.from({ length: a.nc }, (_, c) => canUse(f, c) ? `<option value="${c + 1}">${c + 1}</option>` : '')).join('');
      const pseudo = ASG && ASG.ok && ASG.pseudo[i];
      const dupSel = pseudo ? `<select data-f="${i}" data-k="dup" aria-label="重複させる水準">${[0, 1].map(j => `<option value="${j}"${(f.dup | 0) === j ? ' selected' : ''}>${esc(levelLabel(f, j))} を重複</option>`).join('')}</select>` : '';
      return `<tr>
        <td class="l"><input type="text" class="nm" data-f="${i}" data-k="name" value="${esc(f.name)}" aria-label="因子${i + 1}の名前"></td>
        <td class="l"><input type="text" class="un" data-f="${i}" data-k="unit" value="${esc(f.unit)}" placeholder="単位" aria-label="単位"></td>
        <td class="l"><select data-f="${i}" data-k="nlev" aria-label="水準数"><option value="2"${f.nlev === 2 ? ' selected' : ''}>2</option><option value="3"${f.nlev === 3 ? ' selected' : ''}>3</option></select></td>
        ${[0, 1, 2].map(j => `<td class="l">${j < f.nlev ? `<input type="text" class="lv" data-f="${i}" data-k="lv${j}" value="${esc(f.levels[j] || '')}" placeholder="水準${j + 1}" aria-label="水準${j + 1}">` : ''}</td>`).join('')}
        <td class="l"><select data-f="${i}" data-k="col" aria-label="列">${colOpts}</select>${ASG && ASG.ok && f.col === 'auto' ? ` <span class="hint">→ ${ASG.cols[i] + 1}</span>` : ''}</td>
        <td class="ps">${pseudo ? '擬水準 ' + dupSel : ''}</td>
        <td><button class="del" type="button" data-delf="${i}" title="この因子を削除" aria-label="削除">×</button></td>
      </tr>`;
    }).join('');
    st.factors.forEach((f, i) => { const s = $(`#facBody select[data-f="${i}"][data-k="col"]`); if (s) s.value = String(f.col); });
  }
  $('#facBody').addEventListener('input', e => {
    const i = e.target.dataset.f, k = e.target.dataset.k; if (i == null) return;
    const f = st.factors[+i];
    if (k === 'name') f.name = e.target.value;
    else if (k === 'unit') f.unit = e.target.value;
    else if (k && k.startsWith('lv')) f.levels[+k.slice(2)] = e.target.value;
    else return;
    // 文字の入力中は表を作り直さない（フォーカスが外れるため）。割り付けの結果と順序表だけ更新する
    recomputeAssign(); renderInter(true); renderAssign(); renderOrder(); save();
  });
  $('#facBody').addEventListener('change', e => {
    const i = e.target.dataset.f, k = e.target.dataset.k; if (i == null) return;
    const f = st.factors[+i];
    if (k === 'nlev') { f.nlev = +e.target.value; if (f.col !== 'auto' && !canUse(f, (f.col | 0) - 1)) f.col = 'auto'; }
    else if (k === 'col') f.col = e.target.value === 'auto' ? 'auto' : +e.target.value;
    else if (k === 'dup') f.dup = +e.target.value;
    else return;
    refreshPlan();
  });
  $('#facBody').addEventListener('click', e => {
    const b = e.target.closest('[data-delf]'); if (!b) return;
    const i = +b.dataset.delf;
    st.factors.splice(i, 1);
    st.inter = st.inter.filter(([p, q]) => p !== i && q !== i).map(([p, q]) => [p > i ? p - 1 : p, q > i ? q - 1 : q]);
    refreshPlan();
  });
  $('#addFac').addEventListener('click', () => {
    if (st.factors.length >= arr().nc) { toast(`${st.array} の列数（${arr().nc}）を超えるので追加できません`); return; }
    const used = new Set(st.factors.map(f => f.name));
    let i = st.factors.length; while (used.has(LETTERS[i]) && i < 25) i++;
    // 3 水準の列がある表（L9・L18）では 3 水準を既定にする
    st.factors.push(newFactor(i, arr().levels.includes(3) ? 3 : 2)); refreshPlan();
  });
  function renderInter(labelsOnly) {
    const opts = sel => st.factors.map((f, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(facName(f, i))}</option>`).join('');
    if (labelsOnly) { $$('#interList select').forEach(s => { const v = +s.value; s.innerHTML = opts(v); }); return; }
    $('#interList').innerHTML = st.inter.length ? st.inter.map(([p, q], k) => `<div class="it"><select data-ii="${k}" data-side="0" aria-label="因子">${opts(p)}</select><span>×</span><select data-ii="${k}" data-side="1" aria-label="因子">${opts(q)}</select><button class="del" type="button" data-deli="${k}" aria-label="削除">×</button></div>`).join('') : '<p class="hint">なし（交互作用を調べないときは空のままにします）</p>';
  }
  $('#interList').addEventListener('change', e => { const k = e.target.dataset.ii; if (k == null) return; st.inter[+k][+e.target.dataset.side] = +e.target.value; refreshPlan(); });
  $('#interList').addEventListener('click', e => { const b = e.target.closest('[data-deli]'); if (!b) return; st.inter.splice(+b.dataset.deli, 1); refreshPlan(); });
  $('#addInter').addEventListener('click', () => {
    if (st.factors.length < 2) { toast('因子を 2 つ以上入れてください'); return; }
    // まだ指定していない組を選ぶ
    for (let p = 0; p < st.factors.length; p++) for (let q = p + 1; q < st.factors.length; q++) {
      if (!st.inter.some(([a, b]) => (a === p && b === q) || (a === q && b === p))) { st.inter.push([p, q]); refreshPlan(); return; }
    }
    toast('すべての組を指定済みです');
  });
  function renderAssign() {
    const a = arr(), F = DES.factors;
    const log = [];
    if (!ASG.ok) ASG.errors.forEach(m => log.push(`<li class="err">${esc(m)}</li>`));
    else {
      log.push(`<li class="info">${esc(a.name)}：${a.N} 実験 × データ ${K()} 個 ＝ ${a.N * K()} 回の測定。誤差の自由度（行ごとの指標の解析）：${a.N - 1 - D.termsOf(DES, ASG).reduce((s, t) => s + t.df, 0)}</li>`);
      ASG.warnings.forEach(m => log.push(`<li class="warn">${esc(m)}</li>`));
    }
    $('#asgLog').innerHTML = log.join('');
    if (!ASG.ok) { $('#colBody').innerHTML = ''; return; }
    const nameI = it => `${F[it.a].name}×${F[it.b].name}`;
    let h = ASG.table.map(r => {
      let use = '<td class="use-e">空き（誤差）</td>';
      if (r.use === 'factor') use = `<td class="use-f">${esc(F[r.factor].name)}${ASG.pseudo[r.factor] ? `<span class="hint">（擬水準：水準3 → ${esc(levelLabel(st.factors[r.factor], F[r.factor].dup))}）</span>` : ''}</td>`;
      else if (r.use === 'inter') { const it = ASG.inter[r.inter]; use = `<td class="use-i">${esc(nameI(it))}${it.cols.length > 1 ? `<span class="hint">（${it.cols.indexOf(r.col) + 1}/${it.cols.length} 列目）</span>` : ''}</td>`; }
      const al = r.alias.map(([p, q]) => `${F[p].name}×${F[q].name}`).join('、');
      return `<tr><td class="num">${r.col + 1}</td><td class="num">${r.levels}</td>${use}<td class="alias${al ? '' : ' none'}">${al ? esc(al) : '―'}</td></tr>`;
    }).join('');
    ASG.inter.filter(it => it.hidden).forEach(it => { h += `<tr><td class="num">―</td><td class="num">2×3</td><td class="use-i">${esc(nameI(it))}<span class="hint">（列を使わずに求める：列1×列2）</span></td><td class="alias none">―</td></tr>`; });
    $('#colBody').innerHTML = h;
  }

  // ---------- 3. 実験順序表 ----------
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function orderRuns() {
    const N = arr().N, k = K(), u = rng(st.seed * 2654435761);
    const runs = [];
    if (st.outer.kind === 'repeat' && k > 1) { for (let r = 0; r < N; r++) for (let j = 0; j < k; j++) runs.push({ r, j }); }
    else for (let r = 0; r < N; r++) runs.push({ r, j: null });
    for (let i = runs.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [runs[i], runs[j]] = [runs[j], runs[i]]; }
    return runs;
  }
  function orderRows() {
    if (!ASG.ok) return null;
    const lev = D.runLevels(DES, ASG), k = K();
    const head = ['順番', '実験 No.'].concat(st.outer.kind === 'repeat' && k > 1 ? ['回'] : [], st.factors.map((f, i) => facName(f, i) + (f.unit ? `（${f.unit}）` : '')), st.outer.kind === 'noise' ? ['測る条件'] : []);
    const rows = orderRuns().map((x, i) => [String(i + 1), String(x.r + 1)].concat(
      st.outer.kind === 'repeat' && k > 1 ? [outerName(x.j)] : [],
      st.factors.map((f, fi) => levelLabel(f, lev[x.r][fi])),
      st.outer.kind === 'noise' ? [Array.from({ length: k }, (_, j) => outerName(j)).join('・')] : []));
    return { head, rows };
  }
  function renderOrder() {
    const k = K();
    $('#orderHint').textContent = st.outer.kind === 'repeat' && k > 1
      ? `${arr().N} 実験 × ${k} 回の全 ${arr().N * k} 回を、ランダムな順番で行います。同じ条件をまとめて続けて行うと、時間とともに変わる要因（温度・材料・慣れ）が因子の効果に混ざるためです。`
      : st.outer.kind === 'noise' ? `実験 No. をランダムな順番で行い、それぞれで ${Array.from({ length: k }, (_, j) => outerName(j)).join('・')} を測ります。`
        : `実験 No. をランダムな順番で行います。`;
    const o = orderRows();
    if (!o) { $('#orderTbl').innerHTML = '<p class="empty">割り付けを直すと表示します。</p>'; return; }
    $('#orderTbl').innerHTML = `<table class="order"><thead><tr>${o.head.map((h, i) => `<th class="${i >= 2 ? 'l' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${o.rows.map(r => `<tr>${r.map((v, i) => `<td class="${i === 0 ? 'run' : i >= 2 ? 'l' : 'num'}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  $('#shuffleBtn').addEventListener('click', () => { st.seed = (st.seed % 1000000) + 1; renderOrder(); save(); toast('順番を並べ替えました'); });
  $('#orderCsv').addEventListener('click', () => {
    const o = orderRows(); if (!o) return;
    const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = '﻿' + [o.head].concat(o.rows).map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
    download(csv, `${stamp()}_${safeName(st.title) || '実験順序表'}.csv`, 'text/csv');
  });
  $('#orderPrint').addEventListener('click', () => { document.body.classList.add('print-order'); window.print(); });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-order'));

  function refreshPlan() {
    fixShape(); recomputeAssign(); renderSetup(); renderFactors(); renderInter(); renderAssign(); renderOrder(); save();
    if (st.tab === 'analysis') { grid.render(); compute(); }
  }

  // ---------- 4. データ ----------
  const grid = T.create($('#grid'), {
    rows: () => arr().N, cols: () => K(),
    get: (r, c) => (st.data[r] || [])[c], set: (r, c, v) => { st.data[r][c] = v; },
    rowHead: r => {
      const lv = ASG && ASG.ok ? D.runLevels(DES, ASG)[r].map(x => x + 1).join(' ') : '';
      return `No.${r + 1}<span class="lvs">${lv}</span>`;
    },
    colHead: c => esc(outerName(c)),
    grow: () => { /* 実験数は直交表で決まるので広げない */ },
    onPaste: (block, r0, c0) => {
      // 見出しの行（数値でない行）は飛ばす
      const rows = block.filter(row => row.some(v => num(v) != null));
      rows.forEach((row, i) => row.forEach((v, j) => { if (r0 + i < arr().N && c0 + j < K()) st.data[r0 + i][c0 + j] = v.trim(); }));
      if (rows.length + r0 > arr().N || Math.max(...rows.map(r => r.length)) + c0 > K()) toast('表に入らない分は読み込んでいません（実験数・データ数を確認してください）');
      grid.render(); onData(); return true;
    },
    onChange: () => onData(),
  });
  const onData = debounce(() => { save(); compute(); }, 350);
  $('#clearData').addEventListener('click', () => {
    if (!confirm('データ（確認実験の値を含む）をすべて消します。よろしいですか？')) return;
    st.data = []; st.conf = { opt: [], cur: [] }; fixShape(); grid.render(); save(); compute();
  });

  // ---------- 5. 解析 ----------
  let RES = {}, METRICS = [];
  function dataMatrix() {
    return st.data.map(r => r.map(v => { const x = num(v); return x == null ? NaN : x; }));
  }
  const filled = () => st.data.some(r => r.some(v => String(v).trim() !== ''));
  const yUnit = m => m === 'sn' || (m === 'sens' && st.char === 'nominal1') ? 'db' : (st.charUnit || '');
  const metricName = m => m === 'sens' && st.char === 'nominal2' ? '感度（平均）' : D.METRIC_LABEL[m];
  const charLabel = () => (st.charName || '特性値') + (st.charUnit ? `（${st.charUnit}）` : '');
  const CHAR_NAME = { smaller: '望小特性', larger: '望大特性', nominal1: '望目特性タイプI', nominal2: '望目特性タイプII' };

  function compute() {
    const out = $('#out');
    // 入力中のフォーカスを、作り直した後に戻す
    const act = document.activeElement, actId = act && out.contains(act) ? act.id : null, selS = actId ? act.selectionStart : null;
    out.innerHTML = renderOut();
    charts.length = 0;
    afterRender();
    if (actId) { const el = document.getElementById(actId); if (el) { el.focus(); try { el.setSelectionRange(selS, selS); } catch (e) { /* 数値欄など */ } } }
  }

  function renderOut() {
    RES = {}; METRICS = [];
    if (!ASG || !ASG.ok) return '<h2><span class="step">5</span>結果</h2><p class="err-msg">計画タブの「因子と割り付け」を直してください。</p>';
    if (!filled()) return '<h2><span class="step">5</span>結果</h2><p class="empty">データを入れると、ここに分散分析・要因効果図・推定の結果を表示します。動作を確かめるときは「サンプル」のボタンを押してください（計画も入れ替わります）。</p>';
    const Y = dataMatrix(), k = K(), F = DES.factors;
    METRICS = D.metricsFor(st.char, k);
    if (!METRICS.includes(st.metric)) st.metric = METRICS.includes('sn') ? 'sn' : 'mean';
    for (const m of METRICS) RES[m] = D.analyze(DES, ASG, Y, { kind: st.outer.kind, char: st.char, metric: m, pool: st.pool[m] ?? null, alpha: st.alpha });
    const R = RES[st.metric];
    let h = '<h2><span class="step">5</span>結果</h2>';
    h += `<div class="banner"><span class="big">${esc(st.array)}・${esc(CHAR_NAME[st.char])}</span><span class="sub2">因子 ${F.length} ／ 交互作用 ${DES.inter.length} ／ 1 実験のデータ ${k} 個（${st.outer.kind === 'noise' ? '誤差因子の調合' : '繰り返し'}）／ 特性値：${esc(charLabel())}</span></div>`;
    h += `<div class="metric-bar"><div class="seg seg-wrap" id="metricSeg">${METRICS.map(m => `<button type="button" data-metric="${m}" aria-pressed="${m === st.metric}">${esc(metricName(m))}</button>`).join('')}</div>
      <label class="field"><span class="lbl">有意水準</span><input type="number" id="alphaIn" step="0.01" min="0.001" max="0.5" value="${st.alpha}"></label></div>`;
    h += `<div class="print-only"><h3 class="sec">指標：${esc(metricName(st.metric))}</h3></div>`;
    if (R.errors && R.errors.length) {
      h += `<ul class="log">${R.errors.map(e => `<li class="err">${esc(e)}</li>`).join('')}</ul>`;
      return h + runTable();
    }
    if (R.warnings.length) h += `<ul class="log">${R.warnings.map(w => `<li class="warn">${esc(w)}</li>`).join('')}</ul>`;
    h += anovaTable(R);
    h += '<h3 class="sec">要因効果図</h3><div class="charts">' + chartHtml('effChart', `要因効果図_${metricName(st.metric)}`, true) + DES.inter.map((_, i) => chartHtml(`intChart${i}`, `交互作用図_${i + 1}`)).join('') + '</div>';
    // 2 段階設計は望目特性のとき（望小・望大の SN比は平均の良し悪しも含むので、調整因子の考え方を使わない）
    if (METRICS.includes('sn') && st.char.startsWith('nominal')) h += twoStage();
    h += estimateSec();
    h += confirmSec();
    h += runTable();
    h += planSummary();
    h += `<div class="tools no-print"><button class="btn primary" type="button" id="printBtn">レポートを印刷・PDF</button><button class="btn" type="button" id="saveJson2">保存（JSON）</button></div>`;
    return h;
  }

  function anovaTable(R) {
    const manual = st.pool[st.metric] != null;
    const row = t => `<tr class="${t.pooled ? 'pooled' : ''}"><td class="l">${esc(t.label)}</td><td class="num">${sig(t.S, 5)}</td><td class="num">${t.df}</td><td class="num">${sig(t.V, 5)}</td>
      <td class="num">${t.pooled ? '（プール）' : fix(t.F, 2)}</td><td class="num${t.sig ? ' sig' : ''}">${t.pooled ? '' : pval(t.p)}</td><td class="num">${t.pooled ? '' : pctv(t.rho)}</td>
      <td class="pl no-print"><input type="checkbox" data-pool="${t.key}"${t.pooled ? ' checked' : ''} aria-label="${esc(t.label)} をプール"></td></tr>`;
    let h = `<h3 class="sec">分散分析表（${esc(metricName(st.metric))}${R.raw ? '・全データ' : '・実験ごとの値'}）</h3>`;
    h += `<div class="tbl-wrap"><table class="anova"><thead><tr><th class="l">要因</th><th>平方和 S</th><th>自由度 φ</th><th>分散 V</th><th>F</th><th>p 値</th><th>寄与率 ρ</th><th class="no-print">プール</th></tr></thead><tbody>`;
    h += R.terms.map(row).join('');
    if (R.e2) {
      h += `<tr class="sub"><td class="l">　空き列などの誤差 e₁</td><td class="num">${sig(R.Se - R.e2.S, 5)}</td><td class="num">${R.dfe - R.e2.df}</td><td class="num">${R.dfe - R.e2.df > 0 ? sig((R.Se - R.e2.S) / (R.dfe - R.e2.df), 5) : '―'}</td><td colspan="4"></td></tr>`;
      h += `<tr class="sub"><td class="l">　繰り返しの誤差 e₂</td><td class="num">${sig(R.e2.S, 5)}</td><td class="num">${R.e2.df}</td><td class="num">${R.e2.df > 0 ? sig(R.e2.S / R.e2.df, 5) : '―'}</td><td colspan="4"></td></tr>`;
    }
    h += `<tr class="err"><td class="l">誤差（プール後）</td><td class="num">${sig(R.Sp, 5)}</td><td class="num">${R.dfp}</td><td class="num">${R.dfp > 0 ? sig(R.Vp, 5) : '―'}</td><td></td><td></td><td class="num">${pctv(R.rhoE)}</td><td class="no-print"></td></tr>`;
    h += `<tr class="tot"><td class="l">合計</td><td class="num">${sig(R.ST, 5)}</td><td class="num">${R.dfT}</td><td colspan="5"></td></tr>`;
    h += '</tbody></table></div>';
    h += `<p class="hint">プールの${manual ? '指定は手動です' : '候補を表示しています'}：誤差の自由度が 0 なら効果の小さい半分を、そのあと F &lt; 2 の項を順に誤差に含めます（交互作用を残すなら、その主効果は残します）。最終的な判断はチェックで変えてください。寄与率は純変動 (S − φ·Ve) ÷ 合計です。${manual ? ' <button class="btn small no-print" type="button" id="poolReset">候補に戻す</button>' : ''}</p>`;
    return h;
  }

  // 2 段階設計：SN比で因子を選び、平均（望目タイプIは感度）で調整する
  function twoStage() {
    const sn = RES.sn, adjM = st.char === 'nominal1' && RES.sens ? 'sens' : 'mean', adj = RES[adjM];
    if (!sn || sn.errors.length || !adj || adj.errors.length) return '';
    const F = DES.factors, cls = D.classify(F, sn, adj);
    const LAB = { sn: 'SN比を上げる因子', adjust: '調整因子', both: 'SN比を優先（調整にも効く）', none: 'コスト・作業性で決める' };
    const bestLv = (R, i, dir) => { const lm = R.levelMeans[i]; let b = 0; lm.forEach((v, j) => { if (dir * v > dir * lm[b] + 1e-12) b = j; }); return b; };
    let h = `<h3 class="sec">2 段階設計</h3><p class="hint">SN比に効く因子でばらつきを小さくし、SN比に効かず${esc(metricName(adjM))}だけに効く因子（調整因子）で目標値に合わせます。「効く」はプール後に残った項で、統計的に有意でも実用上は小さい効果がありえるので、幅の大きさも見て判断してください。</p>`;
    h += `<div class="tbl-wrap"><table><thead><tr><th class="l">因子</th><th>SN比</th><th>SN比の幅（db）</th><th class="l">SN比が最大の水準</th><th>${esc(metricName(adjM))}</th><th>${esc(metricName(adjM))}の幅</th><th class="l">分類</th></tr></thead><tbody>`;
    h += cls.map(c => {
      const f = st.factors[c.f];
      return `<tr><td class="l">${esc(F[c.f].name)}</td><td class="${c.sn ? 'sig' : ''}">${c.sn ? '効く' : '―'}</td><td class="num">${fix(c.snRange, 2)}</td><td class="l">${esc(levelFull(f, bestLv(sn, c.f, 1)))}</td>
        <td class="${c.adj ? 'sig' : ''}">${c.adj ? '効く' : '―'}</td><td class="num">${sig(c.adjRange, 3)}</td><td class="l"><span class="kind ${c.kind}">${LAB[c.kind]}</span></td></tr>`;
    }).join('');
    return h + '</tbody></table></div>';
  }

  // 条件（最適・現行）の選択と、各指標の推定
  function defaultOpt() {
    const F = DES.factors;
    const base = RES.sn && !RES.sn.errors.length ? RES.sn : null;
    if (base) return D.bestCondition(base, F, 1);
    const m = RES.mean;
    if (m && !m.errors.length) return D.bestCondition(m, F, D.goodDir('mean', st.char) || 1);
    return F.map(() => 0);
  }
  const validCond = c => Array.isArray(c) && c.length === DES.factors.length && c.every((v, i) => Number.isInteger(v) && v >= 0 && v < DES.factors[i].nlev);
  const optCond = () => (validCond(st.optCond) ? st.optCond : defaultOpt());
  const curCond = () => (validCond(st.curCond) ? st.curCond : DES.factors.map(() => 0));
  // 確認実験で平均するデータ数（全データの平均の分析のときだけ k 個、それ以外は実験ごとの値 1 個）
  const mOf = R => (R.raw ? K() : 1);

  function estimateSec() {
    const F = DES.factors, opt = optCond(), cur = curCond();
    let h = `<h3 class="sec">最適条件の推定</h3><p class="hint">最適条件の初期値は、${RES.sn && !RES.sn.errors.length ? 'SN比の推定値が最大になる組み合わせ' : '平均の推定値が最も良い組み合わせ'}です（プールした因子は水準ごとの平均で選びます）。${st.char.startsWith('nominal') ? '望目特性では、調整因子の水準を変えて平均（感度）を目標値に合わせてください。' : ''}現行条件には今の条件を選びます。</p>`;
    h += `<div class="tbl-wrap"><table class="cond"><thead><tr><th class="l">因子</th><th class="l">最適条件</th><th class="l">現行条件</th></tr></thead><tbody>`;
    h += F.map((f, i) => {
      const opts = sel => Array.from({ length: f.nlev }, (_, j) => `<option value="${j}"${j === sel ? ' selected' : ''}>${esc(levelFull(st.factors[i], j))}</option>`).join('');
      return `<tr><td class="l">${esc(f.name)}</td><td class="l"><select data-cond="opt" data-i="${i}" aria-label="${esc(f.name)} の最適条件">${opts(opt[i])}</select></td><td class="l"><select data-cond="cur" data-i="${i}" aria-label="${esc(f.name)} の現行条件">${opts(cur[i])}</select></td></tr>`;
    }).join('');
    h += '</tbody></table></div>';
    if (validCond(st.optCond)) h += '<div class="tools no-print"><button class="btn small" type="button" id="optReset">最適条件を自動で選び直す</button></div>';
    h += `<div class="tbl-wrap"><table class="est"><thead><tr><th class="l">指標</th><th>最適条件の推定</th><th>信頼区間（${Math.round((1 - st.alpha) * 100)}%）</th><th>現行条件の推定</th><th>差（利得）</th><th>差の信頼区間</th><th>有効反復数</th></tr></thead><tbody>`;
    for (const m of METRICS) {
      const R = RES[m];
      if (R.errors.length || !R.model) { h += `<tr><td class="l">${esc(metricName(m))}</td><td colspan="6" class="l verdict-na">計算できません</td></tr>`; continue; }
      const eo = D.estimate(R, opt, mOf(R)), ec = D.estimate(R, cur, mOf(R)), g = D.gain(R, opt, cur), u = yUnit(m);
      const ci = eo.ci ? `${sig(eo.ci[0], 5)} 〜 ${sig(eo.ci[1], 5)}` : '―（誤差の自由度 0）';
      h += `<tr><td class="l">${esc(metricName(m))}${u ? `（${esc(u)}）` : ''}</td><td class="num best">${sig(eo.est, 5)}</td><td class="num">${ci}</td><td class="num">${sig(ec.est, 5)}</td><td class="num best">${sig(g.est, 4)}</td><td class="num">${g.ci ? `${sig(g.ci[0], 4)} 〜 ${sig(g.ci[1], 4)}` : '―'}</td><td class="num">${fix(eo.ne, 2)}</td></tr>`;
    }
    h += '</tbody></table></div>';
    if (RES.sd && !RES.sd.errors.length && RES.sd.model) {
      const e = D.estimate(RES.sd, opt, 1);
      if (e.est <= 0) h += '<ul class="log"><li class="warn">標準偏差の推定値が 0 以下です。標準偏差は加法性が成り立ちにくいので、ばらつきの評価には SN比を使ってください</li></ul>';
    }
    h += '<p class="hint">推定は、プールしていない項だけで当てはめた最小二乗モデルによります（交互作用を残すと、その主効果も含めます）。有効反復数 n_e は、推定値の分散が Ve ÷ n_e になる数で、直交表では伊奈の式・田口の式と同じ値です。</p>';
    return h;
  }

  // 確認実験：最適条件と現行条件で実験し、利得が再現するかを確かめる
  function confirmSec() {
    const k = K(), opt = optCond(), cur = curCond();
    const inputs = key => Array.from({ length: k }, (_, j) => `<input type="text" inputmode="decimal" id="conf-${key}-${j}" data-conf="${key}" data-j="${j}" value="${esc(st.conf[key][j] || '')}" placeholder="${esc(outerName(j))}" aria-label="${key === 'opt' ? '最適条件' : '現行条件'}の${esc(outerName(j))}">`).join('');
    let h = `<h3 class="sec">確認実験</h3><p class="hint">上で選んだ最適条件と現行条件で、計画と同じ取り方（${k} 個：${Array.from({ length: k }, (_, j) => outerName(j)).join('・')}）でデータを取って入れます。推定した利得と確認実験の利得を比べ、最適条件の値が予測区間に入るかを見ます。</p>`;
    h += `<div class="conf-in"><div class="card"><h4>最適条件</h4>${inputs('opt')}</div><div class="card"><h4>現行条件</h4>${inputs('cur')}</div></div>`;
    h += `<div class="metric-bar" style="margin-top:10px"><label class="field"><span class="lbl">利得の再現の許容幅 ±</span><input type="number" id="tolIn" min="1" max="100" step="1" value="${st.tol}"><span class="lbl">%</span></label></div>`;
    h += '<p class="hint">許容幅の既定値（±30%）は目安です。文献によって基準が異なり、統一された値はありません。</p>';
    const vals = key => st.conf[key].map(num);
    const vo = vals('opt'), vc = vals('cur');
    const okO = vo.every(v => v != null), okC = vc.every(v => v != null);
    if (!okO) return h + '<p class="empty">最適条件の確認データ（全部）を入れると判定します。</p>';
    h += `<div class="tbl-wrap"><table><thead><tr><th class="l">指標</th><th>確認（最適）</th><th>予測区間（最適）</th><th>区間内</th><th>確認の利得</th><th>推定の利得</th><th>再現率</th><th class="l">判定</th></tr></thead><tbody>`;
    for (const m of METRICS) {
      const R = RES[m];
      if (R.errors.length || !R.model) continue;
      const mo = D.metricOf(vo, m, st.char), mc = okC ? D.metricOf(vc, m, st.char) : null;
      if (mo.err) { h += `<tr><td class="l">${esc(metricName(m))}</td><td colspan="7" class="l verdict-na">${esc(mo.err)}</td></tr>`; continue; }
      const eo = D.estimate(R, opt, R.raw ? vo.length : 1), g = D.gain(R, opt, cur);
      const inPI = eo.pi ? mo.v >= eo.pi[0] && mo.v <= eo.pi[1] : null;
      let obsG = null, ratio = null, verdict = '<span class="verdict-na">現行条件のデータがあると判定します</span>';
      if (mc && !mc.err) {
        obsG = mo.v - mc.v;
        ratio = Math.abs(g.est) > 1e-12 ? obsG / g.est : NaN;
        const rep = Number.isFinite(ratio) && Math.abs(ratio - 1) <= st.tol / 100;
        verdict = rep ? '<span class="verdict-ok">再現した</span>' : `<span class="verdict-ng">再現していない</span>`;
      }
      h += `<tr><td class="l">${esc(metricName(m))}</td><td class="num">${sig(mo.v, 5)}</td><td class="num">${eo.pi ? `${sig(eo.pi[0], 5)} 〜 ${sig(eo.pi[1], 5)}` : '―'}</td>
        <td class="${inPI === false ? 'verdict-ng' : inPI ? 'verdict-ok' : 'verdict-na'}">${inPI == null ? '―' : inPI ? '入る' : '外れる'}</td>
        <td class="num">${sig(obsG, 4)}</td><td class="num">${sig(g.est, 4)}</td><td class="num">${ratio == null ? '―' : pctv(ratio)}</td><td class="l">${verdict}</td></tr>`;
    }
    h += '</tbody></table></div>';
    h += '<p class="hint">利得が再現しないときは、割り付けていない交互作用が残っている、誤差因子の選び方が実態に合っていない、特性値の選び方に加法性がない、などを疑います。SN比の判定を最も重く見てください。</p>';
    return h;
  }

  // 実験ごとの値（レポート用の表）
  function runTable() {
    const lev = D.runLevels(DES, ASG), k = K(), F = DES.factors;
    const ms = METRICS;
    let h = '<h3 class="sec">実験ごとのデータと指標</h3><div class="tbl-wrap"><table><thead><tr><th>No.</th>' + F.map(f => `<th class="l">${esc(f.name)}</th>`).join('') + Array.from({ length: k }, (_, j) => `<th>${esc(outerName(j))}</th>`).join('') + ms.map(m => `<th>${esc(metricName(m))}</th>`).join('') + '</tr></thead><tbody>';
    const Y = dataMatrix();
    h += lev.map((l, r) => '<tr><td class="num">' + (r + 1) + '</td>' + l.map((v, i) => `<td class="l">${esc(levelLabel(st.factors[i], v))}</td>`).join('') + Y[r].map(v => `<td class="num">${Number.isFinite(v) ? sig(v, 6) : '<span class="verdict-ng">空欄</span>'}</td>`).join('') +
      ms.map(m => { if (Y[r].some(v => !Number.isFinite(v))) return '<td></td>'; const x = D.metricOf(Y[r], m, st.char); return `<td class="num">${x.err ? '<span class="verdict-ng">―</span>' : sig(x.v, 5)}</td>`; }).join('') + '</tr>').join('');
    return h + '</tbody></table></div>';
  }
  // 計画の要約（レポート用）
  function planSummary() {
    const F = DES.factors;
    let h = '<h3 class="sec">計画の要約</h3><div class="tbl-wrap"><table><thead><tr><th class="l">因子</th><th>列</th><th class="l">水準1</th><th class="l">水準2</th><th class="l">水準3</th></tr></thead><tbody>';
    h += F.map((f, i) => `<tr><td class="l">${esc(f.name)}</td><td class="num">${ASG.cols[i] + 1}${ASG.pseudo[i] ? '（擬水準）' : ''}</td>${[0, 1, 2].map(j => `<td class="l">${j < f.nlev ? esc(levelFull(st.factors[i], j)) : ''}</td>`).join('')}</tr>`).join('');
    h += ASG.inter.map(it => `<tr><td class="l">${esc(F[it.a].name)}×${esc(F[it.b].name)}</td><td class="num">${it.hidden ? '列1×列2' : it.cols.map(c => c + 1).join('・')}</td><td colspan="3"></td></tr>`).join('');
    return h + '</tbody></table></div>';
  }

  function afterRender() {
    const R = RES[st.metric];
    $('#printTitle').textContent = st.title ? `実験計画法：${st.title}` : '実験計画法';
    if (!R || (R.errors && R.errors.length)) return;
    const F = DES.factors, dir = D.goodDir(st.metric, st.char);
    mount('effChart', () => G.effects({
      title: `要因効果図：${metricName(st.metric)}`, yLabel: `${metricName(st.metric)}${yUnit(st.metric) ? `（${yUnit(st.metric)}）` : ''}`, mean: R.mean,
      factors: F.map((f, i) => {
        const lm = R.levelMeans[i];
        let best = null;
        if (dir) { best = 0; lm.forEach((v, j) => { if (dir * v > dir * lm[best] + 1e-12) best = j; }); }
        const t = R.terms.find(x => x.key === 'f' + i);
        return { name: f.name, levels: Array.from({ length: f.nlev }, (_, j) => levelLabel(st.factors[i], j)), means: lm, muted: t.pooled, best };
      }),
    }));
    ASG.inter.forEach((it, k) => mount(`intChart${k}`, () => G.interaction({
      title: `交互作用：${F[it.a].name}×${F[it.b].name}`, yLabel: `${metricName(st.metric)}${yUnit(st.metric) ? `（${yUnit(st.metric)}）` : ''}`,
      aName: F[it.a].name, aLevels: Array.from({ length: F[it.a].nlev }, (_, j) => levelLabel(st.factors[it.a], j)),
      bName: F[it.b].name, bLevels: Array.from({ length: F[it.b].nlev }, (_, j) => levelLabel(st.factors[it.b], j)),
      cells: R.cellMeans[k],
    })));
  }

  // 結果の操作（作り直すので委譲で受ける）
  $('#out').addEventListener('click', e => {
    const mb = e.target.closest('[data-metric]');
    if (mb) { st.metric = mb.dataset.metric; save(); compute(); return; }
    if (e.target.id === 'poolReset') { delete st.pool[st.metric]; save(); compute(); return; }
    if (e.target.id === 'optReset') { st.optCond = null; save(); compute(); return; }
    if (e.target.id === 'printBtn') { window.print(); return; }
    if (e.target.id === 'saveJson2') { saveJson(); return; }
  });
  $('#out').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.pool) {
      st.pool[st.metric] = $$('#out [data-pool]').filter(x => x.checked).map(x => x.dataset.pool);
      save(); compute(); return;
    }
    if (t.dataset.cond) {
      const key = t.dataset.cond === 'opt' ? 'optCond' : 'curCond';
      const c = (t.dataset.cond === 'opt' ? optCond() : curCond()).slice();
      c[+t.dataset.i] = +t.value; st[key] = c; save(); compute(); return;
    }
  });
  const onConf = debounce(() => { save(); compute(); }, 500);
  $('#out').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.conf) { st.conf[t.dataset.conf][+t.dataset.j] = t.value; onConf(); return; }
    if (t.id === 'alphaIn') { const v = num(t.value); if (v != null && v > 0 && v < 0.5) { st.alpha = v; onConf(); } return; }
    if (t.id === 'tolIn') { const v = num(t.value); if (v != null && v > 0 && v <= 100) { st.tol = v; onConf(); } }
  });

  // ---------- 保存・読み込み・印刷 ----------
  function saveJson() {
    const o = Object.assign({}, st); delete o.tab; delete o.sig;
    o.app = 'doe-calc'; o.version = 1;
    download(JSON.stringify(o, null, 1), `${stamp()}_${safeName(st.title) || '実験計画'}.json`, 'application/json');
  }
  $('#saveJson').addEventListener('click', saveJson);
  $('#loadJson').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (!o || o.app !== 'doe-calc' || !Array.isArray(o.factors)) throw new Error('形式が違います');
      if (!D.ARRAY_NAMES.includes(o.array)) throw new Error('直交表の指定が不正です');
      const tab = st.tab;
      st = Object.assign(defaults(), o, { tab, sig: '' });
      delete st.app; delete st.version;
      // 読み込んだ条件・プールの指定は、割り付けの確認のあとも残す
      const keep = { pool: st.pool, optCond: st.optCond, curCond: st.curCond };
      fixShape(); recomputeAssign(); Object.assign(st, keep);
      refreshPlan(); toast(`${f.name} を読み込みました`);
    } catch (err) { toast('読み込めませんでした：' + err.message); }
  });
  let themeBeforePrint = null;
  window.addEventListener('beforeprint', () => {
    themeBeforePrint = document.documentElement.getAttribute('data-theme'); document.documentElement.dataset.theme = 'light'; redrawCharts();
    const d = new Date(); $('#printDate').textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 作成`;
  });
  window.addEventListener('afterprint', () => { if (themeBeforePrint == null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = themeBeforePrint; redrawCharts(); });

  // ---------- サンプル（架空のデータ） ----------
  function seeded(seed) {
    let s = seed >>> 0;
    const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
    return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
  }
  function loadSample(cfg, gen, seed) {
    if (filled() && !confirm('今の計画とデータをサンプルに置き換えます。よろしいですか？')) return;
    const tab = st.tab;
    st = Object.assign(defaults(), cfg, { tab });
    fixShape(); recomputeAssign();
    const lev = D.runLevels(DES, ASG), r = seeded(seed);
    st.data = lev.map(l => Array.from({ length: K() }, (_, j) => gen(l, j, r)));
    refreshPlan(); grid.render(); compute();
    toast('サンプルの計画とデータを入れました');
  }
  // L18・望目特性タイプI：射出成形品の寸法（目標 50.00 mm）。誤差因子は材料ロットと室温を調合した N1・N2
  $('#sampleTaguchi').addEventListener('click', () => loadSample({
    title: '成形品の寸法のばらつき低減（サンプル）', charName: '寸法', charUnit: 'mm', char: 'nominal1', array: 'L18',
    factors: [
      { name: '金型温度', unit: '℃', nlev: 2, levels: ['40', '60', ''], col: 'auto', dup: 0 },
      { name: '樹脂温度', unit: '℃', nlev: 3, levels: ['200', '220', '240'], col: 'auto', dup: 0 },
      { name: '射出速度', unit: 'mm/s', nlev: 3, levels: ['20', '40', '60'], col: 'auto', dup: 0 },
      { name: '保圧', unit: 'MPa', nlev: 3, levels: ['40', '60', '80'], col: 'auto', dup: 0 },
      { name: '保圧時間', unit: 's', nlev: 3, levels: ['3', '6', '9'], col: 'auto', dup: 0 },
      { name: '冷却時間', unit: 's', nlev: 3, levels: ['10', '15', '20'], col: 'auto', dup: 0 },
      { name: 'ゲート', unit: '', nlev: 2, levels: ['ピン', 'サイド', ''], col: 'auto', dup: 0 },
      { name: '背圧', unit: 'MPa', nlev: 3, levels: ['5', '10', '15'], col: 'auto', dup: 0 },
    ],
    inter: [], outer: { kind: 'noise', k: 2, names: ['N1（低温・ロット甲）', 'N2（高温・ロット乙）'] }, metric: 'sn',
  }, (l, j, r) => {
    // 平均は樹脂温度・背圧で動き、ばらつき（N1 と N2 の差）は保圧・保圧時間・ゲートで変わる
    const mu = 49.85 + 0.12 * l[1] + 0.06 * l[7];
    const half = (0.16 - 0.05 * l[3]) * (1.15 - 0.12 * l[4]) * (l[6] ? 1.5 : 1) + 0.01 * l[2];
    return (mu + (j ? 1 : -1) * half + r.n() * 0.03).toFixed(3);
  }, 20261011));
  // L8・望大特性：接着強度。硬化温度×硬化時間の交互作用、2 回の繰り返し
  $('#sampleInter').addEventListener('click', () => loadSample({
    title: '接着強度の向上（サンプル）', charName: '接着強度', charUnit: 'N', char: 'larger', array: 'L8',
    factors: [
      { name: '硬化温度', unit: '℃', nlev: 2, levels: ['80', '100', ''], col: 'auto', dup: 0 },
      { name: '硬化時間', unit: 'min', nlev: 2, levels: ['30', '60', ''], col: 'auto', dup: 0 },
      { name: '塗布量', unit: 'g', nlev: 2, levels: ['0.2', '0.4', ''], col: 'auto', dup: 0 },
      { name: '前処理', unit: '', nlev: 2, levels: ['なし', 'あり', ''], col: 'auto', dup: 0 },
    ],
    inter: [[0, 1]], outer: { kind: 'repeat', k: 2, names: [] }, metric: 'mean',
  }, (l, j, r) => (120 + 14 * l[0] + 9 * l[1] + 12 * l[0] * l[1] + 2 * l[2] + 7 * l[3] + r.n() * 3.5).toFixed(1), 1011));

  // ---------- 開始 ----------
  fixShape(); recomputeAssign();
  applyTheme(theme);
  renderSetup(); renderFactors(); renderInter(); renderAssign(); renderOrder();
  showTab(location.hash.slice(1) || st.tab);
  if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname.endsWith('github.io')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
