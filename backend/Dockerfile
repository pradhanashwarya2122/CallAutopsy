FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# schema.sql is a static asset — copy it into dist so migrate.ts can find it
RUN mkdir -p dist/db && cp src/db/schema.sql dist/db/schema.sql

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY samples ./samples
EXPOSE 3000
CMD ["node", "dist/index.js"]
