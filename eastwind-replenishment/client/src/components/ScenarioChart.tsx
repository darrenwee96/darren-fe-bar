import { useMemo } from 'react';
import { LineChart, useChartUITokens, useThemeColors } from '@databricks/appkit-ui/react';
import { MarkAreaComponent, MarkLineComponent } from 'echarts/components';
import { use as registerEcharts } from 'echarts/core';
import { shortEventName } from '../lib/reasons';

// AppKit registers only the core ECharts components; the forecast shading and festival marker need these two.
registerEcharts([MarkAreaComponent, MarkLineComponent]);

export interface ScenarioRow {
  week: string;
  actual: number | null;
  forecast?: number | null;
  p90?: number | null;
  last_year: number | null;
  /** Festival that falls in this week (e.g. "Mid-Autumn Festival 2026"), drawn as a marker. */
  festival?: string | null;
  [key: string]: unknown;
}

interface ScenarioChartProps {
  rows: ScenarioRow[];
  ariaLabel: string;
  height?: number;
  /** Formats values in the tooltip and value axis, e.g. units or USD thousands. */
  formatValue?: (v: number) => string;
}

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : Math.abs(v) >= 1_000
      ? `${(v / 1_000).toFixed(0)}K`
      : v.toLocaleString('en-US', { maximumFractionDigits: 1 });

/**
 * IBCS scenario notation on one time axis: actual = solid ink line, previous year = thin gray line,
 * forecast = dashed accent line with its p90 band (expected → p90) as a light fill of the same hue.
 * AppKit charts draw NULL as 0, so the ECharts series are built here (ECharts leaves a gap for null) and passed
 * through `options`. The tooltip reads the source row, so it shows the true p90 even where the band is clipped.
 * Festival weeks get a thin dashed vertical marker labelled with the festival, so the peak reads against its cause.
 */
export function ScenarioChart({ rows, ariaLabel, height = 300, formatValue }: ScenarioChartProps) {
  const ui = useChartUITokens();
  const [accent] = useThemeColors('categorical');

  const options = useMemo(() => {
    const fmt = formatValue ?? ((v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
    const weeks = rows.map((r) => r.week);
    const forecastWeeks = rows.filter((r) => r.actual === null && r.forecast != null).map((r) => r.week);
    const hasBand = rows.some((r) => r.p90 != null && r.forecast != null);
    const festivals = rows.filter((r) => r.festival);
    const series: Record<string, unknown>[] = [
      {
        name: 'Last year',
        type: 'line',
        data: rows.map((r) => r.last_year),
        showSymbol: false,
        lineStyle: { width: 1.5, color: ui.axisLabel, opacity: 0.75 },
        itemStyle: { color: ui.axisLabel },
        z: 1,
        markLine:
          festivals.length > 0
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: ui.axisLabel, type: [3, 3], width: 1, opacity: 0.9 },
                label: {
                  show: true,
                  position: 'end',
                  color: ui.axisTitle,
                  fontSize: 11,
                  fontWeight: 600,
                  formatter: (p: { name: string }) => p.name,
                },
                data: festivals.map((r) => ({ name: shortEventName(r.festival ?? ''), xAxis: r.week })),
              }
            : undefined,
      },
      {
        name: 'Actual',
        type: 'line',
        data: rows.map((r) => r.actual),
        showSymbol: false,
        lineStyle: { width: 2, color: ui.axisTitle },
        itemStyle: { color: ui.axisTitle },
        z: 4,
      },
    ];
    if (hasBand) {
      // Stacked pair: an invisible base at the expected forecast plus the (p90 - expected) band on top of it.
      series.push(
        {
          name: 'band-base',
          type: 'line',
          stack: 'p90',
          data: rows.map((r) => (r.p90 != null && r.forecast != null ? r.forecast : null)),
          lineStyle: { opacity: 0 },
          showSymbol: false,
          silent: true,
          tooltip: { show: false },
          z: 2,
        },
        {
          name: 'p90 band',
          type: 'line',
          stack: 'p90',
          data: rows.map((r) => (r.p90 != null && r.forecast != null ? Math.max(0, r.p90 - r.forecast) : null)),
          lineStyle: { opacity: 0 },
          areaStyle: { color: accent, opacity: 0.16 },
          itemStyle: { color: accent, opacity: 0.35 },
          showSymbol: false,
          silent: true,
          z: 2,
        }
      );
    }
    if (forecastWeeks.length > 0) {
      series.push({
        name: 'Forecast',
        type: 'line',
        data: rows.map((r) => r.forecast ?? null),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { width: 2, type: 'dashed', color: accent },
        itemStyle: { color: accent, borderColor: ui.tooltipBg, borderWidth: 2 },
        z: 3,
        markArea: {
          silent: true,
          itemStyle: { color: ui.grid, opacity: 0.45 },
          label: {
            show: true,
            position: 'insideTopLeft',
            color: ui.axisLabel,
            formatter: 'Forecast',
            fontSize: 11,
            padding: [6, 6],
          },
          data: [[{ xAxis: forecastWeeks[0] }, { xAxis: forecastWeeks[forecastWeeks.length - 1] }]],
        },
      });
    }

    const row = (label: string, value: number | null | undefined, swatch: string, dashed = false) =>
      value == null
        ? ''
        : `<div style="display:flex;justify-content:space-between;gap:16px;align-items:center">
             <span style="display:flex;align-items:center;gap:6px">
               <span style="display:inline-block;width:12px;height:0;border-top:2px ${dashed ? 'dashed' : 'solid'} ${swatch}"></span>${label}
             </span>
             <span style="font-variant-numeric:tabular-nums;font-weight:600">${fmt(value)}</span>
           </div>`;

    return {
      xAxis: {
        type: 'category',
        data: weeks,
        boundaryGap: false,
        axisLabel: { color: ui.axisLabel, hideOverlap: true },
        axisLine: { lineStyle: { color: ui.grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: { color: ui.axisLabel, formatter: (v: number) => (formatValue ? formatValue(v) : compact(v)) },
        splitLine: { lineStyle: { color: ui.grid } },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: ui.axisLabel, type: 'dashed' } },
        backgroundColor: ui.tooltipBg,
        borderColor: ui.grid,
        textStyle: { color: ui.axisTitle, fontSize: 12 },
        formatter: (params: { dataIndex: number }[]) => {
          const r = rows[params[0]?.dataIndex ?? 0];
          if (!r) return '';
          const isForecast = r.actual == null;
          const festival = r.festival
            ? `<div style="margin-bottom:4px;color:${ui.axisLabel}">${shortEventName(r.festival)} week</div>`
            : '';
          return `<div style="min-width:170px"><div style="margin-bottom:2px;font-weight:600">Week of ${r.week}</div>${festival}
            ${row('Actual', r.actual, ui.axisTitle)}
            ${isForecast ? row('Forecast', r.forecast, accent, true) : ''}
            ${isForecast ? row('p90', r.p90, accent) : ''}
            ${row('Last year', r.last_year, ui.axisLabel)}</div>`;
        },
      },
      legend: {
        bottom: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: ui.axisLabel, fontSize: 12 },
        data: ['Actual', 'Forecast', ...(hasBand ? ['p90 band'] : []), 'Last year'],
      },
      grid: { left: 4, right: 16, top: 26, bottom: 30, containLabel: true },
      textStyle: { fontFamily: 'DM Sans, system-ui, sans-serif' },
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
