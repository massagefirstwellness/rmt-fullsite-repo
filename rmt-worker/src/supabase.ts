import type { Env } from "./auth";

export function supabaseClient(env: Env) {
  const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/";
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };

  async function request(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: method === "GET" ? headers : { ...headers, Prefer: "return=representation" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status} ${text}`);
    return text ? JSON.parse(text) : [];
  }

  return {
    select: (table: string, query = "") => request("GET", `${table}${query ? "?" + query : ""}`),
    insert: (table: string, row: unknown) => request("POST", table, row),
    update: (table: string, filter: string, row: unknown) => request("PATCH", `${table}?${filter}`, row),
    remove: (table: string, filter: string) => request("DELETE", `${table}?${filter}`),
  };
}
