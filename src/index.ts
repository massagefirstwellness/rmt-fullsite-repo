import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth, type Env } from "./auth";
import { supabaseClient } from "./supabase";
import { buildSite } from "./build";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*" /* tighten to your Pages domain in production */ }));

// ---- Public ----
app.get("/api/health", (c) => c.json({ ok: true }));

// ---- Everything below requires a valid Supabase login (single admin) ----
app.use("/api/*", requireAuth);

// The one clinic profile
app.get("/api/profile", async (c) => {
  const db = supabaseClient(c.env);
  const rows = await db.select("rmt_profile", "select=*&limit=1");
  return c.json(rows[0] ?? null);
});

app.patch("/api/profile/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const db = supabaseClient(c.env);
  const rows = await db.update("rmt_profile", `id=eq.${id}`, body);
  return c.json(rows[0] ?? null);
});

// Generic CRUD factory for the content tables that hang off rmt_id
const CONTENT_TABLES = ["services", "conditions_treated", "testimonials", "faqs", "blog_posts"] as const;

for (const table of CONTENT_TABLES) {
  app.get(`/api/${table}`, async (c) => {
    const db = supabaseClient(c.env);
    const order = table === "testimonials" || table === "blog_posts" ? "created_at.desc" : "display_order.asc";
    return c.json(await db.select(table, `select=*&order=${order}`));
  });

  app.post(`/api/${table}`, async (c) => {
    const body = await c.req.json();
    const db = supabaseClient(c.env);
    const rows = await db.insert(table, body);
    return c.json(rows[0] ?? null);
  });

  app.patch(`/api/${table}/:id`, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const db = supabaseClient(c.env);
    const rows = await db.update(table, `id=eq.${id}`, body);
    return c.json(rows[0] ?? null);
  });

  app.delete(`/api/${table}/:id`, async (c) => {
    const id = c.req.param("id");
    const db = supabaseClient(c.env);
    await db.remove(table, `id=eq.${id}`);
    return c.json({ ok: true });
  });
}

// Server-side "Build" — ports rmt-site-builder's render functions to run
// here, pulling straight from the tables above, and pushes the output to
// Cloudflare Pages instead of offering a zip download.
app.post("/api/build", async (c) => {
  const result = await buildSite(c.env);
  return c.json(result);
});

export default app;
