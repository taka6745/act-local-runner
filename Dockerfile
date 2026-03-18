FROM node:20-slim AS client-build

WORKDIR /app/client
COPY client/.npmrc ./
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates docker.io git && \
    curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .npmrc ./
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server/ ./server/
COPY mcp-server/ ./mcp-server/
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=455
ENV DATA_DIR=/app/data

EXPOSE 455

CMD ["node", "server/index.js"]
