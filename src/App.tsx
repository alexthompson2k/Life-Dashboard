import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthGate } from './components/AuthGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/ui'
import { SettingsProvider } from './lib/settings'

import Overview from './pages/Overview'
import Financials from './pages/Financials'
import Tasks from './pages/Tasks'
import Fitness from './pages/Fitness'
import Habits from './pages/Habits'
import Goals from './pages/Goals'
import Weather from './pages/Weather'
import News from './pages/News'
import Journal from './pages/Journal'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    // The outer boundary catches failures in auth and settings loading, which
    // sit above the router and so are not covered by the per-page one.
    <ErrorBoundary>
      <ToastProvider>
        <AuthGate>
          <SettingsProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Overview />} />
                <Route path="financials" element={<Financials />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="fitness" element={<Fitness />} />
                <Route path="habits" element={<Habits />} />
                <Route path="goals" element={<Goals />} />
                <Route path="weather" element={<Weather />} />
                <Route path="news" element={<News />} />
                <Route path="journal" element={<Journal />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </SettingsProvider>
        </AuthGate>
      </ToastProvider>
    </ErrorBoundary>
  )
}
