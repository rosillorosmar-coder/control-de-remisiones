FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.html styles.css app.js server.js ./
COPY scripts ./scripts

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["npm", "start"]
