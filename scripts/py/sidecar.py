#!/usr/bin/env python3
"""buchnative helpers: SMTP + S3. Flask on 127.0.0.1:5050.

Baga talks HTTP here (no process spawn). Same idea as su-doxis:
smtp_service.py + s3_backup.py, one process.

S3 backup is a logical dump, chosen by ORM_BACKEND: rocksbaga (drock) минава
през kvdump.py (RESP2 SCAN + JSON lines), Postgres/boilaDB — през dump.py
(COPY TO STDOUT). Не е tar на живи LSM файлове.
"""

from __future__ import annotations

import os
import smtplib
import ssl
import tempfile
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Flask, jsonify, request

import kvdump
from dump import dump_to_path, pg_cfg

def is_kv_backend() -> bool:
    be = (os.environ.get("ORM_BACKEND") or "").lower()
    return be.startswith("drock") or be.startswith("rocks")


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


@app.post("/s3/backup")
def s3_backup():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    kv = is_kv_backend()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ext = "json.gz" if kv else "sql.gz"
    filename = f"buchnative_backup_{stamp}.{ext}"
    s3_key = f"{c['prefix']}{filename}"
    tmp = ""
    try:
        fd, tmp = tempfile.mkstemp(suffix="." + ext)
        os.close(fd)
        if kv:
            st = kvdump.dump_to_path(kvdump.kv_cfg(data), tmp)
            note = f"{st['keys']} ключа, dump през rocksbaga SCAN"
            kind = "kv"
        else:
            st = dump_to_path(pg_cfg(data), tmp)
            note = f"{st.get('tables') or 0} таблици, dump през boilaDB COPY"
            kind = "copy"
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        client.upload_file(tmp, c["bucket"], s3_key)
        n = st.get("tables") or 0
        return _ok(
            f"Бекъп създаден: {filename} ({note})",
            filename=filename,
            s3_key=s3_key,
            size=st.get("size") or 0,
            tables=n,
            kind=kind,
        )
    except Exception as e:
        return _json_error(str(e))
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


@app.post("/s3/list")
def s3_list():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    if not c["bucket"]:
        return _json_error("S3 bucket е задължителен")
    try:
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        resp = client.list_objects_v2(Bucket=c["bucket"], Prefix=c["prefix"])
        items = []
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            filename = key[len(c["prefix"]) :] if key.startswith(c["prefix"]) else key
            if "buchnative_backup" not in filename:
                continue
            size = obj["Size"]
            items.append(
                {
                    "key": key,
                    "filename": filename,
                    "size": size,
                    "size_human": (
                        f"{size / 1024:.1f} KB"
                        if size < 1048576
                        else f"{size / 1048576:.1f} MB"
                    ),
                    "last_modified": obj["LastModified"].strftime("%Y-%m-%d %H:%M:%S"),
                }
            )
        items.sort(key=lambda x: x["last_modified"], reverse=True)
        return jsonify({"success": True, "message": "ok", "items": items, "count": len(items)})
    except Exception as e:
        return _json_error(str(e))


@app.post("/s3/delete")
def s3_delete():
    data = request.get_json(silent=True) or {}
    c = s3_cfg(data)
    key = data.get("s3_key") or ""
    if not key:
        return _json_error("s3_key е задължителен")
    try:
        client = s3_client(c["endpoint"], c["access_key"], c["secret_key"], c["region"])
        client.delete_object(Bucket=c["bucket"], Key=key)
        return _ok("Бекъпът е изтрит")
    except Exception as e:
        return _json_error(str(e))


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print(f"buchnative sidecar SMTP+S3+dump on 127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
