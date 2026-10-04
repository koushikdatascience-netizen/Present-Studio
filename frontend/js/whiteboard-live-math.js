(function () {
  const defaults = kind => ({ version: 1, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, kind, expression: kind === 'surface3d' ? 'a*sin(sqrt(x^2+y^2))' : kind === 'sequence' ? '1/x^2' : 'a*sin(x)', parameter: 1, minimum: kind === 'sequence' ? 1 : -5, maximum: kind === 'sequence' ? 40 : 5, numerator: 3, denominator: 8, position: 0, count: 12, angle: 45, stretch: 1.5 });
  function validate(model) {
    if (!model || model.version !== 1 || !['graph', 'fraction', 'numberline', 'geometry', 'tangent', 'integral', 'matrix', 'surface3d', 'sequence'].includes(model.kind)) throw new Error('Unsupported live math object.');
    if (typeof model.expression !== 'string' || model.expression.length > 500) throw new Error('Use an expression of up to 500 characters.');
    for (const name of ['parameter', 'minimum', 'maximum', 'numerator', 'denominator', 'position', 'count', 'angle', 'stretch']) if (!Number.isFinite(model[name])) throw new Error('Math parameters must be finite.');
    if (model.minimum >= model.maximum || model.maximum - model.minimum > 1000 || Math.abs(model.minimum) > 1e6 || Math.abs(model.maximum) > 1e6) throw new Error('Use an increasing domain spanning at most 1,000.');
    if (model.kind === 'sequence' && (!Number.isInteger(model.minimum) || !Number.isInteger(model.maximum) || model.maximum - model.minimum > 499)) throw new Error('Sequences need integer bounds and no more than 500 terms.');
    if (!Number.isInteger(model.denominator) || model.denominator < 1 || model.denominator > 24 || !Number.isInteger(model.numerator) || model.numerator < 0 || model.numerator > model.denominator) throw new Error('Fractions must have 1–24 pieces and a valid numerator.');
    if (!Number.isInteger(model.count) || model.count < 2 || model.count > 40 || model.angle < 5 || model.angle > 175 || model.stretch < .1 || model.stretch > 3 || Math.abs(model.parameter) > 10 || model.position < 0 || model.position > 1) throw new Error('Math controls are outside their supported range.');
    return model;
  }
  function render(model, math) {
    validate(model); const objects = [];
    const line = (x1, y1, x2, y2, color = '#a7b0bb', width = 1) => objects.push(new fabric.Line([x1, y1, x2, y2], { stroke: color, strokeWidth: width, selectable: false }));
    const label = (text, x, y, size = 15, color = '#202329') => objects.push(new fabric.Text(String(text), { left: x, top: y, fontSize: size, fill: color, fontFamily: 'Arial', selectable: false }));
    const dot = (x, y, radius = 5, color = '#198fa0') => objects.push(new fabric.Circle({ left: x - radius, top: y - radius, radius, fill: color, selectable: false }));
    // The transparent vector boundary keeps stable object dimensions without a bitmap frame.
    objects.push(new fabric.Rect({ left: 0, top: 0, width: 600, height: 360, fill: 'rgba(255,255,255,0)', strokeWidth: 0 }));
    const title = { graph: 'Function graph', fraction: 'Fraction strips', numberline: 'Number line', geometry: 'Triangle and angles', tangent: 'Tangent and secant', integral: 'Riemann rectangles', matrix: 'Matrix transformation', surface3d: 'Live 3D surface', sequence: 'Sequence and partial sums' };
    label(title[model.kind], 12, 8, 20);
    if (model.kind === 'fraction') {
      const cell = 560 / model.denominator;
      for (let index = 0; index < model.denominator; index++) objects.push(new fabric.Rect({ left: 20 + index * cell, top: 100, width: cell - 2, height: 90, fill: index < model.numerator ? '#ffda45' : '#fff', stroke: '#202329', strokeWidth: 1 }));
      label(`${model.numerator} / ${model.denominator} = ${(model.numerator / model.denominator).toFixed(3)}`, 20, 230, 25);
    } else if (model.kind === 'numberline') {
      line(25, 170, 575, 170, '#202329', 3);
      for (let index = 0; index <= 10; index++) { const x = 25 + index * 55; line(x, 160, x, 180, '#202329'); label(Number((model.minimum + (model.maximum - model.minimum) * index / 10).toPrecision(4)), x - 12, 192); }
      const value = model.minimum + model.position * (model.maximum - model.minimum); dot(25 + model.position * 550, 170, 10); label(`x = ${value.toFixed(3)}`, 25, 260, 24);
    } else if (model.kind === 'geometry') {
      const angle = model.angle * Math.PI / 180; const ax = 260, ay = 280, bx = 550, by = 280, cx = ax + 220 * Math.cos(angle), cy = ay - 220 * Math.sin(angle);
      line(ax, ay, bx, by, '#198fa0', 3); line(bx, by, cx, cy, '#198fa0', 3); line(cx, cy, ax, ay, '#198fa0', 3);
      [[ax, ay, 'A'], [bx, by, 'B'], [cx, cy, 'C']].forEach(([x, y, name]) => { dot(x, y); label(name, x + 7, y - 23, 18); });
      const b = Math.atan2(ay - cy, bx - cx) * 180 / Math.PI; label(`A ${model.angle.toFixed(1)}°   B ${b.toFixed(1)}°   C ${(180 - model.angle - b).toFixed(1)}°`, 20, 320, 18);
    } else if (model.kind === 'matrix') {
      const angle = model.angle * Math.PI / 180; const transform = (x, y) => [300 + 90 * (model.stretch * Math.cos(angle) * x - Math.sin(angle) * y), 190 - 90 * (model.stretch * Math.sin(angle) * x + Math.cos(angle) * y)];
      for (let index = -2; index <= 2; index++) { line(120, 190 + index * 70, 480, 190 + index * 70); line(300 + index * 70, 50, 300 + index * 70, 330); }
      line(300, 190, ...transform(1, 0), '#dc5963', 4); line(300, 190, ...transform(0, 1), '#198fa0', 4);
      objects.push(new fabric.Polygon([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => { const p = transform(x, y); return { x: p[0], y: p[1] }; }), { fill: 'rgba(255,218,69,.3)', stroke: '#d99816', strokeWidth: 2 }));
      label(`Rotation ${model.angle.toFixed(1)}°; stretch ${model.stretch.toFixed(2)}; determinant ${model.stretch.toFixed(2)}`, 10, 337, 14);
    } else if (model.kind === 'surface3d') {
      window.SnapKeyWhiteboard3D.compile(math, model.expression);
      label(`z = ${model.expression}`, 30, 60, 22);
    } else {
      const expression = model.expression.replace(/\ba\b/g, `(${model.parameter})`);
      const node = window.SnapKeyWhiteboardStudios.expression(math, expression, true); node.traverse(item => { if (item.type === 'ArrayNode' || (item.type === 'SymbolNode' && ['ans', 'i', 'complex', 'det', 'inv', 'norm', 'transpose'].includes(item.name))) throw new Error('Use a real scalar function of x.'); });
      const compiled = node.compile(); const evaluate = x => { try { const value = compiled.evaluate({ x }); return typeof value === 'number' && Number.isFinite(value) ? value : null; } catch { return null; } };
      const discrete = model.kind === 'sequence'; let sum = 0;
      const samples = Array.from({ length: discrete ? model.maximum - model.minimum + 1 : 181 }, (_, index) => { const x = discrete ? model.minimum + index : model.minimum + (model.maximum - model.minimum) * index / 180; const y = evaluate(x); if (discrete && y === null) throw new Error(`Sequence term ${x} is undefined.`); if (discrete) sum += y; return { x, y, sum }; });
      const finite = samples.filter(item => item.y !== null); if (!finite.length) throw new Error('This domain has no finite real samples.');
      const extent = Math.max(1, Math.min(10000, Math.max(...finite.map(item => Math.max(Math.abs(item.y), discrete ? Math.abs(item.sum) : 0))) * 1.2));
      const px = x => 35 + (x - model.minimum) / (model.maximum - model.minimum) * 530; const py = y => 195 - y / extent * 130;
      for (let index = 0; index <= 10; index++) line(35 + index * 53, 55, 35 + index * 53, 325, '#e5e9ef');
      line(35, 195, 565, 195, '#202329'); if (model.minimum <= 0 && model.maximum >= 0) line(px(0), 55, px(0), 325, '#202329');
      label(model.minimum, 35, 325); label(model.maximum, 535, 325); label(extent.toPrecision(3), 0, 55, 12); label((-extent).toPrecision(3), 0, 300, 12);
      let segment = []; const flush = () => { if (segment.length > 1) objects.push(new fabric.Polyline(segment, { fill: 'transparent', stroke: '#198fa0', strokeWidth: 3, objectCaching: false })); segment = []; };
      samples.forEach(item => { if (item.y === null || Math.abs(item.y) > extent || (segment.length && Math.abs(py(item.y) - segment.at(-1).y) > 150)) flush(); if (item.y !== null && Math.abs(item.y) <= extent) segment.push({ x: px(item.x), y: py(item.y) }); }); flush();
      if (discrete) { if (!Number.isFinite(sum)) throw new Error('Sequence partial sum is too large.'); objects.push(new fabric.Polyline(samples.map(item => ({ x: px(item.x), y: py(item.sum) })), { fill: 'transparent', stroke: '#d99816', strokeWidth: 2 })); samples.filter((_, index) => index % Math.max(1, Math.ceil(samples.length / 50)) === 0).forEach(item => dot(px(item.x), py(item.y), 3)); label(`Partial sum: ${sum.toPrecision(6)}; terms teal / sums gold; finite sum only`, 70, 335, 13); }
      if (model.kind === 'tangent') {
        const x = model.minimum + model.position * (model.maximum - model.minimum), y = evaluate(x); const derivative = math.derivative(node, 'x').compile().evaluate({ x });
        const h = Math.max(.001, (1 - model.position) * (model.maximum - model.minimum) / 4), other = evaluate(x + h);
        if (y !== null && typeof derivative === 'number' && Number.isFinite(derivative)) { const span = (model.maximum - model.minimum) / 8; line(px(x - span), py(y - derivative * span), px(x + span), py(y + derivative * span), '#dc5963', 2); dot(px(x), py(y)); if (other !== null) { line(px(x), py(y), px(x + h), py(other), '#d99816', 2); } label(`x=${x.toFixed(3)}, slope=${derivative.toFixed(3)}`, 150, 335, 14); }
      }
      if (model.kind === 'integral') {
        const dx = (model.maximum - model.minimum) / model.count; let area = 0;
        for (let index = 0; index < model.count; index++) { const x = model.minimum + index * dx, y = evaluate(x + dx / 2); if (y === null || Math.abs(y) > extent) throw new Error('Riemann samples are undefined or outside the display range.'); area += y * dx; objects.push(new fabric.Rect({ left: px(x), top: Math.min(195, py(y)), width: 530 / model.count, height: Math.abs(py(y) - 195), fill: 'rgba(255,218,69,.3)', stroke: '#d99816', strokeWidth: 1 })); }
        label(`Midpoint estimate (${model.count} rectangles): ${area.toPrecision(6)}`, 110, 335, 14);
      }
      label(`f(x)=${model.expression}; a=${model.parameter.toFixed(2)}`, 250, 12, 14);
    }
    return new fabric.Group(objects, { left: 40, top: 60, wbMath: JSON.parse(JSON.stringify(model)), wbKind: 'Live math', objectCaching: false });
  }
  function attach({ dialog, canvas, loadMath, commit, select, notify }) {
    const panel = document.createElement('aside'); panel.className = 'science-board-window'; panel.dataset.wbWindow = 'live-math'; panel.hidden = true;
    panel.innerHTML = `<header><strong>Live math objects</strong><button type="button" data-wb-action="close-window" aria-label="Close live math"><i data-lucide="x"></i></button></header><section><label>Object<select data-live-kind>${[['graph', 'Function graph'], ['surface3d', '3D surface'], ['sequence', 'Sequence / partial sums'], ['fraction', 'Fraction strips'], ['numberline', 'Number line'], ['geometry', 'Triangle angles'], ['tangent', 'Tangent / secant'], ['integral', 'Riemann integration'], ['matrix', 'Matrix transformation']].map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label><label data-live-function>Expression<input data-live-expression value="a*sin(x)"></label><div class="wb-row" data-live-domain><label>Minimum<input data-live-minimum type="number" value="-5"></label><label>Maximum<input data-live-maximum type="number" value="5"></label></div>${[['parameter', 'a', -10, 10, .1], ['position', 'Position', 0, 1, .01], ['numerator', 'Filled pieces', 0, 24, 1], ['denominator', 'Total pieces', 1, 24, 1], ['angle', 'Angle', 5, 175, 1], ['stretch', 'Stretch', .1, 3, .1], ['count', 'Rectangles', 2, 40, 1]].map(([key, text, min, max, step]) => `<label data-live-field="${key}">${text} <output data-live-output="${key}"></output><input data-live-${key} type="range" min="${min}" max="${max}" step="${step}" value="${defaults('graph')[key]}"></label>`).join('')}<p data-live-error role="alert" class="science-board-message"></p><div class="wb-row"><button type="button" class="is-primary" data-live-add>Add live object</button><button type="button" data-live-update>Update selected</button><button type="button" data-live-play aria-pressed="false"><i data-lucide="play"></i></button></div></section>`;
    dialog.append(panel); const q = selector => panel.querySelector(selector); const explanation = document.createElement('section'); explanation.innerHTML = '<strong data-live-check></strong><ol data-live-steps></ol>'; panel.querySelector('section').append(explanation); let timer, target = null, math, pending = 0, replacing = false;
    function stop() { clearInterval(timer); timer = null; q('[data-live-play]').setAttribute('aria-pressed', 'false'); q('[data-live-play]').title = 'Animate parameter'; }
    function read() { const model = defaults(q('[data-live-kind]').value); if (target?.wbMath?.kind === model.kind) { model.id = target.wbMath.id; if (target.wbMath.camera) model.camera = target.wbMath.camera; } Object.keys(model).filter(key => !['kind', 'version', 'id', 'camera'].includes(key)).forEach(key => { const field = q(`[data-live-${key}]`); if (field) model[key] = key === 'expression' ? field.value : Number(field.value); }); return model; }
    function fields() { const model = read(); q('[data-live-function]').hidden = !['graph', 'tangent', 'integral', 'surface3d', 'sequence'].includes(model.kind); q('[data-live-domain]').hidden = !['graph', 'tangent', 'integral', 'numberline', 'surface3d', 'sequence'].includes(model.kind); const visible = { graph: ['parameter'], surface3d: ['parameter'], sequence: ['parameter'], tangent: ['parameter', 'position'], integral: ['parameter', 'count'], fraction: ['numerator', 'denominator'], numberline: ['position'], geometry: ['angle'], matrix: ['angle', 'stretch'] }[model.kind]; panel.querySelectorAll('[data-live-field]').forEach(label => { const key = label.dataset.liveField; label.hidden = !visible.includes(key); q(`[data-live-output="${key}"]`).textContent = model[key]; }); q('[data-live-numerator]').max = model.denominator; const checked = window.SnapKeyLessons?.explanations(model); if (checked) { q('[data-live-check]').textContent = checked.status; q('[data-live-steps]').replaceChildren(); checked.steps.forEach(text => { const item = document.createElement('li'); item.textContent = text; q('[data-live-steps]').append(item); }); } }
    function populate(object) { if (replacing) return; stop(); target = object?.wbMath ? object : null; if (!target) return; q('[data-live-kind]').value = object.wbMath.kind; Object.entries(object.wbMath).forEach(([key, value]) => { const input = q(`[data-live-${key}]`); if (input) input.value = value; }); fields(); }
    async function update(add = false) {
      const version = ++pending;
      if (read().kind === 'surface3d' && canvas.getObjects().filter(object => object.wbMath?.kind === 'surface3d').length - (!add && target?.wbMath?.kind === 'surface3d' ? 1 : 0) >= 4) { stop(); notify('A page can contain at most four live 3D surfaces.'); return; }
      try { math ||= await loadMath(); if (version !== pending) return; if (!add && (!target || !canvas.getObjects().includes(target))) throw new Error('Select a live math object first.'); const model = read(); const next = render(model, math); if (!add) next.set({ left: target.left, top: target.top, scaleX: target.scaleX, scaleY: target.scaleY, angle: target.angle }); replacing = true; if (!add) canvas.remove(target); canvas.add(next); target = next; select(); canvas.setActiveObject(next); canvas.requestRenderAll(); q('[data-live-error]').textContent = ''; commit(); } catch (error) { stop(); q('[data-live-error]').textContent = error.message; notify(error.message); } finally { replacing = false; }
    }
    canvas.on('selection:created', event => populate(event.selected?.[0])); canvas.on('selection:updated', event => populate(event.selected?.[0])); canvas.on('selection:cleared', () => { if (!replacing) { target = null; stop(); } });
    let dragging = null;
    const localPoint = (event, object) => { const point = fabric.util.transformPoint(canvas.getPointer(event.e), fabric.util.invertTransform(object.calcTransformMatrix())); return { x: point.x + object.width / 2, y: point.y + object.height / 2 }; };
    const moveHandle = point => {
      if (!dragging) return;
      const kind = dragging.object.wbMath.kind;
      if (kind === 'numberline' || kind === 'tangent') q('[data-live-position]').value = Math.max(0, Math.min(1, (point.x - (kind === 'numberline' ? 25 : 35)) / (kind === 'numberline' ? 550 : 530)));
      else if (kind === 'geometry') q('[data-live-angle]').value = Math.max(5, Math.min(175, Math.atan2(280 - point.y, point.x - 260) * 180 / Math.PI));
      else if (kind === 'fraction') q('[data-live-numerator]').value = Math.max(0, Math.min(Number(q('[data-live-denominator]').value), Math.ceil((point.x - 20) / 560 * Number(q('[data-live-denominator]').value))));
      fields(); update();
    };
    canvas.on('mouse:down', event => {
      const object = event.target; if (!object?.wbMath || !['numberline', 'geometry', 'fraction', 'tangent'].includes(object.wbMath.kind) || canvas.isDrawingMode || !object.selectable) return;
      const point = localPoint(event, object), model = object.wbMath;
      const vertex = { x: 260 + 220 * Math.cos(model.angle * Math.PI / 180), y: 280 - 220 * Math.sin(model.angle * Math.PI / 180) };
      const handle = model.kind === 'fraction' ? point.y >= 100 && point.y <= 190 : model.kind === 'geometry' ? Math.hypot(point.x - vertex.x, point.y - vertex.y) < 24 : model.kind === 'numberline' ? Math.hypot(point.x - (25 + model.position * 550), point.y - 170) < 24 : point.x >= 35 && point.x <= 565 && point.y >= 55 && point.y <= 325;
      if (!handle) return; populate(object); dragging = { object, lockedX: object.lockMovementX, lockedY: object.lockMovementY }; object.lockMovementX = true; object.lockMovementY = true; moveHandle(point);
    });
    canvas.on('mouse:move', event => { if (dragging) moveHandle(localPoint(event, dragging.object)); });
    canvas.on('mouse:up', () => { if (dragging) { dragging.object.lockMovementX = dragging.lockedX; dragging.object.lockMovementY = dragging.lockedY; dragging = null; } });
    panel.addEventListener('input', event => { if (event.target.matches('[data-live-kind]')) return; fields(); if (target) update(); }); q('[data-live-kind]').addEventListener('change', () => { stop(); target = null; const initial = defaults(q('[data-live-kind]').value); ['expression', 'minimum', 'maximum'].forEach(key => { q(`[data-live-${key}]`).value = initial[key]; }); fields(); });
    q('[data-live-add]').addEventListener('click', () => update(true)); q('[data-live-update]').addEventListener('click', () => update());
    q('[data-live-play]').title = 'Animate parameter'; q('[data-live-play]').setAttribute('aria-label', 'Animate parameter');
    q('[data-live-play]').addEventListener('click', () => { if (timer) { stop(); return; } if (!target) { notify('Add or select a live object first.'); return; } const model = read(); const key = { graph: 'parameter', surface3d: 'parameter', sequence: 'parameter', tangent: 'position', integral: 'count', fraction: 'numerator', numberline: 'position', geometry: 'angle', matrix: 'angle' }[model.kind]; const field = q(`[data-live-${key}]`); const original = Number(field.value); let frame = 0; q('[data-live-play]').setAttribute('aria-pressed', 'true'); timer = setInterval(() => { if (!dialog.open || panel.hidden) { stop(); return; } const min = Number(field.min), max = Number(field.max), step = Number(field.step); field.value = Math.min(max, Math.max(min, Math.round((min + (max - min) * (Math.sin(original + ++frame / 12) + 1) / 2) / step) * step)); fields(); update(); }, 150); });
    dialog.addEventListener('close', stop); fields();
    return { stop, populate, insert: async model => { stop(); target = null; q('[data-live-kind]').value = model.kind; Object.entries(model).forEach(([key, value]) => { const input = q(`[data-live-${key}]`); if (input) input.value = value; }); fields(); await update(true); } };
  }
  window.SnapKeyLiveMath = { defaults, validate, render, attach };
})();
