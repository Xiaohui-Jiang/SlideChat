# Dockerfile for Biological Multiagent Analysis API
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create directories for job results
RUN mkdir -p /app/job_results

# Expose API port
EXPOSE 8000

# Run the API server
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
