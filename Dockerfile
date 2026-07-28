# Multi-stage build: React frontend + Flask-SocketIO backend

FROM node:22-alpine AS frontend
WORKDIR /app/Frontend
COPY Frontend/package.json Frontend/package-lock.json ./
RUN npm ci
COPY Frontend/ ./
# Same-origin static hosting from Flask
ENV VITE_BASE=/
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY Backend/requirements.txt ./Backend/requirements.txt
RUN pip install --no-cache-dir -r Backend/requirements.txt

COPY Backend/ ./Backend/
COPY --from=frontend /app/Frontend/dist ./Frontend/dist

WORKDIR /app/Backend
ENV PORT=5050
EXPOSE 5050

CMD ["python", "app.py"]
