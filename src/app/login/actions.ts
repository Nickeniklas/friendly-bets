"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sends a magic-link email. Supabase creates the user automatically the
 * first time they request a link — there's no separate "sign up" step.
 *
 * `emailRedirectTo` is where the link in that email points; it must be
 * added to the "Redirect URLs" allow-list in the Supabase Auth settings.
 */
export async function signInWithMagicLink(formData: FormData) {
  const email = formData.get("email") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    "/login?message=" +
      encodeURIComponent(
        "Check your email for a login link. Can't find it? Check your spam/junk folder — first-time emails from us often land there.",
      ),
  );
}
