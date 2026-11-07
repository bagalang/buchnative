#!/usr/bin/env python3
"""Файлов архив на rocksbaga за S3.

rocksbaga има жива BACKUP команда: под mutex прави checkpoint (flush на
memtable → SST), копира всички SST и bloom файлове и пише BAGABK1 инвентар
с размери и crc32c. Този модул влиза през RESP2, вика BACKUP върху споделена
директория и връща инвентаря — sidecar-ът кача файловете в S3.

Възстановяването е файлово: свалиш файловете в директория и пуснеш rocksbaga
с LSMPATH сочеща към нея. LSM форматът е самоописен (manifest + SST + bloom),
няма SQL и няма зависимост от версията на моделите.
"""

from __future__ import annotations

import os
import socket

FORMAT = "buchnative-lsm-backup"
VERSION = 1


class LsmError(RuntimeError):
    pass


class Resp:
    """Минимален RESP2 клиент — само bulk масиви, без inline команди."""

    def __init__(self, host, port, timeout: float = 120.0):
        self.host = str(host)
        self.port = int(port)
        self.sock = socket.create_connection((self.host, self.port), timeout=timeout)
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
            raise LsmError("rocksbaga затвори връзката")
        tag, body = line[0:1], line[1:].strip()
        if tag == b"+":
            return body.decode("utf-8", "replace")
        if tag == b"-":
            raise LsmError(body.decode("utf-8", "replace"))
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
        raise LsmError("неочакван RESP отговор: %r" % line)


def ping(host, port) -> None:
    c = Resp(host, port)
    try:
        if c.cmd("PING") not in ("PONG", b"PONG"):
            raise LsmError("rocksbaga не отговори на PING")
    finally:
        c.close()


def file_name(dest: str, kind: str, gen: int) -> str:
    if kind == "manifest":
        return dest + ".manifest"
    if kind == "sst":
        return "%s.sst.%d" % (dest, gen)
    if kind == "bloom":
        return "%s.bloom.%d" % (dest, gen)
    raise LsmError("неизвестен вид файл: %s" % kind)


def parse_inventory(body: str, dest: str) -> dict:
    """BAGABK1 → {nshards, created_ms, files:[{name,size,crc,kind,gen}]}."""
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    if not lines or lines[0] != "BAGABK1":
        raise LsmError("не е BAGABK1 инвентар")
    nshards = 1
    created_ms = 0
    files = []
    for line in lines[1:]:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "nshards":
            nshards = int(parts[1])
        elif parts[0] == "created_ms":
            created_ms = int(parts[1])
        elif parts[0] == "file":
            kind, gen, size, crc = parts[1], int(parts[2]), int(parts[3]), int(parts[4])
            files.append(
                {
                    "name": os.path.basename(file_name(dest, kind, gen)),
                    "kind": kind,
                    "gen": gen,
                    "size": size,
                    "crc": crc,
                }
            )
    if not files:
        raise LsmError("инвентарът е празен")
    return {"nshards": nshards, "created_ms": created_ms, "files": files}


def checkpoint(host, port, dest) -> dict:
    """Жив BACKUP: сървърът прави checkpoint и пише инвентар."""
    c = Resp(host, port)
    try:
        if c.cmd("PING") not in ("PONG", b"PONG"):
            raise LsmError("rocksbaga не отговори на PING")
        reply = c.cmd("BACKUP", dest)
        if reply not in ("OK", b"OK"):
            raise LsmError("BACKUP отказа: %r" % (reply,))
        with open(dest + ".backup", "r", encoding="utf-8") as f:
            inv = parse_inventory(f.read(), dest)
    finally:
        c.close()
    inv["format"] = FORMAT
    inv["version"] = VERSION
    inv["prefix"] = dest
    return inv


def total_bytes(inv: dict) -> int:
    return sum(f["size"] for f in inv.get("files", []))


def missing(inv: dict, directory: str) -> list:
    """Файлове от инвентаря, които не са на място (или с различен размер)."""
    bad = []
    for f in inv.get("files", []):
        path = os.path.join(directory, f["name"])
        if not os.path.exists(path):
            bad.append(f["name"])
        elif os.path.getsize(path) != f["size"]:
            bad.append(f["name"])
    return bad
