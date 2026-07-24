# Build context must be the REPO ROOT, not this directory — see the
# identical note in apps/api-public/Dockerfile. Build with:
#   docker build -f apps/api-internal/Dockerfile -t cop-api-internal .
# (run from the repo root).

FROM node:20-slim AS build
WORKDIR /repo

COPY . .

RUN npm ci
RUN npm run --workspace packages/shared-types build
RUN npm run --workspace apps/api-internal build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/apps/api-internal/package.json ./apps/api-internal/package.json
COPY --from=build /repo/apps/api-internal/dist ./apps/api-internal/dist

EXPOSE 4002
CMD ["npm", "run", "--workspace", "apps/api-internal", "start"]

# To bootstrap the first reviewer's password after deploying (one-time, via
# the platform's shell/exec into this container): the dev-only `create-admin`
# script needs tsx, which was pruned from this production image. Use the
# compiled equivalent instead — DATABASE_URL is already set in the
# container's environment, so it just needs the flags:
#   npm run --workspace apps/api-internal create-admin:built -- --email=reviewer@example.org --password=<pick one>
