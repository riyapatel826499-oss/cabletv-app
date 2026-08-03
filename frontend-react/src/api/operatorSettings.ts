import api from '../api/client';

export interface OperatorSettings {
  app_name: string;
  business_name: string;
  phone: string;
  care_phone: string;
  email: string;
  upi_id: string;
  upi_reconnect_id: string;
  map_lat: number;
  map_lng: number;
  map_radius_km: number;
  prorata_enabled: boolean;
  primary_color: string;
  secondary_color: string;
}

export interface PortalSettings {
  business_name: string;
  phone: string;
  care_phone: string;
  email: string;
  app_name: string;
  upi_id: string;
  upi_reconnect_id: string;
  prorata_enabled: boolean;
}

let _settingsCache: { data: any; ts: number } | null = null;

async function _fetch<T>(endpoint: string, cache = true): Promise<T> {
  if (cache && _settingsCache && Date.now() - _settingsCache.ts < 300_000) {
    return _settingsCache.data as T;
  }
  const res = await api.get(endpoint);
  if (cache) {
    _settingsCache = { data: res.data, ts: Date.now() };
  }
  return res.data as T;
}

export function invalidateSettingsCache() {
  _settingsCache = null;
}

/** Fetch operator settings (requires auth). */
export function fetchOperatorSettings(): Promise<OperatorSettings> {
  return _fetch<OperatorSettings>('/operator-settings');
}

/** Fetch public portal settings (no auth). */
export function fetchPortalSettings(): Promise<PortalSettings> {
  return _fetch<PortalSettings>('/portal/settings');
}
