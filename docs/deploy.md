# Качване на VPS (контейнери)

След няколко дни локалният прототип става услуга. jwtbaga е наред; за VPS
приложението вече издава JWT с `iat`/`exp` (default 7 дни, `FMR_JWT_TTL_SEC`)
и `fmr_before` отказва изтекъл токен.

## Какво трябва да е вярно преди `up`

1. **`FMR_JWT_SECRET`** — дълъг случаен низ (`openssl rand -hex 32`). Не
   `dev-secret` / `baga-secret`. Backend-ът пише WARNING ако е default.
2. **Смени паролата на `superadmin`** след първи вход (`123+123` е само за
   seed). Създай отделен счетоводител, не работи с супер-админ всеки ден.
3. **Том за boilaDB** — `boila-data`. Без него рестартът на контейнера трие
   дневника.
4. **TLS** — Caddy/nginx пред `:3000`. `FMR_CORS` = публичният https origin,
   не `*`.
5. Frontend проксира `/v1` към `backend:8080` (rewrite). Браузърът не трябва
   да вика `:8080` директно.

## Старт от корена на baga монорепото

```bash
cp app-product/buchnative/deploy/.env.example app-product/buchnative/deploy/.env
# редактирай FMR_JWT_SECRET
docker compose -f app-product/buchnative/deploy/docker-compose.yml \
  --env-file app-product/buchnative/deploy/.env up --build -d
```

После seed (веднъж), от хоста или exec в backend мрежата към `:8080`.

Вход: `superadmin` / `123+123` — смени веднага.

## Контейнери

| Услуга | Роля | Порт |
|--------|------|------|
| boiladb | база, PostgreSQL wire | 6575 вътре |
| backend | Baga API; PDF печатът ползва DejaVu Sans | 8080 вътре |
| sidecar | SMTP/S3 + dump Python | 5050 вътре |
| frontend | Next.js | 3000 публичен |

Caddy в отделен compose (както baraba) с `caddy-network` ако вече имаш reverse
proxy на VPS.

## Архив (S3)

Админ → S3 / Архиви качва `buchnative_backup_YYYYMMDD_HHMMSS.sql.gz` — логически
dump през живата boilaDB (`COPY TO STDOUT` в REPEATABLE READ). Sidecar-ът **не**
монтира `boila-data` и не тарва LSM файлове.

Възстановяване върху празен `BOILA_PATH`, boiladb пуснат, backend още не:

```bash
gunzip -c buchnative_backup_….sql.gz | \
  psql "host=127.0.0.1 port=6575 user=boila dbname=boila sslmode=disable"
```

После старт на backend (migrate е no-op, ако dump-ът има `baga_schema_migrations`).

Офлайн физически checkpoint (спрян сървър): `boilaDB/tools/backup.baga`
`BACKUP_MODE=create|verify|restore`. Не се пуска срещу жив `BOILA_PATH`.
