// 実験計画法のグラフ（要因効果図・交互作用図）。SVG で描き、色は CSS 変数で指定する（CpkCharts.resolveVars で実際の色に置き換え）
(function (root) {
  'use strict';
  const C = root.CpkCharts;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // 文字列のおおよその幅（全角 1 文字 = 1、半角 = 0.56）
  const width = (t, fs) => [...String(t)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.56), 0) * fs;
  // 幅に収まるように末尾を省略する
  function fit(t, maxW, fs) {
    t = String(t);
    if (width(t, fs) <= maxW) return t;
    while (t.length > 1 && width(t + '…', fs) > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function yScale(vals, H, top, bottom) {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
    lo -= pad; hi += pad;
    const tk = C.ticks(lo, hi, 5);
    lo = Math.min(lo, tk.t[0]); hi = Math.max(hi, tk.t[tk.t.length - 1]);
    return { lo, hi, tk, Y: v => H - bottom - (v - lo) / (hi - lo) * (H - top - bottom) };
  }
  function fmtTick(v, step) {
    let d = 0;
    while (d < 10 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6 * 10 ** d) d++;
    return v.toFixed(d);
  }

  // 要因効果図：因子ごとの水準の平均を、縦軸をそろえて横に並べる
  // opt: { title, yLabel, mean, factors: [{ name, levels: [ラベル], means: [値], muted: bool, best: 水準 }] }
  function effects(opt) {
    const W = 640, H = 300, L = 58, R = 12, T = 34, B = 58;
    const all = opt.factors.flatMap(f => f.means).concat([opt.mean]).filter(Number.isFinite);
    if (!all.length) return '';
    const ys = yScale(all, H, T, B), Y = ys.Y;
    const n = opt.factors.length, pw = (W - L - R) / n;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="var(--f-ui)" role="img" aria-label="${esc(opt.title || '')}">`;
    s += `<rect width="${W}" height="${H}" fill="var(--surface)"/>`;
    if (opt.title) s += `<text x="${L}" y="20" font-size="14" font-weight="700" fill="var(--ink)">${esc(opt.title)}</text>`;
    for (const v of ys.tk.t) if (v >= ys.lo && v <= ys.hi) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--f-num)">${fmtTick(v, ys.tk.step)}</text>`;
    if (opt.yLabel) s += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(opt.yLabel)}</text>`;
    if (Number.isFinite(opt.mean)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(opt.mean)}" y2="${Y(opt.mean)}" stroke="var(--muted)" stroke-dasharray="5 4"/>`;
    opt.factors.forEach((f, i) => {
      const x0 = L + i * pw, k = f.means.length;
      // 水準のラベルが隣と重ならない字の大きさ（7〜10.5）。それでも入らなければ省略する
      const slot = pw / k - 3, longest = Math.max(...f.levels.map(t => width(t, 1)));
      const fsLab = Math.max(7, Math.min(10.5, slot / (longest || 1)));
      const X = j => x0 + pw * (j + 0.5) / k;
      if (i) s += `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${H - B}" stroke="var(--line)"/>`;
      const col = f.muted ? 'var(--muted)' : 'var(--s1)';
      const d = f.means.map((v, j) => `${j ? 'L' : 'M'}${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2"${f.muted ? ' stroke-dasharray="3 3"' : ''}/>`;
      f.means.forEach((v, j) => {
        const best = f.best === j && !f.muted;
        s += `<circle cx="${X(j)}" cy="${Y(v)}" r="${best ? 5 : 3.5}" fill="${best ? 'var(--s2)' : col}"/>`;
        s += `<text x="${X(j)}" y="${H - B + 14}" font-size="${fsLab.toFixed(1)}" text-anchor="middle" fill="var(--muted)" font-family="var(--f-num)">${esc(fit(f.levels[j], slot, fsLab))}</text>`;
      });
      s += `<text x="${x0 + pw / 2}" y="${H - B + 32}" font-size="${pw < 40 ? 10 : 12}" text-anchor="middle" font-weight="700" fill="${f.muted ? 'var(--muted)' : 'var(--ink)'}">${esc(fit(f.name, pw - 4, pw < 40 ? 10 : 12))}</text>`;
    });
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="var(--line)"/>`;
    // 凡例
    s += `<line x1="${W - R - 250}" x2="${W - R - 232}" y1="16" y2="16" stroke="var(--muted)" stroke-dasharray="5 4"/><text x="${W - R - 228}" y="20" font-size="11" fill="var(--ink2)">全体の平均</text>`;
    s += `<circle cx="${W - R - 152}" cy="16" r="4.5" fill="var(--s2)"/><text x="${W - R - 144}" y="20" font-size="11" fill="var(--ink2)">良い水準</text>`;
    s += `<line x1="${W - R - 82}" x2="${W - R - 66}" y1="16" y2="16" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="2"/><text x="${W - R - 62}" y="20" font-size="11" fill="var(--ink2)">プール</text>`;
    return C.resolveVars(s + '</svg>');
  }

  // 交互作用図：横軸に因子 A の水準、因子 B の水準ごとに線を引く
  // opt: { title, yLabel, aName, aLevels, bName, bLevels, cells: [[A×B の平均]] }
  function interaction(opt) {
    const W = 640, H = 320, L = 58, R = 140, T = 34, B = 50;
    const all = opt.cells.flat().filter(Number.isFinite);
    const ys = yScale(all, H, T, B), Y = ys.Y;
    const na = opt.aLevels.length, X = i => L + (W - L - R) * (na === 1 ? 0.5 : 0.12 + 0.76 * i / (na - 1));
    const COL = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="var(--f-ui)" role="img" aria-label="${esc(opt.title || '')}">`;
    s += `<rect width="${W}" height="${H}" fill="var(--surface)"/>`;
    if (opt.title) s += `<text x="${L}" y="20" font-size="14" font-weight="700" fill="var(--ink)">${esc(opt.title)}</text>`;
    for (const v of ys.tk.t) if (v >= ys.lo && v <= ys.hi) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--f-num)">${fmtTick(v, ys.tk.step)}</text>`;
    if (opt.yLabel) s += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(opt.yLabel)}</text>`;
    opt.aLevels.forEach((lab, i) => { s += `<text x="${X(i)}" y="${H - B + 16}" font-size="11" text-anchor="middle" fill="var(--muted)">${esc(fit(lab, 120, 11))}</text>`; });
    s += `<text x="${(L + W - R) / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(opt.aName)}</text>`;
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="var(--line)"/>`;
    opt.bLevels.forEach((lab, j) => {
      const col = COL[j % 3], dash = j === 1 ? ' stroke-dasharray="6 3"' : j === 2 ? ' stroke-dasharray="2 3"' : '';
      const d = opt.cells.map((row, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(row[j]).toFixed(1)}`).join('');
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.2"${dash}/>`;
      opt.cells.forEach((row, i) => { s += `<circle cx="${X(i)}" cy="${Y(row[j])}" r="3.5" fill="${col}"/>`; });
      const ly = T + 22 + j * 20;
      s += `<line x1="${W - R + 12}" x2="${W - R + 32}" y1="${ly}" y2="${ly}" stroke="${col}" stroke-width="2.2"${dash}/><text x="${W - R + 36}" y="${ly + 4}" font-size="11" fill="var(--ink2)">${esc(fit(lab, R - 42, 11))}</text>`;
    });
    s += `<text x="${W - R + 12}" y="${T + 6}" font-size="11" font-weight="700" fill="var(--ink2)">${esc(fit(opt.bName, R - 16, 11))}</text>`;
    return C.resolveVars(s + '</svg>');
  }

  root.DoeCharts = { effects, interaction };
})(typeof window !== 'undefined' ? window : globalThis);
