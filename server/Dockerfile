# SMaLL-100 translation daemon — CPU image
# For GPU: replace base image with pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir \
    fastapi==0.111.* \
    uvicorn[standard]==0.30.* \
    torch==2.3.* --index-url https://download.pytorch.org/whl/cpu \
    transformers==4.41.* \
    sentencepiece==0.2.* \
    accelerate==0.30.*

# Pre-download the model at build time so the container starts immediately
RUN python -c "from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; \
    AutoTokenizer.from_pretrained('alirezamsh/small100'); \
    AutoModelForSeq2SeqLM.from_pretrained('alirezamsh/small100')"

COPY server/translate.py .

EXPOSE 7080

# Bind to 0.0.0.0 so the container port is accessible from the host
CMD ["python", "translate.py", "--host", "0.0.0.0", "--port", "7080"]
