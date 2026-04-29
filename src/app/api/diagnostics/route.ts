import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

type Status = { ok: boolean; msg: string; detail?: string };

async function checkAnthropic(): Promise<Status> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, msg: "ANTHROPIC_API_KEY not set" };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Cheapest possible call: tiny model, 5 tokens. Validates auth + billing.
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, msg: "live", detail: `model=${res.model}` };
  } catch (e) {
    return { ok: false, msg: "auth/billing failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkApollo(): Promise<Status> {
  if (!process.env.APOLLO_API_KEY) return { ok: false, msg: "APOLLO_API_KEY not set" };
  try {
    // Apollo's auth_check returns user + plan. No credit cost.
    const res = await fetch("https://api.apollo.io/v1/auth/health", {
      method: "GET",
      headers: { "X-Api-Key": process.env.APOLLO_API_KEY },
    });
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}`, detail: await res.text().catch(() => "") };
    const data = await res.json();
    return { ok: true, msg: "live", detail: data.is_logged_in === false ? "but is_logged_in=false" : "authenticated" };
  } catch (e) {
    return { ok: false, msg: "request failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkHunter(): Promise<Status> {
  if (!process.env.HUNTER_API_KEY) return { ok: false, msg: "HUNTER_API_KEY not set" };
  try {
    // Hunter's account endpoint returns plan + remaining credits. No search cost.
    const res = await fetch(
      `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(process.env.HUNTER_API_KEY)}`,
    );
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}`, detail: await res.text().catch(() => "") };
    const data = await res.json();
    const plan = data.data?.plan_name || "unknown plan";
    const usedSearches = data.data?.requests?.searches?.used ?? "?";
    const availSearches = data.data?.requests?.searches?.available ?? "?";
    return {
      ok: true,
      msg: `live · ${plan}`,
      detail: `searches: ${usedSearches}/${availSearches}`,
    };
  } catch (e) {
    return { ok: false, msg: "request failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const [anthropic, apollo, hunter] = await Promise.all([
    checkAnthropic(),
    checkApollo(),
    checkHunter(),
  ]);
  return NextResponse.json({
    anthropic,
    apollo,
    hunter,
    env: {
      uploadSecretSet: !!process.env.UPLOAD_SECRET,
      dbPath: process.env.DB_PATH || "(default)",
    },
  });
}
