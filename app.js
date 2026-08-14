/* The page reads every number out of data.json, which the eval harness emits.
   Nothing here is typed in by hand — if a sweep is re-run, the page changes
   with it, and there is no second copy of the truth to fall out of date. */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => n.toLocaleString('en-US');
const short = (id) => id.replace(/^openai\//, '').replace(/:free$/, ' (free)');

let DATA;

/* ------------------------------------------------------------------ boot */
document.documentElement.classList.add('has-js');
// Whatever happens below, the page must not stay invisible: the reveal
// animation is the only thing holding content at opacity 0.
const revealAll = () =>
  $$('[data-reveal]').forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
setTimeout(() => { if (!DATA) revealAll(); }, 4000);

init().catch((err) => {
  console.error('bake-off: falling back to static content', err);
  revealAll();
});

async function init() {
  DATA = await fetch('data.json').then((r) => r.json());

  buildTable();
  buildBars('answerPct');
  buildScatter();
  buildPerDay();
  buildHeat();
  buildWall();
  buildCalculator();
  buildExperiments();
  buildCompare();

  $('#attemptCount').textContent = DATA.totalAttempts;
  $('#footAttempts').textContent = DATA.totalAttempts;
  $('#winnerName').textContent = short(DATA.models[0].model);

  animate();
}

/* ------------------------------------------------------------- animation */
function animate() {
  $$('#metricToggle button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#metricToggle button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      buildBars(b.dataset.metric);
    })
  );

  const bar = $('#progressBar');
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = `${h > 0 ? (scrollY / h) * 100 : 0}%`;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (reduced || typeof gsap === 'undefined') {
    $$('[data-reveal]').forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
    $$('.stat-num').forEach((el) => { el.textContent = finalCount(el); });
    fillBudget(1);
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  $$('[data-reveal]').forEach((el) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: .7, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // Hero counters: the three numbers the whole page is about.
  $$('.stat-num').forEach((el) => {
    const target = Number(el.dataset.count);
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: 'power2.out', delay: .25,
      onUpdate: () => { el.textContent = `${el.dataset.prefix ?? ''}${Math.round(obj.v)}${el.dataset.suffix ?? ''}`; },
    });
  });

  ScrollTrigger.create({
    trigger: '.budget-bar', start: 'top 85%', once: true,
    onEnter: () => fillBudget(0),
  });
}

const finalCount = (el) => `${el.dataset.prefix ?? ''}${el.dataset.count}${el.dataset.suffix ?? ''}`;

function fillBudget(instant) {
  const w = DATA.models.find((m) => m.tpdUsed && m.tpd);
  const used = w ? Math.min(1, w.tpdUsed / w.tpd) : 1;
  const label = w
    ? `${fmt(w.tpdUsed)} of ${fmt(w.tpd)} daily tokens — spent by one sweep`
    : 'daily budget';
  $('#budgetLabel').textContent = label;
  const el = $('#budgetFill');
  if (instant || reduced || typeof gsap === 'undefined') el.style.width = `${used * 100}%`;
  else gsap.to(el, { width: `${used * 100}%`, duration: 1.4, ease: 'power2.out' });
}

/* ---------------------------------------------------------------- table */
let sortKey = 'answerPct', sortDir = -1;

function buildTable() {
  const tb = $('#scoreTable tbody');
  const rows = [...DATA.models].sort(cmp);

  tb.innerHTML = rows.map((m, i) => `
    <tr class="${i === 0 && sortKey === 'answerPct' && sortDir === -1 ? 'win' : ''}">
      <td class="left mono">${short(m.model)}</td>
      <td class="left">${m.provider}</td>
      <td class="num">${m.toolPct}%</td>
      <td class="num"><span class="pill ${band(m.answerPct)}">${m.answerPct}%</span></td>
      <td class="num">${m.errors}/${m.attempts}</td>
      <td class="num">${m.medianMs < 10000 ? `${m.medianMs}ms` : `${(m.medianMs / 1000).toFixed(0)}s`}</td>
      <td class="num">${fmt(m.tokensPerQ)}</td>
      <td class="num" title="${m.questionsPerDay ? 'daily cap observed in a 429' : 'daily cap never hit, so never disclosed'}">${m.questionsPerDay ?? '—'}</td>
    </tr>`).join('');

  $$('#scoreTable thead th').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.sort;
      if (k === sortKey) sortDir *= -1;
      else { sortKey = k; sortDir = (k === 'medianMs' || k === 'errors' || k === 'tokensPerQ') ? 1 : -1; }
      $$('#scoreTable thead th').forEach((x) => x.classList.remove('sorted'));
      th.classList.add('sorted');
      buildTable();
    };
  });
}

