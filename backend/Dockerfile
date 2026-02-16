# Use the official Playwright image which includes Python and all browser dependencies
# This avoids manual installation failures and ensures compatibility
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

WORKDIR /app

COPY requirements.txt .

# Install Python dependencies (FastAPI, Uvicorn, OpenAI, etc.)
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
