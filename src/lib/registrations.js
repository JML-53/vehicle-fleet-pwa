/**
 * registrations — registration status + license-plate styles (items 26, 27).
 * Status comes from the registration_status view (same 60-day "due soon"
 * window as inspections); plate styles from the plate-styles Edge Function.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const REG_STATUS_META = {
  current:  { label: 'Registered',    badge: 'badge-green' },
  due_soon: { label: 'Renew soon',    badge: 'badge-amber' },
  expired:  { label: 'Reg. expired',  badge: 'badge-red'   },
  unknown:  { label: 'No registration', badge: 'badge-slate' },
}

export const PLATE_CATEGORIES = ['Standard', 'Special Interest', 'College', 'Military', 'Other']

/** Every vehicle's current registration (Dashboard) */
export function useRegistrationStatusAll() {
  return useQuery({
    queryKey: ['registration_status'],
    queryFn: async () => {
      const { data, error } = await supabase.from('registration_status').select('*')
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

/** One vehicle's current registration (Vehicle page header) */
export function useRegistrationStatus(vehicleId) {
  return useQuery({
    queryKey: ['registration_status', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registration_status').select('*').eq('vehicle_id', vehicleId).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
    staleTime: 0,
  })
}

export function usePlateStyles() {
  return useQuery({
    queryKey: ['plate_styles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plate_styles').select('id, slug, name, category, source_image_url, image_path')
        .eq('state', 'VA').order('name')
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

async function callPlateStyles(body) {
  const { data, error } = await supabase.functions.invoke('plate-styles', { body })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Plate style request failed')
  return data
}

/** Fetch the Virginia DMV catalog into plate_styles */
export const syncPlateCatalog = () => callPlateStyles({ action: 'sync' })

/** Cache a style's artwork (first time only) → public URL or null */
export async function ensurePlateImage(styleId) {
  return (await callPlateStyles({ action: 'image', styleId })).url
}

/** Public URL of cached artwork, if any */
export function plateImageUrl(imagePath) {
  if (!imagePath) return null
  return supabase.storage.from('plate-styles').getPublicUrl(imagePath).data.publicUrl
}