const band = (p) => (p >= 80 ? 'good' : p >= 55 ? 'mid' : 'bad');

function cmp(a, b) {
  const va = a[sortKey], vb = b[sortKey];
  if (typeof va === 'string') return va.localeCompare(vb) * (sortDir === -1 ? 1 : -1);
  return ((va ?? 0) - (vb ?? 0)) * -sortDir * -1;
}

/* ----------------------------------------------------------------- bars */
function buildBars(metric) {
  const unit = metric === 'answerPct' || metric === 'toolPct' ? '%' : metric === 'medianMs' ? 'ms' : '';
  const rows = [...DATA.models].sort((a, b) =>
    metric === 'medianMs' || metric === 'tokensPerQ' ? a[metric] - b[metric] : b[metric] - a[metric]);
  const max = Math.max(...rows.map((r) => r[metric]));
  const lowerIsBetter = metric === 'medianMs' || metric === 'tokensPerQ';

  $('#bars').innerHTML = rows.map((m, i) => `
    <div class="bar-row ${i === 0 ? '' : 'dim'}">
      <div class="name" title="${m.label}">${short(m.model)}</div>
      <div class="bar-track"><div class="bar-fill" data-w="${(m[metric] / max) * 100}"></div></div>
      <div class="bar-val">${unit === 'ms' && m[metric] > 10000 ? `${(m[metric] / 1000).toFixed(0)}s` : fmt(m[metric]) + unit}</div>
    </div>`).join('');

  const fills = $$('#bars .bar-fill');
  if (reduced || typeof gsap === 'undefined') fills.forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  else gsap.fromTo(fills, { width: 0 }, {
    width: (i, el) => `${el.dataset.w}%`, duration: .75, ease: 'power2.out', stagger: .06,
  });

  $('.chart-head h3').textContent = lowerIsBetter ? 'Cost — lower is better' : 'Accuracy — higher is better';
}

/* -------------------------------------------------------------- scatter */
function buildScatter() {
  const W = 560, H = 330, pad = 54;
  const pts = DATA.models;
  const maxMs = Math.max(...pts.map((p) => p.medianMs));
  // Log scale: one candidate is ~28x slower, and a linear axis would flatten
  // every other model into the same pixel column.
  const lx = (ms) => {
    const lo = Math.log10(400), hi = Math.log10(maxMs * 1.4);
    return pad + ((Math.log10(Math.max(ms, 400)) - lo) / (hi - lo)) * (W - pad - 100);
  };
  const y = (p) => H - pad - (p / 100) * (H - pad - 26);
  const ticks = [500, 1000, 5000, 30000].filter((t) => t <= maxMs * 1.4);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy against latency">`;
  for (let g = 0; g <= 4; g++) {
    const yy = y(g * 25);
    s += `<line class="gl" x1="${pad}" y1="${yy}" x2="${W - 90}" y2="${yy}"/>`;
    s += `<text class="ax" x="${pad - 8}" y="${yy + 4}" text-anchor="end">${g * 25}%</text>`;
  }
  ticks.forEach((t) => {
    s += `<text class="ax" x="${lx(t)}" y="${H - pad + 20}" text-anchor="middle">${t >= 1000 ? `${t / 1000}s` : `${t}ms`}</text>`;
  });
  s += `<text class="ax" x="${(W - 90) / 2}" y="${H - 8}" text-anchor="middle">median latency per question (log)</text>`;

  const colours = ['#35c08a', '#7c8cff', '#e0a020', '#e0574f'];
  pts.forEach((p, i) => {
    const cx = lx(p.medianMs), cy = y(p.answerPct);
    const flip = cx > (W - 90) * 0.62;
    s += `<circle cx="${cx}" cy="${cy}" r="8" fill="${colours[i % colours.length]}" opacity=".9"><title>${p.label} — ${p.answerPct}% at ${p.medianMs}ms</title></circle>`;
    s += `<text class="dot-label" x="${flip ? cx - 13 : cx + 13}" y="${cy + 4}" text-anchor="${flip ? 'end' : 'start'}">${short(p.model)}</text>`;
  });
  s += '</svg>';
  $('#scatter').innerHTML = s;
}

