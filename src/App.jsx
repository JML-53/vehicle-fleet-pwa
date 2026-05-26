import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import VehicleList from '@/pages/VehicleList'
import VehicleDetail from '@/pages/VehicleDetail'
import AddServiceRecord from '@/pages/AddServiceRecord'
import PendingWorkPage from '@/pages/PendingWorkPage'
import MaintenanceSchedulePage from '@/pages/MaintenanceSchedulePage'
import DocumentsPage from '@/pages/DocumentsPage'

function RequireAuth({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  return session ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="vehicles" element={<VehicleList />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="vehicles/:id/add-service" element={<AddServiceRecord />} />
        <Route path="pending" element={<PendingWorkPage />} />
        <Route path="maintenance" element={<MaintenanceSchedulePage />} />
        <Route path="documents" element={<DocumentsPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
