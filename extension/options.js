const fields = ["jevKey", "nifptKey"];

chrome.storage.local.get(fields).then((v) => fields.forEach((f) => (document.getElementById(f).value = v[f] ?? "")));

document.getElementById("save").addEventListener("click", async () => {
  // Accept a pasted .env line ("TYPESAFE_API_KEY=sk-or-…") by keeping only what follows "=".
  const clean = (v) => v.trim().replace(/^[A-Z_]+=/, "").replace(/^["']|["']$/g, "");
  const values = Object.fromEntries(fields.map((f) => [f, clean(document.getElementById(f).value)]));
  await chrome.storage.local.set(values);
  // OpenRouter keys are sk-or-v1- + 64 hex; a short one is usually a copy that lost a character.
  const k = values.jevKey;
  const bad = k.startsWith("sk-or-") && !/^sk-or-v1-[0-9a-f]{64}$/.test(k);
  document.getElementById("saved").textContent = bad
    ? `Saved, but this doesn't look like a complete OpenRouter key (${k.length} characters, expected 73).`
    : "Saved";
});