/* ------------------------------------------------------------- per day */
function buildPerDay() {
  // Includes the throttled candidates: their answers are not scoreable, but the
  // tokens they burned per question are, and that is exactly why they starved.
  const rows = [...DATA.models, ...DATA.starved]
    .filter((m) => m.questionsPerDay)
    .sort((a, b) => b.questionsPerDay - a.questionsPerDay);
  if (!rows.length) { $('#perDay').innerHTML = '<p class="fine">No daily cap was observed for these models.</p>'; return; }
  const note = '<p class="fine" style="margin-top:.6rem">A daily cap is only knowable once you hit it, so this covers the models that ran out.</p>';

  const W = 560, rowH = 44, pad = 190;
  const H = rows.length * rowH + 44;
  const max = Math.max(...rows.map((r) => r.questionsPerDay));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Questions per day on the free tier">`;
  rows.forEach((r, i) => {
    const yy = 14 + i * rowH;
    const w = (r.questionsPerDay / max) * (W - pad - 70);
    s += `<text class="ax" x="${pad - 10}" y="${yy + 20}" text-anchor="end">${short(r.model)}</text>`;
    s += `<rect x="${pad}" y="${yy + 6}" width="${w}" height="20" rx="5" fill="#7c8cff" opacity=".85"/>`;
    s += `<text class="dot-label" x="${pad + w + 8}" y="${yy + 21}">${r.questionsPerDay} / day</text>`;
  });
  s += '</svg>';
  $('#perDay').innerHTML = s + note;
}

/* ------------------------------------------------------------- heatmap */
function buildHeat() {
  const qs = DATA.questions;
  const rows = [...DATA.models];

  let s = `<div class="hhead"><span class="spacer"></span>${qs.map((q) => `<span>${q.id}</span>`).join('')}</div>`;
  rows.forEach((m) => {
    s += `<div class="hrow" data-model="${m.label}">
      <div class="rlabel" title="click to isolate">${short(m.model)} · ${m.provider}</div>
      ${qs.map((q) => {
        const c = m.perQuestion[q.id] ?? { pass: 0, total: 0 };
        if (!c.total) return `<div class="cell none">–</div>`;
        const cls = c.pass === c.total ? 'good' : c.pass === 0 ? 'bad' : 'mid';
        return `<div class="cell ${cls}" data-q="${q.id}" title="${q.id}: ${c.pass} of ${c.total} correct">${c.pass}/${c.total}</div>`;
      }).join('')}
    </div>`;
  });
  $('#heat').innerHTML = s;

  $$('#heat .cell[data-q]').forEach((c) => {
    c.addEventListener('mouseenter', () => showQuestion(c.dataset.q));
  });
  $$('#heat .rlabel').forEach((l) => {
    l.addEventListener('click', () => {
      const row = l.parentElement;
      const already = row.dataset.iso === '1';
      $$('#heat .hrow').forEach((r) => { r.classList.remove('faded'); r.dataset.iso = '0'; });
      if (!already) {
        $$('#heat .hrow').forEach((r) => { if (r !== row) r.classList.add('faded'); });
        row.dataset.iso = '1';
      }
    });
  });
}

function showQuestion(id) {
  const q = DATA.questions.find((x) => x.id === id);
  if (!q) return;
  const el = $('#qDetail');
  el.hidden = false;
  // Built as text nodes rather than markup: the question strings come from the
  // fixtures, and a fixture should never be able to inject into this page.
  el.replaceChildren();
  const h = document.createElement('h4'); h.textContent = q.id;
  const ask = document.createElement('p'); ask.className = 'ask'; ask.textContent = `“${q.ask}”`;
  const why = document.createElement('p'); why.className = 'why'; why.textContent = q.why;
  el.append(h, ask, why);
}

/* ---------------------------------------------------------------- wall */
function buildWall() {
  const st = DATA.starved;
  $('#starvedText').innerHTML = st.length
    ? st.map((m) => `<b>${short(m.model)}</b> lost ${m.errors} of ${m.attempts} attempts to throttling`).join('; ') + '.'
    : 'Every candidate produced a usable sample.';

  $('#degenTable').innerHTML = DATA.degenerate.map((d) => `
    <div><span>${d.question}</span><span>${fmt(d.outputTokens)} tokens · ${(d.ms / 1000).toFixed(0)}s</span></div>
  `).join('') || '<div><span>none observed</span></div>';
}

