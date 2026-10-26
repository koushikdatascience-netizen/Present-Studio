#!/usr/bin/python3
"""Root-owned forced SSH command for this application's CI deploy key only.

Protocol: ssh host 'deploy COMMIT ARCHIVE_SHA256 ALLOW_ACTIVE' < image.tar.gz
No arbitrary commands, paths, Compose arguments, environment values or shell.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path('/srv/snapkey-studio')
BACKEND = 'snapkey-vps-backend-1'
MAX_ARCHIVE = 2 * 1024**3
REPOSITORY = 'MadhushalaReport/SnapkeyStudio'
REPOSITORY_ID = '1379740996'
OWNER_ID = '282201099'


def command(arguments, **options):
    return subprocess.run(arguments, check=True, capture_output=True, text=True, **options).stdout


def inspect(name):
    return json.loads(command(['docker', 'inspect', name]))[0]


def parse_request(value):
    parts = shlex.split(value)
    if parts == ['status']:
        return parts
    if (len(parts) != 4 or parts[0] != 'deploy'
            or not re.fullmatch('[a-f0-9]{40}', parts[1])
            or not re.fullmatch('[a-f0-9]{64}', parts[2]) or parts[3] not in {'0', '1'}):
        raise ValueError('Only status or a validated deployment request is permitted')
    return parts


def identity_policy(commit, allow_active):
    return {'repository': REPOSITORY, 'repository_id': REPOSITORY_ID,
            'repository_owner_id': OWNER_ID, 'ref': 'refs/heads/main', 'sha': commit,
            'workflow_sha': commit, 'runner_environment': 'github-hosted',
            'workflow_ref': REPOSITORY + '/.github/workflows/deploy.yml@refs/heads/main'}


def verify_identity(stream, commit, allow_active):
    line = stream.readline(16385)
    if not line.endswith(b'\n') or len(line) > 16384:
        raise ValueError('Missing GitHub deployment identity')
    token = line.decode('ascii').strip()
    # Use an isolated instance of the already-approved image, not the mutable
    # filesystem of the running backend. It receives no production credentials.
    code = '''import json,sys,jwt
request=json.load(sys.stdin)
key=jwt.PyJWKClient('https://token.actions.githubusercontent.com/.well-known/jwks',timeout=15).get_signing_key_from_jwt(request['token'])
claims=jwt.decode(request['token'],key.key,algorithms=['RS256'],audience='snapkey-studio-vps',issuer='https://token.actions.githubusercontent.com',options={'require':['exp','iat','nbf','sub','aud','iss']})
for field,value in request['expected'].items():
 if claims.get(field)!=value:raise ValueError('GitHub deployment identity rejected')
if claims.get('event_name') not in {'push','workflow_dispatch'}:raise ValueError('Unsupported deployment event')
if request['allow_active'] and claims['event_name']!='workflow_dispatch':raise ValueError('Meeting override requires manual dispatch')
print('GitHub main-branch deployment identity verified')
'''
    image = inspect(BACKEND)['Image']
    command(['docker', 'run', '--rm', '--read-only', '--cap-drop', 'ALL',
             '--security-opt', 'no-new-privileges', '--cpus', '.25', '--memory', '128m',
             '--pids-limit', '64', '-e', 'PYTHONDONTWRITEBYTECODE=1',
             '--entrypoint', 'python', '-i', image, '-c', code],
            input=json.dumps({'token': token, 'expected': identity_policy(commit, allow_active),
                              'allow_active': allow_active}))


def health():
    with urllib.request.urlopen('http://127.0.0.1:18474/api/health', timeout=8) as response:
        if json.load(response).get('status') != 'ok':
            raise RuntimeError('Application health check failed')


def status():
    current = inspect(BACKEND)
    health()
    return {'image': current['Config']['Image'], 'id': current['Id'],
            'healthy': current['State'].get('Health', {}).get('Status') == 'healthy'}


def participants():
    code = '''import asyncio,json,os
from livekit import api
from app.database import SessionLocal
from app.models import Presentation
async def check():
 with SessionLocal() as db: ids={r[0] for r in db.query(Presentation.id).all()}
 client=api.LiveKitAPI(url=os.environ['LIVEKIT_URL'],api_key=os.environ['LIVEKIT_API_KEY'],api_secret=os.environ['LIVEKIT_API_SECRET'])
 try:
  rooms=(await client.room.list_rooms(api.ListRoomsRequest())).rooms
  print(json.dumps(sum(r.num_participants for r in rooms if r.name in ids)))
 finally: await client.aclose()
asyncio.run(check())
'''
    return int(json.loads(command(['docker', 'exec', BACKEND, 'python', '-c', code])))


def check_meetings(allow_active):
    count = participants()  # Fail closed if meeting occupancy cannot be verified.
    if count and not allow_active:
        raise BlockingIOError('Deployment held: active meeting participants: ' + str(count))
    return count


def image_environment(contents, image):
    lines = contents.splitlines()
    if sum(line.startswith('APP_IMAGE=') for line in lines) != 1:
        raise ValueError('Expected exactly one APP_IMAGE setting')
    return '\n'.join('APP_IMAGE=' + image if line.startswith('APP_IMAGE=') else line for line in lines) + '\n'


def receive_archive(stream, target, expected_digest):
    partial = target.with_suffix('.partial')
    digest = hashlib.sha256()
    size = 0
    try:
        with partial.open('wb') as output:
            os.chmod(partial, 0o600)
            while True:
                block = stream.read(4 * 1024**2)
                if not block:
                    break
                size += len(block)
                if size > MAX_ARCHIVE:
                    raise ValueError('Deployment archive exceeds size limit')
                digest.update(block)
                output.write(block)
        if not size or digest.hexdigest() != expected_digest:
            raise ValueError('Deployment archive checksum mismatch')
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def archive_identity(path, image, commit):
    # Verify the Docker config and OCI manifest IDs: different Docker engines
    # report either identity after loading the same archive.
    with tarfile.open(path, 'r:gz') as archive:
        manifest = json.load(archive.extractfile('manifest.json'))
        if len(manifest) != 1 or manifest[0]['RepoTags'] != [image]:
            raise ValueError('Unexpected image tags in deployment archive')
        config_name = manifest[0]['Config']
        config_bytes = archive.extractfile(config_name).read()
        config_digest = hashlib.sha256(config_bytes).hexdigest()
        if config_name != 'blobs/sha256/' + config_digest and config_name != config_digest + '.json':
            raise ValueError('Image configuration digest mismatch')
        config = json.loads(config_bytes)
        if config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != commit:
            raise ValueError('Image revision does not match deployment commit')
        identities = {'sha256:' + config_digest}
        if 'index.json' in archive.getnames():
            index = json.load(archive.extractfile('index.json'))
            for item in index['manifests']:
                digest = item['digest']
                if not re.fullmatch('sha256:[a-f0-9]{64}', digest):
                    raise ValueError('Invalid image manifest digest')
                data = archive.extractfile('blobs/sha256/' + digest[7:]).read()
                if 'sha256:' + hashlib.sha256(data).hexdigest() != digest:
                    raise ValueError('Image manifest checksum mismatch')
                if json.loads(data).get('config', {}).get('digest') == 'sha256:' + config_digest:
                    identities.add(digest)
        return identities


def snapshot():
    return {name: {'id': item['Id'], 'startedAt': item['State']['StartedAt']}
            for name in command(['docker', 'ps', '--format', '{{.Names}}']).splitlines()
            for item in [inspect(name)]}


def deploy(commit, digest, allow_active, stream, root=ROOT):
    image = 'snapkey-studio:release-' + commit
    already_deployed = inspect(BACKEND)['Config']['Image'] == image
    if not already_deployed:
        check_meetings(allow_active)
    release = root / 'releases' / commit
    release.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(release, 0o700)
    target = release / 'image.tar.gz'
    receive_archive(stream, target, digest)
    identities = archive_identity(target, image, commit)
    if already_deployed:
        # Consume the complete upload before returning, so a successful retry
        # cannot fail the runner's pipe with SIGPIPE. Never restart twice.
        return {**status(), 'commit': commit, 'alreadyDeployed': True}
    command(['docker', 'load', '-i', str(target)])
    loaded = json.loads(command(['docker', 'image', 'inspect', image]))[0]
    if loaded['Id'] not in identities:
        raise ValueError('Loaded image does not match verified archive')
    # Recheck after transfer/loading, immediately before backup and replacement.
    count = check_meetings(allow_active)
    before = snapshot()
    backup = command(['python3', str(root / 'backup.py')]).strip()
    print(backup, flush=True)
    env = root / '.env.vps'
    original = env.read_bytes()
    # Retain every attempt's rollback configuration, including successful reruns.
    import time
    attempt = release / ('attempt-' + str(time.time_ns()))
    attempt.mkdir(mode=0o700)
    (attempt / 'env.before').write_bytes(original)
    shutil.copy2(root / 'compose.vps.yml', attempt / 'compose.before.yml')
    for path in attempt.iterdir():
        os.chmod(path, 0o600)
    compose = ['docker', 'compose', '--env-file', str(env), '-f', str(root / 'compose.vps.yml')]
    temporary = root / '.env.vps.next'
    temporary.write_text(image_environment(original.decode(), image))
    os.chmod(temporary, 0o600)
    temporary.replace(env)
    try:
        command(compose + ['config', '--quiet'])
        command(compose + ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'backend'])
        health()
        if inspect(BACKEND)['Image'] not in identities:
            raise ValueError('Running backend does not match the release')
    except Exception as failure:
        env.write_bytes(original)
        os.chmod(env, 0o600)
        try:
            command(compose + ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'backend'])
            health()
        except Exception as rollback:
            raise RuntimeError('Deployment and backend rollback failed; operator action required') from rollback
        raise RuntimeError('Deployment failed; previous backend restored') from failure
    for name, record in before.items():
        if name == BACKEND:
            continue
        current = inspect(name)
        if current['Id'] != record['id'] or current['State']['StartedAt'] != record['startedAt']:
            raise RuntimeError('Another service changed during deployment: ' + name)
    result = {**status(), 'commit': commit, 'participantsBeforeRestart': count, 'backup': backup}
    (release / 'DEPLOYED.json').write_text(json.dumps(result, indent=2))
    return result


def main():
    import fcntl
    os.umask(0o077)
    parts = parse_request(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    with Path('/run/lock/snapkey-studio-deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if parts == ['status']:
            result = status()
        else:
            verify_identity(sys.stdin.buffer, parts[1], parts[3] == '1')
            result = deploy(parts[1], parts[2], parts[3] == '1', sys.stdin.buffer)
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError as error:
        print(str(error), file=sys.stderr)
        sys.exit(3)
    except Exception as error:
        # Never print captured subprocess output or environment values to CI.
        print('VPS deployment failed: ' + type(error).__name__ + '. Inspect restricted server logs/configuration.', file=sys.stderr)
        sys.exit(1)
