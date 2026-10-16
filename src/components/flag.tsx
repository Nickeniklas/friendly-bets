import Image from "next/image";
import { TEAM_FLAG_CODES } from "@/lib/flags";
import { teamLogo } from "@/lib/team-logos";

// A team's mark next to its name: the country flag for national teams
// (TEAM_FLAG_CODES), else the club logo for this competition (teamLogo(), e.g.
// Liiga / NHL teams — scoped per competition so leagues can't collide on a
// name), else nothing — e.g. knockout placeholder names like "1A" or "W74" — rather than
// a broken image.
export function Flag({
  team,
  competition,
  width = 20,
  className = "",
}: {
  team: string;
  /** competitions.id — which league's logo map to look the team up in. */
  competition: string;
  width?: number;
  className?: string;
}) {
  const code = TEAM_FLAG_CODES[team];
  if (code) {
    return (
      // Next's image optimizer refuses SVGs by default (XSS risk for
      // *untrusted* SVGs). Ours are static, vetted files from the flag-icons
      // package, and being vector there's nothing to optimize anyway, so we
      // opt out of the optimizer entirely.
      <Image
        src={`/flags/${code}.svg`}
        alt=""
        width={width}
        height={Math.round(width * 0.75)}
        unoptimized
        className={`inline-block rounded-sm ${className}`}
      />
    );
  }

  const logo = teamLogo(competition, team);
  if (!logo) return null;

  // Logos aren't 4:3 like flags, so they get a square box with object-contain.
  // The box size is set inline because Tailwind's preflight forces
  // `img { height: auto }` on the image. They're large rasters (up to
  // ~1500px), so unlike the flags we DO let the image optimizer resize them —
  // except SVGs (the NHL logos), which it refuses and which need no resizing.
  //
  // `backing`: in dark mode the box becomes a near-white circle (with a little
  // padding so the logo sits inside it), because several clubs' logos are
  // black/dark (e.g. TPS) and would vanish on the dark card background. Light
  // mode needs no backing, and neither does a team's dedicated dark-background
  // variant (Lukko's gold logo, every NHL team's `darkLogo`) — that variant is
  // already drawn for a dark background.
  const DARK_BACKING = "dark:rounded-full dark:bg-[oklch(0.95_0.005_250)] dark:p-[3px]";
  const logoImage = (src: string, themeClass: string, backing: boolean) => (
    <span
      style={{ width, height: width }}
      className={`${themeClass} shrink-0 items-center justify-center ${backing ? DARK_BACKING : ""} ${className}`}
    >
      <Image
        src={src}
        alt=""
        width={width}
        height={width}
        unoptimized={src.endsWith(".svg")}
        className="h-full w-full object-contain"
      />
    </span>
  );

  if (!logo.dark) return logoImage(logo.light, "inline-flex", true);

  // Team has a separate dark-background variant: render both and let the
  // app's `.dark` class on <html> (Tailwind's `dark:` variant, see
  // globals.css) pick one. Pure CSS, so there's no hydration mismatch and it
  // flips instantly with the theme toggle.
  return (
    <>
      {logoImage(logo.light, "inline-flex dark:hidden", false)}
      {logoImage(logo.dark, "hidden dark:inline-flex", false)}
    </>
  );
}
