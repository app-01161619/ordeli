const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://kbgdxhshxkhuelbxlggc.supabase.co; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self' https://kbgdxhshxkhuelbxlggc.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; img-src 'self' data: blob: https://kbgdxhshxkhuelbxlggc.supabase.co; media-src 'self' blob: https://kbgdxhshxkhuelbxlggc.supabase.co; style-src 'self'; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:;"
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const match = pathname.match(/^\/t\/([^/]+)$/i);

    if (match) {
      const token = decodeURIComponent(match[1]);
      const customerUrl = new URL("/customer/", url);
      customerUrl.searchParams.set("token", token);
      return Response.redirect(customerUrl.toString(), 302);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    const pathname = new URL(request.url).pathname;
    if (pathname === "/" || pathname === "/index.html" || pathname === "/sw.js" || pathname === "/js/register-sw.js") {
      headers.set("Cache-Control", "no-store");
    }
    return withSecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  }
};
