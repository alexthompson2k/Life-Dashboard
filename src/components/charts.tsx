import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Table2, LineChart as LineIcon } from 'lucide-react'

/**
 * Chart layer.
 *
 * Colour rules that are load-bearing here:
 *  - Categorical hues are assigned by fixed slot, never by rank, so a filtered
 *    chart never repaints the survivors.
 *  - Slots run 1..8 and are never cycled; callers fold the tail into "Other".
 *  - One y-axis, always. Two measures of different scale get two charts.
 *  - Every chart offers a table view — that is the relief for the light-mode
 *    slots that sit under 3:1 contrast, and the accessible fallback generally.
 */

const SLOT_VARS = [
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--series-5',
  '--series-6',
  '--series-7',
  '--series-8',
] as const

export interface Palette {
  series: string[]
  text: string
  textSecondary: string
  muted: string
  grid: string
  surface: string
  border: string
  good: string
  warning: string
  critical: string
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    series: SLOT_VARS.map((s) => v(s)),
    text: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    muted: v('--text-muted'),
    grid: v('--grid'),
    surface: v('--surface-1'),
    border: v('--border'),
    good: v('--status-good'),
    warning: v('--status-warning'),
    critical: v('--status-critical'),
  }
}

/**
 * Recharts writes colours as SVG presentation attributes, which do not resolve
 * `var(...)`. So the tokens are read to concrete values and re-read whenever
 * the theme attribute flips.
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() =>
    typeof window === 'undefined'
      ? {
          series: [],
          text: '#000',
          textSecondary: '#555',
          muted: '#888',
          grid: '#eee',
          surface: '#fff',
          border: '#ddd',
          good: '#008300',
          warning: '#eda100',
          critical: '#e34948',
        }
      : readPalette(),
  )

  useEffect(() => {
    const update = () => setPalette(readPalette())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return palette
}

/** Slot is 1-indexed to match the palette documentation. */
export function slotColor(palette: Palette, slot: number) {
  return palette.series[(slot - 1) % palette.series.length] ?? palette.series[0]
}

/* ------------------------------------------------------------------ */
/* Frame: title, legend, table toggle                                  */
/* ------------------------------------------------------------------ */

export interface SeriesDef {
  key: string
  label: string
  slot: number
  kind?: 'line' | 'area' | 'bar'
  dashed?: boolean
}

