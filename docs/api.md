# API

База: `http://localhost:8080`. JSON, JWT Bearer (`POST /v1/auth/token`).
Route id-тата в `backend/routes.baga` са стабилни — не се пренареждат
(OpenAPI operationId). Нови пътища взимат следващ свободен id (140+ са
вътрешните документи). Статичният сегмент (`next-number`) е **преди** `{id}`.

Пълен OpenAPI: `GET /openapi.json`.

## Система и вход

| Метод | Път |
|--------|-----|
| GET | `/health` `/ready` `/readyz` `/v1/meta` `/openapi.json` `/metrics` |
| POST | `/v1/auth/token` `{email, password}` → JWT или `{mfa:"totp", mfa_token}` |
| POST | `/v1/auth/mfa` `{mfa_token, code}` → JWT (TOTP или резервен код) |
| GET | `/v1/auth/registration-status` `{registration_enabled: 0\|1}` |
| POST | `/v1/auth/register` `{email, name, password, company_name, company_eik, …}` |
| POST | `/v1/auth/forgot-password` `{email}` |
| POST | `/v1/auth/reset-password` `{token, password}` |
| GET | `/v1/me` |
| POST | `/v1/me/totp/start` `/confirm` `/disable` |
| GET/PUT | `/v1/active-company` |

## Фирма и настройки

| Метод | Път |
|--------|-----|
| CRUD | `/v1/companies` |
| GET | `/v1/companies/{id}/settings` |
| POST/PATCH/DELETE | `/v1/companies/{id}/locations`, `/v1/company-locations/{id}` |
| също | `beneficial-owners`, `ultimate-parents`, `document-series` |

## Номенклатури

`/v1/accounts`, `/v1/counterparts`, `/v1/products`, `/v1/units`,
`/v1/vat-exemptions`. `POST /v1/accounts/seed-saft` пълни липсващите
сметки от NRA_Nom_Accounts (същото става при създаване на фирма).

VIES (нужен JWT; ключът е на **активната** фирма):

| Метод | Път | Бележка |
|--------|-----|---------|
| GET | `/v1/counterparts/vies-lookup?vat=` | справка, без запис |
| POST | `/v1/counterparts/vies` | създава контрагент `{vat_number, counterpart_type?}` |

Отговорът на lookup: `valid`, `name`, `address` / `vies_address` (суров),
`street_name`, `building_number`, `address_building`,
`additional_address_detail`, `address_type`, `city`, `post_code`, `region`,
`country_code`, `vat_number`, `parse_ok`, `parse_note`.
Разделянето е само ако в настройките на активната фирма има `mistral_api_key`.

`POST /v1/addresses/parse` приема `{address, country?, city?, post_code?}`
и връща същите SAF-T полета без запис. Област извън `BG-01`…`BG-28` за
български адрес се изчиства.

## Фактури и дневник

| Метод | Път |
|--------|-----|
| CRUD | `/v1/invoices` |
| GET | `/v1/invoices/next-number?document_type=&direction=` |
| POST | `/v1/invoices/{id}/post` |
| GET | `/v1/invoices/{id}/print?format=pdf\|docx\|odt` |
| GET | `/v1/invoices/{id}/ubl` |
| GET/POST | `/v1/journal`, GET/PUT `/v1/journal/{id}` |

Печатът връща файл `{номер}_{вид}.ext`: `0000000078_invoice.pdf`, `…_credit_note.docx`, `…_debit_note.odt`.

## Вътрешни документи и склад

| Метод | Път |
|--------|-----|
| CRUD | `/v1/internal-docs` |
| GET | `/v1/internal-docs/next-number` |
| POST | `/v1/internal-docs/{id}/confirm` — **без** journal_entries |
| GET | `/v1/internal-docs/{id}/print?format=` |
| GET | `/v1/inventory/at-location?location_id=` |

## Периоди и начални салда

| Метод | Път |
|--------|-----|
| GET | `/v1/accounting-periods?year=` — 12 месеца; липсващ ред = отворен |
| POST | `/v1/accounting-periods/close` `{year, month, notes, closed_at}` |
| POST | `/v1/accounting-periods/reopen` `{year, month}` |
| GET | `/v1/opening-balances?year=` |
| POST | `/v1/opening-balances` |
| PATCH/DELETE | `/v1/opening-balances/{id}` |

## Справки

JSON на екрана (сумите с точка); файлът е XHTML таблица → reportbaga
(`report_from_html_io`), като печата на фактури. Формати: `pdf`, `xlsx`,
`ods`. В таблицата за експорт сумите са със запетая; XLSX/ODS ги пишат
като числа, за да ги чете български Excel/Google Sheets.

| Метод | Път |
|--------|-----|
| GET | `/v1/reports?kind=&from=&to=&account=&counterpart_id=` |
| GET | `/v1/reports/export?kind=&from=&to=&account=&counterpart_id=&format=` |

`kind`: `trial_balance`, `general_ledger`, `correspondence_ledger`,
`chronological`, `counterpart_trial`, `counterpart_chrono`,
`balance_sheet`, `income_statement`, `cash_flow`, `equity`. Датите са ISO
`YYYY-MM-DD`. `account` е префикс на номера. По контрагент `counterpart_id`
е задължителен. `correspondence_ledger` е главна книга по Дт/Кт двойки
(без дати и документи): `debit_lead` и `credit_lead`. Финансовите отчети
се пълнят от формули в Настройки (салда `+304Д`, обороти `+702ОК`,
кореспонденции `+304Д/401К`).

## Банки

