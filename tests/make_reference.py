# tests/reference.json（参照値）を作る。js/doe.js とは別の方法で計算する
#   pip install numpy scipy pandas statsmodels
#   python tests/make_reference.py
# - 直交表：教科書の表を文字列で書き写したもの（L4・L8・L9・L12・L18）と、別の作り方で作った L16
# - 平方和・F・p：statsmodels の最小二乗法（区分の変数としての当てはめ）と anova_lm（Type II）
# - 推定値・信頼区間・予測区間：プールしていない項だけの最小二乗モデルを statsmodels で当てはめ、get_prediction で計算
# - SN比・感度：numpy で式どおりに計算
import json, itertools
from pathlib import Path
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm
from scipy import stats

OUT = Path(__file__).resolve().parent / 'reference.json'

def tab(rows):
    return [[int(ch) for ch in r] for r in rows]

ARR = {
    'L4': tab(['111', '122', '212', '221']),
    'L8': tab(['1111111', '1112222', '1221122', '1222211', '2121212', '2122121', '2211221', '2212112']),
    'L9': tab(['1111', '1222', '1333', '2123', '2231', '2312', '3132', '3213', '3321']),
    'L12': tab(['11111111111', '11111222222', '11222111222', '12122122112', '12212212121', '12221221211',
                '21221122121', '21212221112', '21122212211', '22211112212', '22121211122', '22112121221']),
    'L18': tab(['11111111', '11222222', '11333333', '12112233', '12223311', '12331122', '13121323', '13232131', '13313212',
                '21133221', '21211332', '21322113', '22123132', '22231213', '22312321', '23132312', '23213123', '23321231']),
}
# L16：基本列 a, b, c, d（1, 2, 4, 8 列目）と、その積で残りの列を作る（±1 の積で表し、−1 を水準2 にする）
def make_l16():
    rows = []
    for a, b, c, d in itertools.product([1, -1], repeat=4):
        base = {1: a, 2: b, 4: c, 8: d}
        row = []
        for j in range(1, 16):
            v = 1
            for bit in (1, 2, 4, 8):
                if j & bit:
                    v *= base[bit]
            row.append(1 if v == 1 else 2)
        rows.append(row)
    return rows
ARR['L16'] = make_l16()

def metric(y, m, char):
    y = np.asarray(y, float); n = len(y)
    if m == 'mean':
        return y.mean()
    if m == 'sd':
        return y.std(ddof=1)
    Sm = y.sum() ** 2 / n
    Ve = y.var(ddof=1) if n > 1 else np.nan
    if m == 'sens':
        return 10 * np.log10((Sm - Ve) / n) if char == 'nominal1' else y.mean()
    if char == 'smaller':
        return -10 * np.log10(np.mean(y ** 2))
    if char == 'larger':
        return -10 * np.log10(np.mean(1 / y ** 2))
    if char == 'nominal1':
        return 10 * np.log10((Sm - Ve) / n / Ve)
    return -10 * np.log10(Ve)

def level_of(arr, col, r, nlev, dup):
    v = arr[r][col] - 1
    if nlev == 2 and max(row[col] for row in arr) == 3 and v == 2:
        return dup
    return v

