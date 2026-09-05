import jwt from "@tsndr/cloudflare-worker-jwt";
import type { Context, Next } from "hono";

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_PAGES_PROJECT: string;
};

/**
 * Verifies the Supabase Auth access token sent by the logged-in browser
 * (Authorization: Bearer <token>). This is the ONLY place a token from the
 * browser is trusted — everything downstream uses the service-role key,
 * which lives only in this Worker's secrets.
 */
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "Missing Authorization header" }, 401);

  const valid = await jwt.verify(token, c.env.SUPABASE_JWT_SECRET);
  if (!valid) return c.json({ error: "Invalid or expired token" }, 401);

  const { payload } = jwt.decode(token);
  c.set("userId" as never, payload.sub as never);
  c.set("userEmail" as never, (payload as { email?: string }).email as never);
  await next();
}
