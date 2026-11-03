# Качване на VPS (контейнери)

След няколко дни локалният прототип става услуга. jwtbaga е наред; за VPS
приложението вече издава JWT с `iat`/`exp` (default 7 дни, `FMR_JWT_TTL_SEC`)
и `fmr_before` отказва изтекъл токен.

## Какво трябва да е вярно преди `up`

1. **`FMR_JWT_SECRET`** — дълъг случаен низ (`openssl rand -hex 32`). Не
   `dev-secret` / `baga-secret`. Backend-ът пише WARNING ако е default.
2. **Смени паролата на `superadmin`** след първи вход (`123+123` е само за
   seed). Създай отделен счетоводител, не работи с супер-админ всеки ден.
3. **Том за rocksbaga** — `rocks-data` (`LSMPATH`). Без него рестартът на
   контейнера трие дневника.
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
| rocksbaga | база, KV по RESP2 | 16579 вътре |
| backend | Baga API; PDF печатът ползва DejaVu Sans | 8080 вътре |
| sidecar | SMTP/S3 + dump Python | 5050 вътре |
| frontend | Next.js | 3000 публичен |

Caddy в отделен compose (както baraba) с `caddy-network` ако вече имаш reverse
proxy на VPS.

## Архив (S3)

Админ → S3 / Архиви качва `buchnative_backup_YYYYMMDD_HHMMSS.json.gz` — логически
dump на редовете (по ключ `kv:t:<таблица>:<id>`). Sidecar-ът **не** монтира
`rocks-data` и не тарва LSM файлове — това не е snapshot, докато сървърът пише.

Възстановяване върху празно `LSMPATH`, rocksbaga пуснат, backend още не:
dump-ът се разархивира и редовете се записват обратно през drockb. При
съмнение за цялост — `chunk` от `drockb` (`CHECKPOINT`) върху спрян сървър
(`BACKUP` / `CHECKPOINT`), не върху жив `LSMPATH`.
