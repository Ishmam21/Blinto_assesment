FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY BE/requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY BE/*.py ./

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
