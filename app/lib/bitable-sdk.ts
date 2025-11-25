/**
 * Lightweight wrapper to access the Feishu Bitable JS SDK when inside the dashboard iframe.
 * Falls back to injecting the public CDN script when running locally/outside Feishu.
 */
export async function loadBitable() {
  if (typeof window === "undefined") {
    return null;
  }

  const w = window as any;
  if (w.bitable) return w.bitable;
  if (w.lark?.base?.bitable) return w.lark.base.bitable;

  // Try load from public CDN for local dev preview. If it fails, return null and caller will use mock data.
  try {
    await injectScript(
      "https://lf3-static.bytednsdoc.com/obj/bitable-static/feishu-bitable-js-sdk/bitable.js"
    );
    return (window as any).bitable ?? null;
  } catch (err) {
    console.warn("Failed to load remote bitable sdk", err);
    return null;
  }
}

function injectScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.body.appendChild(script);
  });
}
