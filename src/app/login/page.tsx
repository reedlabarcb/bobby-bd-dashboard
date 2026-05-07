"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Use location.assign so the cookie is sent on the next navigation.
        window.location.assign(next.startsWith("/") ? next : "/");
        return;
      }
      if (res.status === 503) {
        setError(
          "Auth isn't configured on this server. Set APP_PASSWORD and AUTH_SECRET."
        );
      } else {
        setError("Wrong password.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-8 w-full max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight">
        <span className="text-primary">Bobby</span>
        <span className="text-muted-foreground ml-1 font-normal text-sm">
          BD Dashboard
        </span>
      </h1>
      <p className="text-sm text-muted-foreground mt-2 mb-6">
        Sign in to continue
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting || !password} className="w-full">
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-6 bg-background">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
