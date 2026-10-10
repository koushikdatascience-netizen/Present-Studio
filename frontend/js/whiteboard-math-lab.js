(function () {
  function bounds(lower, upper, discrete = false) {
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper || Math.abs(lower) > 1e6 || Math.abs(upper) > 1e6 || upper - lower > (discrete ? 499 : 1000) || (discrete && (!Number.isInteger(lower) || !Number.isInteger(upper)))) throw new Error(discrete ? 'Use integer bounds with 2 to 500 terms.' : 'Use finite increasing bounds spanning no more than 1,000.');
  }
  function matrix(math, value) {
    const rows = value?.toArray ? value.toArray() : value;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4 || !rows.every(row => Array.isArray(row) && row.length === rows[0].length && row.length > 0 && row.length <= 4 && row.every(Number.isFinite))) throw new Error('Use a rectangular numeric matrix of up to 4 by 4.');
    return rows;
  }
  function symbolic(payload) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/js/math-lab-worker.js?v=20261004-math-lab');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Calculation exceeded 8 seconds. Try a simpler expression.')); }, 8000);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      worker.onmessage = event => { finish(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
      worker.onerror = () => { finish(); reject(new Error('The symbolic library could not load or calculate this expression.')); };
      worker.postMessage(payload);
    });
  }
  function attach({ dialog, loadMath, loadPlot, addText, insertLive, notify }) {
    const panel = document.createElement('aside'); panel.className = 'science-board-window'; panel.dataset.wbWindow = 'math-lab'; panel.hidden = true;
    panel.innerHTML = `<header><strong>Math exploration</strong><button type="button" data-wb-action="close-window" aria-label="Close math exploration"><i data-lucide="x"></i></button></header><section><label>Topic<select data-lab-mode><option value="sequence">Sequences and partial sums</option><option value="integral">Definite integral</option><option value="antiderivative">Antiderivative</option><option value="limit">Limit</option><option value="matrix">Matrices</option></select></label><div class="science-board-presets"><button type="button" data-lab-preset="geometric">Geometric</button><button type="button" data-lab-preset="harmonic">Harmonic</button><button type="button" data-lab-preset="alternating">Alternating</button><button type="button" data-lab-preset="area">Area</button><button type="button" data-lab-preset="limit">sin(x)/x</button><button type="button" data-lab-preset="matrix">Matrix</button></div><label data-lab-expression-label>Expression in x<input data-lab-source value="1/x^2" spellcheck="false"></label><div class="wb-row" data-lab-bounds><label>From<input type="number" data-lab-lower value="1"></label><label>To<input type="number" data-lab-upper value="50"></label></div><label data-lab-point-label hidden>Approach point<input type="number" data-lab-point value="0"></label><div data-lab-matrix-fields hidden><label>Matrix A<textarea data-lab-a spellcheck="false">[[2,1],[1,3]]</textarea></label><label>Operation<select data-lab-operation><option value="det">Determinant</option><option value="inv">Inverse</option><option value="transpose">Transpose</option><option value="multiply">A × B</option><option value="add">A + B</option><option value="solve">Solve Ax = b</option></select></label><label data-lab-b-label hidden>Matrix B / column b<textarea data-lab-b spellcheck="false">[[1],[2]]</textarea></label></div><p class="science-board-message" data-lab-error role="alert"></p><output class="wb-lab-result" data-lab-result aria-live="polite"></output><div class="science-board-plot" data-lab-plot></div><div class="wb-row"><button type="button" class="is-primary" data-lab-run>Calculate</button><button type="button" data-lab-insert disabled>Add result</button><button type="button" data-lab-image disabled>Add visualization</button></div></section>`;
    dialog.append(panel); const q = selector => panel.querySelector(selector); let summary = '', revision = 0, running = false;
    const invalidate = () => { revision++; summary = ''; q('[data-lab-insert]').disabled = true; q('[data-lab-image]').disabled = true; };
    function fields() {
      invalidate(); const mode = q('[data-lab-mode]').value;
      q('[data-lab-expression-label]').hidden = mode === 'matrix'; q('[data-lab-matrix-fields]').hidden = mode !== 'matrix';
      q('[data-lab-bounds]').hidden = !['sequence', 'integral'].includes(mode); q('[data-lab-point-label]').hidden = mode !== 'limit';
      q('[data-lab-b-label]').hidden = !['multiply', 'add', 'solve'].includes(q('[data-lab-operation]').value);
    }
    async function run() {
      if (running) return;
      invalidate(); const version = revision; running = true; q('[data-lab-run]').disabled = true; q('[data-lab-error]').textContent = ''; q('[data-lab-result]').textContent = 'Calculating...';
      try {
        const math = await loadMath(); await loadPlot(); const mode = q('[data-lab-mode]').value;
        const lower = Number(q('[data-lab-lower]').value), upper = Number(q('[data-lab-upper]').value); let traces = [], answer;
        if (mode === 'matrix') {
          const parse = input => matrix(math, window.SnapKeyWhiteboardStudios.expression(math, input).compile().evaluate());
          const a = parse(q('[data-lab-a]').value), operation = q('[data-lab-operation]').value;
          const b = ['multiply', 'add', 'solve'].includes(operation) ? parse(q('[data-lab-b]').value) : null;
          if (['det', 'inv', 'solve'].includes(operation) && a.length !== a[0].length) throw new Error('This operation requires a square matrix A.');
          if (operation === 'solve' && (b.length !== a.length || b[0].length !== 1)) throw new Error('For Ax = b, use a column b matching A.');
          const value = operation === 'multiply' ? math.multiply(a, b) : operation === 'add' ? math.add(a, b) : operation === 'solve' ? math.lusolve(a, b) : math[operation](a);
          answer = `${operation}: ${math.format(value, { precision: 10 })}`;
          traces = [{ type: 'heatmap', z: a, name: 'A', colorscale: 'RdBu', zmid: 0, hovertemplate: 'A[%{y}, %{x}] = %{z}<extra></extra>' }];
        } else {
          const source = q('[data-lab-source]').value;
          const node = window.SnapKeyWhiteboardStudios.expression(math, source, true);
          // Scalar calculus deliberately excludes matrices and complex-valued function evaluation.
          node.traverse(item => { if (item.type === 'ArrayNode' || (item.type === 'SymbolNode' && ['ans', 'i', 'det', 'inv', 'complex', 'transpose', 'norm'].includes(item.name))) throw new Error('Use a real-valued scalar function of x.'); });
          const fn = node.compile(); const evaluate = x => { try { const y = fn.evaluate({ x }); return typeof y === 'number' && Number.isFinite(y) ? y : null; } catch { return null; } };
          if (mode === 'sequence') {
            bounds(lower, upper, true); const x = [], terms = [], sums = []; let sum = 0, correction = 0;
            for (let n = lower; n <= upper; n++) { const term = evaluate(n); if (term === null) throw new Error(`Term ${n} is undefined or not real.`); const adjusted = term - correction; const next = sum + adjusted; correction = (next - sum) - adjusted; sum = next; x.push(n); terms.push(term); sums.push(sum); }
            if (!Number.isFinite(sum)) throw new Error('The partial sum is too large.');
            answer = `Finite partial sum (${lower} to ${upper}) = ${math.format(sum, { precision: 12 })}. Last term = ${math.format(terms.at(-1), { precision: 10 })}. Infinite-series convergence is not established.`;
            traces = [{ x, y: terms, mode: 'markers', name: 'Terms', marker: { color: '#198fa0' } }, { x, y: sums, mode: 'lines', name: 'Partial sums', yaxis: 'y2', line: { color: '#d99816' } }];
          } else {
            const point = Number(q('[data-lab-point]').value);
            if (mode === 'integral') bounds(lower, upper);
            if (mode === 'limit' && (!Number.isFinite(point) || Math.abs(point) > 1e6)) throw new Error('Use a finite approach point.');
            if (mode === 'integral' && Array.from({ length: 401 }, (_, index) => evaluate(lower + (upper - lower) * index / 400)).some(value => value === null)) throw new Error('The interval includes undefined or non-real samples. Improper integrals need separate analysis.');
            const result = await symbolic({ mode, source: node.toString(), lower, upper, point });
            answer = result.unresolved ? `Not resolved symbolically: ${result.exact}` : `${mode}: ${result.exact}${mode === 'antiderivative' ? ' + C' : `; evaluated value: ${result.approximate}`}`;
            const start = mode === 'integral' ? lower : mode === 'limit' ? point - 1 : -5; const end = mode === 'integral' ? upper : mode === 'limit' ? point + 1 : 5;
            const x = Array.from({ length: 401 }, (_, index) => start + (end - start) * index / 400);
            traces = [{ x, y: x.map(evaluate), mode: 'lines', name: 'f(x)', connectgaps: false, ...(mode === 'integral' ? { fill: 'tozeroy' } : {}) }];
            if (mode === 'limit') {
              const approaches = [0.1, 0.01, 0.001, 0.0001];
              answer += '\nApproach samples (not proof): ' + approaches.map(h => `h=${h}: left ${evaluate(point - h)}, right ${evaluate(point + h)}`).join('; ');
            }
          }
        }
        if (version !== revision) return;
        summary = mode === 'matrix' ? `A = ${q('[data-lab-a]').value}\n${answer}` : `f(x) = ${q('[data-lab-source]').value}\n${answer}`; q('[data-lab-result]').textContent = summary;
        await Plotly.react(q('[data-lab-plot]'), traces, { margin: { l: 52, r: 52, t: 20, b: 45 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff', font: { family: 'Arial', size: 12 }, legend: { orientation: 'h' }, ...(mode === 'sequence' ? { yaxis: { title: 'Term' }, yaxis2: { title: 'Partial sum', overlaying: 'y', side: 'right' } } : {}) }, { responsive: true, displaylogo: false });
        if (version === revision) { q('[data-lab-insert]').disabled = false; q('[data-lab-image]').disabled = false; }
      } catch (error) { q('[data-lab-error]').textContent = error.message; q('[data-lab-result]').textContent = ''; } finally { running = false; q('[data-lab-run]').disabled = false; }
    }
    panel.addEventListener('input', invalidate); q('[data-lab-mode]').addEventListener('change', fields); q('[data-lab-operation]').addEventListener('change', fields);
    q('[data-lab-run]').addEventListener('click', run);
    q('[data-lab-insert]').addEventListener('click', () => { if (summary) addText(summary, 'en', 26); });
    q('[data-lab-image]').textContent = 'Add live visualization';
    q('[data-lab-image]').addEventListener('click', async () => { try { const mode = q('[data-lab-mode]').value; if (mode === 'matrix') throw new Error('Use the Live math matrix-transformation lesson for editable matrix visuals.'); await insertLive({ ...window.SnapKeyLiveMath.defaults(mode === 'sequence' ? 'sequence' : mode === 'integral' ? 'integral' : 'graph'), expression: q('[data-lab-source]').value, minimum: ['integral', 'sequence'].includes(mode) ? Number(q('[data-lab-lower]').value) : -5, maximum: ['integral', 'sequence'].includes(mode) ? Number(q('[data-lab-upper]').value) : 5 }); } catch (error) { notify(error.message); } });
    const presets = { geometric: ['sequence', '1/2^x', 1, 40], harmonic: ['sequence', '1/x', 1, 100], alternating: ['sequence', '(-1)^(x+1)/x', 1, 100], area: ['integral', 'x^2', 0, 1], limit: ['limit', 'sin(x)/x', 0, 1], matrix: ['matrix', '', 0, 1] };
    panel.querySelectorAll('[data-lab-preset]').forEach(button => button.addEventListener('click', () => { const [mode, source, lower, upper] = presets[button.dataset.labPreset]; q('[data-lab-mode]').value = mode; q('[data-lab-source]').value = source; q('[data-lab-lower]').value = lower; q('[data-lab-upper]').value = upper; fields(); run(); }));
    fields();
  }
  window.SnapKeyWhiteboardMathLab = { attach, bounds, matrix };
})();
