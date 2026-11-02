# buchnative

**Счетоводна програма на Baga върху rocksbaga** — сърце от двоен запис,
сметкоплан, фактури и отчети, които работят директно върху KV хранилището
през конектора [drockb](../drockb). Няма SQL, няма ORM, няма float суми.

За разлика от [bagabuch](../bagabuch) (SQL + Next.js, пълен ERP) това е
**нативно и бързо**: едно процесно приложение, една DrokDB връзка на TCP
конекция, и данни, които се четат с едно префикс-сканиране.

## Старт

```bash
# 1. rocksbaga сървър (RESP2, същия wire като redis-cli)
LSMPATH=/tmp/buchnative LSMPORT=16579 \
  ./baga -I . -I app-product app-product/rocksbaga/tools/serve.baga &

# 2. данни + сметкоплан + супер-админ
DROCK_PORT=16579 ./baga -I . -I app-product app-product/buchnative/start.baga seed

# 3. API (порт 8090)
DROCK_PORT=16579 FMR_JWT_SECRET=change-me PORT=8090 \
  ./baga -I . -I app-product app-product/buchnative/start.baga serve
```

Или еднократно: `app-product/buchnative/scripts/up.sh`.

## Модел на данните

Ключовете са ASCII, стойностите JSON. Суми в JSON са **десетични низове** —
`f64` не се ползва никъде.

| Ключ | Съдържание |
|---|---|
| `bn:co:<id>` / `bn:co:all` | фирма / списък от id-та |
| `bn:usr:<email>` | потребител (солен хеш `salt$hex`) |
| `bn:role:<co>:<email>` | роля въвфирмата |
| `bn:act:<email>` | активна фирма на потребителя |
| `bn:acc:<co>:<code>` / `bn:acc:all:<co>` | сметка / списък кодове |
| `bn:cp:<co>:<id>` / `bn:cp:all:<co>` | контрагент |
| `bn:per:<co>:<yyyy-mm>` | статус на период (open/closed) |
| `bn:ob:<co>:<account>:<yyyy>` | начално салдо |
| `bn:seq:<co>:<yyyy-mm>` | INCR брояч на записите |
| `bn:je:<co>:<yyyy-mm>:<seq:08d>` | запис (непроменим) |
| `bn:jl:<co>:<account>:<yyyy-mm>:<seq:08d>:<line:02d>` | аналитичен индекс на сметка |
| `bn:bal:<co>:<yyyy-mm>:<account>` | инкрементално салдо |
| `bn:inv:<co>:<id>` / `bn:inv:num:<co>:<number>` | фактура / индекс по номер |

`seq:08d` е с водещи нули, задат лексикографското подреждане да съвпада с
номерната последователност. SCAN на rocksbaga е **неподреден** (Redis-стил),
затова след префикс-сканиране ключовете се сортират в паметта.

## Двоен запис

Записът е непроменим и се номерира автоматично. Проверки преди запис:

- поне два реда;
- сметката съществува в сметкоплана на фирмата;
- сумата е валидно число, неотрицателна;
- дебит и кредит **не** са едновременно;
- дебитът е равен на кредита;
- периодът е отворен.

Корекция се прави със **сторно** (нов запис с разменени дебит/кредит), не с
изтриване — хронологията остава пълна.

## Салда и отчети

Салдата на сметка се инкрементира в **същия `MSET`**, който записва реда —
ред и салдо са атомарни. Преди това се взема KV-заключване на фирмата
(`bn:lock:post:<co>`), за да няма загубена промяна при едновременни проводки.

Отчети:

| Команда | Какво |
|---|---|
| `trial <период>` | оборотна ведомост — дебит/кредит/салдо по сметка |
| `ledger <сметка> [период]` | главна книга с текущо салдо |
| `pl <период>` | НСС1 — приходи (клас 7) минус разходи (клас 6) |
| `bs <период>` | НСС2 — активи (1,2) срещу пасиви (3,4,5) + резултат |

НСС2 е натрупан за годината: начално салдо + месеци от януари до периода.

## API

`GET /health`, `GET /ready`, `POST /v1/auth/token`, `POST /v1/auth/register`,
`GET /v1/me`, `GET|POST /v1/me/company`, `GET|POST /v1/companies`,
`GET|POST /v1/accounts`, `GET|PATCH|DELETE /v1/accounts/{code}`,
`POST /v1/accounts/seed`, `GET|POST /v1/counterparts`,
`GET|PATCH|DELETE /v1/counterparts/{id}`, `GET|POST /v1/journal`,
`GET /v1/journal/{period}/{number}`, `POST /v1/journal/{period}/{number}/reverse`,
`GET|POST /v1/invoices`, `GET /v1/invoices/{id}`, `POST /v1/invoices/{id}/post`,
`DELETE /v1/invoices/{id}`, `GET /v1/periods`, `POST /v1/periods/{period}/close|reopen`,
`GET|POST /v1/opening-balances`, `DELETE /v1/opening-balances/{account}`,
`GET /v1/reports/trial|trial-year|ledger|pl|pl-year|bs`,
`GET|POST /v1/users`, `PATCH /v1/users/{email}/role`, `GET /v1/roles`.

Ролята се проверява на всеки заявка: `viewer` (четене), `accountant` (+проводки),
`admin` (+управление), `super_admin` (всичко, глобално). Супер-админът минава
с `"*"`.

```bash
TOKEN=$(curl -s -X POST localhost:8090/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin","password":"123+123"}' | jq -r .access_token)

curl -s localhost:8090/v1/reports/trial?period=2026-11 \
  -H "Authorization: Bearer $TOKEN" | jq
```

## Тестове

```bash
# чисти (без сървър)
./baga -I . -I app-product app-product/buchnative/tests/money_test.baga

# интеграционни (нужен rocksbaga на DROCK_PORT)
DROCK_PORT=16579 ./baga -I . -I app-product app-product/buchnative/tests/journal_test.baga
DROCK_PORT=16579 ./baga -I . -I app-product app-product/buchnative/tests/api_test.baga
```

`make test` пуска и тях срещу изолирани сървъри (виж `scripts/run_tests.sh`).

## Ограничения

Виж [gaps.md](gaps.md).
