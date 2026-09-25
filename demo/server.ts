import { decide, hasKey, loadInvoices } from "./jev.ts";

const invoices = await loadInvoices();
const pending = invoices.filter((i: any) => i.estadoDocumento === "P");
const byId = new Map(pending.map((i: any) => [String(i.idDocumento), i]));
const STATIC: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/logic.js": "logic.js" };

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3210),
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (STATIC[pathname]) return new Response(Bun.file(`${import.meta.dir}/${STATIC[pathname]}`));
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (pathname === "/api/pending") return Response.json({ hasKey, invoices: pending });
    const m = pathname.match(/^\/api\/decide\/(\d+)$/);
    if (m && byId.has(m[1])) return Response.json(await decide(byId.get(m[1])));
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 e-Fatura Rescue demo on http://localhost:${server.port} (Jev key ${hasKey ? "✅ set" : "missing, cache only"})`);
