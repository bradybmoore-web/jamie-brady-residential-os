import type { Listing, MarketingAssetKind, Property } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { FACTS_RULE, WRITING_GUIDELINES } from "./writing";

export const MARKETING_PROMPT_VERSION = "listing_marketing@2";

/**
 * Reusable prompt templates for the Listing Studio.
 *
 * Each entry defines the brief for one output type, plus the deterministic
 * template used when no model is available. Adding a new content type means
 * adding one entry here — nothing else changes.
 */
export interface MarketingTemplate {
  kind: MarketingAssetKind;
  /** What the model is being asked to produce. */
  brief: string;
  maxTokens: number;
  temperature: number;
  /** Deterministic version, built from the listing's own facts. */
  fallback: (listing: Listing, property: Property) => string;
}

const SIGNOFF = "Jamie & Brady Moore · Moore Residential Group";

function specLine(listing: Listing, property: Property) {
  const bits = [
    property.beds ? `${property.beds} bed` : null,
    property.baths ? `${property.baths} bath` : null,
    property.squareFeet ? `${property.squareFeet.toLocaleString()} sq ft` : null,
    property.lotSizeAcres ? `${property.lotSizeAcres} acre lot` : null,
    property.yearBuilt ? `built ${property.yearBuilt}` : null,
  ].filter(Boolean);
  return `${bits.join(" · ")} · ${formatCurrency(listing.listPrice)}`;
}

function lifestyleParagraph(listing: Listing) {
  const points = listing.lifestylePoints.length > 0 ? listing.lifestylePoints : listing.majorFeatures;
  return points.slice(0, 3).join(" ");
}

