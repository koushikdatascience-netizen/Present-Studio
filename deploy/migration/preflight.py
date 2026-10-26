"""Offline configuration check. Never connects to a host or prints secret values."""
import argparse
from pathlib import Path
import re
from dotenv import dotenv_values


def check(path):
    values = dotenv_values(path, interpolate=False)
    errors = []
    required = ['APP_IMAGE', 'POSTGRES_PASSWORD', 'JWT_SECRET', 'AWS_ACCESS_KEY_ID',
                'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET_NAME', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
    for key in required:
        value = values.get(key) or ''
        if not value or 'REPLACE_' in value or 'change-this' in value.lower():
            errors.append(key + ': missing or placeholder value')
    image = values.get('APP_IMAGE') or ''
    if not re.fullmatch(r'snapkey-studio:release-[a-f0-9]{40}', image):
        errors.append('APP_IMAGE: must be the exact CI source-commit release tag')
    password = values.get('POSTGRES_PASSWORD') or ''
    if not re.fullmatch(r'[a-fA-F0-9]{64}', password):
        errors.append('POSTGRES_PASSWORD: must be a new 64-character hex value')
    if values.get('AWS_REGION', 'ap-south-1') != 'ap-south-1':
        errors.append('AWS_REGION: verify any change from the existing storage region')
    for key in ['JWT_SECRET', 'S3_BUCKET_NAME', 'S3_KEY_PREFIX', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']:
        if values.get(key) and str(values[key]).strip() != values[key]:
            errors.append(key + ': unexpected surrounding whitespace')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, required=True)
    args = parser.parse_args()
    if not args.env_file.is_file():
        parser.error('Environment file is missing')
    errors = check(args.env_file)
    if errors:
        print('Configuration is NOT ready. Secret values are intentionally omitted.')
        for error in errors:
            print('- ' + error)
        return 2
    print('Offline checks passed. No server was contacted. Preserve-current-value, S3 access, DNS/TLS and database checks still require maintenance-window verification.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
