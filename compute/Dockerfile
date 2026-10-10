FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY compute/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY compute /app/compute
USER 10001:10001
CMD ["uvicorn", "compute.service:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]
