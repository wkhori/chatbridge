FROM node:22-slim AS build
WORKDIR /app

# Install pnpm and build tools needed for native modules
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches/ patches/
COPY release/app/package.json release/app/package.json

# Install dependencies — skip postinstall scripts (electron-rebuild not needed for web)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Run only the root-level postinstall (patches), skip release/app postinstall
RUN pnpm run --if-present postinstall 2>/dev/null || true

# Copy source
COPY . .

# Accept build-time env vars for Vite static replacement
ARG VITE_ANTHROPIC_API_KEY
ENV VITE_ANTHROPIC_API_KEY=$VITE_ANTHROPIC_API_KEY

# Build web
RUN pnpm build:web

# Serve with lightweight static server
FROM node:22-slim
RUN npm install -g serve
WORKDIR /app
COPY --from=build /app/release/app/dist/renderer /app/dist
EXPOSE 3000
CMD ["serve", "dist", "-s", "-p", "3000", "--cors"]
