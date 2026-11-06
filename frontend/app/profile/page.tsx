"use client";

// Профил на текущия потребител: име, парола, имейл.
// След смяна на парола/имейл се връща нов токен — запазваме го.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, setToken } from "../../lib/api";
import { useI18n } from "../../components/I18nProvider";
import { RequireAuth } from "../../components/RequireAuth";

interface Me {
  sub: string;
  id: number;
  email: string;
  name: string;
  is_super_admin: number;
  totp_enabled: number;
}

function ProfileInner() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const [name, setName] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [email, setEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await api.get<Me>("/v1/me");
      setMe(r);
      setName(r.name ?? "");
      setEmail(r.email ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body: Record<string, string>, okMsg: string) => {
    setBusy(path);
    setError("");
    setMsg("");
    try {
      const r = await api.post<{ access_token?: string }>(path, body);
      if (r.access_token) {
        setToken(r.access_token);
      }
      setMsg(okMsg);
      setCurPw("");
      setNewPw("");
      setNewPw2("");
      setEmailPw("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    void post("/v1/me/name", { name }, t("profile.name_saved"));
  };

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== newPw2) {
      setError(t("profile.password_mismatch"));
      return;
    }
    void post(
      "/v1/me/password",
      { current_password: curPw, new_password: newPw },
      t("profile.password_saved")
    );
  };

  const saveEmail = (e: FormEvent) => {
    e.preventDefault();
    void post(
      "/v1/me/email",
      { email, current_password: emailPw },
      t("profile.email_saved")
    );
  };

  if (!me) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("profile.title")}</h1>
      </div>
      {error && <div className="error-text">{error}</div>}
      {msg && <div className="success-text">{msg}</div>}

      <div className="card content" style={{ marginBottom: 18 }}>
        <h3 className="section-title">{t("profile.identity")}</h3>
        <p className="muted">
          {me.email}
          {me.is_super_admin === 1 ? ` · ${t("profile.super_admin")}` : ""}
          {me.totp_enabled === 1 ? ` · ${t("profile.totp_on")}` : ""}
        </p>
        <form onSubmit={saveName}>
          <div className="field">
            <label className="label">{t("profile.name")}</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy === "/v1/me/name"}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>

      <div className="card content" style={{ marginBottom: 18 }}>
        <h3 className="section-title">{t("profile.change_password")}</h3>
        <form onSubmit={savePassword}>
          <div className="field">
            <label className="label">{t("profile.current_password")}</label>
            <input
              className="input"
              type="password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">{t("profile.new_password")}</label>
            <input
              className="input"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">{t("profile.new_password_again")}</label>
            <input
              className="input"
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy === "/v1/me/password"}
            >
              {t("profile.change_password")}
            </button>
          </div>
        </form>
      </div>

      <div className="card content">
        <h3 className="section-title">{t("profile.change_email")}</h3>
        <form onSubmit={saveEmail}>
          <div className="field">
            <label className="label">{t("profile.email")}</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">{t("profile.current_password")}</label>
            <input
              className="input"
              type="password"
              value={emailPw}
              onChange={(e) => setEmailPw(e.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy === "/v1/me/email"}
            >
              {t("profile.change_email")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileInner />
    </RequireAuth>
  );
}
