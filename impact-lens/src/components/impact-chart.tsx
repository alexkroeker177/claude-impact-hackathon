"use client";

import { Bar, BarChart, CartesianGrid, Funnel, FunnelChart, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ImpactChartProps = {
  type: "bar" | "line" | "funnel";
  title: string;
  description: string;
  series: Array<{ label: string; value: number | null }>;
};

export function ImpactChart({ type, title, description, series }: ImpactChartProps) {
  return (
    <figure aria-label={title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_60px_-45px_rgba(15,23,42,0.45)] sm:p-7">
      <figcaption className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Primary view</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-slate-600">{description}</p>
      </figcaption>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer height="100%" width="100%">
          {type === "line" ? <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
            <XAxis axisLine={false} dataKey="label" fontSize={12} tickLine={false} tick={{ fill: "#64748b" }} />
            <YAxis axisLine={false} fontSize={12} tickLine={false} tick={{ fill: "#64748b" }} width={48} />
            <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 12px 30px rgba(15,23,42,.12)" }} formatter={(value) => [Number(value).toLocaleString("en"), "Value"]} />
            <Line dataKey="value" dot={{ fill: "#047857", r: 4 }} stroke="#047857" strokeWidth={3} type="monotone" />
          </LineChart> : type === "funnel" ? <FunnelChart>
            <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 12px 30px rgba(15,23,42,.12)" }} formatter={(value) => [Number(value).toLocaleString("en"), "People"]} />
            <Funnel data={series} dataKey="value" fill="#047857" nameKey="label">
              <LabelList dataKey="label" fill="#ffffff" position="right" />
            </Funnel>
          </FunnelChart> : <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
            <XAxis axisLine={false} dataKey="label" fontSize={12} tickLine={false} tick={{ fill: "#64748b" }} />
            <YAxis axisLine={false} fontSize={12} tickLine={false} tick={{ fill: "#64748b" }} width={48} />
            <Tooltip
              contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 12px 30px rgba(15,23,42,.12)" }}
              cursor={{ fill: "#ecfdf5" }}
              formatter={(value) => [Number(value).toLocaleString("en"), "People"]}
            />
            <Bar dataKey="value" fill="#047857" radius={[9, 9, 2, 2]} />
          </BarChart>}
        </ResponsiveContainer>
      </div>
      <p className="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">
        Text summary: {description}
      </p>
    </figure>
  );
}
