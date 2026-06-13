/**
 * Maps team names (as they appear in `matches.team1` / `matches.team2`,
 * which come straight from openfootball's worldcup.json) to flag-icons
 * (https://flagicons.lipis.dev/) country codes.
 *
 * Knockout-stage placeholder names ("1A", "W74", "L101", etc.) are
 * intentionally absent — they get overwritten with real team names as the
 * bracket resolves (see openfootball.ts buildExternalRef), and until then
 * there's no flag to show. `Flag` renders nothing for unmapped names.
 *
 * SVGs for these codes live in public/flags/ (copied from the flag-icons
 * package by scripts/copy-flags.mjs).
 */
export const TEAM_FLAG_CODES: Record<string, string> = {
  Algeria: "dz",
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  "Bosnia & Herzegovina": "ba",
  Brazil: "br",
  Canada: "ca",
  "Cape Verde": "cv",
  Colombia: "co",
  Croatia: "hr",
  Curaçao: "cw",
  "Czech Republic": "cz",
  "DR Congo": "cd",
  Ecuador: "ec",
  Egypt: "eg",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  Iran: "ir",
  Iraq: "iq",
  "Ivory Coast": "ci",
  Japan: "jp",
  Jordan: "jo",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Norway: "no",
  Panama: "pa",
  Paraguay: "py",
  Portugal: "pt",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  "South Africa": "za",
  "South Korea": "kr",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tunisia: "tn",
  Turkey: "tr",
  USA: "us",
  Uruguay: "uy",
  Uzbekistan: "uz",
};
