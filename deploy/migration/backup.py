"""Restricted PresentStudio backup; no automatic deletion or unrelated services."""
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import subprocess


def main():
    os.umask(0o077)
    root = Path('/srv/snapkey-studio/backups')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    partial = root / ('database-' + stamp + '.dump.partial')
    final = root / ('database-' + stamp + '.dump')
    with partial.open('xb') as output:
        subprocess.run(['docker', 'exec', 'snapkey-vps-postgres-1',
                        'pg_dump', '-U', 'present_studio', '-d', 'present_studio', '-Fc'],
                       stdout=output, check=True)
    with partial.open('rb') as source:
        subprocess.run(['docker', 'exec', '-i', 'snapkey-vps-postgres-1',
                        'pg_restore', '--list'], stdin=source,
                       stdout=subprocess.DEVNULL, check=True)
    partial.rename(final)
    digest = hashlib.sha256()
    with final.open('rb') as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b''):
            digest.update(block)
    final.with_suffix('.dump.sha256').write_text(digest.hexdigest() + '  ' + final.name + '\n')
    print('Validated database backup: ' + str(final))


if __name__ == '__main__':
    main()
