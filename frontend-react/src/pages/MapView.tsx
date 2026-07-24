import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Phone, Satellite, Search, X } from 'lucide-react';
import { mapApi } from '../api';

// ── Config (set these in frontend-react/.env) ──────────────────────────────
// No API key and no credit card needed — uses free Esri satellite imagery.
// Center on your area (right-click your home in Google Maps to copy lat,lng).
const HOME_CENTER: [number, number] = [
  Number(import.meta.env.VITE_HOME_LAT) || 13.0827,
  Number(import.meta.env.VITE_HOME_LNG) || 80.2707,
];
// How far (km) the map is allowed to roam from your area.
const AREA_RADIUS_KM = Number(import.meta.env.VITE_AREA_RADIUS_KM) || 3;

// Lock the map to a box around your area so other places never load.
const _latPad = AREA_RADIUS_KM / 111;
const _lngPad = AREA_RADIUS_KM / (111 * Math.cos((HOME_CENTER[0] * Math.PI) / 180));
const MAX_BOUNDS: L.LatLngBoundsExpression = [
  [HOME_CENTER[0] - _latPad, HOME_CENTER[1] - _lngPad],
  [HOME_CENTER[0] + _latPad, HOME_CENTER[1] + _lngPad],
];

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

// Minimal shape needed to place/move any customer.
type Placing = { customer_id: string; name: string; hasLocation: boolean };

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Coloured pin (green = paid, red = unpaid) drawn with HTML — no image files.
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

// Handles map taps while you're placing a customer.
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

  const [month, setMonth] = useState(currentMonth());
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [placingFor, setPlacingFor] = useState<Placing | null>(null);
  const [search, setSearch] = useState('');

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

  const customers = useMemo(
    () => (data?.customers ?? []).filter((c) => (unpaidOnly ? !c.is_paid : true)),
    [data, unpaidOnly],
  );

  // Every active customer (located + not-yet-located) for the search picker.
  const allCustomers: Placing[] = useMemo(() => {
    const located = (data?.customers ?? []).map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      hasLocation: true,
    }));
    const unlocated = (noLoc ?? []).map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      hasLocation: false,
    }));
    return [...unlocated, ...located];
  }, [data, noLoc]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allCustomers
      .filter(
        (c) => c.name.toLowerCase().includes(q) || c.customer_id.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, allCustomers]);

  const paidCount = data?.customers.filter((c) => c.is_paid).length ?? 0;
  const unpaidCount = (data?.customers.length ?? 0) - paidCount;

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

  function pickForPlacing(c: Placing) {
    setPlacingFor(c);
    setSearch('');
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white border-b">
        <span className="text-sm font-semibold">Collection Map</span>
        <span className="text-sm text-green-600">{paidCount} paid</span>
        <span className="text-sm text-red-600">{unpaidCount} unpaid</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        />
        <label className="flex items-center gap-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => setUnpaidOnly(e.target.checked)}
          />
          Unpaid only
        </label>

        {/* Search any customer to place / move them */}
        <div className="relative ml-auto">
          <div className="flex items-center gap-1 border rounded px-2 py-1">
            <Search size={14} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find customer to place\u2026"
              className="text-sm outline-none w-48"
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <X size={14} className="text-gray-400" />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="absolute right-0 mt-1 w-64 bg-white border rounded shadow z-[1000] max-h-72 overflow-y-auto">
              {searchResults.map((c) => (
                <button
                  key={c.customer_id}
                  onClick={() => pickForPlacing(c)}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-gray-50 text-left"
                >
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-gray-400 ml-1">{c.customer_id}</span>
                  </span>
                  <span className={`text-xs ${c.hasLocation ? 'text-green-600' : 'text-amber-600'}`}>
                    {c.hasLocation ? 'move' : 'place'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {placingFor && (
        <div className="px-4 py-2 bg-amber-100 text-amber-800 text-sm flex items-center gap-2">
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
          center={HOME_CENTER}
          zoom={16}
          minZoom={14}
          maxZoom={19}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ width: '100%', height: '100%' }}
        >
          {/* Free Esri satellite imagery */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
          {/* Street/place name labels on top (hybrid look) */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />

          <MapClickHandler enabled={!!placingFor} onPick={placeAt} />

          {customers.map((c) => (
            <Marker
              key={c.customer_id}
              position={[c.latitude, c.longitude]}
              icon={pinIcon(c.is_paid)}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const p = m.getLatLng();
                  saveLocation.mutate({ id: c.customer_id, lat: p.lat, lng: p.lng });
                },
              }}
            >
              <Popup>
                <div className="min-w-[170px] text-sm">
                  <div className="font-bold">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.customer_id}</div>
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
                  <div className="text-[11px] text-gray-400 mt-1">Tip: drag the pin to adjust.</div>
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

      {/* ── Customers still needing a location ── */}
      {noLoc && noLoc.length > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t max-h-40 overflow-y-auto">
          <div className="text-sm font-semibold mb-1">Needs location ({noLoc.length})</div>
          <div className="flex flex-wrap gap-2">
            {noLoc.map((c) => (
              <span
                key={c.customer_id}
                className="inline-flex items-center gap-1 bg-white border rounded-full px-2 py-1 text-xs"
              >
                {c.name}
                <button
                  className="text-blue-600 flex items-center gap-0.5"
                  onClick={() => pickForPlacing({ customer_id: c.customer_id, name: c.name, hasLocation: false })}
                  title="Tap the map to place"
                >
                  <MapPin size={12} /> map
                </button>
                <button
                  className="text-green-600 flex items-center gap-0.5"
                  onClick={() => captureGps({ customer_id: c.customer_id, name: c.name, hasLocation: false })}
                  title="Use my current GPS"
                >
                  <Satellite size={12} /> GPS
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
