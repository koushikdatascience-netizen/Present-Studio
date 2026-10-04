(function () {
  const assets = new Map();
  function script(url) {
    if (!assets.has(url)) assets.set(url, new Promise((resolve, reject) => {
      const node = document.createElement('script'); node.src = url; node.async = true;
      node.onload = resolve; node.onerror = () => { assets.delete(url); node.remove(); reject(new Error('A whiteboard library could not load. Check your connection and retry.')); };
      document.head.append(node);
    }));
    return assets.get(url);
  }
  const icon = (name, label, action, extra = '') => `<button type="button" class="wb-icon" data-wb-action="${action}" title="${label}" aria-label="${label}" ${extra}><i data-lucide="${name}"></i></button>`;
  const uid = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const blankPage = number => ({ id: uid(), title: `Page ${number}`, paper: 'blank', scene: { version: '5.3.0', objects: [], background: '#fff' } });

  function create(options) {
    const { api, presentationId, token = '', requestOptions = {}, socket, onActivate, onStop, onDocument, notify } = options;
    let board = { version: 1, revision: 0, pages: [blankPage(1)] }; board.activePageId = board.pages[0].id;
    let canvas, dialog, liveMath, loading = false, busy = false, uploading = false, dirty = false, saveTimer, savePromise = Promise.resolve(), generation = 0;
    let tool = 'pen', ink = '#202329', size = 4, zoom = 1, pan = { x: 0, y: 0 }, pointer = null, pendingShape = null;
    let baseScale = 1, graphReady = false, pdf = null, pdfPage = 1, pdfZoom = 1, pdfTask = null, equationSvg = null, threeGraph = null;
    const histories = new Map();
    const q = selector => dialog.querySelector(selector);
    const page = () => board.pages.find(item => item.id === board.activePageId) || board.pages[0];
    const status = text => { if (dialog) q('[data-wb-save]').textContent = text; };
    const guard = fn => async (...args) => { try { await fn(...args); } catch (error) { notify(error.message || 'This whiteboard action could not be completed.'); } };
    function capture() { if (canvas && !loading) { page().scene = canvas.toJSON(['wbKind', 'direction', 'wbMath', 'wbLatex']); delete page().scene.clipPath; } }
    function remember() {
      const history = histories.get(page().id) || { entries: [], index: -1 };
      const value = JSON.stringify(page().scene);
      if (history.entries[history.index] === value) return;
      history.entries.splice(history.index + 1); history.entries.push(value);
      if (history.entries.length > 40) history.entries.shift();
      history.index = history.entries.length - 1; histories.set(page().id, history);
      updateHistoryButtons();
    }
    function updateHistoryButtons() {
      const history = histories.get(page().id);
      q('[data-wb-action="undo"]').disabled = !history || history.index <= 0;
      q('[data-wb-action="redo"]').disabled = !history || history.index >= history.entries.length - 1;
    }
    function updatePages() {
      const select = q('[data-wb-pages]'); select.replaceChildren();
      board.pages.forEach(item => select.add(new Option(item.title, item.id)));
      select.value = page().id;
      const index = board.pages.indexOf(page());
      q('[data-wb-action="previous"]').disabled = index === 0;
      q('[data-wb-action="next"]').disabled = index === board.pages.length - 1;
      q('[data-wb-action="add-page"]').disabled = board.pages.length >= 40;
      q('[data-wb-paper]').value = page().paper || 'blank';
      q('[data-wb-format]').value = page().width === 1280 && page().height === 720 ? 'landscape' : page().width === 900 && page().height === 1280 ? 'portrait' : 'auto';
      updateHistoryButtons();
    }
    function publish() {
      dirty = true; generation += 1; status('Unsaved changes');
      onDocument(clone(board));
      if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 650);
    }
    async function flush() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty) return savePromise;
      if (busy) return savePromise.then(() => dirty ? flush() : undefined);
      const version = generation;
      const document = clone(board);
      busy = true; status('Saving...');
      savePromise = api.saveWhiteboard(presentationId, document, board.revision, token, requestOptions).then(result => {
        board.revision = result.revision; dirty = version !== generation;
        status(dirty ? 'Unsaved changes' : 'Saved to meeting');
      }).catch(error => {
        status('Not saved'); notify(error.message);
        throw error;
      }).finally(() => { busy = false; });
      try { await savePromise; if (dirty) await flush(); } catch { /* Retain edits for retry or export. */ }
    }
    function commit() { if (loading) return; capture(); remember(); publish(); }
    async function loadPage() {
      liveMath?.stop();
      loading = true;
      await new Promise(resolve => canvas.loadFromJSON(clone(page().scene), resolve));
      loading = false; viewport(); canvas.renderAll(); remember(); setTool(tool); updatePages();
    }
    function viewport() {
      if (!canvas) return;
      const bounds = q('.science-board-viewport').getBoundingClientRect();
      canvas.setDimensions({ width: bounds.width, height: bounds.height });
      const width = page().width || 1280; const height = page().height || 720;
      baseScale = Math.min(bounds.width / width, bounds.height / height) * .96;
      const scale = baseScale * zoom;
      canvas.clipPath = new fabric.Rect({ left: 0, top: 0, width, height, absolutePositioned: true });
      canvas.setViewportTransform([scale, 0, 0, scale, (bounds.width - width * scale) / 2 + pan.x, (bounds.height - height * scale) / 2 + pan.y]);
      q('[data-wb-zoom]').textContent = `${Math.round(zoom * 100)}%`;
      canvas.renderAll();
    }
    function setTool(next) {
      tool = next;
      canvas.isDrawingMode = ['pen', 'marker', 'pencil'].includes(tool);
      canvas.selection = tool === 'select';
      canvas.defaultCursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
      canvas.getObjects().forEach(object => { object.selectable = tool === 'select'; object.evented = ['select', 'eraser'].includes(tool); });
      if (canvas.isDrawingMode) {
        const brush = new fabric.PencilBrush(canvas);
        const color = new fabric.Color(ink); color.setAlpha(tool === 'marker' ? .25 : tool === 'pencil' ? .65 : 1);
        brush.color = color.toRgba(); brush.width = size * (tool === 'marker' ? 4 : 1); brush.decimate = .7;
        canvas.freeDrawingBrush = brush;
      }
      q('[data-wb-size-value]').textContent = `${size}`;
      dialog.querySelectorAll('[data-wb-tool]').forEach(button => { const active = button.dataset.wbTool === tool; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
    }
    function erase(event) { const target = canvas.findTarget(event.e); if (target) { canvas.remove(target); canvas.requestRenderAll(); } }
    function bindCanvas() {
      canvas.on('path:created', commit); canvas.on('object:modified', commit);
      canvas.on('mouse:down', event => {
        if (canvas.isDrawingMode || tool === 'select') return;
        const original = event.e;
        pointer = { clientX: original.clientX, clientY: original.clientY, pan: { ...pan }, point: canvas.getPointer(original) };
        if (tool === 'eraser') erase(event);
        if (['line', 'rectangle', 'circle'].includes(tool)) {
          const point = pointer.point;
          pendingShape = tool === 'line' ? new fabric.Line([point.x, point.y, point.x, point.y], { stroke: ink, strokeWidth: size }) : tool === 'circle' ? new fabric.Ellipse({ left: point.x, top: point.y, rx: 0, ry: 0, fill: 'transparent', stroke: ink, strokeWidth: size }) : new fabric.Rect({ left: point.x, top: point.y, width: 0, height: 0, fill: 'transparent', stroke: ink, strokeWidth: size });
          pendingShape.selectable = false; pendingShape.evented = false; canvas.add(pendingShape);
        }
        if (tool === 'text') {
          const text = new fabric.IText('Text', { left: pointer.point.x, top: pointer.point.y, fill: ink, fontFamily: 'Arial', fontSize: 36 });
          canvas.add(text); setTool('select'); canvas.setActiveObject(text); text.enterEditing(); text.selectAll();
          text.on('editing:exited', commit); commit();
        }
      });
      canvas.on('mouse:move', event => {
        if (!pointer) return;
        if (tool === 'pan') { pan = { x: pointer.pan.x + event.e.clientX - pointer.clientX, y: pointer.pan.y + event.e.clientY - pointer.clientY }; viewport(); }
        else if (tool === 'eraser') erase(event);
        else if (pendingShape) {
          const end = canvas.getPointer(event.e); const start = pointer.point;
          if (tool === 'line') pendingShape.set({ x2: end.x, y2: end.y });
          else { pendingShape.set({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), ...(tool === 'circle' ? { rx: Math.abs(end.x - start.x) / 2, ry: Math.abs(end.y - start.y) / 2 } : {}) }); }
          canvas.requestRenderAll();
        }
      });
      canvas.on('mouse:up', () => {
        if (pointer && (tool === 'eraser' || pendingShape)) { pendingShape?.setCoords(); commit(); }
        pointer = null; pendingShape = null;
      });
      canvas.on('mouse:wheel', event => {
        if (!event.e.ctrlKey && !event.e.metaKey) return;
        zoom = Math.min(4, Math.max(.25, zoom * Math.exp(-event.e.deltaY / 500))); viewport(); event.e.preventDefault();
      });
    }
    function paper(mode) {
      page().paper = mode;
      if (mode === 'blank') canvas.backgroundColor = '#fff';
      else {
        const pattern = document.createElement('canvas'); pattern.width = 32; pattern.height = 32;
        const context = pattern.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 32, 32); context.strokeStyle = '#dfe5ed'; context.fillStyle = '#c0c9d6';
        if (mode === 'dots') { context.beginPath(); context.arc(2, 2, 1, 0, Math.PI * 2); context.fill(); }
        else { context.beginPath(); context.moveTo(0, 0); context.lineTo(32, 0); if (mode === 'grid') { context.moveTo(0, 0); context.lineTo(0, 32); } context.stroke(); }
        canvas.backgroundColor = new fabric.Pattern({ source: pattern.toDataURL(), repeat: 'repeat' });
      }
      canvas.renderAll(); commit();
    }
    async function changePage(id) { if (uploading) throw new Error('Wait for the reference upload before changing pages.'); liveMath?.stop(); capture(); board.activePageId = id; zoom = 1; pan = { x: 0, y: 0 }; await loadPage(); viewport(); publish(); }
    async function addPage(copy = false) {
      if (uploading) throw new Error('Wait for the reference upload before adding pages.');
      if (board.pages.length >= 40) throw new Error('This board has reached its 40-page limit.');
      capture(); const item = copy ? { ...clone(page()), id: uid(), title: `${page().title} copy` } : blankPage(board.pages.length + 1);
      item.width = page().width || 1280; item.height = page().height || 720;
      board.pages.push(item); await changePage(item.id);
    }
    async function history(delta) {
      liveMath?.stop();
      const state = histories.get(page().id); if (!state || state.index + delta < 0 || state.index + delta >= state.entries.length) return;
      state.index += delta; page().scene = JSON.parse(state.entries[state.index]);
      loading = true; await new Promise(resolve => canvas.loadFromJSON(page().scene, resolve)); loading = false; setTool(tool); updateHistoryButtons(); canvas.renderAll(); publish();
    }
    function download(url, filename) { const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); }
    async function rasterBlob(source) { return new Promise(resolve => source.toBlob(resolve, 'image/png')); }
    async function upload(blob, name) {
      if (!blob) throw new Error('The image could not be rendered.');
      const file = new File([blob], name, { type: 'image/png' });
      if (!requestOptions.publicAccess) { const result = await api.uploadMedia(file); return result.asset.url; }
      const form = new FormData(); form.append('file', file); form.append('presentation_id', presentationId); form.append('client_id', ''); form.append('share_token', token);
      const response = await fetch('/api/media/meeting-upload', { method: 'POST', body: form, credentials: 'omit' });
      const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'Image upload failed');
      return result.attachment.url;
    }
    async function addImage(blob, name) {
      if (uploading) throw new Error('A reference upload is already in progress.');
      uploading = true;
      try {
      status('Uploading...'); const url = await upload(blob, name);
      const image = await new Promise((resolve, reject) => fabric.Image.fromURL(url, value => value?.width ? resolve(value) : reject(new Error('The uploaded image could not load. Check storage access.')), { crossOrigin: 'anonymous' }));
      const width = page().width || 1280; const height = page().height || 720;
      image.scale(Math.min(width * .46 / image.width, height * .72 / image.height, 1));
      const reference = name.startsWith('PDF') || name.startsWith('Equation');
      let top = height * .08;
      if (name.startsWith('PDF')) { top = Math.max(height * .24, ...canvas.getObjects().filter(object => object.wbKind?.startsWith('Equation')).map(object => object.top + object.getScaledHeight() + 24)); image.scale(Math.min(width * .46 / image.width, Math.max(120, height - top - 20) / image.height, 1)); }
      image.set({ left: reference ? width * .54 : width * .04, top, wbKind: name });
      canvas.add(image); setTool('select'); canvas.setActiveObject(image); canvas.renderAll(); commit();
      } catch (error) { status('Reference upload failed'); throw error; } finally { uploading = false; }
    }
    function showWindow(name) { dialog.querySelectorAll('.science-board-window').forEach(window => { window.hidden = window.dataset.wbWindow !== name; }); }
    function dragWindows() {
      dialog.querySelectorAll('.science-board-window > header').forEach(header => {
        header.addEventListener('pointerdown', event => {
          if (event.target.closest('button') || innerWidth <= 640) return;
          const window = header.parentElement; const rect = window.getBoundingClientRect(); const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          header.setPointerCapture(event.pointerId);
          const move = e => { window.style.left = `${Math.max(8, Math.min(dialog.clientWidth - rect.width - 8, e.clientX - offset.x))}px`; window.style.right = 'auto'; window.style.top = `${Math.max(116, Math.min(dialog.clientHeight - 120, e.clientY - offset.y))}px`; };
          const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); header.removeEventListener('pointercancel', up); };
          header.addEventListener('pointermove', move); header.addEventListener('pointerup', up); header.addEventListener('pointercancel', up);
        });
      });
    }
    function compileExpression(expression) {
      if (!expression.trim() || expression.length > 500) throw new Error('Enter a mathematical expression of up to 500 characters.');
      const node = math.parse(expression); let count = 0;
      const symbols = new Set(['x', 'y', 't', 'a', 'pi', 'e']);
      const functions = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'log10', 'sqrt', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'sign', 'pow']);
      node.traverse(item => {
        if (++count > 150 || !['ConstantNode', 'SymbolNode', 'OperatorNode', 'FunctionNode', 'ParenthesisNode'].includes(item.type)) throw new Error('Use a numeric expression, not assignments or programming commands.');
        if (item.type === 'SymbolNode' && !symbols.has(item.name) && !functions.has(item.name)) throw new Error(`Unknown symbol: ${item.name}`);
        if (item.type === 'FunctionNode' && !functions.has(item.fn.name)) throw new Error('That function is not supported in this graph.');
        if (item.type === 'ConstantNode' && typeof item.value !== 'number') throw new Error('Only numeric constants are supported.');
      });
      return node.compile();
    }
    function dispose3d() {
      if (!threeGraph) return;
      cancelAnimationFrame(threeGraph.frame); threeGraph.observer.disconnect(); threeGraph.controls.dispose();
      threeGraph.scene.traverse(object => { object.geometry?.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => { material?.map?.dispose(); material?.dispose(); }); });
      threeGraph.renderer.dispose(); threeGraph = null;
    }
    async function draw3d(mode, expressions, values, evaluate) {
      const [THREE, { OrbitControls }] = await Promise.all([import('https://esm.sh/three@0.170.0'), import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js')]);
      const target = q('[data-wb-plot]'); if (window.Plotly) Plotly.purge(target); target.replaceChildren(); dispose3d();
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#f5f7fa');
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .85; target.append(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(45, 1, .01, 100000);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      const group = new THREE.Group(); scene.add(group);
      if (mode === 'surface') {
        const points = [], colors = [], indices = []; const valid = [];
        values.forEach((y, row) => values.forEach((x, column) => {
          const z = evaluate(expressions[0], { x, y }); valid.push(z !== null);
          points.push(x, z || 0, y);
          const color = new THREE.Color().setHSL(.6 - Math.min(.22, Math.max(0, ((z || 0) + 4) / 36)), .62, .5); colors.push(color.r, color.g, color.b);
          if (row && column) {
            const index = row * values.length + column; const previous = index - values.length;
            if (valid[index] && valid[index - 1] && valid[previous] && valid[previous - 1]) indices.push(index, index - 1, previous, index - 1, previous - 1, previous);
          }
        }));
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
        group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .65 })));
      } else {
        const second = compileExpression(q('[data-wb-expression-y]').value); const third = compileExpression(q('[data-wb-expression-z]').value);
        let segment = [];
        const append = () => { if (segment.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment), new THREE.LineBasicMaterial({ color: '#198fa0' }))); segment = []; };
        values.forEach(t => { const x = evaluate(expressions[0], { t }), y = evaluate(second, { t }), z = evaluate(third, { t }); if ([x, y, z].includes(null)) append(); else segment.push(new THREE.Vector3(x, z, y)); }); append();
      }
      if (!group.children.length) { renderer.dispose(); throw new Error('This expression has no real values in the selected domain.'); }
      const bounds = new THREE.Box3().setFromObject(group); const center = bounds.getCenter(new THREE.Vector3()); const extent = bounds.getSize(new THREE.Vector3()); const span = Math.max(extent.x, extent.y, extent.z, 1);
      group.position.sub(center);
      const grid = new THREE.GridHelper(span * 1.3, 16, '#a9b5c5', '#dce2eb'); grid.position.y = -center.y; scene.add(grid);
      const axes = new THREE.AxesHelper(span * .65); axes.position.copy(group.position); scene.add(axes);
      scene.add(new THREE.HemisphereLight('#fff', '#8597ad', 1.8)); const light = new THREE.DirectionalLight('#fff', 2); light.position.set(10, 20, 12); scene.add(light);
      camera.position.set(span * 1.1, span * .85, span * 1.2); camera.lookAt(0, 0, 0);
      const resize = () => { const rect = target.getBoundingClientRect(); renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(target); resize();
      threeGraph = { renderer, controls, scene, observer, frame: null };
      const animate = () => { if (!threeGraph || threeGraph.renderer !== renderer) return; threeGraph.frame = requestAnimationFrame(animate); if (dialog.open && !q('[data-wb-window="graph"]').hidden) { controls.update(); renderer.render(scene, camera); } }; animate(); renderer.render(scene, camera);
    }
    async function graph() {
      const error = q('[data-wb-graph-error]'); error.textContent = '';
      try {
        if (!graphReady) { await Promise.all([script('https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js'), script('https://cdn.jsdelivr.net/npm/mathjs@13.2.3/lib/browser/math.js')]); graphReady = true; }
        const mode = q('[data-wb-graph-mode]').value; const min = Number(q('[data-wb-domain-min]').value); const max = Number(q('[data-wb-domain-max]').value); const a = Number(q('[data-wb-parameter]').value);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || max - min > 1000) throw new Error('Choose a finite domain with minimum below maximum (maximum span 1000).');
        const expressions = q('[data-wb-expression]').value.split('\n').filter(line => line.trim()).slice(0, 5).map(line => { let source = line.trim(); if (mode === 'implicit' && source.includes('=')) { const sides = source.split('='); if (sides.length !== 2) throw new Error('Use one equality per implicit expression.'); source = `(${sides[0]})-(${sides[1]})`; } else source = source.replace(/^[yz]\s*=\s*/, ''); return compileExpression(source); });
        if (!expressions.length) throw new Error('Enter at least one expression.');
        const evaluate = (expression, scope) => { try { const result = expression.evaluate({ ...scope, a }); return typeof result === 'number' && Number.isFinite(result) && Math.abs(result) < 1e9 ? result : null; } catch { return null; } };
        const domain = count => Array.from({ length: count }, (_, index) => min + index * (max - min) / (count - 1));
        if (['surface', 'curve3d'].includes(mode)) { await draw3d(mode, expressions, domain(mode === 'surface' ? 61 : 501), evaluate); q('[data-wb-graph-insert]').disabled = false; return; }
        const had3d = Boolean(threeGraph); dispose3d(); if (had3d) q('[data-wb-plot]').replaceChildren();
        let traces;
        const colors = ['#198fa0', '#dc5963', '#9670c2', '#d99816', '#3a9366'];
        if (mode === 'surface' || mode === 'implicit') {
          const values = domain(mode === 'surface' ? 61 : 101); const z = values.map(y => values.map(x => evaluate(expressions[0], { x, y })));
          traces = [{ type: mode === 'surface' ? 'surface' : 'contour', x: values, y: values, z, colorscale: 'Viridis', showscale: mode === 'surface', ...(mode === 'implicit' ? { contours: { start: 0, end: 0, size: 1, coloring: 'lines' }, line: { width: 3 }, showscale: false } : {}) }];
        } else if (mode === 'parametric' || mode === 'curve3d') {
          const values = domain(501); const second = compileExpression(q('[data-wb-expression-y]').value); const third = mode === 'curve3d' ? compileExpression(q('[data-wb-expression-z]').value) : null;
          traces = [{ type: third ? 'scatter3d' : 'scatter', mode: 'lines', x: values.map(t => evaluate(expressions[0], { t })), y: values.map(t => evaluate(second, { t })), ...(third ? { z: values.map(t => evaluate(third, { t })) } : {}), line: { color: colors[0], width: third ? 5 : 3 } }];
        } else traces = expressions.map((expression, index) => { const x = domain(601); return { type: 'scatter', mode: 'lines', x, y: x.map(x => evaluate(expression, { x })), name: `f${index + 1}(x)`, connectgaps: false, line: { color: colors[index], width: 3 } }; });
        await Plotly.react(q('[data-wb-plot]'), traces, { margin: { l: 42, r: 15, t: 15, b: 38 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff', font: { family: 'Arial', size: 11 }, xaxis: { title: mode.includes('3d') ? 'x' : mode === 'parametric' ? 'x(t)' : 'x', gridcolor: '#e5e9ef', zerolinecolor: '#bbc4d0' }, yaxis: { title: 'y', gridcolor: '#e5e9ef', zerolinecolor: '#bbc4d0' }, scene: { aspectmode: 'auto', xaxis: { title: 'x' }, yaxis: { title: 'y' }, zaxis: { title: 'z' } }, showlegend: traces.length > 1 }, { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['sendDataToCloud'] });
        q('[data-wb-graph-insert]').disabled = false;
      } catch (message) { error.textContent = message.message; q('[data-wb-graph-insert]').disabled = true; }
    }
    async function equation() {
      if (!window.MathJax?.tex2svgPromise) {
        window.MathJax = { startup: { typeset: false }, svg: { fontCache: 'none' }, tex: { packages: ['base', 'ams'], maxBuffer: 10000 } };
        await script('https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js'); await MathJax.startup.promise;
      }
      const value = q('[data-wb-latex]').value || ''; if (!value.trim() || value.length > 2000) throw new Error('Enter an equation of up to 2000 characters.');
      const output = await MathJax.tex2svgPromise(value, { display: true });
      if (output.querySelector('[data-mjx-error]')) throw new Error('Check the equation syntax.');
      equationSvg = output.querySelector('svg'); q('[data-wb-equation-preview]').replaceChildren(output); q('[data-wb-equation-insert]').disabled = false;
    }
    async function insertEquation() {
      await equation();
      const svg = equationSvg.cloneNode(true); const [, , width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number); svg.setAttribute('width', Math.ceil(width * .045)); svg.setAttribute('height', Math.ceil(height * .045)); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const value = q('[data-wb-latex]').value;
      const group = await new Promise((resolve, reject) => fabric.loadSVGFromString(new XMLSerializer().serializeToString(svg), (objects, settings) => objects.length ? resolve(fabric.util.groupSVGElements(objects, settings)) : reject(new Error('The equation could not be rendered as vectors.'))));
      const selected = canvas.getActiveObject(); const previous = selected?.wbLatex !== undefined ? selected : null;
      group.scale(Math.min(1, 500 / Math.max(1, group.width))); group.set({ left: previous?.left ?? 60, top: previous?.top ?? 60, wbKind: 'Equation', wbLatex: value });
      if (previous) canvas.remove(previous); canvas.add(group); setTool('select'); canvas.setActiveObject(group); canvas.renderAll(); commit();
    }
    async function renderPdf() {
      if (!pdf) return;
      if (pdfTask) { pdfTask.cancel(); try { await pdfTask.promise; } catch {} }
      const item = await pdf.getPage(pdfPage); const original = item.getViewport({ scale: 1 }); const viewport = item.getViewport({ scale: Math.min(pdfZoom * 1.25, 2400 / Math.max(original.width, original.height)) });
      const output = q('[data-wb-pdf-canvas]'); output.width = viewport.width; output.height = viewport.height;
      output.style.width = `${Math.round(pdfZoom * 100)}%`;
      pdfTask = item.render({ canvasContext: output.getContext('2d'), viewport }); await pdfTask.promise;
      q('[data-wb-pdf-page]').textContent = `${pdfPage} / ${pdf.numPages}`;
      q('[data-wb-action="pdf-previous"]').disabled = pdfPage <= 1; q('[data-wb-action="pdf-next"]').disabled = pdfPage >= pdf.numPages;
    }
    async function openPdf(file) {
      if (!file || file.size > 30 * 1024 * 1024) throw new Error('Choose a PDF no larger than 30 MB.');
      showWindow('pdf'); q('[data-wb-pdf-title]').textContent = file.name; status('Opening PDF...');
      const library = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
      library.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const data = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('This file is not a valid PDF.');
      await pdf?.destroy(); pdf = await library.getDocument({ data, isEvalSupported: false }).promise; pdfPage = 1; pdfZoom = 1; await renderPdf(); status(dirty ? 'Unsaved changes' : 'Saved to meeting');
    }
    function build() {
      dialog = document.createElement('dialog'); dialog.className = 'science-board'; dialog.setAttribute('aria-label', 'Science whiteboard workspace');
      const tools = [['mouse-pointer-2', 'Select and move objects', 'select'], ['pen-tool', 'Smooth pen', 'pen'], ['pencil', 'Pencil', 'pencil'], ['highlighter', 'Highlighter', 'marker'], ['eraser', 'Erase an object or stroke', 'eraser'], ['hand', 'Grab and pan', 'pan'], ['minus', 'Line', 'line'], ['square', 'Rectangle', 'rectangle'], ['circle', 'Ellipse', 'circle'], ['type', 'Text', 'text']];
      dialog.innerHTML = `<div class="science-board-shell"><header class="science-board-header"><div>${icon('arrow-left', 'Return to meeting', 'close')}<h2>Whiteboard</h2><span class="science-board-save" data-wb-save>Loading...</span></div><div>${icon('download', 'Export current page as PNG', 'export')}${icon('save', 'Save board', 'save')}<button type="button" data-wb-action="stop"><i data-lucide="presentation"></i><span class="wb-desktop-label">Stop presenting</span></button></div></header>
      <nav class="science-board-tools" aria-label="Whiteboard tools">${tools.map(([name, label, tool]) => `<button type="button" class="wb-icon" data-wb-tool="${tool}" title="${label}" aria-label="${label}" aria-pressed="false"><i data-lucide="${name}"></i></button>`).join('')}<span class="science-board-separator"></span><div class="science-board-swatches">${['#202329', '#198fa0', '#dc5963', '#9670c2', '#d99816', '#3a9366'].map(color => `<button class="wb-swatch" type="button" data-wb-ink="${color}" style="--ink:${color}" title="Ink ${color}" aria-label="Ink ${color}"></button>`).join('')}</div><input type="color" data-wb-color value="#202329" aria-label="Custom ink color"><input type="range" data-wb-size min="1" max="24" value="4" aria-label="Stroke width"><span class="science-board-size" data-wb-size-value>4</span><span class="science-board-separator"></span>${icon('sigma', 'Insert an equation', 'equation')}${icon('chart-no-axes-combined', '2D and 3D graph laboratory', 'graph')}${icon('file-up', 'Open a PDF reference', 'pdf')}</nav>
      <section class="science-board-viewport" aria-label="Drawing canvas"><canvas data-wb-canvas></canvas></section>
      <footer class="science-board-pages"><div>${icon('chevron-left', 'Previous page', 'previous')}<select data-wb-pages aria-label="Whiteboard page"></select>${icon('chevron-right', 'Next page', 'next')}${icon('plus', 'Add page', 'add-page')}<span class="wb-page-extras">${icon('copy', 'Duplicate page', 'duplicate-page')}${icon('trash-2', 'Delete page', 'delete-page')}</span></div><div>${icon('undo-2', 'Undo', 'undo')}${icon('redo-2', 'Redo', 'redo')}${icon('zoom-out', 'Zoom out', 'zoom-out')}<span class="science-board-zoom" data-wb-zoom>100%</span>${icon('zoom-in', 'Zoom in', 'zoom-in')}${icon('scan', 'Reset view', 'fit')}<select data-wb-paper aria-label="Paper style"><option value="blank">Blank</option><option value="dots">Dots</option><option value="grid">Grid</option><option value="ruled">Ruled</option></select>${icon('delete', 'Clear page', 'clear')}</div></footer></div>
      <aside class="science-board-window" data-wb-window="graph" hidden><header><strong>Graph laboratory</strong>${icon('x', 'Close graph panel', 'close-window')}</header><section><label>Mode<select data-wb-graph-mode><option value="function">2D functions</option><option value="implicit">2D implicit: f(x,y) = 0</option><option value="parametric">2D parametric</option><option value="surface">3D surface</option><option value="curve3d">3D parametric curve</option></select></label><label>Expression<textarea data-wb-expression spellcheck="false">a*sin(x)</textarea></label><div data-wb-parametric hidden><label>y(t)<input data-wb-expression-y value="sin(t)"></label><label data-wb-z-field hidden>z(t)<input data-wb-expression-z value="t/4"></label></div><div class="wb-row"><label>Minimum<input type="number" data-wb-domain-min value="-10"></label><label>Maximum<input type="number" data-wb-domain-max value="10"></label><label>a = <output data-wb-parameter-value>1</output><input type="range" data-wb-parameter min="-5" max="5" step="0.1" value="1"></label></div><div class="science-board-presets"><button type="button" data-wb-preset="wave">Wave</button><button type="button" data-wb-preset="parabola">Parabola</button><button type="button" data-wb-preset="circle">Circle</button><button type="button" data-wb-preset="surface">3D wave</button><button type="button" data-wb-preset="helix">Helix</button></div><p class="science-board-message" data-wb-graph-error></p><div class="science-board-plot" data-wb-plot></div><div class="wb-row"><button type="button" class="is-primary" data-wb-action="plot">Plot</button><button type="button" data-wb-action="insert-graph" data-wb-graph-insert disabled>Add graph to page</button></div></section></aside>
      <aside class="science-board-window" data-wb-window="equation" hidden><header><strong>Equation studio</strong>${icon('x', 'Close equation panel', 'close-window')}</header><section><math-field data-wb-latex>\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}</math-field><div class="science-board-presets"><button type="button" data-wb-equation="\\frac{a}{b}">Fraction</button><button type="button" data-wb-equation="\\int_0^1 x^2\\,dx">Integral</button><button type="button" data-wb-equation="\\sum_{n=1}^{\\infty}\\frac{1}{n^2}">Series</button><button type="button" data-wb-equation="\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}">Matrix</button><button type="button" data-wb-equation="E=mc^2">Physics</button></div><div class="science-board-equation-preview" data-wb-equation-preview></div><div class="wb-row"><button type="button" data-wb-action="equation-preview">Preview</button><button type="button" class="is-primary" data-wb-action="insert-equation" data-wb-equation-insert disabled>Add equation</button></div></section></aside>
      <aside class="science-board-window" data-wb-window="pdf" hidden><header><strong data-wb-pdf-title>PDF reference</strong>${icon('x', 'Close PDF reference', 'close-window')}</header><section><div class="wb-row">${icon('chevron-left', 'Previous PDF page', 'pdf-previous')}<span data-wb-pdf-page></span>${icon('chevron-right', 'Next PDF page', 'pdf-next')}${icon('zoom-out', 'Zoom PDF out', 'pdf-zoom-out')}${icon('zoom-in', 'Zoom PDF in', 'pdf-zoom-in')}<button type="button" data-wb-action="insert-pdf">Add page to board</button></div><canvas class="science-board-pdf" data-wb-pdf-canvas></canvas></section></aside><input type="file" data-wb-pdf-input accept="application/pdf,.pdf" hidden>`;
      document.body.append(dialog);
      const backup = document.createElement('div'); backup.innerHTML = icon('file-json', 'Export entire board as JSON', 'export-board') + icon('refresh-cw', 'Reload saved board', 'reload');
      while (backup.firstChild) q('.science-board-tools').append(backup.firstChild);
      canvas = new fabric.Canvas(q('[data-wb-canvas]'), { preserveObjectStacking: true, selection: false, renderOnAddRemove: false, enableRetinaScaling: true, stopContextMenu: true });
      q('.science-board-tools').append(q('[data-wb-paper]'));
      const format = document.createElement('select'); format.dataset.wbFormat = ''; format.setAttribute('aria-label', 'Page format');
      format.add(new Option('Auto page', 'auto')); format.add(new Option('Landscape', 'landscape')); format.add(new Option('Portrait', 'portrait')); q('.science-board-tools').append(format);
      format.addEventListener('change', () => { const bounds = q('.science-board-viewport').getBoundingClientRect(); page().width = format.value === 'portrait' ? 900 : 1280; page().height = format.value === 'landscape' ? 720 : format.value === 'portrait' ? 1280 : Math.max(360, Math.min(4000, Math.round(1280 * bounds.height / bounds.width))); viewport(); commit(); });
      window.SnapKeyWhiteboardStudios.attach({ dialog, showWindow, notify, loadMath: async () => { await script('https://cdn.jsdelivr.net/npm/mathjs@13.2.3/lib/browser/math.js'); return window.math; }, addText: (value, language, fontSize) => {
        const rtl = ['ar', 'ur'].includes(language);
        const object = new fabric.Textbox(value, { left: 40, top: 40, width: (page().width || 1280) * .8, fill: ink, fontSize, fontFamily: 'Arial, Nirmala UI, sans-serif', direction: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' });
        object.on('editing:exited', commit); canvas.add(object); setTool('select'); canvas.setActiveObject(object); canvas.renderAll(); commit();
      } });
      window.SnapKeyWhiteboardMathLab.attach({ dialog, notify, insertLive: async model => { await liveMath.insert(model); showWindow('live-math'); }, loadMath: async () => { await script('https://cdn.jsdelivr.net/npm/mathjs@13.2.3/lib/browser/math.js'); return window.math; }, loadPlot: () => script('https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js'), addText: (value, language, fontSize) => {
        const object = new fabric.Textbox(value, { left: 40, top: 40, width: (page().width || 1280) * .8, fill: ink, fontSize, fontFamily: 'Arial' }); object.on('editing:exited', commit); canvas.add(object); setTool('select'); canvas.setActiveObject(object); canvas.renderAll(); commit();
      } });
      liveMath = window.SnapKeyLiveMath.attach({ dialog, canvas, commit, notify, select: () => setTool('select'), loadMath: async () => { await script('https://cdn.jsdelivr.net/npm/mathjs@13.2.3/lib/browser/math.js'); return window.math; } });
      window.SnapKeyWhiteboard3D.attach(canvas, { notify, onSelect: () => setTool('select'), onMove: commit, onCamera: (object, camera) => { object.wbMath.camera = camera; commit(); } });
      window.SnapKeyLessons.attach({ dialog, notify, apply: async template => { await addPage(); page().title = template.title; updatePages(); await liveMath.insert({ ...window.SnapKeyLiveMath.defaults(template.kind), ...template.values }); showWindow('live-math'); } });
      window.SnapKeyAdvancedMath.attach({ dialog, notify, calculate: payload => api.computeMath(presentationId, payload, token, requestOptions), addText: (value, language, fontSize) => { const object = new fabric.Textbox(value, { left: 40, top: 40, width: (page().width || 1280) * .8, fill: ink, fontSize, fontFamily: 'Arial' }); object.on('editing:exited', commit); canvas.add(object); setTool('select'); canvas.setActiveObject(object); canvas.renderAll(); commit(); } });
      const studios = document.createElement('div'); studios.innerHTML = icon('calculator', 'Scientific calculator', 'calculator') + icon('languages', 'Multilingual text studio', 'language') + icon('sigma', 'Sequences, calculus and matrices', 'math-lab') + icon('blocks', 'Live manipulatives and lessons', 'live-math') + icon('book-open', 'Lesson templates', 'lessons') + icon('cpu', 'Advanced computation', 'advanced');
      while (studios.firstChild) q('.science-board-tools').append(studios.firstChild);
      const templates = { Derivative: '\\frac{d}{dx}f(x)', Limit: '\\lim_{x\\to 0}\\frac{\\sin x}{x}', Cases: '\\begin{cases}x^2 & x\\ge 0\\\\-x & x<0\\end{cases}', Vector: '\\vec{F}=m\\vec{a}', 'Double integral': '\\iint_D f(x,y)\\,dx\\,dy' };
      Object.entries(templates).forEach(([label, value]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.wbEquation = value; q('[data-wb-window="equation"] .science-board-presets').append(button); });
      bindCanvas(); dragWindows();
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('click', guard(async event => {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button.dataset.wbTool) { canvas.discardActiveObject(); setTool(button.dataset.wbTool); canvas.renderAll(); return; }
        if (button.dataset.wbInk) { ink = button.dataset.wbInk; q('[data-wb-color]').value = ink; setTool(tool); return; }
        if (button.dataset.wbEquation) { q('[data-wb-latex]').value = button.dataset.wbEquation; await equation(); return; }
        if (button.dataset.wbPreset) {
          const presets = { wave: ['function', 'a*sin(x)', '-10', '10'], parabola: ['function', 'a*x^2', '-5', '5'], circle: ['implicit', 'x^2+y^2-a^2', '-5', '5'], surface: ['surface', 'a*sin(sqrt(x^2+y^2))', '-8', '8'], helix: ['curve3d', 'cos(t)', '0', '12.56'] };
          const values = presets[button.dataset.wbPreset]; q('[data-wb-graph-mode]').value = values[0]; q('[data-wb-expression]').value = values[1]; q('[data-wb-domain-min]').value = values[2]; q('[data-wb-domain-max]').value = values[3]; graphMode(); await graph(); return;
        }
        const action = button.dataset.wbAction;
        if (uploading && ['reload', 'delete-page', 'undo', 'redo', 'clear', 'stop', 'close'].includes(action)) throw new Error('Wait for the reference upload to finish.');
        if (action === 'close') close();
        else if (action === 'stop') { close(); onStop(); }
        else if (action === 'save') { dirty = true; await flush(); }
        else if (action === 'reload') { if (dirty && !confirm('Discard unsaved local changes and reload the saved board?')) return; clearTimeout(saveTimer); if (busy) await savePromise.catch(() => {}); const result = await api.getWhiteboard(presentationId, token, requestOptions); if (result.document) { board = result.document; dirty = false; histories.clear(); await loadPage(); viewport(); onDocument(clone(board)); status('Saved to meeting'); } }
        else if (action === 'export-board') { capture(); const url = URL.createObjectURL(new Blob([JSON.stringify(board)], { type: 'application/json' })); download(url, 'Science-whiteboard.json'); setTimeout(() => URL.revokeObjectURL(url), 10000); }
        else if (action === 'add-page' || action === 'duplicate-page') await addPage(action === 'duplicate-page');
        else if (action === 'previous' || action === 'next') await changePage(board.pages[board.pages.indexOf(page()) + (action === 'next' ? 1 : -1)].id);
        else if (action === 'delete-page') { if (board.pages.length > 1 && confirm('Delete this whiteboard page?')) { const id = page().id; board.pages = board.pages.filter(item => item.id !== id); histories.delete(id); await changePage(board.pages[0].id); } }
        else if (action === 'undo' || action === 'redo') await history(action === 'undo' ? -1 : 1);
        else if (action === 'zoom-in' || action === 'zoom-out') { zoom = Math.min(4, Math.max(.25, zoom + (action === 'zoom-in' ? .25 : -.25))); viewport(); }
        else if (action === 'fit') { zoom = 1; pan = { x: 0, y: 0 }; viewport(); }
        else if (action === 'clear') { if (confirm('Clear all objects on this page?')) { canvas.getObjects().forEach(object => canvas.remove(object)); canvas.renderAll(); commit(); } }
        else if (action === 'export') { capture(); const element = document.createElement('canvas'); const output = new fabric.StaticCanvas(element, { width: page().width || 1280, height: page().height || 720, enableRetinaScaling: false }); try { await new Promise(resolve => output.loadFromJSON(page().scene, resolve)); window.SnapKeyWhiteboard3D?.composite(canvas.lowerCanvasEl, element.getContext('2d'), output.width, output.height, true); download(element.toDataURL('image/png'), `${page().title}.png`); } finally { output.dispose(); } }
        else if (['calculator', 'language', 'math-lab', 'live-math', 'lessons', 'advanced'].includes(action)) showWindow(action);
        else if (action === 'graph') { showWindow('graph'); await graph(); }
        else if (action === 'plot') await graph();
        else if (action === 'insert-graph') { const mode = q('[data-wb-graph-mode]').value; if (!['function', 'surface'].includes(mode)) throw new Error('Shared insertion supports explicit 2D functions and 3D surfaces. Other modes remain interactive in the graph laboratory.'); const expression = q('[data-wb-expression]').value; if (expression.includes('\n')) throw new Error('Insert one live function at a time.'); await liveMath.insert({ ...window.SnapKeyLiveMath.defaults(mode === 'surface' ? 'surface3d' : 'graph'), expression, parameter: Number(q('[data-wb-parameter]').value), minimum: Number(q('[data-wb-domain-min]').value), maximum: Number(q('[data-wb-domain-max]').value) }); showWindow('live-math'); }
        else if (action === 'equation') { showWindow('equation'); await script('https://cdn.jsdelivr.net/npm/mathlive@0.101.1/dist/mathlive.min.js'); if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.container = dialog; const selected = canvas.getActiveObject(); if (selected?.wbLatex !== undefined) q('[data-wb-latex]').value = selected.wbLatex; await equation(); }
        else if (action === 'equation-preview') await equation();
        else if (action === 'insert-equation') await insertEquation();
        else if (action === 'pdf') q('[data-wb-pdf-input]').click();
        else if (action === 'pdf-previous' || action === 'pdf-next') { if (!pdf) return; pdfPage = Math.max(1, Math.min(pdf.numPages, pdfPage + (action === 'pdf-next' ? 1 : -1))); await renderPdf(); }
        else if (action === 'pdf-zoom-in' || action === 'pdf-zoom-out') { pdfZoom = Math.max(.5, Math.min(2, pdfZoom + (action === 'pdf-zoom-in' ? .25 : -.25))); await renderPdf(); }
        else if (action === 'insert-pdf') { if (pdf) await addImage(await rasterBlob(q('[data-wb-pdf-canvas]')), `PDF-page-${pdfPage}.png`); }
        else if (action === 'close-window') button.closest('.science-board-window').hidden = true;
      }));
      q('[data-wb-pages]').addEventListener('change', guard(event => changePage(event.target.value)));
      q('[data-wb-paper]').addEventListener('change', event => paper(event.target.value));
      q('[data-wb-color]').addEventListener('input', event => { ink = event.target.value; setTool(tool); });
      q('[data-wb-size]').addEventListener('input', event => { size = Number(event.target.value); setTool(tool); });
      q('[data-wb-graph-mode]').addEventListener('change', graphMode);
      let graphTimer;
      q('[data-wb-parameter]').addEventListener('input', event => { q('[data-wb-parameter-value]').textContent = event.target.value; clearTimeout(graphTimer); graphTimer = setTimeout(graph, 120); });
      q('[data-wb-pdf-input]').addEventListener('change', guard(async event => { await openPdf(event.target.files[0]); event.target.value = ''; }));
      dialog.addEventListener('keydown', event => {
        if (event.target.closest('input, textarea, select, math-field') || canvas.getActiveObject()?.isEditing) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); guard(() => history(event.shiftKey ? 1 : -1))(); }
        else if (['Delete', 'Backspace'].includes(event.key)) { const selected = canvas.getActiveObjects(); if (selected.length) { event.preventDefault(); selected.forEach(object => canvas.remove(object)); canvas.discardActiveObject(); canvas.renderAll(); commit(); } }
      });
      new ResizeObserver(viewport).observe(q('.science-board-viewport'));
      script('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js').then(() => lucide.createIcons({ root: dialog })).catch(error => notify(error.message));
    }
    function graphMode() { const mode = q('[data-wb-graph-mode]').value; q('[data-wb-parametric]').hidden = !['parametric', 'curve3d'].includes(mode); q('[data-wb-z-field]').hidden = mode !== 'curve3d'; }
    async function open() {
      if (!dialog) build();
      if (dialog.open) return;
      status('Loading...'); dialog.showModal(); viewport();
      try {
        await flush();
        if (dirty) { status('Not saved'); notify('Your local edits are retained. Save before loading another presenter\'s changes.'); }
        else { const result = await api.getWhiteboard(presentationId, token, requestOptions); if (result.document) board = result.document; else { const bounds = q('.science-board-viewport').getBoundingClientRect(); page().width = 1280; page().height = Math.max(360, Math.min(4000, Math.round(1280 * bounds.height / bounds.width))); } }
        await loadPage(); viewport(); onDocument(clone(board)); onActivate(); status(dirty ? 'Unsaved changes' : 'Saved to meeting');
      } catch (error) { status('Not connected'); notify(error.message); await loadPage(); }
    }
    function close() { capture(); flush(); dispose3d(); dialog.querySelectorAll('.science-board-window').forEach(window => { window.hidden = true; }); window.mathVirtualKeyboard?.hide?.(); dialog.close(); }
    socket?.on('whiteboard_document', event => {
      if (event.presentationId !== presentationId || !event.document || event.document.revision <= board.revision) return;
      onDocument(event.document);
      if (!dirty && !busy) {
        if (event.partial) guard(async () => { const result = await api.getWhiteboard(presentationId, token, requestOptions); if (!dirty && !busy && result.document) { board = result.document; if (dialog?.open) await loadPage(); } })();
        else { board = clone(event.document); if (dialog?.open) guard(loadPage)(); }
      }
    });
    const subscribe = () => socket?.emit('whiteboard_join', { presentationId, shareToken: token, authToken: requestOptions.publicAccess ? '' : localStorage.getItem('presentStudio.accessToken') || '' });
    socket?.on('connect', subscribe); if (socket?.connected) subscribe();
    return { open: guard(open), close, flush, getDocument: () => clone(board), isOpen: () => Boolean(dialog?.open) };
  }
  window.SnapKeyWhiteboard = { create };
})();
