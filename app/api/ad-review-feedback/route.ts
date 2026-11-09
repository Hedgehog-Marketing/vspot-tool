import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 200_000;
const ALLOWED_BOARDS = new Set(["ad-review"]);
const VERDICT_ICON: Record<string, string> = { keep: "✅", revise: "✏️", kill: "🛑" };

type Item = {
  id?: string;
  name?: string;
  phase?: string;
  verdict?: string;
  abPreference?: string;
  note?: string;
};

const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const slackEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function slackText(p: {
  campaign: string;
  business: string;
  reviewer: string;
  items: Item[];
}) {
  const counts: Record<string, number> = {};
  for (const i of p.items) {
    const v = (i.verdict || "no verdict").toLowerCase();
    counts[v] = (counts[v] || 0) + 1;
  }
  const summary = Object.entries(counts)
    .map(([v, n]) => `${n} ${v}`)
    .join(" · ");
  const lines = p.items.slice(0, 60).map((i) => {
    const icon = VERDICT_ICON[(i.verdict || "").toLowerCase()] || "•";
    const ab = i.abPreference ? ` (prefers ${i.abPreference})` : "";
    const note = i.note ? `\n    > ${i.note.replace(/\n+/g, " ")}` : "";
    return `${icon} *${i.name || i.id}*${ab}${note}`;
  });
  const text = [
    `*Ad review feedback: ${p.business || p.campaign}*`,
    `From ${p.reviewer || "unnamed reviewer"} · ${summary || "no items"}`,
    "",
    ...lines,
  ].join("\n");
  return slackEscape(text).replace(/&gt; /g, "> ").slice(0, 38_000);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!ALLOWED_BOARDS.has(String(body.board)) || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Unrecognised payload." }, { status: 400 });
  }

  const items: Item[] = (body.items as Item[]).slice(0, 200).map((i) => ({
    id: clip(i.id, 80),
    name: clip(i.name, 200),
    phase: clip(i.phase, 80),
    verdict: clip(i.verdict, 20),
    abPreference: clip(i.abPreference, 5),
    note: clip(i.note, 2000),
  }));
  const meta = {
    campaign: clip(body.campaign, 120),
    business: clip(body.business, 120),
    reviewer: clip(body.reviewer, 120),
  };

  const slackUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!slackUrl && !(sbUrl && sbKey)) {
    return NextResponse.json({ error: "Feedback storage not configured." }, { status: 500 });
  }

  const jobs: Promise<boolean>[] = [];

  if (sbUrl && sbKey) {
    jobs.push(
      fetch(`${sbUrl}/rest/v1/ad_review_feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          ...meta,
          payload: { ...body, ...meta, items },
        }),
      })
        .then((r) => r.ok)
        .catch(() => false)
    );
  }

  if (slackUrl) {
    jobs.push(
      fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackText({ ...meta, items }) }),
      })
        .then((r) => r.ok)
        .catch(() => false)
    );
  }

  const results = await Promise.all(jobs);
  // Succeed if at least one destination received it, so the reviewer isn't told "Failed" when it landed.
  if (!results.some(Boolean)) {
    return NextResponse.json({ error: "Could not save feedback." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
