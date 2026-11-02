"use client";

import { formatPercent } from "@/lib/format";

export interface ShareSegment {
  label: string;
  value: number;
  color: string;
}

interface ShareBarProps {
  label: string;
  segments: ShareSegment[];
  format: (value: number) => string;
  // What the whole leaves out, where it is not all of the usage
  note?: string;
}

// How a whole splits into parts: one full-width bar, and each part's amount
// and share below it
export function ShareBar({ label, segments, format, note }: ShareBarProps) {
  const total = segments.reduce((sum, { value }) => sum + value, 0);
  const parts = segments.filter(({ value }) => value > 0);
  if (total <= 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {format(total)}
        </span>
      </div>
      {note && <p className="-mt-2 text-xs text-muted-foreground">{note}</p>}
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted">
        {parts.map((segment) => (
          <div
            key={segment.label}
            className="h-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: segment.color }}
              />
              {segment.label}
            </dt>
            <dd className="text-sm tabular-nums">
              {format(segment.value)}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {formatPercent(segment.value / total)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