/* ---------------------------------------------------------- calculator */
function buildCalculator() {
  const sel = $('#calcModel');
  const usable = DATA.models.filter((m) => m.tpd);
  sel.innerHTML = usable.map((m, i) =>
    `<option value="${m.label}" ${i === 0 ? 'selected' : ''}>${short(m.model)} — ${m.provider}</option>`).join('');

  const inputs = ['#calcModel', '#calcPeople', '#calcQper', '#calcRouter', '#calcSpread', '#calcPrice'];
  inputs.forEach((s) => $(s).addEventListener('input', recalc));
  recalc();
}

/** The measured saving from the intent-filtered tool list, taken from the
 *  experiment rather than assumed. Falls back to 0 if that arm was not run. */
function routerSaving() {
  const e = DATA.experiments.toolRouter;
  if (!e?.arm || !e?.baseline) return 0;
  return 1 - e.arm.tokensPerQ / e.baseline.tokensPerQ;
}

function recalc() {
  const m = DATA.models.find((x) => x.label === $('#calcModel').value) ?? DATA.models[0];
  const people = +$('#calcPeople').value;
  const qper = +$('#calcQper').value;
  const router = $('#calcRouter').checked;
  const spread = $('#calcSpread').checked;
  const price = parseFloat($('#calcPrice').value);

  $('#calcPeopleV').textContent = people;
  $('#calcQperV').textContent = qper;
  $('#calcModelName').textContent = '';

  const saving = router ? routerSaving() : 0;
  const perQ = Math.round(m.tokensPerQ * (1 - saving));
  const questions = people * qper;
  const tokens = questions * perQ;
  const cap = (m.tpd ?? 0) * (spread ? 2 : 1);
  const ratio = cap ? tokens / cap : 0;
  const capacity = cap ? Math.floor(cap / perQ) : 0;

  $('#outQ').textContent = fmt(questions);
  $('#outTok').textContent = fmt(tokens);
  $('#outCap').textContent = `${fmt(cap)} tokens · ${fmt(capacity)} questions`;
  $('#outUntil').textContent = questions <= capacity
    ? 'does not run out'
    : `${fmt(capacity)} questions in`;

  const pct = Math.min(999, Math.round(ratio * 100));
  $('#gaugePct').textContent = `${pct}%`;

  // 90-degree arc, drawn as a stroke-dash fraction of the semicircle.
  const arc = $('#gaugeFill');
  const len = arc.getTotalLength();
  const shown = Math.min(1, ratio);
  arc.style.strokeDasharray = `${len}`;
  arc.style.strokeDashoffset = `${len * (1 - shown)}`;
  arc.style.stroke = ratio > 1 ? 'var(--bad)' : ratio > 0.75 ? 'var(--mid)' : 'var(--good)';

  const v = $('#calcVerdict');
  v.classList.remove('over', 'near');
  if (ratio > 1) {
    v.classList.add('over');
    const short_by = questions - capacity;
    v.innerHTML = `Over the free budget. This team asks <b>${fmt(questions)}</b> questions a day and the
      free tier serves <b>${fmt(capacity)}</b> — the last <b>${fmt(short_by)}</b> get an error, and no
      retry helps, because the budget resets on a clock rather than a timer.`;
  } else if (ratio > 0.75) {
    v.classList.add('near');
    v.innerHTML = `Fits, barely — <b>${pct}%</b> of the daily budget with no headroom for a busy
      afternoon or a retry storm.`;
  } else {
    v.innerHTML = `Fits comfortably at <b>${pct}%</b> of the daily budget, leaving room for
      <b>${fmt(capacity - questions)}</b> more questions.`;
  }

  const costLi = $('.readout .cost');
  if (Number.isFinite(price) && price > 0) {
    costLi.hidden = false;
    const day = (tokens / 1e6) * price;
    $('#outCost').textContent = `$${day.toFixed(2)} / $${(day * 30).toFixed(2)}`;
  } else {
    costLi.hidden = true;
  }
}

