(function () {
  const templates = [
    { id: 'fractions', title: 'Equivalent fractions', level: 'Classes 3–6', kind: 'fraction', values: { numerator: 4, denominator: 8 } },
    { id: 'integers', title: 'Positive and negative numbers', level: 'Classes 2–7', kind: 'numberline', values: { minimum: -10, maximum: 10, position: .25 } },
    { id: 'angles', title: 'Triangle angle relationships', level: 'Classes 6–10', kind: 'geometry', values: { angle: 60 } },
    { id: 'sine', title: 'Amplitude of a sine wave', level: 'Classes 10–12', kind: 'graph', values: { expression: 'a*sin(x)', parameter: 2, minimum: -6.28, maximum: 6.28 } },
    { id: 'parabola', title: 'Quadratic transformations', level: 'Classes 8–12', kind: 'graph', values: { expression: 'a*x^2', parameter: 1, minimum: -3, maximum: 3 } },
    { id: 'slope', title: 'From secants to tangents', level: 'Classes 11–University', kind: 'tangent', values: { expression: 'x^2', minimum: -2, maximum: 2, position: .65 } },
    { id: 'area', title: 'Area through midpoint rectangles', level: 'Classes 11–University', kind: 'integral', values: { expression: 'x^2', minimum: 0, maximum: 1, count: 8 } },
    { id: 'cardioid', title: 'Polar curves: the cardioid', level: 'Classes 11–University', kind: 'polar', values: { expression: 'a*(1+cos(theta))', parameter: 1.5, minimum: 0, maximum: 6.2832 } },
    { id: 'linear', title: 'Rotation, stretch and determinant', level: 'University', kind: 'matrix', values: { angle: 45, stretch: 1.5 } },
  ];
  function explanations(model) {
    if (model.kind === 'polar') return { status: 'Sampled polar curve', steps: ['Map each polar sample to (r cos θ, r sin θ).', 'Negative r reflects the point through the origin.', 'Undefined or non-real r breaks the curve.', 'Sampling does not prove symmetry, area or tangents.'] };
    if (model.kind === 'sequence') return { status: 'Finite partial sums, not convergence proof', steps: [`Evaluate terms at integer indices ${model.minimum} to ${model.maximum}.`, 'Teal shows terms; gold shows cumulative sums on the same vertical scale.', 'Infinite convergence requires a separate analytical test.'] };
    if (model.kind === 'surface3d') return { status: 'Sampled real surface', steps: [`z = ${model.expression}, with a = ${model.parameter}.`, 'The surface is sampled on a finite grid; undefined/non-real vertices are omitted.', 'The stored equation and teacher camera synchronize; viewer orbit/zoom does not edit the teacher board.'] };
    if (model.kind === 'fraction') {
      let a = model.numerator, b = model.denominator; while (b) [a, b] = [b, a % b]; const gcd = a || 1;
      return { status: 'Exact arithmetic', steps: [`There are ${model.denominator} equal parts; ${model.numerator} are filled.`, `The fraction is ${model.numerator}/${model.denominator}.`, `Divide numerator and denominator by ${gcd}: ${model.numerator / gcd}/${model.denominator / gcd}.`] };
    }
    if (model.kind === 'numberline') return { status: 'Arithmetic, rounded display', steps: [`Interval: ${model.minimum} to ${model.maximum}.`, `Position is ${model.position} of the interval.`, `x = ${model.minimum} + ${model.position} × (${model.maximum} − ${model.minimum}) = ${(model.minimum + model.position * (model.maximum - model.minimum)).toFixed(4)}.`] };
    if (model.kind === 'geometry') return { status: 'Euclidean construction', steps: ['A and B define the base. C stays at a fixed distance from A.', `Angle A is ${model.angle} degrees.`, 'For this nondegenerate Euclidean triangle, A + B + C = 180 degrees.'] };
    if (model.kind === 'matrix') return { status: 'Algebraic identity', steps: ['Apply a horizontal stretch diag(s, 1), then a rotation R(θ).', `M = [[s cos θ, −sin θ], [s sin θ, cos θ]], with s = ${model.stretch}.`, `det(M) = s(cos²θ + sin²θ) = ${model.stretch}.`, 'The transformed unit square illustrates the signed area scale.'] };
    if (model.kind === 'integral') return { status: 'Numerical estimate, not proof', steps: [`Split [${model.minimum}, ${model.maximum}] into ${model.count} equal intervals.`, 'Evaluate the function at each midpoint.', 'Sum f(midpoint) × interval width; increase the count to compare estimates.', 'Convergence requires mathematical conditions; sampled plots cannot establish them.'] };
    if (model.kind === 'tangent') return { status: 'Symbolic derivative; sampled illustration', steps: ['The secant joins two points on the curve.', 'Its slope is (f(x+h) − f(x))/h.', 'The tangent uses the derivative returned by the math engine.', 'A limit argument is needed to justify differentiability; animation alone is not proof.'] };
    return { status: 'Sampled real graph', steps: [`Plot f(x) = ${model.expression} with a = ${model.parameter}.`, 'Changing a updates the stored equation parameters and the vector graph.', 'Missing/non-real samples and large jumps are omitted; this is not exhaustive singularity detection.'] };
  }
  function attach({ dialog, apply, notify }) {
    const panel = document.createElement('aside'); panel.className = 'science-board-window'; panel.dataset.wbWindow = 'lessons'; panel.hidden = true;
    panel.innerHTML = '<header><strong>Lesson library</strong><button type="button" data-wb-action="close-window" aria-label="Close lessons"><i data-lucide="x"></i></button></header><section><label>Level<select data-lesson-level><option value="all">All levels</option><option value="school">School</option><option value="advanced">University</option></select></label><div class="wb-lesson-list"></div></section>';
    dialog.append(panel); const list = panel.querySelector('.wb-lesson-list');
    templates.forEach(template => { const button = document.createElement('button'); button.type = 'button'; button.dataset.lessonId = template.id; const title = document.createElement('strong'), level = document.createElement('span'); title.textContent = template.title; level.textContent = template.level; button.append(title, level); button.addEventListener('click', async () => { button.disabled = true; try { await apply(template); } catch (error) { notify(error.message); } finally { button.disabled = false; } }); list.append(button); });
    panel.querySelector('select').addEventListener('change', event => { list.querySelectorAll('button').forEach(button => { const template = templates.find(item => item.id === button.dataset.lessonId); button.hidden = event.target.value === 'school' ? template.level === 'University' : event.target.value === 'advanced' ? !template.level.includes('University') : false; }); });
  }
  window.SnapKeyLessons = { templates, explanations, attach };
})();
