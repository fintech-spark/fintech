// Merchant Brain: the navigation model.
//
// One declarative list drives the desktop sidebar, the mobile bar, the command
// palette and the skip link. A navigation model defined in four places is four
// navigation models.
//
// The grouping answers the question a merchant actually has — "am I doing the
// day's work, or understanding the business, or deciding what to do?" — rather
// than listing features alphabetically.

import {
  Banknote,
  Boxes,
  BrainCircuit,
  Calculator,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavGroupId =
  | "operations"
  | "intelligence"
  | "brain"
  | "actions"
  | "settings";

export interface NavGroup {
  readonly id: NavGroupId;
  /** Merchant-facing group name. No internal terminology. */
  readonly label: string;
  /** One line explaining what lives in this group. */
  readonly description: string;
  readonly items: readonly NavItem[];
}

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** What this screen answers. Used in the command palette and as a tooltip. */
  readonly description: string;
  readonly icon: LucideIcon;
  /**
   * Shown in the mobile bar. Deliberately a short list — a bottom bar with
   * thirteen items is not navigation, it is a wall.
   */
  readonly primaryOnMobile?: boolean;
  /**
   * Label for the mobile bottom bar, where the full label truncates
   * mid-word at 390px. Defaults to `label`.
   */
  readonly shortLabel?: string;
  /** Accessible-only marker when the backend for this screen is not built. */
  readonly pendingNote?: string;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "operations",
    label: "Daily operations",
    description: "Your records: what came in, what went out, and what is in stock.",
    items: [
      {
        href: "/overview",
        label: "Overview",
        description: "How your business is doing, and what needs attention.",
        icon: LayoutDashboard,
        primaryOnMobile: true,
      },
      {
        href: "/sales",
        label: "Sales",
        description: "Revenue, orders and what is selling.",
        icon: ShoppingCart,
        primaryOnMobile: true,
      },
      {
        href: "/inventory",
        label: "Inventory",
        description: "Stock levels, low stock and money tied up in stock.",
        icon: Boxes,
        primaryOnMobile: true,
      },
      {
        href: "/customers",
        label: "Customers",
        description: "Who buys from you and who owes you money.",
        icon: Users,
      },
      {
        href: "/suppliers",
        label: "Suppliers",
        description: "Who you buy from, what you owe, and their prices.",
        icon: Truck,
      },
      {
        href: "/expenses",
        label: "Expenses",
        description: "Money going out on running the business.",
        icon: Receipt,
      },
      {
        href: "/documents",
        label: "Documents",
        description: "Invoices and receipts you have sent, and what still needs checking.",
        icon: FileText,
      },
    ],
  },
  {
    id: "intelligence",
    label: "Business intelligence",
    description: "What Merchant Brain has worked out about your business.",
    items: [
      {
        href: "/cash-flow",
        label: "Cash flow",
        description: "Money coming in, going out, and what is expected next.",
        icon: CircleDollarSign,
      },
      {
        href: "/profit-leaks",
        label: "Profit leaks",
        description: "Where money is slipping away, with the evidence.",
        icon: Banknote,
      },
      {
        href: "/simulator",
        label: "Simulator",
        description: "Try a change and see the effect before you make it.",
        icon: Calculator,
      },
    ],
  },
  {
    id: "brain",
    label: "Business Brain",
    description: "Ask questions about your business in plain language.",
    items: [
      {
        href: "/business-brain",
        label: "Ask Merchant Brain",
        shortLabel: "Brain",
        description: "Ask why something happened and see the evidence.",
        icon: BrainCircuit,
        primaryOnMobile: true,
      },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    description: "Things Merchant Brain has prepared for you to approve.",
    items: [
      {
        href: "/actions",
        label: "Action Center",
        shortLabel: "Actions",
        description: "Review, approve or reject anything before it happens.",
        icon: ClipboardCheck,
        primaryOnMobile: true,
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    description: "Your business, your team and your preferences.",
    items: [
      {
        href: "/settings",
        label: "Business settings",
        description: "Business profile, thresholds and team access.",
        icon: Settings,
      },
    ],
  },
];

/** Flat list, used by the command palette and the mobile "all screens" sheet. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The five destinations that earn a permanent slot in the mobile bar. */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter(
  (item) => item.primaryOnMobile,
);

/**
 * True when `href` is the active route or an ancestor of it.
 * `/overview` must stay highlighted on `/overview/profit-leaks`, but `/sales`
 * must not light up on `/suppliers`.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalized === href || normalized.startsWith(`${href}/`);
}

export const APP_NAME = "Merchant Brain";