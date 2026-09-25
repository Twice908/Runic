# Database Migrations — Quick Reference

How to run Prisma migrations against the right database without nuking prod.

## TL;DR

| Target            | Database         | Env file   | Command                            |
| ----------------- | ---------------- | ---------- | ---------------------------------- |
| Prod / main       | `runic`          | `.env`     | `npx prisma migrate deploy`        |
| PAO feature dev   | `runic_pao_dev`  | `.env.pao` | `npx prisma migrate dev --name X`  |

Both databases live in the **same** local Docker container (`runic-timescaledb`, port 5432) — only the database name differs.

All commands run from **`packages/db/`**.

---

## The one file that controls which DB is hit

Prisma reads `DATABASE_URL` from the environment. Whatever value is exported when you run the command wins — schema file, `.env`, and `.env.pao` are all just sources for that one variable.

- `c:/Users/Pranalsingh Rajput/Desktop/Runic/.env` → points to **`runic`** (prod-like / main branch)
- `c:/Users/Pranalsingh Rajput/Desktop/Runic/.env.pao` → points to **`runic_pao_dev`** (this branch only)
- `packages/db/prisma/schema.prisma` → reads `env("DATABASE_URL")`, never edit the URL here

**You never edit `schema.prisma` to swap DBs. You only change which env var is loaded when you run the command.**

---

## Running migrations on PROD-LIKE DB (`runic`)

Use on `main` only, after PR review.

```powershell
cd packages/db

# Prisma auto-loads .env from this folder's parents; .env points at `runic`.
npx prisma migrate deploy
npx prisma generate
```

⚠️ Never run `prisma migrate dev` against prod — it can reset the DB. Only `migrate deploy` on prod.

---

## Running migrations on PAO DEV DB (`runic_pao_dev`)

Use on `feature/pao` branch.

### One-time setup (already done for this branch)

```powershell
# Create the DB inside the running container
docker exec runic-timescaledb psql -U runic -d runic -c "CREATE DATABASE runic_pao_dev OWNER runic;"

# Apply all existing migrations so the schema matches prod
cd packages/db
$env:DATABASE_URL = "postgresql://runic:runic@localhost:5432/runic_pao_dev?schema=public"
npx prisma migrate deploy
npx prisma generate
```

### Day-to-day: adding a new migration for PAO work

1. Edit `packages/db/prisma/schema.prisma` — add/change models for PAO.
2. From `packages/db/`:

   ```powershell
   $env:DATABASE_URL = "postgresql://runic:runic@localhost:5432/runic_pao_dev?schema=public"
   npx prisma migrate dev --name add_pao_<thing>
   npx prisma generate
   ```

3. The new migration file lands in `packages/db/prisma/migrations/` — commit it on `feature/pao`.

### Running the apps against the PAO DB

Set `DATABASE_URL` from `.env.pao` when starting an app. Easiest way:

```powershell
# In whichever shell starts the app
$env:DATABASE_URL = "postgresql://runic:runic@localhost:5432/runic_pao_dev?schema=public"
npm run dev
```

Or use `dotenv-cli`:

```powershell
npx dotenv -e ../../.env.pao -- npm run dev
```

---

## "Which files do I touch before migrating?" — the checklist

| Goal                            | File to edit / set                                                          |
| ------------------------------- | --------------------------------------------------------------------------- |
| Choose which DB the command hits | `DATABASE_URL` env var in your shell (or which env file you load)           |
| Change schema (new table/col)    | `packages/db/prisma/schema.prisma`                                          |
| Never edit                       | Existing files under `packages/db/prisma/migrations/*` (immutable history)  |
| Never edit for DB switching      | `schema.prisma`'s `datasource` block — it already reads `env("DATABASE_URL")` |

---

## Safety rules

- ❌ Never run `prisma migrate deploy` from `feature/pao` with the prod `DATABASE_URL`.
- ❌ Never run `prisma migrate dev` against `runic` — it can drop data on drift.
- ❌ Never commit `.env` or `.env.pao` (covered by `.gitignore`).
- ✅ Always `cd packages/db` before running Prisma commands.
- ✅ Always verify the URL printed by Prisma (`Datasource "db": PostgreSQL database "..."`) matches what you intended **before** confirming.
- ✅ When merging `feature/pao` → `main`, the migrations created against `runic_pao_dev` will be applied to prod by running `prisma migrate deploy` on `main` with the prod `DATABASE_URL`.

---

## Quick verification

List databases in the container:

```powershell
docker exec runic-timescaledb psql -U runic -l
```

List tables in either DB:

```powershell
docker exec runic-timescaledb psql -U runic -d runic -c "\dt"
docker exec runic-timescaledb psql -U runic -d runic_pao_dev -c "\dt"
```

Check what migrations have run on a given DB:

```powershell
docker exec runic-timescaledb psql -U runic -d runic_pao_dev -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;"
```
