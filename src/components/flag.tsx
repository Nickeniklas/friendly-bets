import Image from "next/image";
import { TEAM_FLAG_CODES } from "@/lib/flags";

// Renders nothing for teams with no TEAM_FLAG_CODES entry (knockout
// placeholder names like "1A" or "W74") rather than a broken image.
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
  if (!code) return null;

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
