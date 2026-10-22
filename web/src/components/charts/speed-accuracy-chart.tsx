"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { formatDuration, formatPercent } from "@/lib/format";
import type { SpeedAccuracyPoint } from "@/lib/types";

export function SpeedAccuracyChart({ data }: { data: SpeedAccuracyPoint[] }) {
  const points = data.map((point) => ({
    ...point,
    short: point.title.length > 36 ? `${point.title.slice(0, 34)}…` : point.title,
  }));

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 14, bottom: 4, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis
            type="number"
            dataKey="avg_seconds"
            name="Average time"
            unit="s"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            dataKey="accuracy"
            name="Accuracy"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(value: number) => `${value}%`}
          />
          <ZAxis type="number" dataKey="attempts" range={[50, 340]} />
          <ReferenceLine y={70} stroke="var(--success)" strokeDasharray="4 4" opacity={0.5} />
          <ReferenceLine x={60} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.3} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof points)[number];
              return (
                <div className="max-w-64 rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-xl">
                  <p className="font-medium">{point.title}</p>
                  <p className="mt-1 text-muted-foreground">
                    {formatPercent(point.accuracy, 1)} accuracy ·{" "}
                    {formatDuration(point.avg_seconds)} avg
                  </p>
                  <p className="text-muted-foreground">{point.attempts} attempts</p>
                </div>
              );
            }}
          />
          <Scatter data={points} fill="var(--primary)" fillOpacity={0.72} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
