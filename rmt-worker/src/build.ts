import type { Env } from "./auth";
import { supabaseClient } from "./supabase";
import { generateSite, type BuildOpts } from "./renderer";

/**
 * Pulls every content table for the (single) clinic, renders the full
 * static site with the ported generator, then pushes each file to
 * Cloudflare Pages via the Direct Upload API.
 */
export async function buildSite(env: Env) {
  const db = supabaseClient(env);

  const [profile] = await db.select("rmt_profile", "select=*&limit=1");
  if (!profile) return { ok: false, error: "No rmt_profile row found." };

  const [services, conditions, testimonials, faqs, posts] = await Promise.all([
    db.select("services", "select=*&is_published=eq.true&order=display_order.asc"),
    db.select("conditions_treated", "select=*&is_published=eq.true&order=display_order.asc"),
    db.select("testimonials", "select=*&is_published=eq.true&order=created_at.desc"),
    db.select("faqs", "select=*&is_published=eq.true&order=display_order.asc"),
    db.select("blog_posts", "select=*&is_published=eq.true&order=published_at.desc"),
  ]);

  const buildOpts: BuildOpts = { theme: profile.theme || "sage", layout: profile.layout || "split" };

  const files = generateSite(
    { rmt: profile, services, conditions, testimonials, faqs, posts },
    buildOpts
  );

  const deployResult = await deployToPages(env, files);

  return {
    ok: true,
    clinic: profile.slug,
    filesGenerated: files.size,
    deployment: deployResult,
    counts: {
      services: services.length,
      conditions: conditions.length,
      testimonials: testimonials.length,
      faqs: faqs.length,
      posts: posts.length,
    },
  };
}

/**
 * Pushes generated files to a Cloudflare Pages "direct upload" project.
 *
 * Cloudflare's real Direct Upload flow is two calls:
 *   1. POST .../deployments/upload-token  -> short-lived signed JWT scoped
 *      to this Pages project's asset storage.
 *   2. Upload each file's content (as base64 + sha256 hash) to
 *      https://api.cloudflare.com/client/v4/pages/upload using that JWT,
 *      building a manifest of {path: hash}.
 *   3. POST .../deployments with the manifest to actually create the
 *      deployment that serves those uploaded assets.
 * This is more involved than a single fetch — implemented below following
 * Cloudflare's documented flow. Test it against a real "direct upload"
 * Pages project (created via `wrangler pages project create --production-branch main`
 * with no build config) before relying on it, since asset-hashing APIs
 * are easy to get subtly wrong and I can't hit the live API from here to verify.
 * Docs: https://developers.cloudflare.com/pages/configuration/direct-upload/
 */
async function deployToPages(env: Env, files: Map<string, string>) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${env.CF_PAGES_PROJECT}`;
  const headers = { Authorization: `Bearer ${env.CF_API_TOKEN}` };

  // 1. Get an upload JWT scoped to this project's asset storage.
  const tokenRes = await fetch(`${base}/upload-token`, { headers });
  const tokenJson = await tokenRes.json<{ result: { jwt: string } }>();
  if (!tokenRes.ok) throw new Error(`upload-token failed: ${JSON.stringify(tokenJson)}`);
  const uploadJwt = tokenJson.result.jwt;

  // 2. Hash + upload each file, building the manifest Cloudflare expects.
  const manifest: Record<string, string> = {};
  const payload: { key: string; value: string; base64: boolean; metadata: { contentType: string } }[] = [];

  for (const [path, content] of files) {
    const hash = await sha256Hex(content);
    manifest["/" + path] = hash;
    payload.push({
      key: hash,
      value: btoa(unescape(encodeURIComponent(content))),
      base64: true,
      metadata: { contentType: guessContentType(path) },
    });
  }

  // Cloudflare's upload endpoint accepts batches; keep it simple and send
  // one request per ~50 files to stay well under payload/size limits.
  const BATCH = 50;
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH);
    const uploadRes = await fetch("https://api.cloudflare.com/client/v4/pages/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!uploadRes.ok) throw new Error(`asset upload batch failed: ${await uploadRes.text()}`);
  }

  // 3. Create the deployment referencing the manifest of uploaded assets.
  const deployRes = await fetch(`${base}/deployments`, {
    method: "POST",
    headers,
    body: (() => {
      const form = new FormData();
      form.append("manifest", JSON.stringify(manifest));
      return form;
    })(),
  });
  const deployJson = await deployRes.json();
  if (!deployRes.ok) throw new Error(`deployment create failed: ${JSON.stringify(deployJson)}`);
  return deployJson;
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function guessContentType(path: string) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".xml")) return "application/xml";
  if (path.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
