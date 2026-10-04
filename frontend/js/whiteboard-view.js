(function () {
  const versions = new WeakMap();
  const queues = new WeakMap();
  function render(canvas, document) {
    if (!canvas || !document?.pages?.length) return;
    window.SnapKeyWhiteboard3D?.attach(canvas);
    const page = document.pages.find(item => item.id === document.activePageId) || document.pages[0];
    const version = (versions.get(canvas) || 0) + 1;
    versions.set(canvas, version);
    const scene = JSON.parse(JSON.stringify(page.scene));
    const previous = queues.get(canvas) || Promise.resolve();
    const work = previous.catch(() => {}).then(() => new Promise(resolve => {
      if (versions.get(canvas) !== version) { resolve(); return; }
      canvas.loadFromJSON(scene, () => {
      if (versions.get(canvas) !== version) { resolve(); return; }
      canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; });
      const width = page.width || 1280; const height = page.height || 720;
      const scale = Math.min(canvas.width / width, canvas.height / height);
      canvas.setViewportTransform([scale, 0, 0, scale, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2]);
      canvas.renderAll();
      resolve();
      });
    }));
    queues.set(canvas, work);
  }
  window.SnapKeyWhiteboardView = { render };
})();
