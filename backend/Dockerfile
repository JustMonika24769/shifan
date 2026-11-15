FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk tzdata && rm -rf /var/lib/apt/lists/*
COPY . .
ENV DATA_DIR=/data
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