export const MARKETING_TEMPLATES: Record<MarketingAssetKind, MarketingTemplate> = {
  mls_description: {
    kind: "mls_description",
    brief: `Write the MLS public remarks. 900 characters maximum — MLS fields truncate, so stay under it.
Open with the single most specific true thing about this house. Then the features that matter, in the order a
buyer would care about them. Close with the location in terms of what is actually nearby.
No all-caps, no exclamation marks, no agent contact details, no fair-housing-sensitive language.`,
    maxTokens: 700,
    temperature: 0.65,
    fallback: (l, p) =>
      [
        l.majorFeatures[0] ?? `${p.beds} bedrooms in ${p.neighborhood ?? p.city}.`,
        l.majorFeatures.slice(1, 4).join(" "),
        l.improvements.length > 0 ? `Recent work: ${l.improvements.join("; ")}.` : "",
        l.nearbyDestinations.length > 0 ? `Close to ${l.nearbyDestinations.slice(0, 3).join(", ")}.` : "",
        p.schoolDistrict ? `${p.schoolDistrict}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 900),
  },
  instagram_caption: {
    kind: "instagram_caption",
    brief: `Write an Instagram caption. Two or three short paragraphs, generous line breaks. Lead with a
scene rather than the address. Mention the neighborhood, not the full street address. End with the price and
a single clear invitation. No hashtags — those are generated separately.`,
    maxTokens: 500,
    temperature: 0.8,
    fallback: (l, p) =>
      `${l.lifestylePoints[0] ?? l.majorFeatures[0] ?? ""}\n\n${p.neighborhood ?? p.city}. ${specLine(l, p)}.\n\n${l.majorFeatures.slice(1, 3).join(" ")}\n\nDM for a private showing.`,
  },
  facebook_caption: {
    kind: "facebook_caption",
    brief: `Write a Facebook post. Slightly longer and more conversational than Instagram — Facebook
readers will read three or four sentences. Written in first person as Jamie. End with a clear next step.`,
    maxTokens: 500,
    temperature: 0.8,
    fallback: (l, p) =>
      `New in ${p.neighborhood ?? p.city}. ${l.positioning}\n\n${specLine(l, p)}\n\n${lifestyleParagraph(l)}\n\nMessage me for a private showing.\n\n${SIGNOFF}`,
  },
  reel_caption: {
    kind: "reel_caption",
    brief: `Write a caption for a short vertical video. One or two lines maximum, front-loaded — the first
five words decide whether anyone stops. No hashtags.`,
    maxTokens: 200,
    temperature: 0.85,
    fallback: (l, p) => `${l.lifestylePoints[0] ?? l.majorFeatures[0] ?? p.address}\n${p.neighborhood ?? p.city} · ${formatCurrency(l.listPrice)}`,
  },
  video_script_30: {
    kind: "video_script_30",
    brief: `Write a 30-second video script, roughly 75 words. Format as timestamped beats
(0:00, 0:05, 0:12, 0:22) with what is on screen and what is said. Spoken lines must sound like speech,
not like written copy. One idea per beat.`,
    maxTokens: 600,
    temperature: 0.75,
    fallback: (l, p) =>
      [
        `0:00 — EXTERIOR, approach shot`,
        `"${l.majorFeatures[0] ?? `${p.beds} bedrooms in ${p.neighborhood ?? p.city}`}."`,
        ``,
        `0:06 — INTERIOR, main living`,
        `"${l.majorFeatures[1] ?? "Inside, the layout does what you would want it to do."}"`,
        ``,
        `0:15 — OUTDOOR / feature shot`,
        `"${l.lifestylePoints[0] ?? l.majorFeatures[2] ?? "And this is where you would actually spend your time."}"`,
        ``,
        `0:24 — EXTERIOR, pull back`,
        `"${p.address}. ${formatCurrency(l.listPrice)}. Call me for a private showing."`,
      ].join("\n"),
  },
  video_script_60: {
    kind: "video_script_60",
    brief: `Write a 60-second video script, roughly 150 words, in timestamped beats. Structure it as:
the hook, the house, the one thing that makes it different, the neighborhood, the call to action.
Spoken lines must sound like speech.`,
    maxTokens: 900,
    temperature: 0.75,
    fallback: (l, p) =>
      [
        `0:00 — EXTERIOR`,
        `"${l.majorFeatures[0] ?? p.address}."`,
        ``,
        `0:08 — ENTRY / MAIN LIVING`,
        `"${l.positioning}"`,
        ``,
        `0:20 — FEATURES`,
        `"${l.majorFeatures.slice(1, 3).join(" ")}"`,
        ``,
        `0:34 — IMPROVEMENTS`,
        `"${l.improvements.length ? l.improvements.join(". ") : "Well kept, and it shows."}"`,
        ``,
        `0:46 — NEIGHBORHOOD`,
        `"${l.nearbyDestinations.slice(0, 3).join(", ")}. ${lifestyleParagraph(l)}"`,
        ``,
        `0:55 — CLOSE`,
        `"${p.address}. ${formatCurrency(l.listPrice)}. ${SIGNOFF}."`,
      ].join("\n"),
  },
  agent_email: {
    kind: "agent_email",
    brief: `Write an email to other agents. Agents skim: lead with the facts they need to decide whether
to show it — price, beds, baths, square feet, what is unusual about it, and showing instructions.
Professional, brief, no marketing gloss. Include a subject line as the first line.`,
    maxTokens: 600,
    temperature: 0.4,
    fallback: (l, p) =>
      `Subject: ${p.address} — ${specLine(l, p)}\n\nAgents,\n\n${p.address}, ${p.city}. ${specLine(l, p)}.\n\n${l.majorFeatures.slice(0, 3).map((f) => `• ${f}`).join("\n")}\n\n${l.improvements.length ? `Recent work:\n${l.improvements.map((i) => `• ${i}`).join("\n")}\n\n` : ""}Showings by appointment. Call or text with questions.\n\n${SIGNOFF}`,
  },
  database_email: {
    kind: "database_email",
    brief: `Write an email to Jamie's own database — past clients and sphere, not strangers. Warm and
personal, first person, as if writing to people she knows. The point is not to sell them this house; it is
to tell them about it in case they know someone. Include a subject line as the first line.`,
    maxTokens: 700,
    temperature: 0.75,
    fallback: (l, p) =>
      `Subject: Something new in ${p.neighborhood ?? p.city}\n\nHi —\n\nWe just took on ${p.address} in ${p.neighborhood ?? p.city}. ${l.positioning}\n\n${specLine(l, p)}\n\n${lifestyleParagraph(l)}\n\nIf someone comes to mind, send them my way. If not, no need to do anything at all.\n\n${SIGNOFF}`,
  },
  neighbor_email: {
    kind: "neighbor_email",
    brief: `Write a letter to the immediate neighbors. Neighbors care about two things: what it sold for,
and who is moving in next door. Be respectful of that. Invite them to tell anyone they would like as a
neighbor. Include a subject line as the first line. Do not include the seller's personal circumstances.`,
    maxTokens: 500,
    temperature: 0.7,
    fallback: (l, p) =>
      `Subject: A neighbor on ${p.address.replace(/^\d+\s+/, "")}\n\nHello neighbor,\n\nWe are bringing ${p.address} to market at ${formatCurrency(l.listPrice)}.\n\nNeighbors usually know before anyone else who might want to live here — a friend, family, someone who has been trying to get into ${p.neighborhood ?? p.city} for a while. If that is you, tell them to call me.\n\nAnd if you are curious what this means for your own house, I am glad to tell you honestly, with no follow-up unless you ask for it.\n\n${SIGNOFF}`,
  },
  coming_soon_post: {
    kind: "coming_soon_post",
    brief: `Write a Coming Soon social post. Build anticipation without listing every feature — hold
something back. Say when it goes live. Do not use "sneak peek" or "stay tuned".`,
    maxTokens: 400,
    temperature: 0.85,
    fallback: (l, p) =>
      `Coming soon in ${p.neighborhood ?? p.city}.\n\n${l.majorFeatures[0] ?? l.positioning}\n\n${specLine(l, p)}\n\nOn the market shortly. Message me if you want to see it first.`,
  },
  open_house_post: {
    kind: "open_house_post",
    brief: `Write an open house announcement. Date, time and address must be unmistakable. One line about
why it is worth the drive. Keep it short.`,
    maxTokens: 350,
    temperature: 0.75,
    fallback: (l, p) => {
      const next = l.openHouseDates[0];
      const when = next
        ? new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Chicago",
          }).format(new Date(next))
        : "This weekend";
      return `Open house — ${when}\n\n${p.address}, ${p.city}\n${specLine(l, p)}\n\n${l.majorFeatures[0] ?? ""}\n\nCome by. No appointment needed.`;
    },
  },
  price_adjustment_post: {
    kind: "price_adjustment_post",
    brief: `Write a price adjustment announcement. State the new price plainly and move on. Do not
apologize, do not say "price improvement", do not imply the seller is desperate. Spend most of the words on
why the house is worth seeing.`,
    maxTokens: 400,
    temperature: 0.7,
    fallback: (l, p) =>
      `${p.address} is now ${formatCurrency(l.listPrice)}.\n\n${l.positioning}\n\n${specLine(l, p)}\n\nWorth a second look if it was close before.`,
  },
  pending_post: {
    kind: "pending_post",
    brief: `Write a Pending post. Brief and gracious. Credit the buyer's agent generically. Do not disclose
terms, price, or how many offers there were.`,
    maxTokens: 300,
    temperature: 0.7,
    fallback: (_l, p) =>
      `Pending — ${p.address}, ${p.neighborhood ?? p.city}.\n\nThank you to the buyer's agent for a clean, straightforward contract.\n\nMore to come.`,
  },
  just_sold_post: {
    kind: "just_sold_post",
    brief: `Write a Just Sold post. Focus on the people and the work, not the commission. Do not state the
sale price unless it is in the facts and marked shareable. One sentence of what made this one interesting.`,
    maxTokens: 350,
    temperature: 0.75,
    fallback: (_l, p) =>
      `Sold — ${p.address}, ${p.neighborhood ?? p.city}.\n\nCongratulations to everyone involved. This one took real work from both sides, and it closed the way it should have.\n\nIf you are thinking about your own move, we are glad to talk it through.\n\n${SIGNOFF}`,
  },
  feature_captions: {
    kind: "feature_captions",
    brief: `Write six short captions, one per major feature, each under 15 words. These sit under individual
photos. Numbered list. Each should say something a photo cannot.`,
    maxTokens: 400,
    temperature: 0.8,
    fallback: (l) =>
      l.majorFeatures
        .slice(0, 6)
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n"),
  },
  hashtags: {
    kind: "hashtags",
    brief: `Produce 15 to 20 hashtags on one line, most specific first. Include the neighborhood, the city,
the property type and the price tier. No banned generic tags like #dreamhome or #luxuryliving.`,
    maxTokens: 250,
    temperature: 0.4,
    fallback: (l, p) => {
      const slug = (s: string) => s.replace(/[^a-z0-9]/gi, "");
      return [
        p.neighborhood ? `#${slug(p.neighborhood)}` : null,
        `#${slug(p.city)}TX`,
        "#AustinRealEstate",
        "#AustinHomes",
        `#${slug(p.city)}RealEstate`,
        p.schoolDistrict ? `#${slug(p.schoolDistrict)}` : null,
        p.hasPool ? "#PoolHome" : null,
        p.yearBuilt && p.yearBuilt < 1970 ? "#AustinHistoric" : null,
        "#ATXRealtor",
        "#CentralTexas",
        "#MooreResidentialGroup",
        `#${slug(p.propertyType)}`,
        l.listPrice >= 1000000 ? "#AustinLuxury" : "#AustinHomesForSale",
        "#TexasHillCountry",
        "#NewListing",
      ]
        .filter(Boolean)
        .join(" ");
    },
  },
};

