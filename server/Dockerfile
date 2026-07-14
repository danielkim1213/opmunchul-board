FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY db.js index.js overfast.js rateQueue.js ./

ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["npm", "start"]
