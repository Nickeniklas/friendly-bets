import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers.
 *
 * `cookies()` is async in Next.js and read-only when called from a Server
 * Component (rendering a page can't set response cookies). The `setAll`
 * below is wrapped in try/catch so this helper works in that read-only
 * context too — when that happens, `proxy.ts` is responsible for
 * refreshing the session cookie on the next request instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore (see above).
          }
        },
      },
    }
  );
}