| Метод | Път |
|--------|-----|
| CRUD | `/v1/bank-accounts` |
| GET | `/v1/bank-transactions?bank_account_id=&status=&date_from=&date_to=` |
| POST | `/v1/bank-transactions/preview` `{bank_account_id, filename, content_base64}` |
| POST | `/v1/bank-transactions/import` — същият payload; записва новите |
| POST | `/v1/bank-transactions/{id}/book` `{contra_account_id, counterpart_id?}` (или стария `{debit_account_id, credit_account_id}`) |
| POST | `/v1/bank-transactions/{id}/reallocate` `{account_id, counterpart_id?}` |
| POST | `/v1/bank-transactions/{id}/unbook` — връща в чернова (изтрива записа) |
| DELETE | `/v1/bank-transactions/{id}` — изтрива транзакцията и свързания запис |
| POST | `/v1/bank-transactions/bulk` `{action: "unbook"\|"delete", ids: […]}` — групово, в една транзакция |

Формати на извлечението: OBB XML, ISO camt.053, PostBank XML, MT-940, CSV.
Прегледът маркира дубликати преди импорт.

## ДДС, дивиденти, производство, SAF-T, валута, ДМА

| Метод | Път |
|--------|-----|
| GET | `/v1/vat/registers?period=` `/v1/vat/return?period=` |
| GET | `/v1/vat/export?period=&type=deklar\|pokupki\|prodagbi\|zip` |
| CRUD | `/v1/dividend-distributions` — PATCH `{status}` за одобрение / връщане |
| POST | `/v1/dividends/{id}/pay` `{is_paid, payment_date}` — само след одобрение |
| CRUD | `/v1/recipes` (BOM: изход + материали + фира) |
| GET/POST/GET id/DELETE | `/v1/production-orders` (няма PATCH; редовете идват от рецептата) |
| POST | `/v1/production-orders/{id}/confirm` — изписване + заприход + запис 611 |
| GET | `/v1/saft/export?period=&mode=monthly\|ondemand\|annual` | схема V1.0.1; подаване от 2028. Месечен: сметкоплан, фактури, плащания. Годишен: активи. При поискване: наличност. Без данни се вижда формата, не тест на числа |
| GET | `/v1/saft/nomenclatures?kind=&search=` |
| GET | `/v1/fs/lines?statement=balance\|pl\|cashflow\|equity` |
| GET/PUT | `/v1/fs/formulas?statement=` / `{statement, line_code, formula}` |
| POST | `/v1/fs/formulas/defaults` `/validate` `/clear` |
| GET | `/v1/saft/movement-mappings?kind=stock\|asset\|cash` |
| POST | `/v1/saft/movement-mappings` `{kind, type_code, debit_account, credit_account, …}` |
| POST | `/v1/saft/movement-mappings/defaults` `{kind}` — само ако няма редове за този вид |
| PATCH/DELETE | `/v1/saft/movement-mappings/{id}` |
| GET | `/v1/exchange-rates`, `/v1/exchange-rates/rate?currency=&date=` |
| POST | `/v1/exchange-rates/import` |
| CRUD | `/v1/fixed-asset-categories`, `/v1/fixed-assets` |
| POST | `/v1/fixed-assets/depreciation/preview` и `/post` |
| POST | `/v1/fixed-assets/{id}/revalue\|move\|conserve\|end-conserve\|dispose` |
| GET | `/v1/fixed-assets/{id}/events` |

`move` приема JSON `{ "location_id": N, "event_date", "reason" }`.

## Админ, SMTP, S3, потребители

SMTP и S3 **не са Baga пакети**. Python sidecar `:5050` (`scripts/py/sidecar.py`).
Backend-ът му говори HTTP. `POST /s3-backup` прави логически dump на
редовете от rocksbaga (като JSON) и качва `buchnative_backup_*.json.gz`.
Не тарва живите LSM файлове под `LSMPATH` — това не е snapshot, докато
сървърът пише.

| Метод | Път |
|--------|-----|
| GET/PUT | `/v1/system-settings` `{items:[{key,value}]}` |
| POST | `/v1/system-settings/smtp-test` `{to}` |
| POST | `/v1/system-settings/s3-test` `/s3-backup` `/s3-delete` `{s3_key}` |
| GET | `/v1/system-settings/s3-backups` |
| CRUD | `/v1/users`, `/v1/roles` |

`GET /v1/saft/nomenclatures` без `kind` връща списъка номенклатури. С `kind=`
връща `{kind, items, count}` (официални кодове на НАП, без CRUD):
`stock_movements`, `asset_movements`, `tax_regimes`, `payment_methods`,
`invoice_types`, `tax_types`, `tax_codes`, `product_types`, `units`,
`regions`, `accounts`. `search` филтрира по подниз.

## Сканиране

| Метод | Път | Бележка |
|--------|-----|---------|
| POST | `/v1/scans/extract` | `{filename, mime, content_base64, direction: in\|out}` → JSON на фактура с редове |
| POST | `/v1/scans/ubl` | същото тяло, но UBL 2.1 / Peppol BIS (фактура 380 или кредитно 381). Без Mistral. Връща и `vat_exemption_reason`, `payment_method`, `original_invoice_number` |
| GET | `/v1/product-name-mappings?counterpart_id=` | запомнени имена от документи |
| POST | `/v1/product-name-mappings` | `{counterpart_id, items: [{scanned_name, product_id}]}` |

Черновата се записва с обикновения `POST /v1/invoices`. Без ключ PDF extract връща 422.
Модели: OCR `mistral-ocr-latest`, JSON `mistral-small-2603` (Small 4).
UBL (`/v1/scans/ubl`) не иска ключ: XML-ът се чете директно, VATEX отива в основанието за 0% ДДС, а артикулът се връзва по запомнено име или по кода от `SellersItemIdentification`.
