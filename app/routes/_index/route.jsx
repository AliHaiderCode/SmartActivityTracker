import { redirect } from "react-router";

// The app has no marketing/login landing page — always send visitors to the
// embedded dashboard. Shopify's auth flow kicks in from /app when needed.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  throw redirect(search ? `/app?${search}` : "/app");
};
