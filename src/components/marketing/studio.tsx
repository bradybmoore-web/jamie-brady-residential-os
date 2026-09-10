"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Copy, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import {
  approveMarketingAction,
  generateMarketingAction,
  saveMarketingAction,
} from "@/app/actions/listings";
import { MARKETING_KIND_LABELS, type ListingMarketingAsset, type MarketingAssetKind } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/** The generation menu, grouped the way an agent actually thinks about it. */
const GROUPS: { label: string; kinds: MarketingAssetKind[] }[] = [
  { label: "Listing copy", kinds: ["mls_description", "feature_captions", "hashtags"] },
  { label: "Social", kinds: ["instagram_caption", "facebook_caption", "reel_caption"] },
  { label: "Video", kinds: ["video_script_30", "video_script_60"] },
  { label: "Email", kinds: ["agent_email", "database_email", "neighbor_email"] },
  {
    label: "Announcements",
    kinds: ["coming_soon_post", "open_house_post", "price_adjustment_post", "pending_post", "just_sold_post"],
  },
];

export function MarketingStudio({
  listingId,
  address,
  initialAssets,
  initialKind,
  usingMockAI,
}: {
  listingId: string;
  address: string;
  initialAssets: ListingMarketingAsset[];
  initialKind?: MarketingAssetKind;
  usingMockAI: boolean;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [selected, setSelected] = useState<MarketingAssetKind>(initialKind ?? "mls_description");
  const [instructions, setInstructions] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = assets.find((a) => a.kind === selected);

  const generate = () => {
    startTransition(async () => {
      const result = await generateMarketingAction({ listingId, kind: selected, instructions });
      if (result.ok && result.data) {
        setAssets((prev) => [result.data!.asset, ...prev.filter((a) => a.kind !== selected)]);
        setMessage(result.message ?? null);
      } else if (!result.ok) {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Format picker */}
      <nav aria-label="Content types" className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="eyebrow px-1 pb-1.5">{group.label}</div>
            <ul className="flex flex-col gap-px">
              {group.kinds.map((kind) => {
                const existing = assets.find((a) => a.kind === kind);
                const active = kind === selected;
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      onClick={() => setSelected(kind)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                        active
                          ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(28,27,25,0.06)]"
                          : "text-ink-muted hover:bg-surface/70 hover:text-ink"
                      }`}
                    >
                      <span className="flex-1 truncate">{MARKETING_KIND_LABELS[kind]}</span>
                      {existing ? (
                        <span
                          aria-label={existing.status === "approved" ? "Approved" : "Drafted"}
                          className={`size-1.5 shrink-0 rounded-full ${existing.status === "approved" ? "bg-good" : "bg-brass"}`}
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Workspace */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{MARKETING_KIND_LABELS[selected]}</CardTitle>
              <p className="mt-0.5 text-[12px] text-ink-faint">{address}</p>
            </div>
            <Button variant="primary" size="sm" onClick={generate} disabled={pending}>
              <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
              {pending ? "Writing…" : current ? "Regenerate" : "Generate"}
            </Button>
          </CardHeader>

          <CardContent>
            <label className="eyebrow mb-1.5 block" htmlFor="instructions">
              Direction for this piece (optional)
            </label>
            <Input
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Lead with the pecan tree. Do not mention the studio."
            />

            {message ? <p className="mt-3 text-[12.5px] text-brass">{message}</p> : null}

            {usingMockAI ? (
              <p className="mt-3 rounded-[4px] border border-line bg-surface-sunk/60 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
                No Anthropic key is configured, so this generates from templates built out of the listing&rsquo;s own
                facts. Useful, but not the finished product — connect Claude for real copy.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {current ? (
          <AssetEditor key={current.id} asset={current} onChange={(next) => setAssets((prev) => prev.map((a) => (a.id === next.id ? next : a)))} />
        ) : (
          <Card>
            <EmptyState
              title={`No ${MARKETING_KIND_LABELS[selected].toLowerCase()} yet`}
              description="Generate one from the listing's features, improvements, positioning and the seller's writing notes."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function AssetEditor({
  asset,
  onChange,
}: {
  asset: ListingMarketingAsset;
  onChange: (asset: ListingMarketingAsset) => void;
}) {
  const [content, setContent] = useState(asset.content);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = content !== asset.content;

  const save = () => {
    startTransition(async () => {
      const result = await saveMarketingAction({ assetId: asset.id, content });
      setMessage(result.ok ? (result.message ?? "Saved.") : result.error);
      if (result.ok) onChange({ ...asset, content, status: "draft" });
    });
  };

  const approve = () => {
    startTransition(async () => {
      if (dirty) await saveMarketingAction({ assetId: asset.id, content });
      const result = await approveMarketingAction(asset.id);
      setMessage(result.ok ? (result.message ?? "Approved.") : result.error);
      if (result.ok) onChange({ ...asset, content, status: "approved" });
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage("Could not copy — select the text and copy it manually.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={asset.status === "approved" ? "good" : "neutral"}>
            {asset.status === "approved" ? "Approved" : "Draft"}
          </Badge>
          <span className="text-[11.5px] text-ink-faint">
            {asset.promptVersion} · {formatDate(asset.createdAt)} · {content.length} characters
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5 text-good" strokeWidth={2} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardHeader>

      <CardContent>
        {asset.flaggedPhrases.length > 0 ? (
          <div className="mb-3 flex items-start gap-2 rounded-[4px] border border-[#e6c9c4] bg-urgent-soft px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-urgent" strokeWidth={2} aria-hidden />
            <div>
              <p className="text-[12.5px] font-medium text-urgent">
                {asset.flaggedPhrases.length} phrase{asset.flaggedPhrases.length === 1 ? "" : "s"} to change
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                {asset.flaggedPhrases.join(", ")} — either on the banned list or specifically prohibited by this
                seller.
              </p>
            </div>
          </div>
        ) : null}

        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={Math.min(28, Math.max(10, content.split("\n").length + 4))}
          aria-label={`${asset.kind} content`}
          className="font-sans leading-relaxed"
        />

        {message ? <p className="mt-2.5 text-[12.5px] text-brass">{message}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
          {asset.status !== "approved" ? (
            <Button variant="primary" size="sm" onClick={approve} disabled={pending}>
              Approve
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
