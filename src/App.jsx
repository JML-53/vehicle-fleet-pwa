import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import VehicleList from '@/pages/VehicleList'
import VehicleDetail from '@/pages/VehicleDetail'
import AddEditVehicle from '@/pages/AddEditVehicle'
import AddServiceRecord from '@/pages/AddServiceRecord'
import AddPendingWork from '@/pages/AddPendingWork'
import AddMaintenanceItem from '@/pages/AddMaintenanceItem'
import UploadDocument from '@/pages/UploadDocument'
import AddEditNote from '@/pages/AddEditNote'
import AddEditSpec from '@/pages/AddEditSpec'
import AddEditDiagnostic from '@/pages/AddEditDiagnostic'
import AddEditMod from '@/pages/AddEditMod'
import AddEditRegistration from '@/pages/AddEditRegistration'
import PendingWorkPage from '@/pages/PendingWorkPage'
import MaintenanceSchedulePage from '@/pages/MaintenanceSchedulePage'
import DocumentsPage from '@/pages/DocumentsPage'
import RoadmapPage from '@/pages/RoadmapPage'
import AddEditRoadmapItem from '@/pages/AddEditRoadmapItem'
import AddEditServiceRecord from '@/pages/AddEditServiceRecord'
import AddEditServiceVisit from '@/pages/AddEditServiceVisit'

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

        {/* Vehicles */}
        <Route path="vehicles" element={<VehicleList />} />
        <Route path="vehicles/new" element={<AddEditVehicle />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="vehicles/:id/edit" element={<AddEditVehicle />} />

        {/* Per-vehicle forms */}
        <Route path="vehicles/:id/add-service"           element={<AddServiceRecord />} />
        <Route path="vehicles/:id/add-visit"             element={<AddEditServiceVisit />} />
        <Route path="vehicles/:id/visits/:visitId/edit"  element={<AddEditServiceVisit />} />
        <Route path="vehicles/:id/service/:recordId/edit" element={<AddEditServiceRecord />} />
        <Route path="vehicles/:id/add-pending"           element={<AddPendingWork />} />
        <Route path="vehicles/:id/add-maintenance"       element={<AddMaintenanceItem />} />
        <Route path="vehicles/:id/upload-document"       element={<UploadDocument />} />
        <Route path="vehicles/:id/add-note"              element={<AddEditNote />} />
        <Route path="vehicles/:id/add-spec"              element={<AddEditSpec />} />
        <Route path="vehicles/:id/add-diagnostic"        element={<AddEditDiagnostic />} />
        <Route path="vehicles/:id/add-mod"               element={<AddEditMod />} />
        <Route path="vehicles/:id/add-registration"      element={<AddEditRegistration />} />

        {/* Fleet-wide views */}
        <Route path="pending"            element={<PendingWorkPage />} />
        <Route path="maintenance"        element={<MaintenanceSchedulePage />} />
        <Route path="documents"          element={<DocumentsPage />} />
        <Route path="documents/upload"   element={<UploadDocument />} />

        {/* Dev Roadmap */}
        <Route path="roadmap"                    element={<RoadmapPage />} />
        <Route path="roadmap/new"                element={<AddEditRoadmapItem />} />
        <Route path="roadmap/:itemId/edit"       element={<AddEditRoadmapItem />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
