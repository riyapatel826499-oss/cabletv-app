import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Phone, Satellite, Search, Crosshair } from 'lucide-react';
import { mapApi } from '../api';

// ── Your collection area ───────────────────────────────────────────────────
// Hardcoded so it always centers here (no env/rebuild needed). Change these two
// numbers if your area ever moves. Right-click your area's centre in Google Maps
// to copy the lat,lng.
const HOME_CENTER: [number, number] = [
  Number(import.meta.env.VITE_HOME_LAT) || 11.0974473,
  Number(import.meta.env.VITE_HOME_LNG) || 77.2013613,
];
// How far (km) the map may roam from the centre. Keeps you in your area.
const AREA_RADIUS_KM = Number(import.meta.env.VITE_AREA_RADIUS_KM) || 3;

const _latPad = AREA_RADIUS_KM / 111;
const _lngPad = AREA_RADIUS_KM / (111 * Math.cos((HOME_CENTER[0] * Math.PI) / 180));
const MAX_BOUNDS: L.LatLngBoundsExpression = [
  [HOME_CENTER[0] - _latPad, HOME_CENTER[1] - _lngPad],
  [HOME_CENTER[0] + _latPad, HOME_CENTER[1] + _lngPad],
];

// Theme-aware colours (follow the app's dark/light CSS variables).
const S = {
  panel: { background: 'var(--bg-card)', color: 'var(--text)' } as const,
  text: { color: 'var(--text)' } as const,
  textLight: { color: 'var(--text-light)' } as const,
  border: '1px solid rgba(128,128,128,0.25)',
};

type MapCustomer = {
  customer_id: string;
  name: string;
  phone: string;
  phone2?: string | null;
  area?: string | null;
  address?: string | null;
  latitude: number;
  longitude: number;
  is_paid: boolean;
  plan_amount?: number | null;
};

type MapResponse = {
  month: string;
  count: number;
  missing_location: number;
  customers: MapCustomer[];
};

type NoLocCustomer = {
  customer_id: string;
  name: string;
  phone: string;
  area?: string | null;
  address?: string | null;
};

type Placing = { customer_id: string; name: string; hasLocation: boolean };
type Filter = 'without' | 'with' | 'all';

