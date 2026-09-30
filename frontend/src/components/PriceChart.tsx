"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BaseMove, Candle, Earnings } from "@/lib/api";
import { pct, shortDate, signColor } from "@/lib/format";
import { cssVar, useTheme } from "@/lib/theme";

interface Palette {
  up: string;
  down: string;
  earnings: string;
  grid: string;
  text: string;
  border: string;
}

const DEFAULT_PALETTE: Palette = {
  up: "#34d399",
  down: "#ff4d6d",
  earnings: "#ffc53d",
  grid: "rgba(255,255,255,0.05)",
  text: "#80868d",
  border: "#25292e",
};

/**
 * Resolve any CSS color (including Tailwind's oklch values) to rgba(), which
 * the chart library understands, by painting one pixel on a canvas.
 */
function toRgba(color: string, alpha?: number): string {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${alpha ?? +(a / 255).toFixed(3)})`;
}

/** Chart colors come from the theme's CSS variables. */
function readPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  return {
    up: toRgba(cssVar("--up")),
    down: toRgba(cssVar("--down")),
    earnings: toRgba(cssVar("--warn")),
    grid: toRgba(cssVar("--chart-grid")),
    text: toRgba(cssVar("--chart-text")),
    border: toRgba(cssVar("--border")),
  };
}

function withAlpha(color: string, alpha: number): string {
  return color.startsWith("rgba(") ? color.replace(/,[\d.]+\)$/, `,${alpha})`) : color;
}
// Clicks within this many pixels of a move/earnings marker select that day.
const SNAP_PX = 14;

interface Props {
  candles: Candle[];
  moves: BaseMove[];
  earnings: Earnings[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

function timeToIso(time: Time): string {
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
  const { year, month, day } = time;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function PriceChart({
  candles,
  moves,
  earnings,
  selectedDate,
  onSelectDate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const onSelectRef = useRef(onSelectDate);
  const snapDatesRef = useRef<string[]>([]);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [band, setBand] = useState<{ x: number; width: number; bottom: number } | null>(null);
  const [width, setWidth] = useState(0);
  const { theme } = useTheme();
  // Re-read the CSS variables whenever the theme flips.
  const palette = useMemo(() => (theme ? readPalette() : DEFAULT_PALETTE), [theme]);

  const earningsInView = useMemo(
    () => earnings.filter((e) => candles.length && e.date >= candles[0].time),
    [earnings, candles],
  );

  useEffect(() => {
    onSelectRef.current = onSelectDate;
    snapDatesRef.current = [...moves.map((m) => m.date), ...earningsInView.map((e) => e.date)];
  });

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: DEFAULT_PALETTE.text,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: DEFAULT_PALETTE.grid },
        horzLines: { color: DEFAULT_PALETTE.grid },
      },
      rightPriceScale: { borderColor: DEFAULT_PALETTE.border },
      timeScale: { borderColor: DEFAULT_PALETTE.border },
      crosshair: { mode: 0 },
      // Leave the mouse wheel to the page; drag to pan, pinch/axis-drag to zoom.
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const price = chart.addSeries(CandlestickSeries, {
      borderVisible: false,
    });
    price.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });

    const handleClick = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || !param.point) return;
      const clicked = timeToIso(param.time);
      // Bars are only a few pixels wide on long ranges: snap to a nearby marker.
      let best = clicked;
      let bestDist = SNAP_PX;
      for (const d of snapDatesRef.current) {
        const x = chart.timeScale().timeToCoordinate(d);
        if (x === null) continue;
        const dist = Math.abs(x - param.point.x);
        if (dist < bestDist) {
          best = d;
          bestDist = dist;
        }
      }
      onSelectRef.current(best);
    };
    const handleMove = (param: MouseEventParams<Time>) => {
      setHoverDate(param.time === undefined ? null : timeToIso(param.time));
    };
    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleMove);

    chartRef.current = chart;
    priceRef.current = price;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(price, []);

    return () => {
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleMove);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Theme colors.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
    priceRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
  }, [palette]);

  // Data.
  useEffect(() => {
    if (!priceRef.current || !volumeRef.current) return;
    priceRef.current.setData(
      candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    );
    volumeRef.current.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: withAlpha(c.close >= c.open ? palette.up : palette.down, 0.3),
      })),
    );
  }, [candles, palette]);

  useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Band behind the selected day, repositioned whenever the chart pans or zooms.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();
    const update = () => {
      const x = selectedDate ? timeScale.timeToCoordinate(selectedDate) : null;
      const spacing = timeScale.options().barSpacing;
      setBand(x === null ? null : { x, width: Math.max(spacing, 8), bottom: timeScale.height() });
      setWidth(timeScale.width());
    };
    update();
    timeScale.subscribeVisibleLogicalRangeChange(update);
    timeScale.subscribeSizeChange(update);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(update);
      timeScale.unsubscribeSizeChange(update);
    };
  }, [selectedDate, candles]);

  // Markers for big moves and earnings. Percent labels only when there's room for them.
  const showLabels = width > 0 && moves.length * 70 <= width;
  useEffect(() => {
    if (!markersRef.current) return;
    const markers: SeriesMarker<Time>[] = [
      ...moves.map((m) => ({
        time: m.date,
        position: m.return_pct >= 0 ? ("belowBar" as const) : ("aboveBar" as const),
        shape: m.return_pct >= 0 ? ("arrowUp" as const) : ("arrowDown" as const),
        color: m.return_pct >= 0 ? palette.up : palette.down,
        size: m.date === selectedDate ? 2 : 1,
        text:
          showLabels || m.date === selectedDate
            ? `${m.return_pct >= 0 ? "+" : ""}${m.return_pct.toFixed(1)}%`
            : "",
      })),
      ...earningsInView.map((e) => ({
        time: e.date,
        position: "aboveBar" as const,
        shape: "circle" as const,
        color: palette.earnings,
        size: 1,
        text: "E",
      })),
    ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    markersRef.current.setMarkers(markers);
  }, [moves, earningsInView, selectedDate, showLabels, palette]);

  // OHLC legend for the hovered (or last) bar.
  const legendIndex = useMemo(() => {
    const i = hoverDate ? candles.findIndex((c) => c.time === hoverDate) : -1;
    return i >= 0 ? i : candles.length - 1;
  }, [hoverDate, candles]);
  const bar = candles[legendIndex];
  const prev = candles[legendIndex - 1];
  const change = bar && prev ? (bar.close / prev.close - 1) * 100 : null;

  return (
    <div className="relative">
      {bar && (
        <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-subtle">
          <span className="font-medium text-fg">{shortDate(bar.time)}</span>
          <span className="hidden sm:inline">O {bar.open.toFixed(2)}</span>
          <span className="hidden sm:inline">H {bar.high.toFixed(2)}</span>
          <span className="hidden sm:inline">L {bar.low.toFixed(2)}</span>
          <span>C {bar.close.toFixed(2)}</span>
          <span className={signColor(change)}>{pct(change)}</span>
        </div>
      )}
      {band && (
        <div
          className="pointer-events-none absolute top-0 z-0 rounded-sm border-x border-accent/50 bg-accent/10"
          style={{ left: band.x - band.width / 2, width: band.width, bottom: band.bottom }}
        />
      )}
      <div ref={containerRef} className="h-[340px] w-full cursor-crosshair sm:h-[420px]" />
    </div>
  );
}
