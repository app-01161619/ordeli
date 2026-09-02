export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (/^\/t\/[^/]+$/i.test(url.pathname.replace(/\/+$/, ""))) {
      const customerUrl = new URL("/customer/index.html", url);
      return env.ASSETS.fetch(new Request(customerUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