def run_case(c):
    arr = ARR[c['array']]
    F = c['factors']; cols = c['cols']; inter = c['inter']; data = np.array(c['data'], float)
    N, k = data.shape
    names = [f'F{i}' for i in range(len(F))]
    lev = [[level_of(arr, cols[i], r, F[i]['nlev'], F[i].get('dup', 0)) for i in range(len(F))] for r in range(N)]
    out = {'metrics': {}}
    for m in c['metrics']:
        raw = (m == 'mean' and c['kind'] == 'repeat' and k > 1)
        rows = []
        if raw:
            for r in range(N):
                for j in range(k):
                    rows.append([data[r, j]] + lev[r])
        else:
            for r in range(N):
                rows.append([metric(data[r], m, c['char'])] + lev[r])
        df = pd.DataFrame(rows, columns=['y'] + names)
        terms = [f'C({n})' for n in names] + [f'C({names[a]}):C({names[b]})' for a, b in inter]
        keys = [f'f{i}' for i in range(len(F))] + [f'i{a}-{b}' for a, b in inter]
        full = smf.ols('y ~ ' + ' + '.join(terms), data=df).fit()
        # 誤差の自由度が 0（飽和）のときは Type II が計算できないので逐次（Type I）の平方和を使う（直交計画では同じ値）
        an = anova_lm(full, typ=2) if full.df_resid > 0 else anova_lm(full, typ=1)
        ST = float(((df.y - df.y.mean()) ** 2).sum())
        res = {'ST': ST, 'dfT': len(df) - 1, 'terms': {}}
        for t, key in zip(terms, keys):
            res['terms'][key] = {'S': float(an.loc[t, 'sum_sq']), 'df': int(round(an.loc[t, 'df']))}
        res['Se'] = max(0.0, float(an.loc['Residual', 'sum_sq'])) if full.df_resid > 0 else 0.0
        res['dfe'] = int(round(full.df_resid))
        if raw:
            res['e2'] = float(sum(((data[r] - data[r].mean()) ** 2).sum() for r in range(N)))
        pool = c['pool'][m]
        kept = [key for key in keys if key not in pool]
        # 推定に使うモデル：残した項（交互作用が残るならその主効果も含める）
        mains = set()
        for key in kept:
            if key[0] == 'f':
                mains.add(int(key[1:]))
            else:
                a, b = map(int, key[1:].split('-')); mains |= {a, b}
        rt = [f'C({names[i]})' for i in sorted(mains)] + [f'C({names[a]}):C({names[b]})' for a, b in inter if f'i{a}-{b}' in kept]
        red = smf.ols('y ~ ' + (' + '.join(rt) if rt else '1'), data=df).fit()
        # プールした誤差：全体の誤差 + プールした項（anova_lm の値）
        Sp = res['Se'] + sum(res['terms'][p]['S'] for p in pool)
        dfp = res['dfe'] + sum(res['terms'][p]['df'] for p in pool)
        Vp = Sp / dfp
        res['Sp'] = Sp; res['dfp'] = dfp; res['Vp'] = Vp
        for key in kept:
            t = res['terms'][key]
            t['F'] = t['S'] / t['df'] / Vp
            t['p'] = float(stats.f.sf(t['F'], t['df'], dfp))
            t['rho'] = (t['S'] - t['df'] * Vp) / ST
        alpha = c.get('alpha', 0.05)
        tq = stats.t.ppf(1 - alpha / 2, dfp)
        ests = []
        for cond in c['conds']:
            x = pd.DataFrame([dict(zip(names, cond))])
            # 予測は区分の水準をそろえて行う（当てはめのデータにある水準）
            pr = red.get_prediction(x)
            est = float(pr.predicted_mean[0]); se_fit = float(pr.se_mean[0])
            # 分散の推定に Vp（プールした誤差）を使う：statsmodels の scale を Vp に置き換えた標準誤差
            q = se_fit ** 2 / red.scale
            mm = k if raw else 1
            se = np.sqrt(Vp * q); sp = np.sqrt(Vp * (q + 1 / mm))
            ests.append({'est': est, 'ne': 1 / q, 'ci': [est - tq * se, est + tq * se], 'pi': [est - tq * sp, est + tq * sp], 'm': mm})
        res['est'] = ests
        # 条件1 と条件2 の差（利得）
        x1 = pd.DataFrame([dict(zip(names, c['conds'][0]))]); x2 = pd.DataFrame([dict(zip(names, c['conds'][1]))])
        from patsy import build_design_matrices
        di = red.model.data.orig_exog.design_info
        d1 = np.asarray(build_design_matrices([di], x1)[0]); d2 = np.asarray(build_design_matrices([di], x2)[0])
        dv = (d1 - d2)[0]
        g = float(dv @ red.params.values)
        qg = float(dv @ (red.normalized_cov_params.values) @ dv)
        res['gain'] = {'est': g, 'ci': [g - tq * np.sqrt(Vp * qg), g + tq * np.sqrt(Vp * qg)]}
        if not raw:
            res['units'] = [float(v) for v in df.y]
        out['metrics'][m] = res
    return out

rng = np.random.default_rng(20261011)
cases = []

def add(name, array, factors, cols, inter, kind, char, k, gen, metrics, pool, conds):
    arr = ARR[array]; N = len(arr)
    lev = [[level_of(arr, cols[i], r, factors[i]['nlev'], factors[i].get('dup', 0)) for i in range(len(factors))] for r in range(N)]
    data = [[round(float(gen(lev[r], j)), 3) for j in range(k)] for r in range(N)]
    c = {'name': name, 'array': array, 'factors': factors, 'cols': cols, 'inter': inter, 'kind': kind, 'char': char,
         'data': data, 'metrics': metrics, 'pool': pool, 'conds': conds}
    c['ref'] = run_case(c)
    cases.append(c)

f2 = lambda n, **kw: dict(name=n, nlev=2, **kw)
f3 = lambda n, **kw: dict(name=n, nlev=3, **kw)

# 1. L8：4 因子、A×B・A×C、2 回の繰り返し、望大
add('L8 交互作用・繰り返し・望大', 'L8', [f2('A'), f2('B'), f2('C'), f2('D')], [0, 1, 3, 5], [[0, 1], [0, 2]], 'repeat', 'larger', 2,
    lambda l, j: 50 + 4 * l[0] + 2 * l[1] + 3 * l[0] * l[1] + 0.5 * l[3] + rng.normal(0, 1),
    ['mean', 'sd', 'sn'], {'mean': ['f3'], 'sd': ['f0', 'f1', 'i0-2'], 'sn': ['f2', 'f3']}, [[1, 1, 0, 0], [0, 0, 0, 0]])
