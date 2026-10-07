(function () {
  const allowed = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'floor', 'ceil', 'round', 'min', 'max', 'sign', 'pow', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp', 'log', 'log10', 'factorial', 'det', 'inv', 'transpose', 'norm', 'complex', 'conj', 're', 'im', 'sinh', 'cosh', 'tanh']);
  function expression(math, source, symbolic = false) {
    if (!source.trim() || source.length > 500) throw new Error('Enter an expression of up to 500 characters.');
    const node = math.parse(source); let count = 0;
    node.traverse(item => {
      if (++count > 150 || !['ConstantNode', 'SymbolNode', 'OperatorNode', 'FunctionNode', 'ParenthesisNode', 'ArrayNode'].includes(item.type)) throw new Error('Assignments and programming commands are not allowed.');
      if (item.type === 'ConstantNode' && typeof item.value !== 'number') throw new Error('Use numeric constants.');
      if (item.type === 'SymbolNode' && !allowed.has(item.name) && !['pi', 'e', 'i', 'ans', ...(symbolic ? ['x'] : [])].includes(item.name)) throw new Error(`Unknown symbol: ${item.name}`);
      if (item.type === 'FunctionNode' && !allowed.has(item.fn.name)) throw new Error('Unsupported function.');
      if (item.type === 'FunctionNode' && item.fn.name === 'factorial' && (!item.args[0]?.isConstantNode || item.args[0].value > 170 || item.args[0].value < 0)) throw new Error('Factorial supports constants from 0 to 170.');
      if (item.type === 'OperatorNode' && !['+', '-', '*', '/', '^', '%', '!'].includes(item.op)) throw new Error('Unsupported operator.');
      if (item.type === 'ArrayNode' && item.items.length > 4) throw new Error('Matrices are limited to 4 by 4.');
      if (item.type === 'OperatorNode' && item.op === '!' && (!item.args[0].isConstantNode || item.args[0].value > 170 || item.args[0].value < 0)) throw new Error('Factorial supports integer constants from 0 to 170.');
    });
    return node;
  }
  function attach({ dialog, loadMath, addText, showWindow, notify }) {
    const panel = document.createElement('aside'); panel.className = 'science-board-window'; panel.dataset.wbWindow = 'calculator'; panel.hidden = true;
    panel.innerHTML = `<header><strong>Scientific calculator</strong><button type="button" data-wb-action="close-window" aria-label="Close calculator">×</button></header><section><label>Angle unit<select data-calc-angle><option value="RAD">RAD</option><option value="DEG">DEG</option></select></label><label>Expression<input data-calc-input spellcheck="false" value="sqrt(2)"></label><output class="wb-calculator-result" data-calc-result aria-live="polite">0</output><div class="wb-calculator-keys"></div><div class="wb-row"><button type="button" data-calc-command="evaluate">=</button><button type="button" data-calc-command="simplify">Simplify</button><button type="button" data-calc-command="derivative">d/dx</button><button type="button" data-calc-command="insert">Add to page</button></div><ol class="wb-calculator-history" data-calc-history></ol></section>`;
    dialog.append(panel); const q = selector => panel.querySelector(selector); let answer = 0, result = '0';
    ['sin(', 'cos(', 'tan(', 'asin(', 'acos(', 'atan(', 'sqrt(', 'log(', 'log10(', '^', 'pi', 'e', '(', ')', '[', ']', '7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', ',', '+', 'ans', '!', 'det(', 'inv('].forEach(value => { const button = document.createElement('button'); button.type = 'button'; button.textContent = value; button.dataset.calcKey = value; q('.wb-calculator-keys').append(button); });
    const edit = value => { const input = q('[data-calc-input]'); input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end'); input.focus(); };
    async function calculate(command) {
      const math = await loadMath(); const source = q('[data-calc-input]').value; const node = expression(math, source, command !== 'evaluate');
      const scope = { ans: answer };
      if (q('[data-calc-angle]').value === 'DEG') {
        ['sin', 'cos', 'tan'].forEach(name => { scope[name] = value => math[name](value * Math.PI / 180); });
        ['asin', 'acos', 'atan'].forEach(name => { scope[name] = value => math[name](value) * 180 / Math.PI; });
      }
      const value = command === 'derivative' ? math.derivative(node, 'x').toString() : command === 'simplify' ? math.simplify(node).toString() : node.compile().evaluate(scope);
      result = typeof value === 'string' ? value : math.format(value, { precision: 12 });
      if (result.length > 2000 || /Infinity|NaN/.test(result)) throw new Error('The result is undefined or too large.');
      if (command === 'evaluate') answer = value;
      q('[data-calc-result]').textContent = result;
      const entry = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.textContent = `${source} → ${result}`; button.addEventListener('click', () => { q('[data-calc-input]').value = source; }); entry.append(button); q('[data-calc-history]').prepend(entry);
      while (q('[data-calc-history]').children.length > 10) q('[data-calc-history]').lastChild.remove();
    }
    panel.addEventListener('click', async event => {
      const button = event.target.closest('button'); if (!button) return;
      try { if (button.dataset.calcKey) edit(button.dataset.calcKey); else if (button.dataset.calcCommand === 'insert') addText(`${q('[data-calc-input]').value} = ${result}`, 'en', 32); else if (button.dataset.calcCommand) await calculate(button.dataset.calcCommand); } catch (error) { notify(error.message); }
    });
    q('[data-calc-input]').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); calculate('evaluate').catch(error => notify(error.message)); } });
    const text = document.createElement('aside'); text.className = 'science-board-window'; text.dataset.wbWindow = 'language'; text.hidden = true;
    text.innerHTML = `<header><strong>Text studio</strong><button type="button" data-wb-action="close-window" aria-label="Close text studio">×</button></header><section><label>Language<select data-text-language></select></label><label>Text<textarea data-text-input dir="auto" rows="6"></textarea></label><label>Font size<input type="number" data-text-size min="12" max="120" value="36"></label><button type="button" class="is-primary" data-text-insert>Add text to page</button></section>`;
    dialog.append(text);
    [['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].forEach(([code, label]) => text.querySelector('select').add(new Option(label, code)));
    text.querySelector('select').addEventListener('change', event => { const input = text.querySelector('textarea'); input.lang = event.target.value; input.dir = ['ar', 'ur'].includes(event.target.value) ? 'rtl' : 'auto'; });
    text.querySelector('[data-text-insert]').addEventListener('click', () => { const value = text.querySelector('textarea').value; const size = Number(text.querySelector('[data-text-size]').value); if (!value.trim() || value.length > 5000 || !Number.isFinite(size) || size < 12 || size > 120) { notify('Enter text up to 5,000 characters and a font size from 12 to 120.'); return; } addText(value, text.querySelector('select').value, size); });
    return { open: name => showWindow(name) };
  }
  window.SnapKeyWhiteboardStudios = { attach, expression };
})();
