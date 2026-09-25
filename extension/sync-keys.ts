// Dev shortcut: copies the keys from demo/.env into extension/config.local.json (git-ignored),
// so the unpacked extension works without typing them into the options page.
// Run from the repo root: bun --env-file=demo/.env extension/sync-keys.ts
const jevKey = process.env.TYPESAFE_API_KEY ?? "";
const nifptKey = process.env.NIFPT_API_KEY ?? "";
await Bun.write(`${import.meta.dir}/config.local.json`, JSON.stringify({ jevKey, nifptKey }));
console.log(`✅ config.local.json written (Jev key ${jevKey ? "set" : "missing"}, nif.pt key ${nifptKey ? "set" : "missing"}). Reload the extension.`);
