export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const match = pathname.match(/^\/t\/([^/]+)$/i);

    if (match) {
      const token = decodeURIComponent(match[1]);
      const customerUrl = new URL("/customer/index.html", url);
      const assetResponse = await env.ASSETS.fetch(new Request(customerUrl, request));

      if (!assetResponse.ok) return assetResponse;

      const html = await assetResponse.text();
      const tokenScript = `<script>window.__ORDELI_TRACKING_TOKEN=${JSON.stringify(token)};</script>`;
      const patchedHtml = html.replace(/<\/head>/i, `${tokenScript}</head>`);

      const headers = new Headers(assetResponse.headers);
      headers.set("content-type", "text/html; charset=UTF-8");
      headers.set("cache-control", "no-store");

      return new Response(patchedHtml, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
