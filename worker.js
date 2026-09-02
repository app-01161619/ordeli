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

    return env.ASSETS.fetch(request);
  }
};
