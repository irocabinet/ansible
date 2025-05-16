FROM node:20-alpine AS frontend

WORKDIR /app

RUN npm install -g pnpm

COPY ./web /app
RUN pnpm install && pnpm run build

FROM python:3.9-alpine

WORKDIR /app

COPY . .
COPY --from=frontend /app/dist /app/public


RUN apk update && \
    apk add --no-cache openssh-client sshpass && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -rf /app/web && \
    rm -rf /var/cache/apk/*

EXPOSE 5000

CMD ["python", "app.py"]
