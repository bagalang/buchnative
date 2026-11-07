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
   контейнера трие дневника. `LSMPATH` е **префикс на файл**, не директория:
   `/data/rocks` дава `/data/rocks.wal` вътре във волюма. Ако е само `/data`,
   файловете са в контейнерния слой и се губят при рестарт.
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

Архивът е **файлов**. Админ → S3 / Архиви → „Направи бекъп“: sidecar-ът влиза
през RESP2 в rocksbaga, вика живата `BACKUP <dest>` команда (под mutex:
`flush` на memtable → SST, копия на всички SST и bloom файлове, `BAGABK1`
инвентар с размери и crc32c) и кача файловете в S3 под
`<prefix><stamp>/` заедно с `manifest.json`.

Споделен обем `backup-staging` (`/backup`) е монтиран едновременно в
rocksbaga и sidecar — без него файловете са в контейнера на сървъра и
sidecar-ът не може да ги прочете. Сървърът не се спира.

Възстановяване — админ → S3 / Архиви → „Възстанови“ на бекъпа. Sidecar-ът
сваля файловете в `/backup/<stamp>` и проверява размерите по инвентара. След
това rocksbaga се пуска с `LSMPATH=/backup/<stamp>`:

```bash
docker compose stop rocksbaga
LSMPATH=/backup/<stamp> docker compose up -d rocksbaga
```

`LSMPATH` в compose-а се подменя от променливата на средата, таче споделената
директория на бекъпа става новият жив магазин.

LSM форматът е самоописен (`manifest` + `sst.*` + `bloom.*`), затова не е
нужно нито SQL, нито да се знае версията на моделите — възстановява се точно
същото състояние.

Ръчно копие/възстановяване на файлове е описано и в
`app-product/rocksbaga/tools/backup.baga` (`BACKUP_MODE=create|verify|ship|
restore`), но за живият път се ползва `BACKUP` командата на сървъра.
