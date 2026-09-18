import Image from "next/image";
import { TEAM_FLAG_CODES } from "@/lib/flags";
import { TEAM_LOGOS } from "@/lib/team-logos";

// A team's mark next to its name: the country flag for national teams
// (TEAM_FLAG_CODES), else the club logo (TEAM_LOGOS, e.g. Liiga teams), else
// nothing — e.g. knockout placeholder names like "1A" or "W74" — rather than
// a broken image.
export function Flag({
  team,
  width = 20,
  className = "",
}: {
  team: string;
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

  const logo = TEAM_LOGOS[team];
  if (!logo) return null;

  // Logos aren't 4:3 like flags, so they get a square box with object-contain.
  // The box size is set inline because Tailwind's preflight forces
  // `img { height: auto }` on the image. They're large rasters (up to
  // ~1500px), so unlike the flags we DO let the image optimizer resize them.
  //
  // `backing`: in dark mode the box becomes a near-white circle (with a little
  // padding so the logo sits inside it), because several clubs' logos are
  // black/dark (e.g. TPS) and would vanish on the dark card background. Light
  // mode needs no backing, and neither does a team's dedicated dark-background
  // variant (Lukko's gold logo would look washed out on a white circle).
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
