#!/usr/bin/env bash
# seed.sh — демо данни за разработка през HTTP API (след migrate).
# Първият token е bootstrap (празен users). После: superadmin / 123+123.
set -euo pipefail

PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
SUB="${BUCHNATIVE_SEED_SUB:-superadmin}"
PASS="${BUCHNATIVE_SEED_PASS:-123+123}"

jget() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

wait_ready() {
  local tries="${1:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$BASE/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "seed: $BASE/ready не отговори" >&2
  return 1
}

echo "==> чакам backend $BASE/ready ..."
wait_ready 120

TOKEN=$(curl -sf -X POST "$BASE/v1/auth/token" \
  -H "Content-Type: application/json" \
  -d "{\"sub\":\"$SUB\",\"password\":\"$PASS\"}" | jget access_token || true)
if [ -z "${TOKEN:-}" ]; then
  TOKEN=$(curl -sf -X POST "$BASE/v1/auth/token" \
    -H "Content-Type: application/json" \
    -d "{\"sub\":\"$SUB\"}" | jget access_token)
fi

auth() {
  curl -sf -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"
}

echo "==> роли (baraba: super_admin / admin / accountant / viewer)"
auth -X POST "$BASE/v1/roles" -d '{"name":"super_admin","description":"Супер администратор","permissions":["*"]}' >/dev/null || true
ADMIN_JSON='{"name":"admin","description":"Администратор","permissions":["admin:read","admin:create","admin:update","admin:delete","user:read","user:create","user:update","user:delete","company:read","company:create","company:update","company:delete","role:read","role:create","role:update","role:delete","settings:read","settings:update","report:read","report:export"]}'
auth -X POST "$BASE/v1/roles" -d "$ADMIN_JSON" >/dev/null || true
ACC_JSON='{"name":"accountant","description":"Счетоводител","permissions":["accounting:read","accounting:write","accounting:post","invoice:read","invoice:create","invoice:update","invoice:delete","vat:read","vat:create","vat:submit","document:read","document:upload","report:read","settings:read"]}'
auth -X POST "$BASE/v1/roles" -d "$ACC_JSON" >/dev/null || true
auth -X POST "$BASE/v1/roles" -d '{"name":"viewer","description":"Наблюдател","permissions":["admin:read","accounting:read","invoice:read","document:read","report:read","vat:read","settings:read","user:read","company:read","role:read"]}' >/dev/null || true
ROLE_ID=$(auth "$BASE/v1/roles" | python3 -c 'import json,sys; rs=json.load(sys.stdin).get("items") or []; print(next((r["id"] for r in rs if r.get("name")=="super_admin"),0))')
echo "==> потребител $SUB (супер-админ, парола $PASS)"
auth -X POST "$BASE/v1/users" -d "{\"email\":\"$SUB\",\"name\":\"Superadmin\",\"password\":\"$PASS\",\"is_active\":true,\"is_super_admin\":true,\"role_id\":$ROLE_ID}" >/dev/null || true
TOKEN=$(curl -sf -X POST "$BASE/v1/auth/token" \
  -H "Content-Type: application/json" \
  -d "{\"sub\":\"$SUB\",\"password\":\"$PASS\"}" | jget access_token)

echo "==> фирма"
CO=$(auth -X POST "$BASE/v1/companies" -d '{
  "name": "Бага ООД",
  "eik": "207123456",
  "vat_number": "BG207123456",
  "is_vat_registered": true,
  "vat_period": "monthly",
  "currency": "EUR",
  "address": "ул. Шипка 15",
  "city": "София",
  "post_code": "1000",
  "phone": "02 123 4567",
  "email": "office@baga.bg",
  "website": "https://baga.bg",
  "mol": "Иван Петров",
  "manager_eik": "8001010000",
  "accountant_name": "Мария Георгиева",
  "accountant_egn": "7502020000",
  "tax_authority": "СДВР",
  "nap_office": "СО София",
  "iban": "BG80BNBG96611020345678",
  "bic": "BNBGBGSD",
  "inventory_valuation_method": "WAC",
  "fiscal_year_start_month": 1
}')
CO_ID=$(echo "$CO" | jget id)
auth -X PUT "$BASE/v1/active-company" -d "{\"company_id\": $CO_ID}" >/dev/null
echo "    id=$CO_ID Бага ООД (активна за $SUB)"

