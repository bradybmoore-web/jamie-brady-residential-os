import {
  Building2,
  CalendarCheck,
  FileSignature,
  Handshake,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  UserSearch,
} from "lucide-react";

/**
 * The primary navigation. Ten destinations, in the order Jamie's day runs:
 * what is happening now, then the people, then the properties, then the work.
 */
export const NAV_SECTIONS = [
  {
    label: "Today",
    items: [{ href: "/today", label: "Today", icon: LayoutDashboard }],
  },
  {
    label: "People",
    items: [
      { href: "/leads", label: "Leads", icon: UserSearch },
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/buyers", label: "Buyers", icon: Handshake },
    ],
  },
  {
    label: "Property",
    items: [
      { href: "/listings", label: "Listings", icon: Building2 },
      { href: "/transactions", label: "Transactions", icon: FileSignature },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/opportunities", label: "Opportunities", icon: Lightbulb },
      { href: "/assistant", label: "AI Assistant", icon: MessageSquare },
      { href: "/approvals", label: "Approvals", icon: CalendarCheck },
    ],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
] as const;

export const BRAND_ICON = Sparkles;
