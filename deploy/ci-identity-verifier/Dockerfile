FROM python:3.11.18-slim-bookworm@sha256:061c190f3d5815b341a18dfe8a45771f8ba68c15a607ea56997fde3009ac4eec

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m pip install --no-cache-dir --only-binary=:all: \
      'PyJWT[crypto]==2.10.1' \
      'cryptography==50.0.2'

USER 65532:65532
WORKDIR /tmp
