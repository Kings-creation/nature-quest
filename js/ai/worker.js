// Model worker. The model runs here, off the main thread, so the interface never freezes and the page
// can kill a stuck run by terminating this worker.
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
let tf = null, gen = null, stop = null, extractor = null;
const say = m => postMessage(m);

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      say({ type: "phase", phase: "library" });
      tf ||= await import(LIB);
      say({ type: "phase", phase: "library-ok" });
      tf.env.allowLocalModels = false; tf.env.useBrowserCache = true; tf.env.backends.onnx.wasm.numThreads = 1;
      const files = new Map();
      say({ type: "phase", phase: "model-" + data.device });
      gen = await tf.pipeline("text-generation", data.model, {
        dtype: data.dtype, device: data.device,
        progress_callback: e => {
          if (e.status === "progress" && e.total) { files.set(e.file, { l: e.loaded, t: e.total }); let l = 0, t = 0; files.forEach(v => { l += v.l; t += v.t; }); say({ type: "progress", pct: Math.min(99, Math.round((l / t) * 100)) }); }
          else if (e.status === "ready") say({ type: "phase", phase: "session-ok" });
        }
      });
      say({ type: "loaded" });
    } else if (data.type === "embed-load") {
      say({ type: "phase", phase: "library" }); tf ||= await import(LIB);
      tf.env.allowLocalModels = false; tf.env.useBrowserCache = true; tf.env.backends.onnx.wasm.numThreads = 1;
      const files = new Map(); say({ type: "phase", phase: "model" });
      extractor = await tf.pipeline("feature-extraction", data.model, { dtype: data.dtype, device: "wasm", progress_callback: e => {
        if (e.status === "progress" && e.total) { files.set(e.file, { l: e.loaded, t: e.total }); let l = 0, t = 0; files.forEach(v => { l += v.l; t += v.t; }); say({ type: "progress", pct: Math.min(99, Math.round((l / t) * 100)) }); } } });
      say({ type: "loaded" });
    } else if (data.type === "embed") {
      const out = await extractor(data.texts, { pooling: "mean", normalize: true });
      say({ type: "embedded", vectors: out.tolist() });
    } else if (data.type === "generate") {
      stop = new tf.InterruptableStoppingCriteria();
      const streamer = new tf.TextStreamer(gen.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: t => say({ type: "token", text: t }) });
      const out = await gen(data.messages, { max_new_tokens: data.maxTokens, do_sample: true, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1, stopping_criteria: stop, streamer });
      const t = out?.[0]?.generated_text;
      say({ type: "done", text: Array.isArray(t) ? t.at(-1).content : String(t || "") });
    } else if (data.type === "interrupt") stop?.interrupt();
  } catch (e) { say({ type: "error", message: String(e?.message || e) }); }
};
