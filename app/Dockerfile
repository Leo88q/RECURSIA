# syntax=docker/dockerfile:1
# Static client image: build with Node, serve with unprivileged nginx.
#   docker build -f app/Dockerfile -t recursia-app \
#     --build-arg VITE_CLUSTER=mainnet-beta --build-arg VITE_RPC_URL=https://<your-rpc> \
#     --build-arg VITE_PROGRAM_ID=<program id> .
#   docker run -p 8080:8080 recursia-app
# For production pin both base images by digest (@sha256:…) — checklist #66.
FROM node:22-alpine AS build
WORKDIR /src
ENV CI=1 NPM_CONFIG_IGNORE_SCRIPTS=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json .npmrc ./
COPY packages/sdk/package.json packages/sdk/
COPY app/package.json app/
COPY keeper/package.json keeper/
RUN npm ci --ignore-scripts
COPY packages/sdk packages/sdk
COPY app app
ARG VITE_CLUSTER=devnet
ARG VITE_RPC_URL=
ARG VITE_WS_URL=
ARG VITE_PROGRAM_ID=
ARG VITE_MAX_PRIORITY_FEE=
ENV VITE_CLUSTER=$VITE_CLUSTER VITE_RPC_URL=$VITE_RPC_URL VITE_WS_URL=$VITE_WS_URL VITE_PROGRAM_ID=$VITE_PROGRAM_ID VITE_MAX_PRIORITY_FEE=$VITE_MAX_PRIORITY_FEE
RUN npm -w app run build \
 && node app/scripts/check-bundle.mjs \
 && node app/scripts/gen-deploy.mjs --nginx-out /tmp/default.conf

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /tmp/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
