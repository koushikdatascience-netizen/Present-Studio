/* Symbolic calculations run off the meeting UI thread and are time-limited by the caller. */
importScripts('https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/all.min.js');
self.onmessage = event => {
  const { mode, source, lower, upper, point } = event.data;
  try {
    const command = mode === 'antiderivative' ? `integrate(${source},x)` : mode === 'integral' ? `defint(${source},${lower},${upper},x)` : `limit(${source},x,${point})`;
    const value = nerdamer(command); const exact = value.text();
    if (exact.length > 4000) throw new Error('The symbolic result is too large.');
    const unresolved = /integrate\(|defint\(|limit\(/.test(exact);
    self.postMessage({ exact, approximate: unresolved ? '' : value.evaluate().text('decimals'), unresolved });
  } catch (error) { self.postMessage({ error: error.message || 'This expression is not supported by the symbolic engine.' }); }
};
