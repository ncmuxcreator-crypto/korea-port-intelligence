function localStaticPath(path) {
  return path.replace(/^\/api\//, "./api/").replace(/\?.*$/, "");
}

function debugStaticPath(path) {
  return path.replace(/^\/api\//, "./api/debug/").replace(/\?.*$/, "");
}

const PRODUCTION_API_ORIGIN = "https://hwk-port-intelligence.giwon48.workers.dev";

function isLocalPreview() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname) ||
    window.location.protocol === "file:";
}

function productionApiPath(path) {
  if (!isLocalPreview() || !String(path).startsWith("/api/")) return null;
  return `${PRODUCTION_API_ORIGIN}${path}`;
}

async function fetchJson(url, timeoutMs = 3500) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return { ok: true, data: await response.json(), ms: Math.round(performance.now() - started), url };
  } catch (error) {
    return { ok: false, data: null, ms: Math.round(performance.now() - started), url, error: error?.message || "error" };
  } finally {
    clearTimeout(timer);
  }
}

export function apiFactory(state) {
  return async function api(name, path, timeoutMs = 3500) {
    const urls = [productionApiPath(path), path, localStaticPath(path), debugStaticPath(path)].filter((value, index, all) => value && all.indexOf(value) === index);
    let last = null;
    for (const url of urls) {
      last = await fetchJson(url, timeoutMs);
      if (last.ok) {
        state.latency[name] = last;
        return last.data;
      }
    }
    state.latency[name] = last || { ok: false, ms: timeoutMs, url: path };
    return null;
  };
}
