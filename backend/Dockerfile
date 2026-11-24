FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Dependency layer first so it stays cached until package files change
COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/ready || exit 1

CMD ["node", "src/server.js"]
