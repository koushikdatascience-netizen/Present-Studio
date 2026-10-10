(function () {
  const bindings = new WeakMap();
  const elements = new WeakMap();
  let styles;
  let libraries;
  const load = () => libraries ||= Promise.all([import('https://esm.sh/three@0.170.0'), import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js')]);
  let mathLibrary;
  const loadMath = () => window.math ? Promise.resolve(window.math) : mathLibrary ||= new Promise((resolve, reject) => { const node = document.createElement('script'); node.src = 'https://cdn.jsdelivr.net/npm/mathjs@13.2.3/lib/browser/math.js'; node.onload = () => resolve(window.math); node.onerror = () => { mathLibrary = null; reject(new Error('Math library could not load.')); }; document.head.append(node); });
  function compile(math, expression) {
    if (!expression?.trim() || expression.length > 500) throw new Error('Use an expression of up to 500 characters.');
    const node = math.parse(expression); let count = 0;
    const functions = new Set(['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'sinh', 'cosh', 'tanh']);
    node.traverse(item => {
      if (++count > 150 || !['ConstantNode', 'SymbolNode', 'OperatorNode', 'FunctionNode', 'ParenthesisNode'].includes(item.type)) throw new Error('Use a scalar surface function.');
      if (item.type === 'SymbolNode' && !['x', 'y', 'a', 'pi', 'e'].includes(item.name) && !functions.has(item.name)) throw new Error('Unsupported surface symbol.');
      if (item.type === 'FunctionNode' && !functions.has(item.fn.name)) throw new Error('Unsupported surface function.');
      if (item.type === 'ConstantNode' && typeof item.value !== 'number') throw new Error('Use numeric constants.');
    }); return node.compile();
  }
  function attach(canvas, options = {}) {
    if (bindings.has(canvas)) return;
    if (!styles) { styles = document.createElement('style'); styles.textContent = '.wb-live-surface:fullscreen{width:100vw!important;height:100dvh!important;transform:none!important;position:fixed!important;inset:0!important}.wb-live-surface:fullscreen>div:last-child{height:calc(100% - 40px)!important}.wb-live-surface canvas{display:block}'; document.head.append(styles); }
    const widgets = new Map(); const parent = canvas.wrapperEl || canvas.lowerCanvasEl.parentElement;
    const dispose = widget => { cancelAnimationFrame(widget.frame); widget.resize?.disconnect(); widget.controls?.dispose(); widget.mesh?.geometry.dispose(); widget.mesh?.material.dispose(); widget.scene?.traverse(object => { if (object !== widget.mesh) { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach(item => item.dispose()); else object.material?.dispose(); } }); widget.renderer?.dispose(); widget.element.remove(); };
    async function initialize(widget) {
      try {
        const [THREE, { OrbitControls }] = await load(); const math = await (options.loadMath || loadMath)();
        if (!widget.element.isConnected) return;
        widget.THREE = THREE; widget.math = math; widget.scene = new THREE.Scene(); widget.scene.background = new THREE.Color('#f5f7fa');
        widget.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); widget.renderer.setSize(600, 320); widget.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); widget.body.replaceChildren(widget.renderer.domElement);
        widget.camera = new THREE.PerspectiveCamera(45, 600 / 320, .01, 10000); widget.camera.position.set(12, 12, 12);
        widget.controls = new OrbitControls(widget.camera, widget.renderer.domElement); widget.controls.enableDamping = true;
        widget.resize = new ResizeObserver(() => { const width = widget.body.clientWidth, height = widget.body.clientHeight; if (width && height) { widget.renderer.setSize(width, height); widget.camera.aspect = width / height; widget.camera.fov = 2 * Math.atan(Math.tan(Math.PI / 8) / Math.min(1, width / height)) * 180 / Math.PI; widget.camera.updateProjectionMatrix(); } }); widget.resize.observe(widget.body);
        widget.scene.add(new THREE.HemisphereLight('#fff', '#81919f', 2)); const light = new THREE.DirectionalLight('#fff', 2); light.position.set(10, 20, 10); widget.scene.add(light);
        widget.scene.add(new THREE.AxesHelper(8)); widget.scene.add(new THREE.GridHelper(12, 12, '#9aa7b4', '#d9e1e7'));
        widget.controls.addEventListener('end', () => { if (options.onCamera && widget.object) options.onCamera(widget.object, { position: widget.camera.position.toArray(), target: widget.controls.target.toArray() }); });
        const animate = () => { if (!widget.element.isConnected) return; widget.frame = requestAnimationFrame(animate); if (widget.element.getBoundingClientRect().width > 0 && document.visibilityState !== 'hidden') { widget.controls.update(); widget.renderer.render(widget.scene, widget.camera); } }; animate(); update(widget);
      } catch (error) { widget.body.textContent = '3D surface unavailable. Check the expression or connection.'; options.notify?.(error.message); }
    }
    function update(widget) {
      const model = widget.object.wbMath; const signature = JSON.stringify([model.expression, model.parameter, model.minimum, model.maximum]);
      if (!widget.renderer) return;
      if (widget.signature !== signature) {
        try {
          const expression = compile(widget.math, model.expression); const positions = [], indices = [], valid = [];
          const side = 41, scale = 10 / (model.maximum - model.minimum);
          for (let row = 0; row < side; row++) for (let column = 0; column < side; column++) {
            const x = model.minimum + column * (model.maximum - model.minimum) / (side - 1), y = model.minimum + row * (model.maximum - model.minimum) / (side - 1);
            let z; try { z = expression.evaluate({ x, y, a: model.parameter }); } catch { z = null; }
            const finite = typeof z === 'number' && Number.isFinite(z) && Math.abs(z) < 1e4; valid.push(finite);
            positions.push((x - (model.maximum + model.minimum) / 2) * scale, finite ? z * scale : 0, (y - (model.maximum + model.minimum) / 2) * scale);
            const index = row * side + column; if (row && column && valid[index] && valid[index - 1] && valid[index - side] && valid[index - side - 1]) indices.push(index, index - 1, index - side, index - 1, index - side - 1, index - side);
          }
          if (!indices.length) throw new Error('No finite surface is available in this domain.');
          if (widget.mesh) { widget.scene.remove(widget.mesh); widget.mesh.geometry.dispose(); widget.mesh.material.dispose(); }
          const geometry = new widget.THREE.BufferGeometry(); geometry.setAttribute('position', new widget.THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
          widget.mesh = new widget.THREE.Mesh(geometry, new widget.THREE.MeshStandardMaterial({ color: '#198fa0', side: widget.THREE.DoubleSide, roughness: .65 })); widget.scene.add(widget.mesh); widget.signature = signature;
          if (!model.camera && !widget.framed) { geometry.computeBoundingBox(); const center = geometry.boundingBox.getCenter(new widget.THREE.Vector3()), span = Math.max(1, geometry.boundingBox.getSize(new widget.THREE.Vector3()).length()); widget.controls.target.copy(center); widget.camera.position.copy(center).add(new widget.THREE.Vector3(span, span, span)); widget.camera.far = Math.max(10000, span * 100); widget.camera.updateProjectionMatrix(); widget.framed = true; }
        } catch (error) { options.notify?.(error.message); }
      }
      if (model.camera && JSON.stringify(model.camera) !== widget.cameraSignature) { widget.camera.position.fromArray(model.camera.position); widget.controls.target.fromArray(model.camera.target); widget.cameraSignature = JSON.stringify(model.camera); }
    }
    function sync() {
      const found = new Set();
      canvas.getObjects().filter(object => object.wbMath?.kind === 'surface3d').slice(0, 4).forEach(object => {
        const id = object.wbMath.id; found.add(id); let widget = widgets.get(id);
        if (!widget) {
          const element = document.createElement('div'); element.className = 'wb-live-surface'; element.style.cssText = 'position:absolute;left:0;top:0;width:600px;height:360px;transform-origin:0 0;z-index:2;overflow:hidden;background:#f5f7fa;';
          const header = document.createElement('div'); header.style.cssText = 'height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font:16px Arial;'; header.textContent = '3D · x red / y blue / z green';
          const expand = document.createElement('button'); expand.type = 'button'; expand.textContent = '↗'; expand.title = 'Expand 3D surface'; expand.setAttribute('aria-label', 'Expand 3D surface'); expand.addEventListener('pointerdown', event => event.stopPropagation()); expand.addEventListener('click', async event => { event.stopPropagation(); try { if (document.fullscreenElement === element) await document.exitFullscreen(); else await element.requestFullscreen(); } catch { options.notify?.('Fullscreen is unavailable in this browser.'); } }); header.append(expand);
          const body = document.createElement('div'); body.style.height = '320px'; body.textContent = 'Loading 3D surface...'; element.append(header, body); parent.append(element); widget = { element, body, object }; widgets.set(id, widget);
          if (options.onCamera) header.addEventListener('pointerdown', event => {
            const start = { x: event.clientX, y: event.clientY, left: widget.object.left, top: widget.object.top }; header.setPointerCapture(event.pointerId);
            const move = current => { const rect = canvas.lowerCanvasEl.getBoundingClientRect(); const inverse = fabric.util.invertTransform(canvas.viewportTransform); const dx = (current.clientX - start.x) * canvas.width / rect.width, dy = (current.clientY - start.y) * canvas.height / rect.height; widget.object.set({ left: start.left + inverse[0] * dx + inverse[2] * dy, top: start.top + inverse[1] * dx + inverse[3] * dy }); widget.object.setCoords(); canvas.requestRenderAll(); };
            const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); header.removeEventListener('pointercancel', up); options.onMove?.(widget.object); }; header.addEventListener('pointermove', move); header.addEventListener('pointerup', up); header.addEventListener('pointercancel', up);
          });
          element.addEventListener('pointerdown', () => { if (options.onCamera) { canvas.setActiveObject(widget.object); options.onSelect?.(); } }); initialize(widget);
        }
        widget.object = object; const matrix = fabric.util.multiplyTransformMatrices(canvas.viewportTransform, object.calcTransformMatrix()); const corner = fabric.util.transformPoint(new fabric.Point(-object.width / 2, -object.height / 2), matrix); const sx = canvas.lowerCanvasEl.clientWidth / canvas.width, sy = canvas.lowerCanvasEl.clientHeight / canvas.height; widget.element.style.transform = `matrix(${matrix[0] * sx},${matrix[1] * sy},${matrix[2] * sx},${matrix[3] * sy},${canvas.lowerCanvasEl.offsetLeft + corner.x * sx},${canvas.lowerCanvasEl.offsetTop + corner.y * sy})`; widget.element.style.pointerEvents = canvas.isDrawingMode ? 'none' : 'auto'; update(widget);
      });
      for (const [id, widget] of widgets) if (!found.has(id)) { dispose(widget); widgets.delete(id); }
    }
    canvas.on('after:render', sync); new ResizeObserver(sync).observe(canvas.lowerCanvasEl); const binding = { widgets, sync, canvas }; bindings.set(canvas, binding); elements.set(canvas.lowerCanvasEl, binding);
  }
  function composite(element, context, width, height, boardCoordinates = false) {
    const binding = elements.get(element); if (!binding) return;
    context.save(); if (!boardCoordinates) context.scale(width / binding.canvas.width, height / binding.canvas.height);
    for (const widget of binding.widgets.values()) {
      if (!widget.renderer) continue;
      widget.controls.update(); widget.renderer.render(widget.scene, widget.camera);
      context.save(); const object = widget.object; const matrix = boardCoordinates ? object.calcTransformMatrix() : fabric.util.multiplyTransformMatrices(binding.canvas.viewportTransform, object.calcTransformMatrix()); context.transform(...matrix); context.translate(-object.width / 2, -object.height / 2); context.fillStyle = '#f5f7fa'; context.fillRect(0, 0, 600, 360); context.fillStyle = '#202329'; context.font = '16px Arial'; context.fillText('Live 3D surface', 12, 26); context.drawImage(widget.renderer.domElement, 0, 40, 600, 320); context.restore();
    }
    context.restore();
  }
  window.SnapKeyWhiteboard3D = { attach, compile, composite };
})();
