// Local server provider: any OpenAI-compatible endpoint the person runs themselves
// (Ollama, LM Studio, llama.cpp server). This is how a big open model such as gpt-oss-20b
// powers Nature Quest from a laptop or PC, with no paid API and no data leaving their network.
export const ENDPOINT_DEFAULTS = { baseUrl: "http://localhost:11434/v1", model: "gpt-oss:20b" };

export function createEndpointProvider(cfg = {}) {
  const baseUrl = String(cfg.baseUrl || ENDPOINT_DEFAULTS.baseUrl).replace(/\/+$/, "");
  const model = cfg.model || ENDPOINT_DEFAULTS.model;
  const fetchJson = async (path, init, timeoutMs, signal) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort(); signal?.addEventListener("abort", onAbort);
    try {
      const r = await fetch(baseUrl + path, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error("endpoint-" + r.status);
      return await r.json();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  };
  return {
    id: "endpoint", label: model, license: "open-weight (served locally)", approxMB: 0,
    async load() { await fetchJson("/models", { method: "GET" }, 5000); }, // reachability check only
    isLoaded: () => true,
    async complete(messages, { maxTokens = 400, timeoutMs = 90000, signal } = {}) { // no streaming: the whole reply arrives at once
      const j = await fetchJson("/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7, stream: false }) }, timeoutMs, signal);
      const c = j?.choices?.[0]?.message?.content;
      if (typeof c !== "string" || !c.trim()) throw new Error("empty-completion");
      return c;
    },
    async unload() {}
  };
}
