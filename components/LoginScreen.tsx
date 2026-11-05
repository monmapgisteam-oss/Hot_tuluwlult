"use client";
import { useState, type FormEvent } from "react";

export type SessionUser = { username: string; fullName: string };

export default function LoginScreen({ notice, onLogin }: { notice?: string | null; onLogin: (u: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) { setErr("Хэрэглэгчийн нэр, нууц үгээ оруулна уу."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.user) throw new Error(d?.error ?? "Нэвтрэлт амжилтгүй боллоо.");
      onLogin(d.user);
    } catch (ex) {
      const offline = ex instanceof TypeError; // сервер рүү хүрч чадсангүй
      setErr(offline ? "Сервертэй холбогдож чадсангүй." : (ex as Error).message);
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="loginCard" onSubmit={submit} noValidate>
        <h1>ХОТ ТӨЛӨВЛӨЛТИЙН СИСТЕМ</h1>
        <p className="loginSub">Нэвтрэх</p>
        {(err || notice) && <p className="loginErr" role="alert">{err ?? notice}</p>}
        <input aria-label="Хэрэглэгчийн нэр" placeholder="Хэрэглэгчийн нэр" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input aria-label="Нууц үг" placeholder="Нууц үг" name="password" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Нэвтэрч байна…" : "Нэвтрэх"}</button>
      </form>
    </main>
  );
}
