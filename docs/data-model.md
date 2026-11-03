# Модел на данните

Редовете се съхраняват в **rocksbaga** (KV) като JSON текст, по един ключ на
ред: `kv:t:<таблица>:<id:012d>`. Няма DDL — колоните се появяват при първия
запис. `schema*.baga` (Postgres/boila миграциите от bagabuch) остават в дървото
само като **справка за колоните**; при `ORM_BACKEND=drock` те не се прилагат.

Как работи слоят, защо accessor-ите не отличават backend-а, и как се
мигрира модел — виж [conventions.md](conventions.md#kv-слоят-как-работи).

PK: таблицата има брояч `kv:t:<таблица>:seq` (RESP `INCR`) — `kv_insert` го
взема и връща id-то в реда, както `INSERT … RETURNING`.

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

Суми: **десетичен низ** (`bagadecimal`) в JSON и в реда — няма `f64` и няма
SQL `NUMERIC`. Датите по документи са `TEXT` (`YYYY-MM-DD`), не timestamptz —
за да съвпадат с данъчното събитие / месеца.

## Законови промени и миграции на данни

Счетоводната програма се мени със закона: ново задължително поле, сменена
ДДС ставка, нова версия на SAF-T. В bagabuch това бяха SQL миграциите
(`schema_pg_*` / `schema_boila_*`). Върху rocksbaga DDL няма, затова има
два отделни случая — и е важно да не се бъркат.

### 1. Нова колона — НЕ е миграция

Редът е JSON. Новото поле се появява при следващия запис, а старите редове се
четат като `""` (нула). Достатъчно е да се добави в `*_cols()` на модела и в
`*_create`. Нищо не се обхожда, нищо не се пуска.

Това покрива по-голямата част от промените: „от тази година искаме още едно
поле в документа".

### 2. Старите редове трябва да получат стойност — това е миграция

Когато новото поле не може да е празно (законово изискване, изчисление,
преоформяне), старите редове се обхождат веднъж. Механизмът е
`ormbaga/session/kv_migrate.baga`:

| Понятие | Как е |
|---|---|
| Версия | на таблица: ключ `kv:mig:<таблица>` |
| Миграция | `(таблица, версия, описание, transform)` |
| Transform | `fn(db, table, cols, vals, nulls, id) -> i64` — променя реда на място, връща 1 при промяна |
| Пускане | `kv_migrate_run(db, регистър)` — само новите версии, веднъж |
| Атомарност | един ред = един `MSET` (ред + индексите му) |

Регистърът е `backend/schema_kv.baga` → `buchnative_kv_migrations()`.
Извиква се от `start.baga` при `ORM_BACKEND=drock`, преди `fmr_run`.

```baga
fn buchnative_kv_migrations() -> KvMigrations {
    let mut m = kv_migrations_new()
    m = kv_migrations_add(m, "companies", 1, "SAF-T software полета", kv_mig_company_software)
    m = kv_migrations_add(m, "invoices", 2, "ДДС ставка 20 по подразбиране", kv_mig_invoice_vat20)
    return m
}
```

Правила, които пазят счетоводната коректност:

- **Само напред.** Версията не се връща назад — стар код върху нова база би
  прочел полета, които не разбира, и би ги презаписал празни.
- **Идемпотентна.** Transform-ът трябва да е безопасен при повторно викане
  върху същия ред (проверява дали вече е поправен).
- **Без изтриване на данни.** Миграция допълва или преизчислява; триене на
  счетоводен ред е отделно решение, не миграция.
- **Никога не сменяй знака** (дебит↔кредит) в миграция — сторното е отделен
  запис, не корекция на стар.
- **Тествай.** `tests/orm_drock_migrate_test.baga` показва сценария: стар ред
  без колона → миграция → стойност; втори прогон не пипа нищо.

Ако промяната е в *формула* на отчет, а не в данните — не е миграция. Формулата
живее в кода (`models/fs_formula*`), старите данни не се пипат.
