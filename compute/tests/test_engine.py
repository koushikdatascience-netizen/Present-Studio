import pytest
from compute.engine import calculate, parse


@pytest.mark.parametrize('source', ['__import__("os")', 'x.__class__', '[x for x in range(5)]', 'lambda: 1', 'open("file")', '(x:=1)', '10^(10^10)', 'x[0]', 'x**1000'])
def test_parser_rejects_programming_and_expansion_bombs(source):
    with pytest.raises((ValueError, SyntaxError)):
        parse(source, {})


def test_polynomial_derivative_has_checked_steps():
    result = calculate({'operation': 'differentiate', 'expression': 'x^3+2*x^2-4*x+1'})
    assert result['result'] == '3*x**2 + 4*x - 4'
    assert result['verification'] == 'symbolically-checked'
    assert len(result['steps']) == 4


def test_antiderivative_is_checked_by_differentiation():
    result = calculate({'operation': 'integrate', 'expression': 'x^2'})
    assert result['result'] == 'x**3/3 + C'
    assert result['verification'] == 'symbolically-checked'
    definite = calculate({'operation': 'definite_integral', 'expression': 'x^2', 'lower': '0', 'upper': '1'})
    assert definite['result'] == '1/3'
    assert definite['verification'] == 'antiderivative-checked-only'


def test_one_sided_and_two_sided_limits():
    payload = {'operation': 'limit', 'expression': 'sin(x)/x', 'point': '0'}
    assert calculate(payload)['result'] == '1'
    payload['expression'] = '1/x'
    assert 'does not exist' in calculate(payload)['result']
    assert calculate({**payload, 'direction': '+'})['result'] == 'oo'


def test_series_real_solution_and_matrix_operations():
    assert 'x**3/6' in calculate({'operation': 'series', 'expression': 'sin(x)', 'point': '0', 'order': 6})['result']
    assert calculate({'operation': 'solve', 'expression': 'x^2-4'})['result'] == '{-2, 2}'
    matrix = [['2', '0'], ['0', '3']]
    assert calculate({'operation': 'eigenvalues', 'matrix': matrix})['result'] == '{2: 1, 3: 1}'
    assert calculate({'operation': 'rref', 'matrix': matrix})['result'] == 'Matrix([[1, 0], [0, 1]])'


def test_improper_integrals_are_not_claimed_as_finite_verified_answers():
    divergent = calculate({'operation': 'definite_integral', 'expression': '1/x^2', 'lower': '0', 'upper': '1'})
    assert divergent['result'].startswith('Divergent integral')
    undefined = calculate({'operation': 'definite_integral', 'expression': '1/x', 'lower': '-1', 'upper': '1'})
    assert undefined['unresolved'] is True
