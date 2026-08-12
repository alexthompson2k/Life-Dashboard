/**
 * Weather comes from Open-Meteo: no API key, CORS-enabled, free for personal
 * use. Called straight from the browser — nothing here needs the API server.
 */

export interface CurrentWeather {
  temperature_c: number
  apparent_c: number
  humidity: number
  precipitation: number
  wind_kmh: number
  weather_code: number
  is_day: boolean
}

export interface HourlyPoint {
  time: string
  temperature_c: number
  precipitation_probability: number
  weather_code: number
}

export interface DailyPoint {
  date: string
  weather_code: number
  max_c: number
  min_c: number
  sunrise: string
  sunset: string
  precipitation_probability: number
  wind_max_kmh: number
  uv_index_max: number
}

export interface Forecast {
  current: CurrentWeather
  hourly: HourlyPoint[]
  daily: DailyPoint[]
  timezone: string
  fetched_at: number
}

export interface GeocodeResult {
  name: string
  admin1: string | null
  country: string
  latitude: number
  longitude: number
}

const CACHE_KEY = 'ld.weather.cache'
const CACHE_TTL_MS = 15 * 60 * 1000

export async function fetchForecast(
  latitude: number,
  longitude: number,
  { force = false } = {},
): Promise<Forecast> {
  const cacheId = `${latitude.toFixed(3)},${longitude.toFixed(3)}`

  if (!force) {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { id: string; data: Forecast }
        if (cached.id === cacheId && Date.now() - cached.data.fetched_at < CACHE_TTL_MS) {
          return cached.data
        }
      }
    } catch {
      /* a bad cache entry is not worth failing over */
    }
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
  )
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code')
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max,uv_index_max',
  )
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '7')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
  const json = await res.json()

  const forecast: Forecast = {
    timezone: json.timezone,
    fetched_at: Date.now(),
    current: {
      temperature_c: json.current.temperature_2m,
      apparent_c: json.current.apparent_temperature,
      humidity: json.current.relative_humidity_2m,
      precipitation: json.current.precipitation,
      wind_kmh: json.current.wind_speed_10m,
      weather_code: json.current.weather_code,
      is_day: json.current.is_day === 1,
    },
    hourly: (json.hourly.time as string[]).map((time, i) => ({
      time,
      temperature_c: json.hourly.temperature_2m[i],
      precipitation_probability: json.hourly.precipitation_probability?.[i] ?? 0,
      weather_code: json.hourly.weather_code[i],
    })),
    daily: (json.daily.time as string[]).map((date, i) => ({
      date,
      weather_code: json.daily.weather_code[i],
      max_c: json.daily.temperature_2m_max[i],
      min_c: json.daily.temperature_2m_min[i],
      sunrise: json.daily.sunrise[i],
      sunset: json.daily.sunset[i],
      precipitation_probability: json.daily.precipitation_probability_max?.[i] ?? 0,
      wind_max_kmh: json.daily.wind_speed_10m_max[i],
      uv_index_max: json.daily.uv_index_max?.[i] ?? 0,
    })),
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ id: cacheId, data: forecast }))
  } catch {
    /* cache is best-effort */
  }

  return forecast
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', query)
  url.searchParams.set('count', '5')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Location search returned ${res.status}`)
  const json = await res.json()
  return (json.results ?? []).map((r: Record<string, unknown>) => ({
    name: r.name as string,
    admin1: (r.admin1 as string) ?? null,
    country: r.country as string,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
  }))
}

/** WMO weather interpretation codes. */
const WMO: Record<number, { label: string; icon: string; night?: string }> = {
  0: { label: 'Clear sky', icon: '☀️', night: '🌙' },
  1: { label: 'Mainly clear', icon: '🌤️', night: '🌙' },
  2: { label: 'Partly cloudy', icon: '⛅', night: '☁️' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Freezing fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  56: { label: 'Freezing drizzle', icon: '🌧️' },
  57: { label: 'Freezing drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌦️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  66: { label: 'Freezing rain', icon: '🌧️' },
  67: { label: 'Freezing rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Rain showers', icon: '🌦️' },
  81: { label: 'Rain showers', icon: '🌧️' },
  82: { label: 'Violent showers', icon: '⛈️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  86: { label: 'Snow showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm, hail', icon: '⛈️' },
  99: { label: 'Thunderstorm, hail', icon: '⛈️' },
}

export function describeWeather(code: number, isDay = true) {
  const entry = WMO[code] ?? { label: 'Unknown', icon: '🌡️' }
  return { label: entry.label, icon: !isDay && entry.night ? entry.night : entry.icon }
}

/** A one-line, actionable read on the day rather than raw numbers. */
export function dayAdvice(day: DailyPoint, current: CurrentWeather): string {
  if (day.precipitation_probability >= 60) return 'Take a rain jacket.'
  if (day.uv_index_max >= 7) return 'High UV — sunscreen if you are outside.'
  if (day.wind_max_kmh >= 35) return 'Windy — not a great day for a bike commute.'
  if (day.max_c >= 30) return 'Hot one. Keep water on you.'
  if (day.min_c <= 2) return 'Near freezing tonight — layer up.'
  if (current.apparent_c >= 12 && current.apparent_c <= 24 && day.precipitation_probability < 25) {
    return 'Good conditions for a walk or an outdoor workout.'
  }
  return 'Nothing unusual in the forecast.'
}