export function buildMarketingSystem(listing: Listing) {
  const sellerRules =
    listing.prohibitedPhrases.length > 0
      ? `\n\nSeller-specific rules for this listing — these override everything else:\n${listing.prohibitedPhrases
          .map((p) => `- Never use the phrase "${p}".`)
          .join("\n")}`
      : "";
  const notes = listing.writingNotes ? `\n\nAgent's notes on this listing:\n${listing.writingNotes}` : "";
  return `${WRITING_GUIDELINES}\n\n${FACTS_RULE}${notes}${sellerRules}`;
}

export function buildMarketingFacts(listing: Listing, property: Property) {
  return {
    address: property.address,
    city: property.city,
    state: property.state,
    postalCode: property.postalCode,
    neighborhood: property.neighborhood,
    listPrice: listing.listPrice,
    status: listing.status,
    beds: property.beds,
    baths: property.baths,
    halfBaths: property.halfBaths,
    squareFeet: property.squareFeet,
    lotSizeAcres: property.lotSizeAcres,
    yearBuilt: property.yearBuilt,
    propertyType: property.propertyType,
    stories: property.stories,
    hasPool: property.hasPool,
    schoolDistrict: property.schoolDistrict,
    elementarySchool: property.elementarySchool,
    middleSchool: property.middleSchool,
    highSchool: property.highSchool,
    mlsNumber: property.mlsNumber,
    majorFeatures: listing.majorFeatures,
    improvements: listing.improvements,
    neighborhoodAmenities: listing.neighborhoodAmenities,
    lifestylePoints: listing.lifestylePoints,
    nearbyDestinations: listing.nearbyDestinations,
    positioning: listing.positioning,
    openHouseDates: listing.openHouseDates,
    launchDate: listing.launchDate,
    originalListPrice: listing.originalListPrice,
    brokerageDisclaimer: listing.brokerageDisclaimer,
  };
}
