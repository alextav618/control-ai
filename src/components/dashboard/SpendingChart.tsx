"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatBRL } from "@/lib/format";

interface SpendingChartProps {
  data: { name: string; total: number }[];
}

const SpendingChart = ({ data }: SpendingChartProps) => {
  return (
    <div className="h-[300px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -15, bottom: 0 }} // Margem ajustada para ser mais fino
        >
          {/* Gradiente de Rosa para Roxo */}
          <defs>
            <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="oklch(0.68 0.26 0)" /> {/* Rosa */}
              <stop offset="95%" stopColor="oklch(0.62 0.25 310)" /> {/* Roxo */}
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickFormatter={(value) => `R$ ${value}`}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border)",
              borderRadius: "12px",
              fontSize: "12px",
              color: "var(--foreground)", // Cor clara para o texto do tooltip
            }}
            formatter={(value: number) => [formatBRL(value), "Gasto"]}
            labelStyle={{ fontWeight: "bold", marginBottom: "4px", color: "var(--foreground)" }} // Cor clara para o label também
          />
          <Bar dataKey="total" radius={[6, 6, 0, 0]} strokeWidth={0} barSize={8}> {/* barSize ajustado para 1/4 do tamanho */}
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill="url(#colorGradient)" // Aplica o gradiente
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SpendingChart;