import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// Register the service worker here (not via the injected registerSW.js tag) so
// that when a new deploy's worker takes over, the page reloads onto the new
// index.html. Without the reload, an open page kept asking for the previous
// deploy's CSS after the new worker had deleted it, and rendered unstyled.
registerSW({ immediate: true })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 minutes
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
)
