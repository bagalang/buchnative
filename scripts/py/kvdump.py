#!/usr/bin/env python3
"""KV dump на buchnative върху rocksbaga (RESP2), без SQL и без boilaDB.

Форматът е JSON lines: един header + по един запис {"key","value"} на KV ключ.
Ключовете на ormbaga KV слоя са `kv:t:<таблица>:<id>`, `kv:t:<таблица>:all`,
`kv:t:<таблица>:ix:<колона>:<стойност>`, `kv:t:<таблица>:seq` и `kv:mig:<таблица>`,
така че dump-ът взема ВСИЧКИ ключове и възстановяването е просто replay —
вторичните индекси и броячите идват с данните, не се преизграждат.

Scan, не TAR: rocksbaga държи данните в LSM (WAL + SST). Физическият snapshot е
`tools/backup.baga` (REDIS BACKUP), който изисква спрян сървър или own-checkpoint.
Този модул е горещ логически архив за S3.
"""

from __future__ import annotations

import gzip
import json
import os
import socket
from datetime import datetime, timezone

FORMAT = "buchnative-kv-dump"
VERSION = 1
SCAN_COUNT = 500
# rocksbaga приема най-много 64 аргумента на команда.
MAX_ARGS = 64


class KvError(RuntimeError):
    pass


def kv_cfg(data: dict | None = None) -> dict:
    """Адресът на KV сървъра: тяло на заявката, после DROCK_HOST/DROCK_PORT."""
    data = data or {}
    host = data.get("drock_host") or os.environ.get("DROCK_HOST") or "127.0.0.1"
    port = data.get("drock_port") or os.environ.get("DROCK_PORT") or "16579"
    return {"host": str(host), "port": int(port)}


class Resp:
    """Минимален RESP2 клиент: inline-команди не се ползват, само bulk масиви."""

    def __init__(self, host: str, port: int, timeout: float = 30.0):
        self.host = host
        self.port = port
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        self.f = self.sock.makefile("rb")

    def close(self) -> None:
        try:
            self.f.close()
        finally:
            self.sock.close()

    def cmd(self, *args) -> object:
        out = [("*%d\r\n" % len(args)).encode()]
        for a in args:
            b = a if isinstance(a, bytes) else str(a).encode("utf-8")
            out.append(b"$%d\r\n" % len(b))
            out.append(b)
            out.append(b"\r\n")
        self.sock.sendall(b"".join(out))
        return self._read()

    def _read(self) -> object:
        line = self.f.readline()
        if not line:
            raise KvError("rocksbaga затвори връзката")
        tag, body = line[0:1], line[1:].strip()
        if tag == b"+":
            return body.decode("utf-8", "replace")
        if tag == b"-":
            raise KvError(body.decode("utf-8", "replace"))
        if tag == b":":
            return int(body)
        if tag == b"$":
            n = int(body)
            if n < 0:
                return None
            data = self.f.read(n + 2)
            return data[:n]
        if tag == b"*":
            n = int(body)
            if n < 0:
                return None
            return [self._read() for _ in range(n)]
        raise KvError("неочакван RESP отговор: %r" % line)


def kv_ping(c: Resp) -> None:
    if c.cmd("PING") not in ("PONG", b"PONG"):
        raise KvError("rocksbaga не отговори на PING")


def kv_scan_keys(c: Resp, match: str = "kv:*") -> list:
    """Пълен SCAN с cursor. rocksbaga бърка реда на ключовете — dump-ът ги сортира."""
    keys: list = []
    cursor = "0"
    while True:
        reply = c.cmd("SCAN", cursor, "MATCH", match, "COUNT", SCAN_COUNT)
        if not isinstance(reply, list) or len(reply) < 2:
            raise KvError("неочакван SCAN отговор")
        cursor = (reply[0] or b"0").decode("utf-8", "replace")
        for k in reply[1] or []:
            if k:
                keys.append(k.decode("utf-8", "replace"))
        if cursor == "0":
            return sorted(keys)


def kv_mget(c: Resp, keys: list) -> list:
    """MGET на парчета: 1 команда + N ключа трябва да остане под 64 аргумента."""
    out: list = []
    chunk = MAX_ARGS - 4
    for i in range(0, len(keys), chunk):
        part = keys[i : i + chunk]
        vals = c.cmd("MGET", *part) or []
        out.extend(vals)
    return out


def dump_kv(c: Resp, out) -> dict:
    """JSON lines в текстов file object. Връща {keys, tables, bytes}."""
    keys = kv_scan_keys(c)
    counts: dict = {}
    nbytes = 0
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    def write(s: str) -> None:
        nonlocal nbytes
        if not s.endswith("\n"):
            s += "\n"
        out.write(s)
        nbytes += len(s.encode("utf-8"))

    write(
        json.dumps(
            {
                "format": FORMAT,
                "version": VERSION,
                "created": stamp,
                "host": c.host,
                "port": c.port,
                "keys": len(keys),
            }
        )
    )
    vals = kv_mget(c, keys)
    for k, v in zip(keys, vals):
        text = "" if v is None else v.decode("utf-8", "replace")
        write(json.dumps({"key": k, "value": text}, ensure_ascii=False))
        table = k.split(":")[2] if k.startswith("kv:t:") and len(k.split(":")) > 2 else "mig"
        counts[table] = counts.get(table, 0) + 1
    return {"keys": len(keys), "tables": len(counts), "bytes": nbytes, "per_table": counts}


def dump_to_path(cfg: dict, dest: str) -> dict:
    c = Resp(cfg["host"], cfg["port"])
    try:
        kv_ping(c)
        with gzip.open(dest, "wt", encoding="utf-8") as f:
            st = dump_kv(c, f)
    finally:
        c.close()
    st["size"] = os.path.getsize(dest)
    return st


def restore_path(cfg: dict, src: str, flush: bool = False) -> dict:
    """Replay на dump-а. Изтрива съществуващите kv:* ключове само при flush=True."""
    c = Resp(cfg["host"], cfg["port"])
    try:
        kv_ping(c)
        if flush:
            for k in kv_scan_keys(c):
                c.cmd("DEL", k)
        written = 0
        with gzip.open(src, "rt", encoding="utf-8") as f:
            first = True
            batch_k: list = []
            batch_v: list = []
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if first:
                    first = False
                    if rec.get("format") != FORMAT:
                        raise KvError("не е buchnative KV dump")
                    continue
                batch_k.append(rec["key"])
                batch_v.append(rec["value"])
                if len(batch_k) >= (MAX_ARGS - 4) // 2:
                    c.cmd("MSET", *sum(zip(batch_k, batch_v), ()))
                    written += len(batch_k)
                    batch_k, batch_v = [], []
            if batch_k:
                c.cmd("MSET", *sum(zip(batch_k, batch_v), ()))
                written += len(batch_k)
        return {"written": written}
    finally:
        c.close()


def main(argv: list) -> int:
    mode = argv[1] if len(argv) > 1 else "dump"
    path = argv[2] if len(argv) > 2 else "buchnative_kv.json.gz"
    cfg = kv_cfg({})
    if mode == "dump":
        st = dump_to_path(cfg, path)
        print(
            f"dump {path}: keys={st['keys']} таблици={st['tables']} "
            f"байти={st['bytes']} gzip={st['size']}"
        )
        return 0
    if mode == "restore":
        st = restore_path(cfg, path, flush="--flush" in argv)
        print(f"restore {path}: ключове={st['written']}")
        return 0
    print(f"употреба: python3 kvdump.py dump|restore ФАЙЛ [--flush]  (сега: {mode})")
    return 2


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
