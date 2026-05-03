FROM node:20-bookworm-slim AS build
WORKDIR /app

# Copy only the files needed to install and build the local file dependency graph.
COPY packages/semantic-embedder/package*.json /app/packages/semantic-embedder/
COPY packages/semantic-embedder/src /app/packages/semantic-embedder/src
COPY packages/semantic-embedder/tsconfig.json /app/packages/semantic-embedder/

COPY services/search-api/package*.json /app/services/search-api/
COPY services/search-api/src /app/services/search-api/src
COPY services/search-api/tsconfig.json /app/services/search-api/

# Build local file dependency first so search-api can consume its dist output.
RUN npm ci --prefix /app/packages/semantic-embedder
RUN npm run build --prefix /app/packages/semantic-embedder

# Skip dependency scripts here because semantic-embedder prepare already ran above.
RUN npm ci --ignore-scripts --prefix /app/services/search-api
RUN npm run build --prefix /app/services/search-api

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/services/search-api
ENV NODE_ENV=production

COPY --from=build /app/services/search-api/package*.json ./
COPY --from=build /app/services/search-api/node_modules ./node_modules
COPY --from=build /app/services/search-api/dist ./dist

# semantic-embedder is installed as a local file dependency and is linked
# from search-api node_modules to /app/packages/semantic-embedder.
COPY --from=build /app/packages/semantic-embedder /app/packages/semantic-embedder

EXPOSE 3001
CMD ["node", "dist/main.js"]
