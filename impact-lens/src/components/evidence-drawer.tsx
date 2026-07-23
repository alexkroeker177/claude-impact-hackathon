"use client";

import { Badge } from "@/components/ui/badge";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SourceProfile } from "@/lib/files/types";
import type { MetricDefinition } from "@/lib/semantic/schema";
import type { ChartSpec, MetricResult } from "@/lib/analysis/types";

interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: MetricDefinition | null;
  result: MetricResult | null;
  profiles: SourceProfile[];
  chart: ChartSpec | null;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function fileNameFor(sourceId: string, profiles: SourceProfile[]): string {
  const profile = profiles.find((p) => p.sourceId === sourceId);
  if (!profile) return sourceId;
  return profile.sheetName ? `${profile.fileName} · ${profile.sheetName}` : profile.fileName;
}

function headerFor(sourceId: string, fieldId: string, profiles: SourceProfile[]): string {
  const field = profiles.find((p) => p.sourceId === sourceId)?.fields.find((f) => f.fieldId === fieldId);
  return field?.header ?? fieldId;
}

export function EvidenceDrawer({ open, onOpenChange, definition, result, profiles, chart }: EvidenceDrawerProps) {
  if (!definition || !result) return null;
  const coveragePct = Math.round(result.coverage * 100);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{definition.name}</SheetTitle>
          <SheetDescription>{definition.description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {result.evidence.sourceIds.map((sourceId) => (
                <Badge key={sourceId} variant="outline">
                  {fileNameFor(sourceId, profiles)}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Formula</p>
            <p className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
              {result.evidence.formula}
            </p>
          </div>

          {result.evidence.fieldRefs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fields used</p>
              <div className="flex flex-wrap gap-1.5">
                {result.evidence.fieldRefs.map((ref, i) => (
                  <Badge key={i} variant="secondary">
                    {headerFor(ref.sourceId, ref.fieldId, profiles)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Coverage</p>
            <Progress value={coveragePct}>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
              <span>Used: {numberFormat.format(result.recordsUsed)}</span>
              <span>Available: {numberFormat.format(result.recordsAvailable)}</span>
              <span>Missing: {numberFormat.format(result.missingRecords)}</span>
              <span>Excluded: {numberFormat.format(result.excludedRecords)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
            <span>Confidence: {Math.round(definition.confidence * 100)}%</span>
            {definition.unit && <span>Unit: {definition.unit}</span>}
          </div>

          {definition.assumptions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Assumptions</p>
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-600">
                {definition.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {result.evidence.caveats.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Caveats</p>
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-600">
                {result.evidence.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {result.evidence.exampleRows.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Example rows</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Row</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.evidence.exampleRows.map((ex, i) => (
                    <TableRow key={i}>
                      <TableCell>{fileNameFor(ex.sourceId, profiles)}</TableCell>
                      <TableCell>{ex.rowNumber}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {chart && chart.metricId === definition.id && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Chart summary</p>
              <p className="text-sm text-slate-600">{chart.summary}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
