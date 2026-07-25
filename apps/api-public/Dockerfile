# Build context must be the REPO ROOT, not this directory — this is an npm
# workspaces monorepo, and apps/api-public depends on @cop/shared-types
# being built first. Build with:
#   docker build -f apps/api-public/Dockerfile -t cop-api-public .
# (run from the repo root, not from apps/api-public/).

FROM node:22-slim AS build
WORKDIR /repo

# Copy the whole repo rather than cherry-picking package.json files — this
# is a small monorepo and `npm ci` needs every workspace's package.json
# present to resolve the workspace dependency graph correctly regardless of
# which app is being built.
COPY . .

RUN npm ci
RUN npm run --workspace packages/shared-types build
RUN npm run --workspace apps/api-public build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/apps/api-public/package.json ./apps/api-public/package.json
COPY --from=build /repo/apps/api-public/dist ./apps/api-public/dist

EXPOSE 4001
CMD ["npm", "run", "--workspace", "apps/api-public", "start"]
