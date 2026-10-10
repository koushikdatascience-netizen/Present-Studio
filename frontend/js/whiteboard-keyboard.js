(function () {
  const FIELDS = '[data-wb-expression],[data-wb-expression-y],[data-wb-expression-z],[data-wb-domain-min],[data-wb-domain-max],[data-calc-input],[data-lab-source],[data-live-expression],[data-advanced-expression],[data-advanced-point],[data-advanced-lower],[data-advanced-upper]';
  const keys = values => values.map(([label, insert]) => [label, insert, label]);
  const pages = {
    basic: keys([['(', '(|)'], [')', ')'], ['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['x²', '|^2'], ['xⁿ', '|^'], ['√', 'sqrt(|)'], ['|x|', 'abs(|)'], ['π', 'pi'], ['e', 'e'], ['x', 'x'], ['y', 'y'], ['t', 't'], ['a', 'a'], ['k', 'k'], ['θ', 'theta']]),
    functions: keys([['sin', 'sin(|)'], ['cos', 'cos(|)'], ['tan', 'tan(|)'], ['sec', 'sec(|)'], ['asin', 'asin(|)'], ['acos', 'acos(|)'], ['atan', 'atan(|)'], ['csc', 'csc(|)'], ['sinh', 'sinh(|)'], ['cosh', 'cosh(|)'], ['tanh', 'tanh(|)'], ['cot', 'cot(|)'], ['ln', 'log(|)'], ['log₁₀', 'log10(|)'], ['eˣ', 'exp(|)'], ['⌊x⌋', 'floor(|)'], ['sign', 'sign(|)'], ['min', 'min(|,0)'], ['max', 'max(|,0)'], ['x', 'x'], ['y', 'y'], ['t', 't'], ['a', 'a'], ['k', 'k']]),
    polar: keys([['θ', 'theta'], ['r=', 'r='], ['π', 'pi'], ['2π', '2*pi'], ['π/2', 'pi/2'], ['π/3', 'pi/3'], ['a', 'a'], ['k', 'k'], ['kθ', 'k*theta'], ['2θ', '2*theta'], ['3θ', '3*theta'], ['cos θ', 'cos(theta)'], ['sin θ', 'sin(theta)'], ['1+cos θ', '1+cos(theta)'], ['a(1+cos θ)', 'a*(1+cos(theta))'], ['cos kθ', 'cos(k*theta)'], ['√cos 2θ', 'sqrt(cos(2*theta))'], ['aθ', 'a*theta'], ['tan θ', 'tan(theta)'], ['1/θ', '1/theta'], ['θ²', 'theta^2'], ['(', '(|)'], [')', ')'], ['−', '-']])
  };
  function attach(dialog, options = {}) {
    if (dialog._wbMathKeyboard) return dialog._wbMathKeyboard;
    const keyboard = document.createElement('section'); keyboard.className = 'wb-math-keyboard'; keyboard.hidden = true; keyboard.setAttribute('aria-label', 'Math keyboard');
    keyboard.innerHTML = '<div class="wb-kb-bar"><div class="wb-kb-tabs" role="tablist"></div><div class="wb-kb-actions"></div></div><div class="wb-kb-digits"></div><div class="wb-kb-keys"></div>';
    dialog.append(keyboard); let field, page = 'basic', timer, abc = false;
    const button = (label, title, onClick) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.title = title; node.setAttribute('aria-label', title); node.addEventListener('click', onClick); return node; };
    const emit = () => field.dispatchEvent(new Event('input', { bubbles: true }));
    function insert(template) {
      if (!field) return;
      const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start, selected = field.value.slice(start, end), mark = template.indexOf('|');
      const replacement = template.replace('|', selected && template.endsWith(')') ? selected : '');
      field.setRangeText(replacement, start, end, 'end');
      if (mark >= 0) { const caret = start + mark + (selected && template.endsWith(')') ? selected.length : 0); field.setSelectionRange(caret, caret); }
      field.focus({ preventScroll: true }); emit();
    }
    function height() { if (!keyboard.hidden) dialog.style.setProperty('--wb-kb-height', `${keyboard.getBoundingClientRect().height}px`); }
    function selectPage(next) {
      page = next; keyboard.querySelector('.wb-kb-keys').replaceChildren(...pages[page].map(([label, text, title]) => button(label, title, () => insert(text))));
      keyboard.querySelectorAll('[role="tab"]').forEach(node => { const active = node.dataset.page === page; node.setAttribute('aria-selected', String(active)); node.classList.toggle('is-active', active); }); height();
    }
    function hide() { clearTimeout(timer); keyboard.hidden = true; dialog.classList.remove('has-math-keyboard'); dialog.style.removeProperty('--wb-kb-height'); }
    for (const [id, label] of [['basic', 'Basic'], ['functions', 'f(x)'], ['polar', 'Polar θ']]) { const node = button(label, label, () => selectPage(id)); node.dataset.page = id; node.setAttribute('role', 'tab'); keyboard.querySelector('.wb-kb-tabs').append(node); }
    const actions = [
      ['←', 'Move caret left', () => { const p = Math.max(0, (field.selectionStart || 0) - 1); field.setSelectionRange(p, p); }],
      ['→', 'Move caret right', () => { const p = Math.min(field.value.length, (field.selectionEnd || 0) + 1); field.setSelectionRange(p, p); }],
      ['⌫', 'Backspace', () => { const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start; field.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end'); emit(); }],
      ['AC', 'Clear input', () => { field.value = ''; emit(); }],
      ['↵', 'Enter', () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))],
      ['ABC', 'Toggle device keyboard', event => { abc = !abc; field.inputMode = abc ? 'text' : 'none'; event.currentTarget.setAttribute('aria-pressed', String(abc)); field.blur(); field.focus({ preventScroll: true }); }],
      ['▾', 'Hide math keyboard', hide]
    ];
    actions.forEach(([label, title, action]) => keyboard.querySelector('.wb-kb-actions').append(button(label, title, event => { if (field) action(event); })));
    '1234567890.,'.split('').forEach(digit => keyboard.querySelector('.wb-kb-digits').append(button(digit, digit, () => insert(digit))));
    for (const event of ['pointerdown', 'mousedown']) keyboard.addEventListener(event, e => { if (e.target.closest('button')) e.preventDefault(); });
    dialog.addEventListener('focusin', event => {
      clearTimeout(timer);
      if (!event.target.matches(FIELDS)) { if (!keyboard.contains(event.target)) hide(); return; }
      field = event.target; if (matchMedia('(pointer: coarse)').matches) field.inputMode = abc ? 'text' : 'none';
      keyboard.hidden = false; dialog.classList.add('has-math-keyboard'); selectPage(options.preferPolar?.(field) ? 'polar' : page); height();
    });
    dialog.addEventListener('focusout', () => { clearTimeout(timer); timer = setTimeout(() => { if (!dialog.contains(document.activeElement) || (!document.activeElement.matches(FIELDS) && !keyboard.contains(document.activeElement))) hide(); }, 120); });
    dialog.addEventListener('close', hide); new ResizeObserver(height).observe(keyboard); selectPage(page);
    return dialog._wbMathKeyboard = { hide, keyboard };
  }
  window.SnapKeyMathKeyboard = { attach, pages, FIELDS };
})();
