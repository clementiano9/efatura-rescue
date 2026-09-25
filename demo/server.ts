import { decide, hasKey, loadInvoices } from "./jev.ts";
import { detailPage, resolvePage } from "./fixture.ts";

const DIR = import.meta.dir;
const pending = (await loadInvoices()).filter((i: any) => i.status === "P");
const byId = new Map(pending.map((i: any) => [String(i.id), i]));
const STATIC: Record<string, string> = {
  "/": `${DIR}/index.html`,
  "/app.js": `${DIR}/app.js`,
  "/logic.js": `${DIR}/../extension/lib/logic.js`,
};
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3210),
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    if (STATIC[pathname]) return new Response(Bun.file(STATIC[pathname]));
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (pathname === "/api/pending") return Response.json({ hasKey, invoices: pending });
    const m = pathname.match(/^\/api\/decide\/(\d+)$/);
    if (m && byId.has(m[1])) return Response.json(await decide(byId.get(m[1])));

    if (pathname.startsWith("/fixture/resolverListaPendenciasAdquirente")) {
      const lengths = url.searchParams.get("lengths")?.split(",").map(Number);
      return html(resolvePage(pending, lengths));
    }
    if (pathname === "/fixture/detalheDocumentoAdquirente.action") {
      const inv = byId.get(url.searchParams.get("idDocumento") ?? "");
      return inv ? html(detailPage(inv)) : new Response("Not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 e-Fatura Rescue demo on http://localhost:${server.port} (Jev key ${hasKey ? "✅ set" : "missing, cache only"})`);
console.log(`   Portal mock for the extension: http://localhost:${server.port}/fixture/resolverListaPendenciasAdquirenteForm.action`);