echo "==> сметкоплан"
acc() {
  auth -X POST "$BASE/v1/accounts" -d "{\"number\":\"$1\",\"name\":\"$2\",\"analytic_type\":\"$3\"}" >/dev/null
  echo "    $1 $2"
}
acc 201 "Дълготрайни материални активи" none
acc 241 "Амортизация на ДМА" none
acc 401 "Доставчици" counterpart
acc 411 "Клиенти" counterpart
acc 4531 "Начислен данък за покупките" none
acc 4532 "Начислен данък за продажбите" none
acc 501 "Каса в левове/евро" none
acc 503 "Разплащателни сметки" none
acc 304 "Стоки" product
acc 601 "Разходи за материали" none
acc 602 "Разходи за външни услуги" none
acc 603 "Разходи за амортизация" none
acc 702 "Приходи от продажби на стоки и услуги" none

echo "==> контрагенти"
CP_ANA=$(auth -X POST "$BASE/v1/counterparts" -d '{
  "name": "Ана ООД",
  "counterpart_type": "customer",
  "eik": "123456789",
  "vat_number": "BG123456789",
  "address": "бул. Витоша 1",
  "city": "София",
  "country": "BG",
  "post_code": "1000",
  "contact_person": "Ана Иванова",
  "email": "ana@example.bg",
  "phone": "0888 111 222"
}' | jget id)
CP_TECH=$(auth -X POST "$BASE/v1/counterparts" -d '{
  "name": "Техномаркет ЕАД",
  "counterpart_type": "supplier",
  "eik": "831641791",
  "vat_number": "BG831641791",
  "address": "бул. Цариградско шосе 115",
  "city": "София",
  "country": "BG",
  "post_code": "1784",
  "contact_person": "Петър Димитров",
  "email": "office@technomarket.bg",
  "phone": "0700 10 10 10"
}' | jget id)
CP_ECONT=$(auth -X POST "$BASE/v1/counterparts" -d '{
  "name": "Еконт Експрес ЕАД",
  "counterpart_type": "both",
  "eik": "130144928",
  "vat_number": "BG130144928",
  "address": "ул. Промишлена 1",
  "city": "Русе",
  "country": "BG",
  "post_code": "7000",
  "contact_person": "Логистика",
  "email": "office@econt.com",
  "phone": "0700 17 444"
}' | jget id)
echo "    Ана ООД=$CP_ANA  Техномаркет=$CP_TECH  Еконт=$CP_ECONT"

