#!/usr/bin/env python3
"""Live logical dump of boilaDB over PostgreSQL v3 wire.

Hot-tarring LSM files under BOILA_PATH is not a snapshot: WAL/SST can
tear while serve_pg writes. boilaDB already has COPY TO STDOUT (P14)
and REPEATABLE READ (snapshot_lsn). This dumps that snapshot as SQL.

Physical checkpoint (tools/backup.baga, P26) stays the offline path:
it opens the store itself, so it must not run against a live BOILA_PATH.
"""

from __future__ import annotations

import os
import re
import socket
import struct
from datetime import datetime, timezone

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# buchnative unique indexes (SHOW INDEX does not expose UNIQUE).
UNIQUE_INDEX_SQL = (
    (
        "product_name_mappings",
        "product_name_mappings_cp_name_idx",
        "CREATE UNIQUE INDEX IF NOT EXISTS product_name_mappings_cp_name_idx "
        "ON product_name_mappings (counterpart_id, scanned_name)",
    ),
    (
        "exchange_rates",
        "exchange_rates_currency_date_idx",
        "CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_currency_date_idx "
        "ON exchange_rates (currency_code, date)",
    ),
)
UNIQUE_INDEX_NAMES = frozenset(name for _t, name, _sql in UNIQUE_INDEX_SQL)


class PgError(RuntimeError):
    pass


def _be32(n: int) -> bytes:
    return struct.pack(">I", n & 0xFFFFFFFF)


