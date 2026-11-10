import { redirect } from "next/navigation";

// The home page is just an entry point: send everyone to /matches. (The old
// welcome page showed profiles.points_balance, a cross-competition total, while
// every other page shows per-competition points.)
export default function Home() {
  redirect("/matches");
}
