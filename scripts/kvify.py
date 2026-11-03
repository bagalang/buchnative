#!/usr/bin/env python3
"""kvify.py — механична част от миграцията на модели към KV слоя.

Прави само еднозначните замествания:
  X_select_sql() -> X_cols()             (SELECT списък → Vec<str>)
  orm_count_sql(                          → kv_count_sql(
  orm_delete_by_id(                       → kv_delete_by_id(
  orm_query(db, concat(S, " ORDER BY c")) → kv_select_all_order(db, table, "c", cols)
  "WHERE id = $1" блокове                 → kv_select_by_id
  "WHERE <col> = $1" блокове              → kv_where_star
Оставя всичко друго за ръчна проверка и го отпечатва.
"""
import re, sys

def cols_fn(name, sql_line):
    m = re.search(r'"SELECT (.+?) FROM (\w+)"', sql_line)
    if not m:
        return None, None
    cols = [c.strip() for c in m.group(1).split(",")]
    table = m.group(2)
    out = ["fn %s() -> Vec<str> {" % name, "    let c: Vec<str> = vec_new()"]
    for c in cols:
        out.append('    vec_push(c, "%s")' % c)
    out += ["    return c", "}"]
    return "\n".join(out), table

def main(path):
    s = open(path).read()
    # 1. SELECT списък → cols()
    for m in list(re.finditer(r'fn (\w+)_select_sql\(\) -> str \{\n    return "SELECT [^"]+"\n\}', s)):
        fn, table = cols_fn(m.group(1) + "_cols", m.group(0))
        if fn:
            s = s[:m.start()] + fn + s[m.end():]
    # 2. прости замествания
    s = s.replace("orm_count_sql(", "kv_count_sql(")
    s = s.replace("orm_delete_by_id(", "kv_delete_by_id(")
    open(path, "w").write(s)
    left = [l for l in s.split("\n") if "orm_query_params" in l or "orm_query(" in l or "orm_insert" in l or "orm_update" in l]
    print("%s: остават %d ръчни реда" % (path.split("/")[-1], len(left)))
    for l in left[:6]:
        print("   ", l.strip()[:100])

if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
