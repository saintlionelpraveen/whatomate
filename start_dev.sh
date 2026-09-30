#!/bin/bash
set -e

W1_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$W1_DIR"

echo "🚀 Starting Whatomate Dev Environment from $W1_DIR"

# Ensure databases are running (docker-compose is now in w1/)
echo "Starting PostgreSQL and Redis..."
docker compose -f "$W1_DIR/docker-compose.yml" up -d postgres-db redis

# Stop any dockerized app containers so they release ports
echo "Stopping Docker app containers..."
docker compose -f "$W1_DIR/docker-compose.yml" stop whatomate-dashboard whatomate-middleware 2>/dev/null || true

echo "Installing frontend dependencies if missing..."
cd "$W1_DIR/frontend"
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "Installing middleware dependencies if missing..."
cd "$W1_DIR/middleware"
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "Starting Go backend natively..."
cd "$W1_DIR"

go run ./cmd/whatomate server -config config.local.toml &
GO_PID=$!

echo "Starting Vue frontend dev server natively..."
cd "$W1_DIR/frontend"
npm run dev &
VUE_PID=$!

echo "Starting Node.js middleware natively..."
cd "$W1_DIR/middleware"
node src/server.js &
MIDDLEWARE_PID=$!

echo ""
echo "✅ All servers are running!"
echo "   Go backend:   http://localhost:3000"
echo "   Vue frontend: http://localhost:5173"
echo "   Middleware:    http://localhost:8080"
echo "   (Press Ctrl+C to stop all)"

# When the user stops this script (Ctrl+C), kill the servers
trap "kill $GO_PID $VUE_PID $MIDDLEWARE_PID 2>/dev/null" EXIT

# Wait for all processes
wait $GO_PID $VUE_PID $MIDDLEWARE_PID
