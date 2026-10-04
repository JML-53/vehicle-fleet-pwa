/**
 * enums — single source for Postgres enum values used in dropdowns.
 *
 * Values are read live from the database via the enum_values() RPC
 * (migration 20261004_service_category_enum.sql), so a value added in the DB
 * shows up everywhere without a code change. `fallback` is used only if the
 * RPC is unavailable (e.g. migration not yet applied).
 *
 * EDITABLE_ENUMS is also the registry for roadmap item 10 (admin enum editor):
 * every enum listed here must be manageable from that screen.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const EDITABLE_ENUMS = {
  service_category: {
    label: 'Service Category',
    usedBy: ['service_records.category', 'maintenance_schedule.category'],
    fallback: [
      'oil_change', 'brakes', 'tires', 'suspension', 'electrical', 'ac_hvac',
      'engine', 'transmission', 'axles', 'interior', 'inspection', 'registration',
      'modification', 'diagnostic', 'fuel_system', 'cooling', 'other',
    ],
  },
}

export function useEnumValues(enumName) {
  const fallback = EDITABLE_ENUMS[enumName]?.fallback ?? []
  const { data } = useQuery({
    queryKey: ['enum_values', enumName],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enum_values', { enum_name: enumName })
      if (error) throw error
      return data
    },
    staleTime: 0,
    retry: false,
  })
  return data?.length ? data : fallback
}

/** 'fuel_system' → 'fuel system' */
export function enumLabel(value) {
  return (value || '').replace(/_/g, ' ')
}
