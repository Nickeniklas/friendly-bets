import { signInWithMagicLink } from "./actions";
import { SubmitButton } from "./submit-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { message, error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <form
        action={signInWithMagicLink}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Enter your email and we&apos;ll send you a magic link to sign in.
          No password needed.
        </p>

        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-black"
        />

        <SubmitButton />

        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Tip: the login email sometimes lands in spam or trash, especially
          the first time. If you don&apos;t see it in your inbox within a
          minute, check there.
        </p>
      </form>
    </div>
  );
}
