import ast
import math
import sympy as sp


FUNCTIONS = {name: getattr(sp, name) for name in ('sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'sqrt', 'sinh', 'cosh', 'tanh')}
FUNCTIONS['abs'] = sp.Abs


def parse(source, symbols):
    """Construct symbolic nodes from a restricted AST; never eval/sympify user text."""
    if not isinstance(source, str) or not 0 < len(source) <= 500:
        raise ValueError('Use an expression of 1 to 500 characters.')
    tree = ast.parse(source.replace('^', '**'), mode='eval')
    if sum(1 for _ in ast.walk(tree)) > 120:
        raise ValueError('Expression is too complex.')

    def visit(node, depth=0):
        if depth > 15:
            raise ValueError('Expression nesting is too deep.')
        child = lambda item: visit(item, depth + 1)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float) and math.isfinite(node.value) and abs(node.value) <= 1e12:
            return sp.Rational(str(node.value))
        if isinstance(node, ast.Name):
            if node.id in symbols:
                return symbols[node.id]
            if node.id in {'pi', 'e', 'i', 'oo'}:
                return {'pi': sp.pi, 'e': sp.E, 'i': sp.I, 'oo': sp.oo}[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = child(node.operand)
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp):
            left, right = child(node.left), child(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                if not (isinstance(node.right, (ast.Constant, ast.Name)) or (isinstance(node.right, ast.UnaryOp) and isinstance(node.right.operand, ast.Constant))):
                    raise ValueError('Use a constant or single symbol as the exponent.')
                if right.is_number and (right.is_real is not True or abs(right) > 100):
                    raise ValueError('Exponent magnitude is limited to 100.')
                return sp.Pow(left, right, evaluate=False)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords and 1 <= len(node.args) <= 2:
            if len(node.args) == 2 and node.func.id != 'log':
                raise ValueError('This function takes one argument.')
            return FUNCTIONS[node.func.id](*[child(item) for item in node.args])
        raise ValueError('Unsupported expression. Attributes, code, assignments and arbitrary functions are forbidden.')

    return visit(tree.body)


def calculate(payload):
    operation = payload['operation']
    x = sp.Symbol('x', real=True)
    symbols = {'x': x}
    source = payload.get('expression', 'x')
    expression = parse(source, symbols)
    steps, verification = [], 'not-verified'
    if operation == 'differentiate':
        result = sp.diff(expression, x)
        if expression.is_polynomial(x):
            poly = sp.Poly(expression, x)
            rebuilt = 0
            for (power,), coefficient in poly.terms():
                term = coefficient * power * x ** (power - 1) if power else sp.Integer(0)
                rebuilt += term
                steps.append({'rule': 'Power rule' if power else 'Constant rule', 'from': str(coefficient * x ** power), 'to': str(term)})
            if sp.simplify(rebuilt - result) == 0:
                verification = 'symbolically-checked'
    elif operation in {'integrate', 'definite_integral'}:
        primitive = sp.integrate(expression, x)
        verified = not primitive.has(sp.Integral) and sp.simplify(sp.diff(primitive, x) - expression) == 0
        steps.append({'rule': 'Antiderivative', 'from': str(expression), 'to': str(primitive)})
        if operation == 'definite_integral':
            lower, upper = parse(payload['lower'], {}), parse(payload['upper'], {})
            result = sp.integrate(expression, (x, lower, upper))
            steps.append({'rule': 'Engine definite-integral result; improper cases need separate analysis', 'from': f'{lower} to {upper}', 'to': str(result)})
            verification = 'antiderivative-checked-only' if verified else 'not-verified'
        else:
            result = primitive
            verification = 'symbolically-checked' if verified else 'not-verified'
    elif operation == 'limit':
        point = parse(payload['point'], {})
        direction = payload.get('direction', '+-')
        left, right = sp.limit(expression, x, point, dir='-'), sp.limit(expression, x, point, dir='+')
        steps = [{'rule': 'Left-hand limit', 'from': str(point), 'to': str(left)}, {'rule': 'Right-hand limit', 'from': str(point), 'to': str(right)}]
        if direction == '+-':
            if left.has(sp.Limit, sp.nan) or right.has(sp.Limit, sp.nan):
                result = sp.Limit(expression, x, point, dir='+-')
            elif left != right:
                return {'result': 'Two-sided limit does not exist', 'latex': '', 'steps': steps, 'verification': 'engine-evaluated', 'assumptions': ['x is real'], 'unresolved': False}
            else:
                result = left
        else:
            result = left if direction == '-' else right
    elif operation == 'series':
        point = parse(payload.get('point', '0'), {})
        result = sp.series(expression, x, point, payload.get('order', 6))
    elif operation == 'solve':
        result = sp.solveset(expression, x, domain=sp.S.Reals)
    elif operation in {'eigenvalues', 'rref'}:
        rows = payload['matrix']
        if not 1 <= len(rows) <= 6 or not all(1 <= len(row) <= 6 and len(row) == len(rows[0]) for row in rows):
            raise ValueError('Use a rectangular matrix up to 6 by 6.')
        matrix = sp.Matrix([[parse(str(value), {}) for value in row] for row in rows])
        if any(value.has(sp.oo, sp.zoo, sp.nan) for value in matrix):
            raise ValueError('Matrix entries must be finite.')
        if operation == 'eigenvalues':
            if matrix.rows != matrix.cols:
                raise ValueError('Eigenvalues require a square matrix.')
            result = matrix.eigenvals()
        else:
            result, pivots = matrix.rref()
            steps.append({'rule': 'Pivot columns (zero-based)', 'from': '', 'to': str(pivots)})
    else:
        raise ValueError('Unsupported computation.')
    unresolved = isinstance(result, sp.Basic) and result.has(sp.Integral, sp.Limit, sp.ConditionSet, sp.nan, sp.zoo)
    text = str(result) + (' + C' if operation == 'integrate' and not unresolved else '')
    if operation == 'definite_integral' and result in (sp.oo, -sp.oo):
        text = f'Divergent integral ({result})'
    if isinstance(result, sp.Basic) and result.has(sp.nan, sp.zoo):
        text = 'Undefined or unresolved result'
    latex = sp.latex(result) + (' + C' if operation == 'integrate' and not unresolved else '')
    if len(text) > 8000 or len(latex) > 12000:
        raise ValueError('Result is too large.')
    return {'result': text, 'latex': latex, 'steps': steps[:40], 'verification': verification, 'unresolved': bool(unresolved), 'assumptions': ['x is real', 'Radians for trigonometric functions', 'Check domains, branches and singularities before applying results']}
