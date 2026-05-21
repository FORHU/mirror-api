#!/bin/sh
set -eu

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting application..."
exec node ./dist/server.js
