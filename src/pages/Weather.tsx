import { useCallback, useEffect, useMemo, useState } from 'react'
import { Droplets, MapPin, RefreshCw, Search, Sunrise, Sunset, Wind } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { Button, Callout, Card, Skeleton, Stat, useToast } from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import {
  dayAdvice,
  describeWeather,
  fetchForecast,
  geocode,
  type Forecast,
  type GeocodeResult,
} from '../lib/weather'
import { cToDisplay, formatTemp, kmhToDisplay, speedUnit, tempUnit } from '../lib/format'

export default function Weather() {
  const { settings, save } = useSettings()
  const toast = useToast()
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const units = settings.unit_system

  const load = useCallback(
    async (force = false) => {
      setLoading(true)
      setError(null)
      try {
        setForecast(await fetchForecast(settings.latitude, settings.longitude, { force }))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [settings.latitude, settings.longitude],
  )

  useEffect(() => {
    void load()
  }, [load])

  const hourly = useMemo(() => {
    if (!forecast) return []
    const now = Date.now()
    return forecast.hourly
      .filter((h) => new Date(h.time).getTime() >= now - 3600_000)
      .slice(0, 24)
      .map((h) => ({
        time: h.time,
        temp: Number(cToDisplay(h.temperature_c, units).toFixed(1)),
        rain: h.precipitation_probability,
        code: h.weather_code,
      }))
  }, [forecast, units])

  const today = forecast?.daily[0]
  const current = forecast?.current

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Weather</h1>
          <p className="flex items-center gap-1 text-xs text-ink-secondary">
            <MapPin size={11} /> {settings.location_name}
          </p>
        </div>
        <Button onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <LocationSearch
        onPick={async (place) => {
          const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ')
          await save({
            location_name: label,
            latitude: place.latitude,
            longitude: place.longitude,
          })
          toast.push(`Location set to ${place.name}`)
        }}
      />

      {error && (
        <Callout intent="warning">
          Could not load the forecast: {error} Open-Meteo may be unreachable from this
          network.
        </Callout>
      )}

      {loading && !forecast ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        forecast &&
        current &&
        today && (
          <>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <span className="text-5xl" aria-hidden>
                    {describeWeather(current.weather_code, current.is_day).icon}
                  </span>
                  <div>
                    <p className="tnum text-4xl font-semibold text-ink-primary">
                      {formatTemp(current.temperature_c, units)}
                    </p>
                    <p className="text-sm text-ink-secondary">
                      {describeWeather(current.weather_code, current.is_day).label} · feels
                      like {formatTemp(current.apparent_c, units)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <Metric
                    icon={<Droplets size={14} />}
                    label="Humidity"
                    value={`${current.humidity}%`}
                  />
                  <Metric
                    icon={<Wind size={14} />}
                    label="Wind"
                    value={`${kmhToDisplay(current.wind_kmh, units).toFixed(0)} ${speedUnit(units)}`}
                  />
                  <Metric
                    icon={<Sunrise size={14} />}
                    label="Sunrise"
                    value={new Date(today.sunrise).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  />
                  <Metric
                    icon={<Sunset size={14} />}
                    label="Sunset"
                    value={new Date(today.sunset).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  />
                </div>
              </div>

              <p className="mt-4 border-t border-line pt-3 text-sm text-ink-secondary">
                {dayAdvice(today, current)}
              </p>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Today's high"
                value={formatTemp(today.max_c, units)}
                hint={`Low ${formatTemp(today.min_c, units)}`}
              />
              <Stat
                label="Chance of rain"
                value={`${today.precipitation_probability}%`}
                intent={today.precipitation_probability >= 60 ? 'bad' : 'neutral'}
              />
              <Stat
                label="Max wind"
                value={`${kmhToDisplay(today.wind_max_kmh, units).toFixed(0)} ${speedUnit(units)}`}
              />
              <Stat
                label="UV index"
                value={today.uv_index_max.toFixed(0)}
                intent={today.uv_index_max >= 7 ? 'bad' : 'neutral'}
                hint={today.uv_index_max >= 7 ? 'Sunscreen weather' : 'Low risk'}
              />
            </div>

            {/* Temperature and rain chance have different units, so they get
                separate charts rather than a second y-axis. */}
            <div className="grid gap-4 xl:grid-cols-2">
              <TimeSeriesChart
                title="Temperature — next 24 hours"
                data={hourly}
                xKey="time"
                xFormat={(v) =>
                  new Date(v)
                    .toLocaleTimeString('en-US', { hour: 'numeric' })
                    .replace(' ', '')
                }
                yFormat={(v) => `${v.toFixed(0)}${tempUnit(units)}`}
                yDomain={['dataMin - 2', 'dataMax + 2']}
                series={[{ key: 'temp', label: 'Temperature', slot: 2, kind: 'area' }]}
              />
              <TimeSeriesChart
                title="Chance of rain — next 24 hours"
                data={hourly}
                xKey="time"
                xFormat={(v) =>
                  new Date(v)
                    .toLocaleTimeString('en-US', { hour: 'numeric' })
                    .replace(' ', '')
                }
                yFormat={(v) => `${v.toFixed(0)}%`}
                yDomain={[0, 100]}
                series={[
                  { key: 'rain', label: 'Precipitation chance', slot: 1, kind: 'bar' },
                ]}
              />
            </div>

            <Card title="7-day forecast">
              <ul className="divide-y divide-line">
                {forecast.daily.map((day, i) => {
                  const described = describeWeather(day.weather_code)
                  return (
                    <li
                      key={day.date}
                      className="grid grid-cols-[5rem_2rem_1fr_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="text-xs font-medium text-ink-primary">
                        {i === 0
                          ? 'Today'
                          : new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'short',
                              day: 'numeric',
                            })}
                      </span>
                      <span
                        className="text-lg"
                        aria-label={described.label}
                        title={described.label}
                      >
                        {described.icon}
                      </span>
                      <span className="truncate text-xs text-ink-secondary">
                        {described.label}
                        {day.precipitation_probability >= 30 && (
                          <span className="ml-2 text-ink-muted">
                            {day.precipitation_probability}% rain
                          </span>
                        )}
                      </span>
                      <span className="tnum whitespace-nowrap text-xs">
                        <span className="font-medium text-ink-primary">
                          {formatTemp(day.max_c, units)}
                        </span>
                        <span className="ml-2 text-ink-muted">
                          {formatTemp(day.min_c, units)}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </>
        )
      )}
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] text-ink-muted">
        {icon}
        {label}
      </p>
      <p className="tnum text-sm font-medium text-ink-primary">{value}</p>
    </div>
  )
}

function LocationSearch({ onPick }: { onPick: (place: GeocodeResult) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      setResults(await geocode(query.trim()))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Change location — search a city"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          aria-label="Search for a city"
        />
        <Button onClick={() => void search()} disabled={searching}>
          <Search size={15} /> Search
        </Button>
      </div>

      {results.length > 0 && (
        <div className="card divide-y divide-line">
          {results.map((r) => (
            <button
              key={`${r.latitude},${r.longitude}`}
              onClick={async () => {
                await onPick(r)
                setResults([])
                setQuery('')
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-2"
            >
              <MapPin size={13} className="text-ink-muted" />
              <span className="text-ink-primary">{r.name}</span>
              <span className="text-xs text-ink-secondary">
                {[r.admin1, r.country].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
