# Архитектура

## Правило

Приложенията в `app-product/` остават универсални. buchnative **не** копира,
не вгражда и не кърпи fmrbaga / ormbaga / drockb. Връзката е:

- **build** — path deps в `backend/sandak.toml`
- **runtime** — само през портове по стандартните протоколи (RESP2 към базата)

## Стек

| Слой | Технология | Порт |
|------|------------|------|
| База | **rocksbaga** (KV, RESP2) през **drockb** | 16579 |
| API | Baga + fmrbaga (HTTP/JSON, JWT, OpenAPI, route-id dispatch) | 8080 |
| UI | Next.js App Router, React 19, чист CSS | 3000 |

Данните на rocksbaga живеят в `buchnative/db/` (`LSMPATH`), не в `/tmp`.

## База: rocksbaga, не boilaDB

buchnative е мигриран от bagabuch върху **rocksbaga** — дълготраен LSM KV
сървър, говорещ RESP2 (същия wire като `redis-cli`). Защо не boilaDB: boilaDB
е SQL engine, който държи стотици нишки, състезаващи се за един locks-път.
За сонда на езика това е полезно; за счетоводно приложение означава
забиване под товар. rocksbaga е един писател върху LSM — няма какво да се бори.

Драйверът е `drockb` (бинарно-сигурни ключове/стойности, batch, SCAN итератор,
CF команди). Моделите не говорят SQL — виж
[конвенциите за KV слоя](conventions.md#kv-слоят-как-работи).

`ORM_BACKEND=drock` избира този backend в `ormbaga`; тогава `OrmDb` носи
`DrokDB` вместо PostgreSQL socket. Другите стойности (`pg`, `boila`) остават
работещи за останалите приложения в монорепото.

## Пакети (backend)

От `backend/sandak.toml`:

- `fmrbaga` — HTTP, JWT, JSON, маршрути
- `ormbaga` — table слой; с `ORM_BACKEND=drock` работи върху rocksbaga
- `drockb` — RESP2 драйвер към rocksbaga
- `bagadecimal` — пари като стринг, без float
- `xmlbaga` + `reportbaga` — печат PDF/DOCX/ODT от HTML
- `std` — стандартната библиотека на Baga

Сумите в базата са **стрингове** (десетични, без `f64`) — същото правило
като в bagabuch, само че вече се съхраняват като JSON текст в KV реда.

## Мултитенант

Активната фирма е по потребител в таблица `settings` (ключ
`активна_фирма:<sub>`). Превключва се от хедъра.

Фактури, дневник, стоки и контрагенти имат `company_id` и се филтрират по
активната фирма. Обектите, кочаните, банките, дивидентите, рецептите и
поръчките също. Сметкоплан / ДМА / протоколи / начални салда още се делят
само през активната фирма, без колона.

## Автентикация

`POST /v1/auth/token` — JWT през jwtbaga (HS256). Тяло: `{sub|email, password}`.
Паролата се проверява срещу `users.password_hash`. При включена 2FA отговорът
е `{mfa:"totp", mfa_token}` — пълният JWT идва след `POST /v1/auth/mfa`.
Празен `users` е bootstrap за seed. `/me` връща правата на ролята. Супер-админът
минава с `"*"`. Публична регистрация с фирма: `POST /v1/auth/register`
(изключва се с `auth.registration_enabled=0`).

Правата са кодове като в baraba (`invoice:read`, `accounting:post`, …) и се
налагат върху API. Групи: super_admin, admin, accountant, viewer.

## Външен HTTPS

Клиентът пази само листото, затова котвата е **прекият издател** (DER).
Хардкоднати в кода; при ротация — env файл с PEM:

| Услуга | Env |
|--------|-----|
| VIES (`ec.europa.eu`) | `BUCHNATIVE_VIES_ANCHOR_FILE` |
| ЕЦБ (`www.ecb.europa.eu`) | `BUCHNATIVE_ECB_ANCHOR_FILE` |
| Mistral (`api.mistral.ai`) | `BUCHNATIVE_MISTRAL_ANCHOR_FILE` |

Mistral ключът не е env — живее в `companies.settings` на активната фирма.
Виж [ai.md](ai.md). Голям HTTPS POST (OCR PDF като base64) изисква TLS
записи на парчета — това е в baga `std/net` (`tls_conn_write`, ≤16 KB).

## Репо

buchnative е отделно репо (`bagalang/buchnative`), submodule в baga монорепото
под `app-product/buchnative`. Компилация: от `backend/` с `sandak` от корена
на baga.
