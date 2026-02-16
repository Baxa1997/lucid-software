# ─────────────────────────────────────────────────────────
#  Lucid AI Engine — Dockerfile
#  OpenHands Software Agent SDK V1 · Docker-in-Docker
# ─────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# docker.io — Docker CLI for the Python Docker SDK
# git       — Required for cloning repos in sandbox
# curl      — Health checks
RUN apt-get update && apt-get install -y \
    curl \
    git \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies in two stages:
# 1. Core dependencies (must succeed)
# 2. Optional OpenHands SDK (may not be available yet)
COPY requirements.txt .

# Stage 1: Install core dependencies that definitely exist on PyPI
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    "uvicorn[standard]>=0.30.0" \
    pydantic>=2.7.0 \
    websockets>=12.0 \
    python-multipart>=0.0.6 \
    "python-jose[cryptography]>=3.3.0" \
    python-dotenv>=1.0.0 \
    httpx>=0.27.0 \
    docker>=7.1.0 \
    litellm>=1.50.0

# Stage 2: Try to install OpenHands SDK packages (optional - may not exist yet)
RUN pip install --no-cache-dir \
    openhands-sdk>=1.0.0 \
    openhands-tools>=1.0.0 \
    openhands-workspace>=1.0.0 \
    openhands-agent-server>=1.0.0 \
    google-generativeai>=0.8.0 \
    || echo "⚠️  Some optional packages not available — running in mock mode"

# Copy application source
COPY . .

# Environment Defaults
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV AGENT_SERVER_PORT=8001

# Expose main API port and agent-server port
EXPOSE 8000 8001

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
