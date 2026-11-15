import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { TooltipComponent, GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([BarChart, TooltipComponent, GridComponent, CanvasRenderer]);
export default function Charts({ data }: { data: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chart.setOption({
      color: ["#9caa91"],
      tooltip: { trigger: "axis" },
      grid: { left: 45, right: 15, bottom: 60, top: 20 },
      xAxis: {
        type: "category",
        data: Object.keys(data),
        axisLabel: { rotate: 30 },
      },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          type: "bar",
          data: Object.values(data),
          barMaxWidth: 32,
          itemStyle: { borderRadius: [6, 6, 0, 0] },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [data]);
  return (
    <div
      ref={ref}
      style={{ height: 280 }}
      role="img"
      aria-label={JSON.stringify(data)}
    />
  );
}
