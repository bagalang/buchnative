#!/usr/bin/env python3
"""addtime.py — добавя !Time към сигнатури, за които компилаторът се оплаква.

При миграцията на bagabuch към KV backend редовете се щамповат с created_at
в модела (SQL версията разчиташе на DEFAULT NOW()), което внася !Time. Ефектът се
разпространява нагоре по веригата model → action; този скрипт го добавя
механично, докато проверката мине.

Употреба:  python3 scripts/addtime.py <entry.baga>
"""
import re
import subprocess
import sys

ROOT = "/home/ziko/ytgit/baga-lang"
ERR = re.compile(r"^(?P<file>[^:]+): ?\d+:\d+: необработен ефект !(?P<eff>\w+) във '(?P<fn>\w+)'")


def check(entry):
    r = subprocess.run(
        [f"{ROOT}/baga", "-I", ".", "-I", "app-product", "--check", entry],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.returncode, r.stdout + r.stderr


def add_effect(path, fname, eff):
    src = open(path).read()
    # fn name(...) -> Ret [!A !B] {   OR   fn name(...) [!A !B] {
    pat = re.compile(r"(fn " + re.escape(fname) + r"\([^)]*\)(?:\s*->\s*[^!{]+?)?)((?:\s*!\w+)*)(\s*\{)")
    m = pat.search(src)
    if not m:
        return False
    if f"!{eff}" in m.group(2):
        return False
    new = m.group(1) + m.group(2) + f" !{eff}" + m.group(3)
    open(path, "w").write(src[:m.start()] + new + src[m.end():])
    return True


def main():
    if len(sys.argv) < 2:
        print("usage: addtime.py <entry.baga>")
        return 2
    entry = sys.argv[1]
    for _ in range(60):
        code, out = check(entry)
        if code == 0:
            print("ok: няма повече липсващи ефекти")
            return 0
        hits = {}
        for line in out.splitlines():
            m = ERR.match(line.strip())
            if m:
                hits[(m.group("file"), m.group("fn"), m.group("eff"))] = True
        if not hits:
            print(out[:3000])
            return 1
        changed = False
        for (f, fn, eff) in hits:
            if add_effect(f, fn, eff):
                print(f"  +!{eff}  {fn}  ({f.split('buchnative/')[-1]})")
                changed = True
        if not changed:
            print("не можах да добавя ефект; остатък:")
            print(out[:3000])
            return 1
    print("прекалено много итерации")
    return 1


if __name__ == "__main__":
    sys.exit(main())
