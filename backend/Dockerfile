FROM python:3.12-slim
WORKDIR /app
# Playwright's bundled Node needs libatomic on ARM64 before its CLI can run.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 fonts-noto-cjk tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
COPY . .
ENV DATA_DIR=/data
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
