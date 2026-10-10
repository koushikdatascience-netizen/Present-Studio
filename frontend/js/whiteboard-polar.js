(function () {
  const limited = value => { const text = String(value); if (text.length > 2000) throw new Error('Use at most 2000 characters.'); return text; };
  function normalize(value) {
    return limited(value).replace(/[θφπ√−×·÷²³]/g, c => ({ 'θ': 'theta', 'φ': 'phi', 'π': 'pi', '√': 'sqrt', '−': '-', '×': '*', '·': '*', '÷': '/', '²': '^2', '³': '^3' }[c]))
      .replace(/\bln\b/g, 'log').replace(/\barcsin\b/g, 'asin').replace(/\barccos\b/g, 'acos').replace(/\barctan\b/g, 'atan')
      .replace(/\b(theta|phi|pi|x|y|z|t|a|k|e)\s*\(/g, '$1*(').replace(/\)\s*\(/g, ')*(')
      .replace(/(^|[^a-zA-Z_\d])(\d+(?:\.\d+)?)\s*\(/g, '$1$2*(')
      .replace(/\b(theta|phi|pi|x|y|z|t|a|k|e)\s+(?=[a-zA-Z])/g, '$1*').trim();
  }
  function latexToExpression(value) {
    let source = limited(value).replace(/\\(?:left|right)/g, '').replace(/\\(?:,|;|!|quad|qquad|enspace|thinspace)/g, ' ');
    const group = (text, start) => {
      if (text[start] !== '{') throw new Error('Expected a braced LaTeX argument.');
      let depth = 1, end = start + 1;
      while (end < text.length && depth) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
      if (depth) throw new Error('Unclosed LaTeX argument.');
      return { body: text.slice(start + 1, end - 1), end };
    };
    // Resolve nested fractions and radicals before handling function arguments.
    let match;
    while ((match = /\\(frac|sqrt)(?:\[([^\]]+)\])?/.exec(source))) {
      let start = match.index + match[0].length; while (/\s/.test(source[start] || '') && start < source.length) start++;
      const first = group(source, start); let end = first.end, replacement;
      if (match[1] === 'frac') { while (/\s/.test(source[end] || '') && end < source.length) end++; const second = group(source, end); end = second.end; replacement = `((${latexToExpression(first.body)})/(${latexToExpression(second.body)}))`; }
      else replacement = match[2] ? `((${latexToExpression(first.body)})^(1/(${latexToExpression(match[2])})))` : `sqrt(${latexToExpression(first.body)})`;
      source = source.slice(0, match.index) + replacement + source.slice(end);
    }
    source = source.replace(/\\(?:vartheta|theta)\b/g, ' theta ').replace(/\\phi\b/g, ' phi ').replace(/\\pi\b/g, ' pi ').replace(/\\(?:cdot|times)\b/g, '*').replace(/\\div\b/g, '/');
    source = source.replace(/([a-zA-Z\d)])\s*(?=\\(?:sin|cos|tan|sec|csc|cot|ln|log|arc))/g, '$1*');
    source = source.replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|ln|log)(?:\s*\^\s*(\{[^{}]+\}|[\d]+))?\s*(\([^()]*\)|\{[^{}]*\}|(?:[\d.]+\s*)?(?:theta|phi|pi|[a-zA-Z]))/g, (_, fn, power, arg) => {
      const name = ({ ln: 'log', log: 'log10', arcsin: 'asin', arccos: 'acos', arctan: 'atan' })[fn] || fn;
      const body = arg.replace(/^[({]|[)}]$/g, ''); const result = `${name}(${body})`;
      return power ? `(${result})^(${power.replace(/[{}]/g, '')})` : result;
    });
    let open = false;
    source = source.replace(/\|/g, () => { open = !open; return open ? 'abs(' : ')'; });
    if (open) throw new Error('Absolute value needs matching bars.');
    return normalize(source.replace(/_\{[^{}]*\}|_[a-zA-Z\d]/g, '').replace(/[{}\\]/g, ''));
  }
  function stripLeft(source, names = 'r|ρ|y|z') { return normalize(source).replace(new RegExp(`^\\s*(?:${names})\\s*=\\s*`), ''); }
  function numberFrom(math, text) {
    const source = normalize(limited(text).replace(/°/g, '*pi/180'));
    if (!source || /[^\d+\-*/^().\s]/.test(source.replace(/[a-zA-Z_]+/g, token => ['pi', 'e', 'sqrt'].includes(token) ? '' : token))) throw new Error('Use a finite numeric bound with pi, e or sqrt.');
    const node = math.parse(source); node.traverse(item => {
      if (!['ConstantNode', 'SymbolNode', 'OperatorNode', 'ParenthesisNode', 'FunctionNode'].includes(item.type) || (item.type === 'SymbolNode' && !['pi', 'e', 'sqrt'].includes(item.name)) || (item.type === 'FunctionNode' && item.fn.name !== 'sqrt')) throw new Error('Invalid domain bound.');
    });
    const result = node.compile().evaluate(); if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('Domain bounds must be finite real numbers.'); return result;
  }
  function polarPoints(evaluate, min, max, samples = 1441) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || !Number.isInteger(samples) || samples < 2 || samples > 10000) throw new Error('Choose an increasing finite polar interval.');
    const x = [], y = [];
    for (let i = 0; i < samples; i++) { const theta = min + (max - min) * i / (samples - 1); let r; try { r = evaluate(theta); } catch { r = null; } const valid = typeof r === 'number' && Number.isFinite(r); x.push(valid ? r * Math.cos(theta) : null); y.push(valid ? r * Math.sin(theta) : null); }
    return { x, y };
  }
  function polarGrid(extent) {
    const target = Math.max(.001, Number.isFinite(extent) ? extent : 1), raw = target / 4, base = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].find(n => n * base >= raw) * base, outer = Math.ceil(target / step) * step, shapes = [];
    for (let radius = step; radius <= outer + step / 100; radius += step) shapes.push({ type: 'circle', x0: -radius, y0: -radius, x1: radius, y1: radius, line: { color: '#e0e5eb', width: 1 } });
    for (let angle = 0; angle < 360; angle += 30) shapes.push({ type: 'line', x0: 0, y0: 0, x1: outer * Math.cos(angle * Math.PI / 180), y1: outer * Math.sin(angle * Math.PI / 180), line: { color: angle % 90 ? '#e0e5eb' : '#a7b0bb', width: 1 } });
    return { shapes, outer };
  }
  const presets = Object.fromEntries([
    ['cardioid', 'a*(1+cos(theta))', '2*pi', 1, 3, 'Cardioid'], ['limacon', '1+2*cos(theta)', '2*pi', 1, 3, 'Limacon'], ['rose', 'a*cos(k*theta)', '2*pi', 1, 3, 'Rose'], ['lemniscate', 'a*sqrt(cos(2*theta))\n-a*sqrt(cos(2*theta))', '2*pi', 1, 3, 'Lemniscate'], ['spiral', 'a*theta', '6*pi', .3, 3, 'Spiral']
  ].map(([id, expression, max, a, k, label]) => [id, { mode: 'polar', expression, min: '0', max, a, k, label }]));
  window.SnapKeyMathInput = { latexToExpression, normalize, stripLeft, numberFrom, polarPoints, polarGrid, presets };
})();