type ListRow = {
  customer_id: string;
  name: string;
  area?: string | null;
  hasLocation: boolean;
  latitude?: number;
  longitude?: number;
  is_paid?: boolean;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function pinIcon(paid: boolean) {
  return L.divIcon({
    className: 'collection-pin',
    html: `<div style="width:18px;height:18px;border-radius:50%;
      background:${paid ? '#22c55e' : '#ef4444'};
      border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.6)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function MapClickHandler({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (enabled) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mapRef = useRef<L.Map | null>(null);
  const autoPlacedRef = useRef(false);

  const [month, setMonth] = useState(currentMonth());
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [placingFor, setPlacingFor] = useState<Placing | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('without');

  const { data } = useQuery<MapResponse>({
    queryKey: ['map-customers', month],
    queryFn: async () => (await mapApi.customers(month)).data,
  });

  const { data: noLoc } = useQuery<NoLocCustomer[]>({
    queryKey: ['map-no-location'],
    queryFn: async () => (await mapApi.withoutLocation()).data,
  });

  const saveLocation = useMutation({
    mutationFn: (v: { id: string; lat: number; lng: number }) =>
      mapApi.setLocation(v.id, v.lat, v.lng),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['map-customers'] });
      qc.invalidateQueries({ queryKey: ['map-no-location'] });
    },
  });

  const located = data?.customers ?? [];
  const unlocated = noLoc ?? [];

  const markers = useMemo(
    () => located.filter((c) => (unpaidOnly ? !c.is_paid : true)),
    [located, unpaidOnly],
  );

  const rows: ListRow[] = useMemo(() => {
    const withRows: ListRow[] = located.map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      area: c.area,
      hasLocation: true,
      latitude: c.latitude,
      longitude: c.longitude,
      is_paid: c.is_paid,
    }));
    const withoutRows: ListRow[] = unlocated.map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      area: c.area,
      hasLocation: false,
    }));
    const q = search.trim().toLowerCase();
    let base: ListRow[];
    if (q) {
      // Search across ALL customers ignoring the tab filter,
      // matching every word in any order against name + id + area.
      const words = q.split(/\s+/).filter(Boolean);
      base = [...withoutRows, ...withRows].filter((r) => {
        const hay = `${r.name} ${r.customer_id} ${r.area ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    } else {
      base =
        filter === 'without' ? withoutRows :
        filter === 'with' ? withRows :
        [...withoutRows, ...withRows];
    }
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }, [located, unlocated, filter, search]);

  useEffect(() => {
    const placeId = searchParams.get('place');
    if (!placeId || autoPlacedRef.current) return;
    const inWith = located.find((c) => c.customer_id === placeId);
    const inWithout = unlocated.find((c) => c.customer_id === placeId);
    const hit = inWith || inWithout;
    if (hit) {
      autoPlacedRef.current = true;
      setPlacingFor({ customer_id: hit.customer_id, name: hit.name, hasLocation: !!inWith });
      searchParams.delete('place');
      setSearchParams(searchParams, { replace: true });
    }
  }, [located, unlocated, searchParams, setSearchParams]);

  const paidCount = located.filter((c) => c.is_paid).length;
  const unpaidCount = located.length - paidCount;
  const total = located.length + unlocated.length;

  function placeAt(lat: number, lng: number) {
    if (!placingFor) return;
    saveLocation.mutate(
      { id: placingFor.customer_id, lat, lng },
      { onSuccess: () => setPlacingFor(null) },
    );
  }

  function captureGps(c: Placing) {
    if (!navigator.geolocation) {
      alert('This device has no GPS/location support.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        saveLocation.mutate(
          { id: c.customer_id, lat: pos.coords.latitude, lng: pos.coords.longitude },
          { onSuccess: () => setPlacingFor(null) },
        ),
      (err) => alert('Could not get GPS: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function flyTo(lat: number, lng: number) {
    mapRef.current?.flyTo([lat, lng], 18);
  }

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: 'without', label: 'Without location', count: unlocated.length },
    { key: 'with', label: 'With location', count: located.length },
    { key: 'all', label: 'All', count: total },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Toolbar ── */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-2"
        style={{ ...S.panel, borderBottom: S.border }}
      >
        <span className="text-sm font-semibold" style={S.text}>Collection Map</span>
        <span className="text-xs" style={S.textLight}>Placed {located.length}/{total}</span>
        <span className="text-sm text-green-600">{paidCount} paid</span>
        <span className="text-sm text-red-600">{unpaidCount} unpaid</span>
        <span className="text-[11px]" style={S.textLight}>(among placed, this month)</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm rounded px-2 py-1"
          style={{ ...S.text, background: 'var(--bg-secondary)', border: S.border }}
        />
        <label className="flex items-center gap-1 text-sm cursor-pointer" style={S.text}>
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => setUnpaidOnly(e.target.checked)}
          />
          Unpaid only
        </label>
      </div>

      {placingFor && (
        <div className="px-4 py-2 text-sm flex items-center gap-2" style={{ background: '#fde68a', color: '#92400e' }}>
          <MapPin size={16} />
          Tap {placingFor.name}&apos;s home on the map to {placingFor.hasLocation ? 'move' : 'set'} the pin.
          <button className="underline" onClick={() => captureGps(placingFor)} title="Use my current GPS instead">
            or use my GPS
          </button>
          <button className="underline ml-2" onClick={() => setPlacingFor(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Map ── */}
      <div className="flex-1 min-h-0">
        <MapContainer
          ref={mapRef}
          center={HOME_CENTER}
          zoom={15}
          minZoom={13}
          maxZoom={19}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />

          <MapClickHandler enabled={!!placingFor} onPick={placeAt} />

          {markers.map((c) => (
            <Marker
              key={c.customer_id}
              position={[c.latitude, c.longitude]}
              icon={pinIcon(c.is_paid)}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const p = (e.target as L.Marker).getLatLng();
                  saveLocation.mutate({ id: c.customer_id, lat: p.lat, lng: p.lng });
                },
              }}
            >
              <Popup>
                {/* Leaflet popups are always light — keep dark text here. */}
                <div className="min-w-[170px] text-sm" style={{ color: '#1d1d1f' }}>
                  <div className="font-bold">{c.name}</div>
                  <div className="text-xs" style={{ color: '#6b7280' }}>{c.customer_id}</div>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-blue-600 mt-1">
                      <Phone size={14} /> {c.phone}
                    </a>
                  )}
                  {c.address && <div className="text-xs mt-1">{c.address}</div>}
                  <div className="mt-1">
                    Plan: ₹{c.plan_amount ?? '\u2014'} —{' '}
                    <b className={c.is_paid ? 'text-green-600' : 'text-red-600'}>
                      {c.is_paid ? 'PAID' : 'UNPAID'}
                    </b>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: '#9ca3af' }}>Tip: drag the pin to adjust.</div>
                  <div className="flex gap-2 mt-2">
                    <a
                      className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 text-white no-underline"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Navigation size={14} /> Navigate
                    </a>
                    {!c.is_paid && (
                      <button
                        className="px-2 py-1 rounded bg-green-600 text-white"
                        onClick={() => navigate(`/customers/${c.customer_id}`)}
                      >
                        Record payment
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* ── Customer list panel (find + add locations) ── */}
      <div className="flex flex-col" style={{ height: '38vh', ...S.panel, borderTop: S.border }}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: S.border }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="text-xs px-2 py-1 rounded-full"
              style={
                filter === f.key
                  ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
                  : { ...S.text, border: S.border, background: 'transparent' }
              }
            >
              {f.label} ({f.count})
            </button>
          ))}
          <div
            className="flex items-center gap-1 rounded px-2 py-1 ml-auto"
            style={{ border: S.border, background: 'var(--bg-secondary)' }}
          >
            <Search size={14} style={S.textLight} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or ID\u2026"
              className="text-sm outline-none w-44 bg-transparent"
              style={S.text}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <div className="px-4 py-6 text-sm text-center" style={S.textLight}>No customers here.</div>
          )}
          {rows.map((r) => (
            <div
              key={r.customer_id}
              className="flex items-center gap-2 px-4 py-2"
              style={{ borderTop: S.border }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: !r.hasLocation ? '#9ca3af' : r.is_paid ? '#22c55e' : '#ef4444',
                }}
                title={!r.hasLocation ? 'No location' : r.is_paid ? 'Paid' : 'Unpaid'}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={S.text}>{r.name}</div>
                <div className="text-xs truncate" style={S.textLight}>
                  {r.customer_id}
                  {r.area ? ` \u00b7 ${r.area}` : ''}
                </div>
              </div>
              {r.hasLocation ? (
                <>
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                    style={{ ...S.textLight, border: S.border }}
                    onClick={() => flyTo(r.latitude!, r.longitude!)}
                    title="Show on map"
                  >
                    <Crosshair size={12} /> show
                  </button>
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded text-blue-500"
                    style={{ border: S.border }}
                    onClick={() => setPlacingFor({ customer_id: r.customer_id, name: r.name, hasLocation: true })}
                    title="Tap the map to move this pin"
                  >
                    <MapPin size={12} /> move
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded text-blue-500"
                    style={{ border: S.border }}
                    onClick={() => setPlacingFor({ customer_id: r.customer_id, name: r.name, hasLocation: false })}
                    title="Tap the map to place this customer"
                  >
                    <MapPin size={12} /> place
                  </button>
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded text-green-500"
                    style={{ border: S.border }}
                    onClick={() => captureGps({ customer_id: r.customer_id, name: r.name, hasLocation: false })}
                    title="Use my current GPS"
                  >
                    <Satellite size={12} /> GPS
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
