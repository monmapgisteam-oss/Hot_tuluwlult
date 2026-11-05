"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import LoginScreen, { type SessionUser } from "./LoginScreen";

// ArcGIS зөвхөн хөтөч дээр, нэвтэрсний дараа ачаална
const SuitabilityApp = dynamic(() => import("./SuitabilityApp"), {
  ssr: false,
  loading: () => <div className="boot">Газрын зураг ачаалж байна…</div>,
});

export default function ClientRoot() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me").then(async (r) => {
      const d = await r.json().catch(() => null);
      if (!live) return;
      if (r.ok && d?.user) setUser(d.user);
      else if (r.status !== 401) setNotice(d?.error ?? "Нэвтрэлт шалгаж чадсангүй.");
    }).catch(() => { if (live) setNotice("Сервертэй холбогдож чадсангүй."); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);

  const signOut = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setNotice(null);
    setUser(null);
  }, []);
  const expired = useCallback(() => {
    setNotice("Нэвтрэлтийн хугацаа дууссан. Дахин нэвтэрнэ үү.");
    setUser(null);
  }, []);
  const onLogin = useCallback((u: SessionUser) => { setNotice(null); setUser(u); }, []);

  if (checking) return <div className="login" aria-busy="true" />;
  if (!user) return <LoginScreen notice={notice} onLogin={onLogin} />;
  return <SuitabilityApp user={user} onSignOut={signOut} onExpired={expired} />;
}
