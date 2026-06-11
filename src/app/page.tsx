import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-semibold">Friendly Bets</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          World Cup 2026 prediction game for family &amp; friends.
        </p>
        <Link
          href="/login"
          className="rounded bg-foreground px-4 py-2 text-background"
        >
          Log in
        </Link>
      </div>
    );
  }

  // The profiles row is created automatically by the handle_new_user DB trigger.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, points_balance")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Friendly Bets</h1>
      <p>
        Welcome, {profile?.display_name ?? user.email}! Balance:{" "}
        {profile?.points_balance ?? "—"} points.
      </p>
      <form action={signOut}>
        <button className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-700">
          Sign out
        </button>
      </form>
    </div>
  );
}
