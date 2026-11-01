"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { SegmentedControl } from "@/components/segmented-control";
import { AGENT_CHART_CONFIG } from "@/constants/chart-config";
import { usePeriodBreakdown } from "@/hooks/use-chart-data";
import { usePeriodLabels } from "@/hooks/use-period-labels";
import {
  formatCount,
  formatMetric,
  formatPercent,
  formatTokens,
  formatUsd,
  METRIC_NAMES,
  metricShare,
  metricValue,
  otherMetric,
} from "@/lib/format";
import { byMetric, type ModelTotals, type UsageView } from "@/lib/usage-view";
import { AGENT_TYPES, AGENT_TYPE_LABELS } from "@/types/agent-types";
import type { Resolution, UsageMetric } from "@/types/chart-types";

type Breakdown = "model" | "period";

interface UsageBreakdownProps {
  view: UsageView;
  metric: UsageMetric;
  resolution: Resolution;
  timeZone: string;
  onSelectModel: (model: ModelTotals) => void;
}

const HEADER = "px-2 py-3 text-xs font-medium text-muted-foreground";

// The period's usage per model, or per day or hour
export function UsageBreakdown({
  view,
  metric,
  resolution,
  timeZone,
  onSelectModel,
}: UsageBreakdownProps) {
  const [breakdown, setBreakdown] = useState<Breakdown>("model");
  const period = resolution === "hour" ? "hour" : "day";

  return (
    <Card className="pt-0">
      <CardHeader className="flex flex-col gap-3 space-y-0 border-b py-5 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <CardTitle>Breakdown</CardTitle>
          <CardDescription>
            {breakdown === "model"
              ? `Models ranked by ${METRIC_NAMES[metric].noun}; open one for its details`
              : `Each ${period} with usage, latest first`}
          </CardDescription>
        </div>
        <SegmentedControl
          label="Break down by"
          value={breakdown}
          onChange={setBreakdown}
          options={[
            { value: "model", label: "Model" },
            { value: "period", label: resolution === "hour" ? "Hour" : "Day" },
          ]}
        />
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        {breakdown === "model" ? (
          <ModelTable
            models={view.models}
            metric={metric}
            onSelectModel={onSelectModel}
          />
        ) : (
          <PeriodTable
            view={view}
            metric={metric}
            resolution={resolution}
            timeZone={timeZone}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ModelTable({
  models,
  metric,
  onSelectModel,
}: {
  models: ModelTotals[];
  metric: UsageMetric;
  onSelectModel: (model: ModelTotals) => void;
}) {
  const ranked = [...models].sort(byMetric(metric));
  const peak = Math.max(0, ...ranked.map((model) => metricValue(metric, model)));
  const emphasis = (column: UsageMetric) =>
    column === metric ? "font-medium" : "text-muted-foreground";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-right">
            <th className={`${HEADER} w-8 text-left`}>#</th>
            <th className={`${HEADER} text-left`}>Model</th>
            <th className={HEADER}>{METRIC_NAMES.cost.title}</th>
            <th className={HEADER}>{METRIC_NAMES.tokens.title}</th>
            <th className={`${HEADER} hidden sm:table-cell`}>Share</th>
            <th className={`${HEADER} hidden md:table-cell`}>Requests</th>
          </tr>
        </thead>
        <tbody>
          {ranked.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground">
                No usage in this period.
              </td>
            </tr>
          ) : (
            ranked.map((model, index) => {
              const value = metricValue(metric, model);
              return (
                <tr
                  key={`${model.agentType}:${model.model}`}
                  className="relative border-b text-right tabular-nums transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50"
                >
                  <td className="px-2 py-2.5 text-left text-xs text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-2 py-2.5 text-left">
                    <button
                      type="button"
                      onClick={() => onSelectModel(model)}
                      className="flex flex-col items-start gap-0.5 text-left outline-none after:absolute after:inset-0"
                    >
                      <span className="font-medium">
                        {model.model || (
                          <span className="text-muted-foreground">
                            Unattributed
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {AGENT_TYPE_LABELS[model.agentType]}
                      </span>
                    </button>
                    {value > 0 && (
                      <div aria-hidden className="mt-1.5 h-0.5 max-w-48">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `max(0.5rem, ${(value / peak) * 100}%)`,
                            backgroundColor:
                              AGENT_CHART_CONFIG[model.agentType].color,
                          }}
                        />
                      </div>
                    )}
                  </td>
                  <td className={`px-2 py-2.5 ${emphasis("cost")}`}>
                    {formatUsd(model.totalCost)}
                  </td>
                  <td className={`px-2 py-2.5 ${emphasis("tokens")}`}>
                    {formatTokens(model.totalTokens)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">
                    {formatPercent(metricShare(metric, model))}
                  </td>
                  <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">
                    {formatCount(model.requests)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function PeriodTable({
  view,
  metric,
  resolution,
  timeZone,
}: {
  view: UsageView;
  metric: UsageMetric;
  resolution: Resolution;
  timeZone: string;
}) {
  const rows = usePeriodBreakdown(view, resolution);
  const labels = usePeriodLabels(resolution, timeZone);
  // A column per agent, where more than one has usage
  const present = new Set(view.agents.map(({ agentType }) => agentType));
  const agents =
    present.size > 1 ? AGENT_TYPES.filter((agent) => present.has(agent)) : [];
  const other = otherMetric(metric);

  const [requestedPage, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  // A narrower selection may have fewer pages than the one paged through
  const page = Math.min(requestedPage, totalPages);
  const shown = rows.slice((page - 1) * perPage, page * perPage);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b text-right">
              <th className={`${HEADER} text-left`}>
                {resolution === "hour" ? "Hour" : "Day"}
              </th>
              {agents.map((agent) => (
                <th key={agent} className={HEADER}>
                  {AGENT_TYPE_LABELS[agent]}
                </th>
              ))}
              <th className={HEADER}>{METRIC_NAMES[metric].title}</th>
              <th className={HEADER}>{METRIC_NAMES[other].title}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={agents.length + 3}
                  className="py-6 text-center text-muted-foreground"
                >
                  No usage in this period.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr
                  key={row.period}
                  className="border-b text-right tabular-nums transition-colors hover:bg-muted/50"
                >
                  <td className="px-2 py-2.5 text-left">
                    {labels.full(row.period)}
                  </td>
                  {agents.map((agent) => {
                    const usage = row.byAgent[agent];
                    return (
                      <td
                        key={agent}
                        className="px-2 py-2.5 text-muted-foreground"
                      >
                        {usage
                          ? formatMetric(metric, metricValue(metric, usage))
                          : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2.5 font-medium">
                    {formatMetric(metric, metricValue(metric, row))}
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">
                    {formatMetric(other, metricValue(other, row))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <DataTablePagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={rows.length}
        itemsPerPage={perPage}
        onPageChange={setPage}
        onItemsPerPageChange={(next) => {
          setPerPage(next);
          setPage(1);
        }}
      />
    </>
  );
}
