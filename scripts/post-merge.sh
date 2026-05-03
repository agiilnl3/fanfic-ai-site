#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Seed the admins allow-list table from any pre-existing users.is_admin rows
# (kept idempotent so reruns are safe). The `admins` table is the canonical
# admin gate as of task #11.
psql "$DATABASE_URL" -c "INSERT INTO admins (user_id) SELECT id FROM users WHERE is_admin = true ON CONFLICT DO NOTHING;" >/dev/null 2>&1 || true
