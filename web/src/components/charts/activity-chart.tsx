"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDay, formatDuration } from "@/lib/format";
import type { DailyPoint } from "@/lib/types";

export function ActivityChart({ data }: { data: DailyPoint[] }) {
  const points = data.map((point) => ({
    ...point,
    label: formatDay(point.day),
    minutes: Math.round(point.seconds / 60),
  }));

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="activity-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.85} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.18} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => `${value}m`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={(value: number) => `${value}%`}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof points)[number];
              return (
                <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-xl">
                  <p className="font-medium">{point.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    {point.attempts} attempts · {formatDuration(point.seconds)}
                  </p>
                  <p className="text-muted-foreground">
                    {point.attempts > 0 ? `${point.accuracy.toFixed(0)}% accuracy` : "No graded answers"}
                  </p>
                </div>
              );
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="minutes"
            fill="url(#activity-bar)"
            radius={[5, 5, 0, 0]}
            maxBarSize={18}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="accuracy"
            stroke="var(--success)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