echo "==> стоки и услуги"
ACC_JSON=$(auth "$BASE/v1/accounts")
ACC_304_ID=$(python3 -c 'import json,sys; items=json.load(sys.stdin)["items"];
print(next((a["id"] for a in items if a["number"]=="304"), 0))' <<<"$ACC_JSON")
ACC_702_ID=$(python3 -c 'import json,sys; items=json.load(sys.stdin)["items"];
print(next((a["id"] for a in items if a["number"]=="702"), 0))' <<<"$ACC_JSON")
P_ACC=$(auth -X POST "$BASE/v1/products" -d "{
  \"name\": \"Счетоводна услуга\",
  \"code\": \"ACC-01\",
  \"unit\": \"HUR\",
  \"price\": \"80.00\",
  \"vat_rate\": \"20\",
  \"is_service\": true,
  \"revenue_account_id\": $ACC_702_ID
}" | jget id)
P_CONS=$(auth -X POST "$BASE/v1/products" -d "{
  \"name\": \"Консултация по ДДС\",
  \"code\": \"VAT-01\",
  \"unit\": \"HUR\",
  \"price\": \"120.00\",
  \"vat_rate\": \"20\",
  \"is_service\": true,
  \"revenue_account_id\": $ACC_702_ID
}" | jget id)
P_PAPER=$(auth -X POST "$BASE/v1/products" -d "{
  \"name\": \"Хартия А4 80g\",
  \"code\": \"ST-A4\",
  \"unit\": \"PK\",
  \"price\": \"4.50\",
  \"cost_price\": \"3.20\",
  \"vat_rate\": \"20\",
  \"is_service\": false,
  \"is_inventory\": true,
  \"inventory_account_id\": $ACC_304_ID,
  \"revenue_account_id\": $ACC_702_ID
}" | jget id)
echo "    продукти $P_ACC $P_CONS $P_PAPER (304=$ACC_304_ID 702=$ACC_702_ID)"

echo "==> фактури"
INV_OUT=$(auth -X POST "$BASE/v1/invoices" -d "{
  \"direction\": \"out\",
  \"document_type\": \"01\",
  \"issue_date\": \"2026-08-20\",
  \"due_date\": \"2026-09-03\",
  \"tax_event_date\": \"2026-08-20\",
  \"counterpart_id\": $CP_ANA,
  \"currency\": \"EUR\",
  \"currency_rate\": \"1\",
  \"payment_method\": \"банков превод\",
  \"lines\": [
    {\"product_id\": $P_ACC, \"description\": \"Счетоводна услуга — август\", \"quantity\": \"8\", \"unit\": \"час\", \"unit_price\": \"80.00\", \"vat_rate\": \"20\", \"net_amount\": \"640.00\", \"vat_amount\": \"128.00\", \"total_amount\": \"768.00\"},
    {\"product_id\": $P_CONS, \"description\": \"Консултация по ДДС\", \"quantity\": \"2\", \"unit\": \"час\", \"unit_price\": \"120.00\", \"vat_rate\": \"20\", \"net_amount\": \"240.00\", \"vat_amount\": \"48.00\", \"total_amount\": \"288.00\"}
  ]
}" | jget id)
auth -X POST "$BASE/v1/invoices/$INV_OUT/post" >/dev/null
echo "    изходяща #$INV_OUT осчетоводена (Ана ООД, 1056 EUR)"

INV_IN=$(auth -X POST "$BASE/v1/invoices" -d "{
  \"direction\": \"in\",
  \"document_type\": \"01\",
  \"issue_date\": \"2026-08-18\",
  \"due_date\": \"2026-09-01\",
  \"tax_event_date\": \"2026-08-18\",
  \"counterpart_id\": $CP_TECH,
  \"currency\": \"EUR\",
  \"currency_rate\": \"1\",
  \"payment_method\": \"банков превод\",
  \"lines\": [
    {\"product_id\": $P_PAPER, \"description\": \"Хартия А4 80g × 10 пакета\", \"quantity\": \"10\", \"unit\": \"пакет\", \"unit_price\": \"4.50\", \"vat_rate\": \"20\", \"net_amount\": \"45.00\", \"vat_amount\": \"9.00\", \"total_amount\": \"54.00\"}
  ]
}" | jget id)
auth -X POST "$BASE/v1/invoices/$INV_IN/post" >/dev/null
echo "    входяща #$INV_IN осчетоводена (Техномаркет, 54 EUR)"

INV_DRAFT=$(auth -X POST "$BASE/v1/invoices" -d "{
  \"direction\": \"out\",
  \"document_type\": \"01\",
  \"issue_date\": \"2026-08-26\",
  \"due_date\": \"2026-09-09\",
  \"tax_event_date\": \"2026-08-26\",
  \"counterpart_id\": $CP_ECONT,
  \"currency\": \"EUR\",
  \"currency_rate\": \"1\",
  \"payment_method\": \"банков превод\",
  \"notes\": \"чернова — още не е осчетоводена\",
  \"lines\": [
    {\"product_id\": $P_ACC, \"description\": \"Месечна абонаментна услуга\", \"quantity\": \"1\", \"unit\": \"услуга\", \"unit_price\": \"200.00\", \"vat_rate\": \"20\", \"net_amount\": \"200.00\", \"vat_amount\": \"40.00\", \"total_amount\": \"240.00\"}
  ]
}" | jget id)
echo "    чернова #$INV_DRAFT (Еконт, 240 EUR)"

echo "==> ръчен запис (каса)"
ACC_JSON=$(auth "$BASE/v1/accounts")
ACC_501=$(echo "$ACC_JSON" | python3 -c 'import json,sys
for a in json.load(sys.stdin)["items"]:
    if a["number"]=="501":
        print(a["id"]); break')
ACC_411=$(echo "$ACC_JSON" | python3 -c 'import json,sys
for a in json.load(sys.stdin)["items"]:
    if a["number"]=="411":
        print(a["id"]); break')
auth -X POST "$BASE/v1/journal" -d "{
  \"entry_date\": \"2026-08-22\",
  \"description\": \"Постъпление от клиент Ана ООД\",
  \"vat_type\": \"no_vat\",
  \"counterpart_id\": $CP_ANA,
  \"document_number\": \"ПКО-12\",
  \"document_date\": \"2026-08-22\",
  \"lines\": [
    {\"account_id\": $ACC_501, \"direction\": \"debit\", \"amount\": \"768.00\", \"vat_amount\": \"0\"},
    {\"account_id\": $ACC_411, \"direction\": \"credit\", \"amount\": \"768.00\", \"vat_amount\": \"0\"}
  ]
}" >/dev/null
echo "    Дт 501 / Кт 411  768 EUR"

echo
echo "Демото е готово. Вход: http://localhost:3000  superadmin / 123+123"
echo "Фирма: Бага ООД  ЕИК 207123456  валута EUR"
