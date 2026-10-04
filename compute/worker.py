import json
import sys

if sys.platform != 'win32':
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))

from compute.engine import calculate

try:
    payload = json.loads(sys.stdin.read(16000))
    print(json.dumps(calculate(payload), allow_nan=False))
except Exception as error:
    print(json.dumps({'error': str(error)[:300]}))