export function ChartFrame({
  title,
  subtitle,
  series,
  action,
  children,
  table,
  height = 260,
}: {
  title: string
  subtitle?: string
  series: SeriesDef[]
  action?: ReactNode
  children: ReactNode
  table: ReactNode
  height?: number
}) {
  const palette = usePalette()
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    <section className="card flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <button
            onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
            className="btn btn-ghost !px-2 !py-1.5"
            aria-label={view === 'chart' ? 'Show data as a table' : 'Show chart'}
            title={view === 'chart' ? 'Show data as a table' : 'Show chart'}
          >
            {view === 'chart' ? <Table2 size={15} /> : <LineIcon size={15} />}
          </button>
        </div>
      </header>

      {/* A legend is always present for two or more series: identity must never
          rest on colour alone. One series is named by the title instead. */}
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5">
          {series.map((s) => (
            <span
              key={s.key}
              className="flex items-center gap-1.5 text-xs text-ink-secondary"
            >
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 rounded-full"
                style={{
                  background: slotColor(palette, s.slot),
                  ...(s.dashed
                    ? {
                        background: `repeating-linear-gradient(90deg, ${slotColor(
                          palette,
                          s.slot,
                        )} 0 4px, transparent 4px 7px)`,
                      }
                    : {}),
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="p-4">
        {view === 'chart' ? (
          <div style={{ height }}>{children}</div>
        ) : (
          <div className="max-h-[320px] overflow-auto">{table}</div>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

interface TooltipEntry {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
  seriesLabels,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  labelFormat?: (v: string) => string
  valueFormat?: (v: number, key: string) => string
  seriesLabels: Record<string, string>
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-ink-primary">
        {labelFormat ? labelFormat(String(label ?? '')) : String(label ?? '')}
      </p>
      <div className="space-y-1">
        {payload.map((entry, i) => {
          const key = String(entry.dataKey ?? entry.name ?? i)
          const value =
            typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0)
          return (
            <div key={key + i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink-secondary">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: entry.color }}
                />
                {seriesLabels[key] ?? key}
              </span>
              <span className="tnum font-medium text-ink-primary">
                {valueFormat ? valueFormat(value, key) : value.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Time series                                                         */
/* ------------------------------------------------------------------ */

const AXIS_FONT = 11

/** Recharts accepts any row shape; `object` keeps typed row models usable. */
export function TimeSeriesChart<T extends object>({
  data,
  xKey,
  series,
  height = 260,
  xFormat,
  yFormat,
  tooltipLabelFormat,
  yDomain,
  title,
  subtitle,
  action,
}: {
  data: T[]
  xKey: string
  series: SeriesDef[]
  height?: number
  xFormat?: (v: string) => string
  yFormat?: (v: number) => string
  tooltipLabelFormat?: (v: string) => string
  /** Accepts Recharts domain expressions such as `'dataMin - 5'`. */
  yDomain?: [number | string, number | string]
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  const palette = usePalette()
  const labels = useMemo(
    () => Object.fromEntries(series.map((s) => [s.key, s.label])),
    [series],
  )

  const table = (
    <DataTable
      data={data}
      columns={[
        {
          key: xKey,
          label: 'Date',
          format: (v) => (xFormat ? xFormat(String(v)) : String(v)),
        },
        ...series.map((s) => ({
          key: s.key,
          label: s.label,
          align: 'right' as const,
          format: (v: unknown) =>
            typeof v === 'number' ? (yFormat ? yFormat(v) : v.toLocaleString()) : '—',
        })),
      ]}
    />
  )

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      series={series}
      action={action}
      table={table}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <defs>
            {series
              .filter((s) => s.kind === 'area')
              .map((s) => (
                <linearGradient
                  key={s.key}
                  id={`fill-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  {/* An area fill is a wash, never a saturated block. */}
                  <stop
                    offset="0%"
                    stopColor={slotColor(palette, s.slot)}
                    stopOpacity={0.14}
                  />
                  <stop
                    offset="100%"
                    stopColor={slotColor(palette, s.slot)}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              ))}
          </defs>

          <CartesianGrid stroke={palette.grid} strokeWidth={1} vertical={false} />

          <XAxis
            dataKey={xKey}
            tickFormatter={xFormat}
            tick={{ fill: palette.textSecondary, fontSize: AXIS_FONT }}
            tickLine={false}
            axisLine={{ stroke: palette.grid }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={yFormat}
            tick={{ fill: palette.textSecondary, fontSize: AXIS_FONT }}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={yDomain}
          />

          <Tooltip
            cursor={{ stroke: palette.border, strokeWidth: 1 }}
            content={
              <ChartTooltip
                seriesLabels={labels}
                labelFormat={tooltipLabelFormat ?? xFormat}
                valueFormat={(v) => (yFormat ? yFormat(v) : v.toLocaleString())}
              />
            }
          />

          {series.map((s) => {
            const color = slotColor(palette, s.slot)
            if (s.kind === 'bar') {
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={color}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              )
            }
            if (s.kind === 'area') {
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: color,
                    // 2px surface ring keeps the marker legible where lines cross.
                    stroke: palette.surface,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              )
            }
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '4 3' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, fill: color, stroke: palette.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Horizontal category bars — built in plain HTML                      */
/* ------------------------------------------------------------------ */

export function CategoryBars({
  title,
  subtitle,
  rows,
  format,
  action,
  slot = 1,
  colorBySlot = false,
}: {
  title: string
  subtitle?: string
  rows: Array<{ label: string; value: number; slot?: number; note?: string }>
  format: (v: number) => string
  action?: ReactNode
  slot?: number
  colorBySlot?: boolean
}) {
  const palette = usePalette()
  const max = Math.max(...rows.map((r) => r.value), 1)

  const table = (
    <DataTable
      data={rows}
      columns={[
        { key: 'label', label: 'Category' },
        { key: 'value', label: 'Amount', align: 'right', format: (v) => format(Number(v)) },
      ]}
    />
  )

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      // A single measure across nominal categories is one series, so no legend.
      series={colorBySlot ? [] : []}
      action={action}
      table={table}
      height={Math.max(160, rows.length * 34)}
    >
      <div className="flex h-full flex-col justify-center gap-2.5">
        {rows.map((row) => {
          const color = slotColor(palette, colorBySlot ? (row.slot ?? slot) : slot)
          return (
            <div
              key={row.label}
              className="group grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3"
            >
              <span className="truncate text-xs text-ink-secondary" title={row.label}>
                {row.label}
              </span>
              <div className="h-4 w-full">
                <div
                  className="h-4 transition-[width] duration-500"
                  style={{
                    width: `${Math.max(2, (row.value / max) * 100)}%`,
                    background: color,
                    // Rounded data-end, square against the baseline.
                    borderRadius: '0 4px 4px 0',
                  }}
                  title={`${row.label}: ${format(row.value)}`}
                />
              </div>
              {/* Direct label at the bar tip — also the relief for low-contrast slots. */}
              <span className="tnum whitespace-nowrap text-xs font-medium text-ink-primary">
                {format(row.value)}
                {row.note && <span className="ml-1.5 text-ink-muted">{row.note}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </ChartFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Table view                                                          */
/* ------------------------------------------------------------------ */

export function DataTable<T extends object>({
  data,
  columns,
}: {
  data: T[]
  columns: Array<{
    key: string
    label: string
    align?: 'left' | 'right'
    format?: (value: unknown, row: T) => string
  }>
}) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-surface-1">
        <tr className="border-b border-line text-ink-secondary">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={`px-2 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => {
          const cells = row as Record<string, unknown>
          return (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`tnum px-2 py-1.5 text-ink-primary ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {c.format ? c.format(cells[c.key], row) : String(cells[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

export function Sparkline({
  values,
  slot = 1,
  width = 120,
  height = 32,
}: {
  values: number[]
  slot?: number
  width?: number
  height?: number
}) {
  const palette = usePalette()
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => [
    i * step,
    height - ((v - min) / span) * (height - 4) - 2,
  ])
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const last = points[points.length - 1]

  return (
    <svg width={width} height={height} role="img" aria-hidden className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke={slotColor(palette, slot)}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={3}
        fill={slotColor(palette, slot)}
        stroke={palette.surface}
        strokeWidth={2}
      />
    </svg>
  )
}
