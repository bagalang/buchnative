#!/usr/bin/env python3
"""buchnative helpers: SMTP + S3. Flask on 127.0.0.1:5050.

Baga talks HTTP here (no process spawn). Same idea as su-doxis:
smtp_service.py + s3_backup.py, one process.

Архивът е ФАЙЛОВ: rocksbaga има жива BACKUP команда, която под mutex прави
checkpoint (manifest + SST + bloom + BAGABK1 инвентар). Sidecar-ът кача тези
файлове в S3 и при нужда ги сваля обратно. Няма SQL — данните са в LSM
файлове, форматът е самоописен.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Flask, jsonify, request

import lsmbackup


app = Flask(__name__)
PORT = int(os.environ.get("BUCHNATIVE_SIDECAR_PORT", "5050"))


def _json_error(msg: str, status: int = 400):
    return jsonify({"success": False, "message": msg}), status


def _ok(msg: str, **extra):
    body = {"success": True, "message": msg}
    body.update(extra)
    return jsonify(body)


# ---------- SMTP ----------


def send_smtp_email(cfg: dict, to: str, subject: str, body_html: str):
    host = cfg.get("host") or ""
    port = int(cfg.get("port") or 587)
    username = cfg.get("username") or ""
    password = cfg.get("password") or ""
    from_email = cfg.get("from_email") or username
    from_name = cfg.get("from_name") or "buchnative"
    use_tls = cfg.get("use_tls", True)
    if isinstance(use_tls, str):
        use_tls = use_tls.lower() in ("1", "true", "yes")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        if port == 465:
            ctx = ssl.create_default_context()
            server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
            if use_tls and port != 80:
                ctx = ssl.create_default_context()
                server.starttls(context=ctx)
        if username and password:
            server.login(username, password)
        server.sendmail(from_email, to, msg.as_string())
        server.quit()
        return True, "Имейлът е изпратен"
    except smtplib.SMTPAuthenticationError:
        return False, "Грешка при автентикация. Проверете потребител/парола."
    except smtplib.SMTPConnectError:
        return False, f"Не може да се свърже с {host}:{port}"
    except smtplib.SMTPException as e:
        return False, f"SMTP грешка: {e}"
    except Exception as e:
        return False, f"Грешка: {e}"


def test_template(app_name: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return f"""<!DOCTYPE html><html><body>
<h2>{app_name}</h2>
<p>SMTP работи. Изпратено: {now}</p>
</body></html>"""


@app.post("/smtp/test")
def smtp_test():
    data = request.get_json(silent=True) or {}
    cfg = data.get("smtp_config") or {}
    to = data.get("to") or ""
    if not cfg.get("host"):
        return _json_error("SMTP host е задължителен")
    if not to:
        return _json_error("Получател е задължителен")
    app_name = data.get("app_name") or "buchnative"
    ok, msg = send_smtp_email(
        cfg, to, f"Тестов имейл — {app_name}", test_template(app_name)
    )
    return (jsonify({"success": ok, "message": msg}), 200 if ok else 400)


@app.post("/smtp/send")
def smtp_send():
    data = request.get_json(silent=True) or {}
    cfg = data.get("smtp_config") or {}
    email = data.get("email") or {}
    if not cfg.get("host"):
        return _json_error("SMTP host е задължителен")
    to = email.get("to") or ""
    subject = email.get("subject") or ""
    body_html = email.get("body_html") or ""
    if not to or not subject:
        return _json_error("Получател и тема са задължителни")
    ok, msg = send_smtp_email(cfg, to, subject, body_html)
    return (jsonify({"success": ok, "message": msg}), 200 if ok else 400)


# ---------- S3 ----------


def s3_client(endpoint, access_key, secret_key, region):
    import boto3
    from botocore.config import Config

    kwargs = {
        "service_name": "s3",
        "aws_access_key_id": access_key,
        "aws_secret_access_key": secret_key,
        "region_name": region or "us-east-1",
        "config": Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client(**kwargs)


def s3_cfg(data: dict):
    return {
        "endpoint": data.get("endpoint") or "",
        "bucket": data.get("bucket") or "",
        "access_key": data.get("access_key") or "",
        "secret_key": data.get("secret_key") or "",
        "region": data.get("region") or "us-east-1",
        "prefix": data.get("prefix") or "backups/",
    }


@app.post("/s3/test")
def s3_test():
    try:
        import boto3  # noqa: F401
        from botocore.exceptions import ClientError, NoCredentialsError
    except ImportError:
        return _json_error("boto3 не е инсталиран (pip install boto3)", 500)
    from botocore.exceptions import ClientError, NoCredentialsError

    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    try:
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        client.list_objects_v2(Bucket=c["bucket"], MaxKeys=1)
        return _ok(f"Връзката с S3 е успешна. Bucket: {c['bucket']}")
    except NoCredentialsError:
        return _json_error("Невалидни credentials")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        mapping = {
            "NoSuchBucket": f"Bucket '{c['bucket']}' не съществува",
            "InvalidAccessKeyId": "Невалиден Access Key",
            "SignatureDoesNotMatch": "Невалиден Secret Key",
            "AccessDenied": "Достъпът е отказан",
        }
        return _json_error(mapping.get(code, str(e)))
    except Exception as e:
        return _json_error(str(e))


def backup_staging() -> str:
    """Споделената с rocksbaga директория, където BACKUP пише checkpoint-а."""
    return os.environ.get("BACKUP_STAGING") or "/backup"


def kv_host() -> str:
    return os.environ.get("DROCK_HOST") or "127.0.0.1"


def kv_port() -> int:
    return int(os.environ.get("DROCK_PORT") or "16579")


def human_size(n: int) -> str:
    if n < 1024:
        return "%d B" % n
    if n < 1048576:
        return "%.1f KB" % (n / 1024)
    return "%.1f MB" % (n / 1048576)


def s3_prefix(c: dict, stamp: str) -> str:
    base = c["prefix"]
    if not base.endswith("/"):
        base += "/"
    return base + stamp + "/"


def remove_staging(staging: str, names: list) -> None:
    for name in names:
        try:
            os.remove(os.path.join(staging, name))
        except OSError:
            pass


@app.post("/s3/backup")
def s3_backup():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    staging = backup_staging()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    names = []
    try:
        os.makedirs(staging, exist_ok=True)
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        # Два бекъпа в една и съща секунда да не се презаписват — новият
        # получава суфикс, старият остане в S3.
        base = s3_prefix(c, stamp)
        n = 2
        while True:
            try:
                client.head_object(Bucket=c["bucket"], Key=base + "manifest.json")
            except Exception:
                break
            stamp = "%s_%d" % (
                datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S"),
                n,
            )
            base = s3_prefix(c, stamp)
            n = n + 1
        dest = os.path.join(staging, stamp)
        # Жив checkpoint от сървъра — под mutex, сървърът не се спира.
        inv = lsmbackup.checkpoint(kv_host(), kv_port(), dest)
        names = [f["name"] for f in inv["files"]] + [stamp + ".backup"]
        for f in inv["files"]:
            path = os.path.join(staging, f["name"])
            if not os.path.exists(path):
                raise lsmbackup.LsmError("липсва файл от checkpoint: %s" % f["name"])
            client.upload_file(path, c["bucket"], base + f["name"])
        # Инвентарът (.backup) носи размерите и crc-тата — без него restore не
        # може да провери целостта на сваленото.
        client.upload_file(dest + ".backup", c["bucket"], base + stamp + ".backup")
        manifest = {
            "format": inv["format"],
            "version": inv["version"],
            "stamp": stamp,
            "created_ms": inv["created_ms"],
            "nshards": inv["nshards"],
            "files": inv["files"],
            "bytes": lsmbackup.total_bytes(inv),
            "backup": stamp + ".backup",
        }
        client.put_object(
            Bucket=c["bucket"],
            Key=base + "manifest.json",
            Body=json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        )
        return _ok(
            "Бекъп %s: %d файла, %s"
            % (stamp, len(inv["files"]), human_size(manifest["bytes"])),
            stamp=stamp,
            files=len(inv["files"]),
            bytes=manifest["bytes"],
        )
    except Exception as e:
        return _json_error(str(e))
    finally:
        remove_staging(staging, names)


@app.post("/s3/list")
def s3_list():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    try:
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        resp = client.list_objects_v2(Bucket=c["bucket"], Prefix=c["prefix"])
        found = {}
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            if not key.startswith(c["prefix"]):
                continue
            parts = key[len(c["prefix"]) :].split("/")
            if len(parts) != 2 or parts[1] != "manifest.json":
                continue
            body = client.get_object(Bucket=c["bucket"], Key=key)["Body"].read()
            try:
                man = json.loads(body.decode("utf-8"))
            except ValueError:
                continue
            found[parts[0]] = (obj["LastModified"].strftime("%Y-%m-%d %H:%M:%S"), man)
        items = []
        for stamp, (last_modified, man) in found.items():
            size = man.get("bytes") or 0
            items.append(
                {
                    "stamp": stamp,
                    "key": c["prefix"] + stamp + "/manifest.json",
                    "filename": stamp,
                    "size": size,
                    "size_human": human_size(size),
                    "files": len(man.get("files") or []),
                    "created_ms": man.get("created_ms") or 0,
                    "last_modified": last_modified,
                }
            )
        items.sort(key=lambda x: x["last_modified"], reverse=True)
        return jsonify({"success": True, "message": "ok", "items": items, "count": len(items)})
    except Exception as e:
        return _json_error(str(e))


@app.post("/s3/restore")
def s3_restore():
    """Сваля файловете на бекъп в споделената директория.

    Възстановяването е файлово: rocksbaga се пуска с LSMPATH, сочеща към
    директорията на бекъпа — LSM форматът е самоописен.
    """
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    stamp = (data.get("stamp") or "").strip()
    if not stamp or stamp.startswith("/") or ".." in stamp:
        return _json_error("невалиден stamp")
    staging = backup_staging()
    dest = os.path.join(staging, stamp)
    base = s3_prefix(c, stamp)
    try:
        os.makedirs(staging, exist_ok=True)
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        resp = client.list_objects_v2(Bucket=c["bucket"], Prefix=base)
        objs = resp.get("Contents", [])
        if not objs:
            return _json_error("няма бекъп %s" % stamp)
        for obj in objs:
            name = obj["Key"][len(base) :]
            if not name or name.endswith("/") or name == "manifest.json":
                continue
            client.download_file(c["bucket"], obj["Key"], os.path.join(staging, name))
        with open(dest + ".backup", "r", encoding="utf-8") as f:
            inv = lsmbackup.parse_inventory(f.read(), dest)
        bad = lsmbackup.missing(inv, staging)
        if bad:
            return _json_error("липсват или повредени файлове: %s" % ", ".join(bad))
        return _ok(
            "Файловете са в %s — пусни rocksbaga с LSMPATH=%s" % (dest, dest),
            stamp=stamp,
            path=dest,
        )
    except Exception as e:
        return _json_error(str(e))


@app.post("/s3/delete")
def s3_delete():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    stamp = (data.get("stamp") or "").strip()
    if not stamp or stamp.startswith("/") or ".." in stamp:
        return _json_error("невалиден stamp")
    base = s3_prefix(c, stamp)
    try:
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        resp = client.list_objects_v2(Bucket=c["bucket"], Prefix=base)
        objs = resp.get("Contents", [])
        if not objs:
            return _json_error("няма бекъп %s" % stamp)
        client.delete_objects(
            Bucket=c["bucket"],
            Delete={"Objects": [{"Key": o["Key"]} for o in objs]},
        )
        return _ok("Бекъпът %s е изтрит (%d обекта)" % (stamp, len(objs)))
    except Exception as e:
        return _json_error(str(e))

@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print(f"buchnative sidecar SMTP+S3+backup on 127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
