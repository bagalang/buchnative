# Модел на данните

Миграциите са dual набор: `schema_pg_a/b/c.baga` (Postgres DDL с
NOT NULL/DEFAULT) и `schema_boila_a/b/c.baga` (исторически набор:
`ALTER ADD COLUMN` е само nullable). `schema.baga` ги сглобява според
`ORM_BACKEND`.

Качените `CREATE TABLE` **не се пипат**. Нови колони — нов `ALTER`.
Нови таблици в boila набора ползват текущия диалект.

PK за таблици от преди P20: `MAX(id)+1` в приложението. Нови таблици с
`BIGSERIAL` в Postgres набора.

## Основни таблици

| Таблица | Бележка |
|---------|---------|
| `companies` | Реквизити, ДДС, SAF-T полета, метод WAC/FIFO/LIFO; `settings` е JSON текст (`mistral_api_key`, `zhipu_api_key`) |
| `company_locations` | Търговски обекти и поделения |
| `beneficial_owners` | Действителни собственици |
| `dividend_distributions` / `dividends` | Протокол за разпределение + редове по собственик |
| `recipes` / `recipe_lines` | Технологична карта (BOM) |
| `production_orders` / `production_order_lines` | Производствена поръчка + материали |
| `ultimate_parents` | Крайни предприятия-майки |
| `document_series` | Кочани; `document_types` е CSV от кодове |
| `accounts` | Сметкоплан; `analytic_type`: none / counterpart / product |
| `counterparts` | Клиент / доставчик; `vies_address` суров, `street_name` / `building_number` / `region` за SAF-T |
| `products` | Стоки/услуги; складов флаг, сметки, фирмена наличност |
| `inventory_lots` | Партиди + `location_id` |
| `invoices` / `invoice_lines` | Данъчни документи + `location_id` |
| `journal_entries` / `journal_lines` | Дневник; редът има `location_id` |
| `vat_return_lines` | Клетки на ППДДС |
| `fixed_assets` / `fixed_asset_categories` / `fixed_asset_events` | ДМА; активът има `location_id` |
| `internal_docs` / `internal_doc_lines` | Вътрешен протокол |
| `accounting_periods` | Месец: open/closed; липсващ ред = отворен |
| `opening_balances` | Начално салдо за фискална година по сметка |
| `exchange_rates` | ЕЦБ курсове по дата |
| `settings` | Ключ/стойност (активна фирма). OCR/Mistral ключът е в `companies.settings`, не тук |
| `users` / `roles` | CRUD екрани `/users` `/roles`; правата още не се налагат на API |
| `bank_accounts` / `bank_transactions` | Банкови сметки + извлечения; `company_id` на транзакциите |
| `product_name_mappings` | Име от сканиран документ → наш артикул, по контрагент |
| `saft_account_mappings` | Дт/Кт шаблон към SAF-T тип движение; `kind` е stock / asset / cash; `*` е префикс |
| `fs_line_formulas` | Формула на статия от НСС 1 бланка, по фирма (`statement` + `line_code`) |

## SAF-T номенклатури (без таблица)

Кодовете са стандарт на НАП (`secret/su-doxis/.../SAFT_BG/Structure_Definition_V_1.0.1.xlsx`).
Няма CRUD: същото като `/v1/units` и `/v1/vat-exemptions`. Каталозите са в
`backend/models/saft_nom_*.baga`.

| `kind` | Какво |
|--------|--------|
| `stock_movements` | Движения на запаси (`MovementType`) |
| `asset_movements` | Движения на активи (`AssetTransactionType`) |
| `tax_regimes` | ДДС режим в `TaxIDStructure` (100010/100020/100030) |
| `payment_methods` | `PaymentMethod` + `PaymentMechanism` |
| `invoice_types` | Вид документ по ППДДС (`InvoiceType`) |
| `tax_types` / `tax_codes` | TAX-IMP (вид данък + код) |
| `product_types` | Вид запас (`ProductType`) |
| `units` | UN/ECE Rec 20 + Rec 21 (същият каталог като `/v1/units`) |
| `regions` | ISO 3166-2:BG |
| `accounts` | NRA_Nom_Accounts — `AccountID` в XML |

## Вътрешен документ

```
internal_docs (
  id, number, doc_date,
  from_location_id, to_location_id,
  status,            -- draft | confirmed
  notes, handed_by, received_by,
  created_at
)

internal_doc_lines (
  id, doc_id,
  line_kind,         -- product | fixed_asset
  product_id,        -- 0 ако ДМА
  asset_id,          -- 0 ако артикул
  quantity,          -- за ДМА винаги 1
  unit_cost, amount, description
)
```

## Дивиденти

```
dividend_distributions (
  id, company_id, year, total_amount,
  decision_date, decision_number,
  status,            -- draft | approved | partially_paid | paid
  notes, created_at
)

dividends (
  id, company_id, distribution_id, beneficial_owner_id,
  owner_name, owner_egn, ownership_percentage,   -- снимка при създаване
  gross_amount, tax_rate, tax_amount, net_amount,
  decision_date, payment_date, is_paid, notes
)
```

Дяловете идват от `beneficial_owners`. Остатъкът след закръгляне отива при
последния собственик. Плащане (`POST /v1/dividends/{id}/pay`) само ако
разпределението не е `draft`.

## Производство

```
recipes (
  id, company_id, code, name,
  output_product_id, output_quantity, output_unit,
  notes, is_active, created_at
)

recipe_lines (
  id, recipe_id, product_id, quantity, unit,
  wastage_percent, line_no
)

production_orders (
  id, company_id, number, recipe_id, output_product_id,
  quantity, location_id, order_date,
  status,            -- draft | completed
  notes, material_cost, journal_entry_id, created_at
)

production_order_lines (
  id, order_id, product_id, product_name,
  quantity, unit, unit_cost, amount
)
```

Редовете на поръчката се копират от рецептата при `POST`. `unit_cost` /
`amount` се пълнят при confirm.

## Пари и дати

Суми: `NUMERIC` в SQL, стринг в JSON. Датите по документи са `TEXT`
(`YYYY-MM-DD`), не timestamptz — заради boila и за да съвпадат с
данъчното събитие / месеца.