/* --------------------------------------------------------- experiments */
function buildExperiments() {
  const r = DATA.experiments.toolRouter;
  if (r?.arm && r?.baseline) {
    $('#expRouter').innerHTML =
      abBlock('tool schemas sent', r.baseline.toolsOffered, r.arm.toolsOffered, '') +
      abBlock('tokens per question', r.baseline.tokensPerQ, r.arm.tokensPerQ, '') +
      abBlock('answers correct', r.baseline.answerPct, r.arm.answerPct, '%') +
      `<span class="delta good">−${Math.round(routerSaving() * 100)}% tokens, accuracy held</span>`;
  }

  const p = DATA.experiments.promptFix;
  if (p?.arm && p?.baseline) {
    const asked = Object.entries(p.arm.perQuestion).filter(([, c]) => c.total > 0);
    $('#expPrompt').innerHTML = asked.map(([qid, c]) => {
      const b = p.baseline.perQuestion[qid] ?? { pass: 0, total: 0 };
      return `<div class="ab-row"><span class="ab-label">${qid}</span>
        <span class="ab-val">${b.pass}/${b.total} → <b>${c.pass}/${c.total}</b></span></div>`;
    }).join('') + `<span class="delta good">one sentence, no model change</span>`;
  }
}

function abBlock(label, before, after, unit) {
  const max = Math.max(before, after) || 1;
  return `
    <div class="ab-row"><span class="ab-label">${label} — before</span><span class="ab-val">${fmt(before)}${unit}</span>
      <span class="ab-track"><i style="width:${(before / max) * 100}%"></i></span></div>
    <div class="ab-row after"><span class="ab-label">${label} — after</span><span class="ab-val">${fmt(after)}${unit}</span>
      <span class="ab-track"><i style="width:${(after / max) * 100}%"></i></span></div>`;
}

/* ------------------------------------------------------------- compare */
function buildCompare() {
  const slots = [null, null];

  $('#pool').innerHTML = DATA.models
    .map((m) => `<div class="chip" data-label="${m.label}">${short(m.model)} <span style="color:var(--ink-faint)">· ${m.provider}</span></div>`)
    .join('');

  // Click is the accessible path; drag is the fun one. Both fill the next slot.
  $$('#pool .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const idx = slots[0] ? (slots[1] ? 0 : 1) : 0;
      place(idx, chip.dataset.label);
    });
  });

  if (typeof interact !== 'undefined') {
    interact('.chip').draggable({
      inertia: true,
      listeners: {
        start(e) { e.target.classList.add('dragging'); },
        move(e) {
          const x = (parseFloat(e.target.dataset.x) || 0) + e.dx;
          const y = (parseFloat(e.target.dataset.y) || 0) + e.dy;
          e.target.style.transform = `translate(${x}px, ${y}px)`;
          e.target.dataset.x = x; e.target.dataset.y = y;
        },
        end(e) {
          e.target.classList.remove('dragging');
          e.target.style.transform = '';
          e.target.dataset.x = 0; e.target.dataset.y = 0;
        },
      },
    });

    interact('.slot').dropzone({
      accept: '.chip',
      overlap: 0.4,
      ondragenter(e) { e.target.classList.add('over'); },
      ondragleave(e) { e.target.classList.remove('over'); },
      ondrop(e) {
        e.target.classList.remove('over');
        place(+e.target.dataset.slot, e.relatedTarget.dataset.label);
      },
    });
  }

  function place(i, label) {
    slots[i] = DATA.models.find((m) => m.label === label);
    const el = $(`.slot[data-slot="${i}"]`);
    el.classList.add('filled');
    el.innerHTML = `<span><b>${short(slots[i].model)}</b><br><small style="color:var(--ink-faint)">${slots[i].provider}</small></span>`;
    render();
  }

  function render() {
    const [a, b] = slots;
    if (!a || !b) { $('#compareOut').innerHTML = ''; return; }
    const metrics = [
      ['answers', 'answerPct', '%', 1],
      ['tool routing', 'toolPct', '%', 1],
      ['errors', 'errors', '', -1],
      ['median latency', 'medianMs', 'ms', -1],
      ['tokens / question', 'tokensPerQ', '', -1],
      ['questions / day', 'questionsPerDay', '', 1],
    ];
    $('#compareOut').innerHTML = metrics.map(([label, key, unit, dir]) => {
      const va = a[key], vb = b[key];
      const aWins = va != null && vb != null && (va - vb) * dir > 0;
      const bWins = va != null && vb != null && (vb - va) * dir > 0;
      const show = (v) => (v == null ? '—' : fmt(v) + unit);
      return `<div class="cmp-row">
        <span class="a ${aWins ? 'better' : ''}">${show(va)}</span>
        <span class="k">${label}</span>
        <span class="b ${bWins ? 'better' : ''}">${show(vb)}</span>
      </div>`;
    }).join('');
  }
}
