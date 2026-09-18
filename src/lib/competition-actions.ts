"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COMPETITION_COOKIE } from "@/lib/competitions";

/**
 * Server Action behind the header's competition dropdown: remember the chosen
 * competition in a cookie. The caller then router.refresh()es so the current
 * page re-renders server-side with the new selection.
 *
 * Unknown ids are ignored (the cookie is left as-is), so a tampered form value
 * can't store junk — getSelectedCompetition() would ignore it anyway.
 */
export async function setSelectedCompetition(id: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return;

  const cookieStore = await cookies();
  cookieStore.set(COMPETITION_COOKIE, id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // a year — it's just a UI preference
    sameSite: "lax",
  });
}