def _readn(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise PgError("връзката с boilaDB се затвори")
        buf.extend(chunk)
    return bytes(buf)


def _err_fields(body: bytes) -> str:
    parts: list[str] = []
    i = 0
    while i < len(body) and body[i] != 0:
        tag = chr(body[i])
        i += 1
        z = body.find(b"\x00", i)
        if z < 0:
            break
        val = body[i:z].decode("utf-8", "replace")
        i = z + 1
        if tag in ("M", "C"):
            parts.append(val)
    return ": ".join(parts) if parts else "boilaDB SQL грешка"


class PgConn:
    def __init__(self, sock: socket.socket):
        self.sock = sock

    def close(self) -> None:
        try:
            self.sock.sendall(b"X" + _be32(4))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass

    def _send_query(self, sql: str) -> None:
        payload = sql.encode("utf-8") + b"\x00"
        self.sock.sendall(b"Q" + _be32(4 + len(payload)) + payload)

    def _read_msg(self) -> tuple[int, bytes]:
        hdr = _readn(self.sock, 5)
        typ, ln = hdr[0], struct.unpack(">I", hdr[1:5])[0]
        if ln < 4:
            raise PgError("счупено PG съобщение")
        body = _readn(self.sock, ln - 4) if ln > 4 else b""
        return typ, body

    def _until_ready(self) -> tuple[list[tuple], bytes, str]:
        """Collect DataRows, COPY payload, CommandComplete tag until ReadyForQuery."""
        rows: list[tuple] = []
        copy = bytearray()
        tag = ""
        ncols = 0
        while True:
            typ, body = self._read_msg()
            if typ == ord("Z"):
                return rows, bytes(copy), tag
            if typ == ord("E"):
                err = _err_fields(body)
                while True:
                    t2, _b = self._read_msg()
                    if t2 == ord("Z"):
                        break
                raise PgError(err)
            if typ == ord("T"):
                if len(body) >= 2:
                    ncols = struct.unpack(">H", body[:2])[0]
                continue
            if typ == ord("D"):
                rows.append(_parse_datarow(body, ncols))
                continue
            if typ == ord("C"):
                tag = body.split(b"\x00", 1)[0].decode("utf-8", "replace")
                continue
            if typ == ord("H"):
                continue
            if typ == ord("d"):
                copy.extend(body)
                continue
            if typ in (ord("c"), ord("N"), ord("S"), ord("K"), ord("I"), ord("1"), ord("2"), ord("3"), ord("n"), ord("t"), ord("A")):
                continue
            # Ignore unknown notice-class messages.

    def query(self, sql: str) -> list[tuple]:
        self._send_query(sql)
        rows, _copy, _tag = self._until_ready()
        return rows

    def copy_out(self, sql: str) -> bytes:
        self._send_query(sql)
        _rows, copy, _tag = self._until_ready()
        return copy

    def exec_ok(self, sql: str) -> str:
        self._send_query(sql)
        _rows, _copy, tag = self._until_ready()
        return tag


def _parse_datarow(body: bytes, ncols_hint: int) -> tuple:
    if len(body) < 2:
        return ()
    n = struct.unpack(">H", body[:2])[0]
    i = 2
    cols: list[str | None] = []
    for _ in range(n):
        if i + 4 > len(body):
            break
        ln = struct.unpack(">i", body[i : i + 4])[0]
        i += 4
        if ln < 0:
            cols.append(None)
            continue
        cols.append(body[i : i + ln].decode("utf-8", "replace"))
        i += ln
    return tuple(cols)


def _startup(sock: socket.socket, user: str, database: str) -> None:
    params = (
        b"user\x00"
        + user.encode("utf-8")
        + b"\x00database\x00"
        + database.encode("utf-8")
        + b"\x00\x00"
    )
    sock.sendall(_be32(8 + len(params)) + _be32(196608) + params)


def _auth(sock: socket.socket, password: str) -> None:
    while True:
        typ, body = PgConn(sock)._read_msg()
        if typ == ord("R"):
            if len(body) < 4:
                raise PgError("непълна Authentication")
            kind = struct.unpack(">I", body[:4])[0]
            if kind == 0:
                continue
            if kind == 3:
                pw = password.encode("utf-8") + b"\x00"
                sock.sendall(b"p" + _be32(4 + len(pw)) + pw)
                continue
            raise PgError(
                f"boilaDB иска auth={kind}; sidecar-ът поддържа trust и cleartext парола"
            )
        if typ == ord("E"):
            raise PgError(_err_fields(body))
        if typ == ord("Z"):
            return
        if typ in (ord("S"), ord("K"), ord("N")):
            continue


def pg_connect(
    host: str,
    port: int,
    user: str,
    database: str,
    password: str = "",
    timeout: float = 15.0,
) -> PgConn:
    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(120.0)
    # SSLRequest → boila answers 'N' unless BOILA_TLS_CERT is set.
    sock.sendall(_be32(8) + _be32(80877103))
    ans = _readn(sock, 1)
    if ans == b"S":
        sock.close()
        raise PgError("boilaDB иска TLS; sidecar dump е само plaintext към :6575")
    if ans != b"N":
        sock.close()
        raise PgError("неочакван отговор на SSLRequest")
    _startup(sock, user, database)
    _auth(sock, password)
    return PgConn(sock)


def pg_cfg(data: dict | None = None) -> dict:
    d = data or {}
    return {
        "host": d.get("pg_host") or os.environ.get("BOILA_PGHOST") or "127.0.0.1",
        "port": int(d.get("pg_port") or os.environ.get("BOILA_PGPORT") or "6575"),
        "user": d.get("pg_user") or os.environ.get("BOILA_PGUSER") or "boila",
        "database": d.get("pg_database") or os.environ.get("BOILA_PGDATABASE") or "boila",
        "password": d.get("pg_password") or os.environ.get("BOILA_PGPASSWORD") or "",
    }


def _ident(name: str) -> str:
    if not name or not IDENT.match(name):
        raise PgError(f"небезопасно име на таблица/индекс: {name!r}")
    return name


def _create_if_not_exists(ddl: str) -> str:
    if ddl.startswith("CREATE TABLE ") and not ddl.startswith("CREATE TABLE IF NOT EXISTS "):
        return "CREATE TABLE IF NOT EXISTS " + ddl[len("CREATE TABLE ") :]
    return ddl


def dump_sql(cfg: dict, out) -> dict:
    """Write a .sql dump to a text file object. Returns {tables, bytes} stats."""
    c = pg_connect(cfg["host"], cfg["port"], cfg["user"], cfg["database"], cfg["password"])
    ntables = 0
    nbytes = 0

    def write(s: str) -> None:
        nonlocal nbytes
        data = s if s.endswith("\n") or s == "" else s + "\n"
        out.write(data)
        nbytes += len(data.encode("utf-8"))

    try:
        c.exec_ok("BEGIN ISOLATION LEVEL REPEATABLE READ")
        tables = [_ident(r[0]) for r in c.query("SHOW TABLES") if r and r[0]]
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        write("-- buchnative логически dump")
        write(f"-- {stamp}")
        write("-- boilaDB COPY TO STDOUT в REPEATABLE READ (не tar на живи LSM файлове)")
        write("-- Възстановяване върху празен BOILA_PATH, boiladb пуснат:")
        write('--   gunzip -c FILE.sql.gz | psql "host=127.0.0.1 port=6575 user=boila dbname=boila sslmode=disable"')
        write("-- После старт на backend (migrate е no-op ако dump-ът има baga_schema_migrations).")
        write("")
        for t in tables:
            cr = c.query(f"SHOW CREATE TABLE {t}")
            ddl = cr[0][1] if cr and len(cr[0]) > 1 and cr[0][1] else ""
            if ddl:
                write(_create_if_not_exists(ddl) + ";")
            payload = c.copy_out(f"COPY {t} TO STDOUT")
            write(f"COPY {t} FROM STDIN;")
            if payload:
                # COPY OUT already includes newlines per row.
                text = payload.decode("utf-8", "replace")
                out.write(text)
                nbytes += len(payload)
                if not text.endswith("\n"):
                    write("")
            write("\\.")
            write("")
            try:
                ixs = c.query(f"SHOW INDEX FROM {t}")
            except PgError:
                ixs = []
            for ix in ixs:
                if len(ix) < 3:
                    continue
                name, col, kind = ix[0] or "", ix[1] or "", (ix[2] or "").lower()
                if not name or name in UNIQUE_INDEX_NAMES:
                    continue
                if kind in ("fts", "hnsw"):
                    continue
                if not IDENT.match(name) or (col and not IDENT.match(col)):
                    continue
                if col:
                    write(f"CREATE INDEX IF NOT EXISTS {name} ON {t} ({col});")
            ntables += 1
        have = set(tables)
        for table, _name, stmt in UNIQUE_INDEX_SQL:
            if table in have:
                write(stmt + ";")
        write("")
        c.exec_ok("ROLLBACK")
    except Exception:
        try:
            c.exec_ok("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        c.close()
    return {"tables": ntables, "bytes": nbytes}


def dump_to_path(cfg: dict, dest: str) -> dict:
    import gzip

    with gzip.open(dest, "wt", encoding="utf-8") as f:
        st = dump_sql(cfg, f)
    st["size"] = os.path.getsize(dest)
    return st


if __name__ == "__main__":
    import sys

    dest = sys.argv[1] if len(sys.argv) > 1 else "buchnative_dump.sql.gz"
    st = dump_to_path(pg_cfg({}), dest)
    print(f"dump {dest} tables={st['tables']} bytes={st['bytes']} gzip={st['size']}")
