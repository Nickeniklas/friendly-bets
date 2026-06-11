import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands here when the user clicks the magic link in their email.
 *
 * With Supabase's *default* email template (no custom SMTP needed), the
 * link points at Supabase's own /auth/v1/verify endpoint, which verifies
 * the token server-side and redirects here with a `?code=...` param (PKCE
 * flow, the @supabase/ssr default). `exchangeCodeForSession` swaps that code
 * for a real session and the server client writes the session cookies onto
 * the redirect response.
 *
 * `token_hash`/`type` handling is also kept as a fallback for the
 * alternative setup where the email templates are customized (requires
 * custom SMTP) to link directly here with a token hash instead.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("That link is invalid or expired.")}`
  );
}