# 2. L18：擬水準（G を列7、水準1 を重複）、誤差因子の調合 N1・N2、望目タイプI
add('L18 擬水準・調合・望目I', 'L18', [f2('A'), f3('B'), f3('C'), f3('D'), f3('E'), f3('F'), f2('G', dup=0), f3('H')], [0, 1, 2, 3, 4, 5, 6, 7], [], 'noise', 'nominal1', 2,
    lambda l, j: 10 + 0.5 * l[1] + 0.2 * l[2] + (1 if j else -1) * (0.3 + 0.3 * l[3] - 0.1 * l[6]) + 0.1 * l[5] + rng.normal(0, 0.05),
    ['mean', 'sd', 'sn', 'sens'], {'mean': ['f0', 'f7'], 'sd': ['f0', 'f1', 'f4'], 'sn': ['f0', 'f2', 'f4'], 'sens': ['f0', 'f7']}, [[0, 2, 2, 0, 1, 1, 1, 0], [0, 0, 0, 1, 0, 0, 0, 0]])
# 3. L18：列1×列2 の交互作用（列を使わない）、データ 1 個、望小
add('L18 列1×列2・望小', 'L18', [f2('A'), f3('B'), f3('C'), f3('D'), f3('E')], [0, 1, 2, 3, 6], [[0, 1]], 'repeat', 'smaller', 1,
    lambda l, j: 5 + 1.5 * l[0] * (l[1] == 2) + 0.8 * l[2] + 0.3 * l[3] + abs(rng.normal(0, 0.3)),
    ['mean', 'sn'], {'mean': ['f4'], 'sn': ['f3', 'f4']}, [[0, 0, 0, 0, 0], [1, 2, 2, 2, 2]])
# 4. L9：A×B（列3・列4）、3 回の繰り返し、望小
add('L9 交互作用・繰り返し3', 'L9', [f3('A'), f3('B')], [0, 1], [[0, 1]], 'repeat', 'smaller', 3,
    lambda l, j: 20 + 2 * l[0] - 1.5 * l[1] + 1.2 * (l[0] == 2 and l[1] == 0) + rng.normal(0, 0.5),
    ['mean', 'sd', 'sn'], {'mean': [], 'sd': ['i0-1'], 'sn': ['i0-1']}, [[0, 2, ], [2, 0]])
# 5. L12：7 因子、2 回の繰り返し、望目タイプII（0 をまたぐ値）
add('L12 望目II', 'L12', [f2(n) for n in 'ABCDEFG'], [0, 1, 2, 4, 6, 8, 10], [], 'repeat', 'nominal2', 2,
    lambda l, j: 0.2 * l[0] - 0.1 * l[2] + rng.normal(0, 0.2 + 0.3 * l[1]),
    ['mean', 'sd', 'sn', 'sens'], {'mean': ['f3', 'f4', 'f5'], 'sd': ['f3', 'f4'], 'sn': ['f5', 'f6'], 'sens': ['f3', 'f4', 'f5']}, [[1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0]])
# 6. L16：6 因子と 4 つの交互作用、データ 1 個
add('L16 交互作用4つ', 'L16', [f2(n) for n in 'ABCDEF'], [0, 1, 3, 7, 14, 9], [[0, 1], [0, 2], [1, 2], [3, 4]], 'repeat', 'larger', 1,
    lambda l, j: 30 + 3 * l[0] + 2 * l[1] - 1 * l[2] + 2.5 * l[0] * l[1] + 1.5 * l[3] * l[4] + 0.3 * l[5] + rng.normal(0, 0.4),
    ['mean', 'sn'], {'mean': ['i0-2', 'i1-2'], 'sn': ['i0-2', 'i1-2', 'f5']}, [[1, 1, 0, 1, 1, 1], [0, 0, 1, 0, 0, 0]])
# 7. L4：3 因子（誤差の自由度 0 → 1 つプール）
add('L4 自由度0', 'L4', [f2('A'), f2('B'), f2('C')], [0, 1, 2], [], 'repeat', 'larger', 1,
    lambda l, j: 10 + 2 * l[0] + 1 * l[1] + rng.normal(0, 0.2),
    ['mean'], {'mean': ['f2']}, [[1, 1, 1], [0, 0, 0]])
# 8. L9：2 水準の因子を擬水準（水準2 を重複）、3 回の繰り返し
add('L9 擬水準', 'L9', [f3('A'), f3('B'), f2('C', dup=1), f3('D')], [0, 1, 2, 3], [], 'repeat', 'larger', 3,
    lambda l, j: 40 + 3 * l[0] + 1.5 * l[2] - l[3] + rng.normal(0, 0.8),
    ['mean', 'sn'], {'mean': ['f1'], 'sn': ['f1', 'f3']}, [[2, 0, 1, 0], [0, 0, 0, 0]])

ref = {'arrays': ARR, 'cases': cases}
OUT.write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{OUT} に {len(cases)} 件の参照値を書き出しました')
