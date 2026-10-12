import { useMemo } from 'react';
import { LineChart, useChartUITokens, useThemeColors } from '@databricks/appkit-ui/react';

export interface ScenarioRow {
  week: string;
  actual: number | null;
  forecast?: number | null;
  last_year: number | null;
  [key: string]: unknown;
}

interface ScenarioChartProps {
  rows: ScenarioRow[];
  ariaLabel: string;
  height?: number;
  /** Formats values in the tooltip and value axis, e.g. units or USD thousands. */
  formatValue?: (v: number) => string;
}

/**
 * IBCS scenario notation on one time axis: actual = solid dark line, previous year = thin muted line,
 * forecast = dashed accent line over a shaded forecast band. AppKit charts draw NULL as 0, so the series are
 * built here (ECharts leaves a gap for null) and passed through `options`.
 */
export function ScenarioChart({ rows, ariaLabel, height = 300, formatValue }: ScenarioChartProps) {
  const ui = useChartUITokens();
  const [accent] = useThemeColors('categorical');

  const options = useMemo(() => {
    const weeks = rows.map((r) => r.week);
    const forecastWeeks = rows.filter((r) => r.actual === null && r.forecast != null).map((r) => r.week);
    const fmt = (v: unknown) =>
      typeof v === 'number'
        ? formatValue
          ? formatValue(v)
          : v.toLocaleString('en-US')
        : typeof v === 'string'
          ? v
          : '—';
    const series: Record<string, unknown>[] = [
      {
        name: 'Actual',
        type: 'line',
        data: rows.map((r) => r.actual),
        showSymbol: false,
        lineStyle: { width: 2.5, color: ui.axisTitle },
        itemStyle: { color: ui.axisTitle },
        z: 3,
      },
      {
        name: 'Last year',
        type: 'line',
        data: rows.map((r) => r.last_year),
        showSymbol: false,
        lineStyle: { width: 1.5, color: ui.axisLabel, opacity: 0.7 },
        itemStyle: { color: ui.axisLabel },
        z: 1,
      },
    ];
    if (forecastWeeks.length > 0) {
      series.push({
        name: 'Forecast',
        type: 'line',
        data: rows.map((r) => r.forecast ?? null),
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { width: 2.5, type: 'dashed', color: accent },
        itemStyle: { color: accent },
        z: 2,
        markArea: {
          silent: true,
          itemStyle: { color: ui.grid, opacity: 0.8 },
          label: { show: true, position: 'insideTop', color: ui.axisLabel, formatter: 'Forecast' },
          data: [[{ xAxis: forecastWeeks[0] }, { xAxis: forecastWeeks[forecastWeeks.length - 1] }]],
        },
      });
    }
    return {
      xAxis: {
        type: 'category',
        data: weeks,
        boundaryGap: false,
        axisLabel: { color: ui.axisLabel },
        axisLine: { lineStyle: { color: ui.grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: ui.axisLabel, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: ui.grid } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ui.tooltipBg,
        textStyle: { color: ui.axisTitle },
        valueFormatter: (v: unknown) => (v == null ? '—' : fmt(v)),
      },
      legend: { top: 'bottom', textStyle: { color: ui.axisTitle } },
      grid: { left: 8, right: 16, top: 24, bottom: 40, containLabel: true },
      series,
    };
  }, [rows, ui, accent, formatValue]);

  return (
    <LineChart
      data={rows}
      xKey="week"
      yKey={['actual', 'last_year']}
      options={options}
      height={height}
      ariaLabel={ariaLabel}
    />
  );
}
