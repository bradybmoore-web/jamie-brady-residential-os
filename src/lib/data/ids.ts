/**
 * Stable identifiers for seed data. Real UUIDs, written out so that seed rows
 * cross-reference each other reliably and so a Supabase seed load produces the
 * same graph as the in-memory store.
 */
const ns = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${n.toString().padStart(12, "0")}`;

export const ID = {
  jamie: ns("11111111", 1),
  brady: ns("11111111", 2),

  // contacts
  whitfield: ns("22222222", 1),
  ruiz: ns("22222222", 2),
  nandakumar: ns("22222222", 3),
  collins: ns("22222222", 4),
  smith: ns("22222222", 5),
  bell: ns("22222222", 6),
  kim: ns("22222222", 7),
  halvorsen: ns("22222222", 8),
  mendes: ns("22222222", 9),
  pryor: ns("22222222", 10),
  dunbar: ns("22222222", 11),
  ostrander: ns("22222222", 12),
  alcott: ns("22222222", 13),

  // properties
  lothian: ns("33333333", 1),
  brackenridge: ns("33333333", 2),
  american: ns("33333333", 3),
  cavalier: ns("33333333", 4),
  pecanGrove: ns("33333333", 5),

  // listings
  lothianListing: ns("44444444", 1),
  brackenridgeListing: ns("44444444", 2),
  americanListing: ns("44444444", 3),
  cavalierListing: ns("44444444", 4),
  pecanGroveListing: ns("44444444", 5),

  // leads
  leadReyes: ns("55555555", 1),
  leadVandenberg: ns("55555555", 2),
  leadGrant: ns("55555555", 3),
  leadWhitcomb: ns("55555555", 4),
  leadNyland: ns("55555555", 5),
  leadIbarra: ns("55555555", 6),
  leadOkafor: ns("55555555", 7),

  // buyers
  buyerBell: ns("66666666", 1),
  buyerKim: ns("66666666", 2),
  buyerPryor: ns("66666666", 3),

  // transactions
  txOstrander: ns("77777777", 1),
  txPecanGrove: ns("77777777", 2),
} as const;

export const seq = ns;
