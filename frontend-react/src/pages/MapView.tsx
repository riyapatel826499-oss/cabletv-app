import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Phone, Satellite, Search, Crosshair, Trash2, Locate, Mic, MessageCircle } from 'lucide-react';
import { mapApi } from '../api';
import { calcPayAmount } from '../lib/prorata';

// ── Your collection area ───────────────────────────────────────────────────
const HOME_CENTER: [number, number] = [
  Number(import.meta.env.VITE_HOME_LAT) || 11.0974473,
  Number(import.meta.env.VITE_HOME_LNG) || 77.2013613,
];
const AREA_RADIUS_KM = Number(import.meta.env.VITE_AREA_RADIUS_KM) || 3;

const _latPad = AREA_RADIUS_KM / 111;
const _lngPad = AREA_RADIUS_KM / (111 * Math.cos((HOME_CENTER[0] * Math.PI) / 180));
const MAX_BOUNDS: L.LatLngBoundsExpression = [
  [HOME_CENTER[0] - _latPad, HOME_CENTER[1] - _lngPad],
  [HOME_CENTER[0] + _latPad, HOME_CENTER[1] + _lngPad],
];

const AREA_SAVE_RADIUS_KM = Number(import.meta.env.VITE_AREA_SAVE_RADIUS_KM) || 10;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

function inArea(lat: number, lng: number) {
  return distanceKm(lat, lng, HOME_CENTER[0], HOME_CENTER[1]) <= AREA_SAVE_RADIUS_KM;
}

const S = {
  panel: {
    background: 'var(--bg-card)',
    color: 'var(--text)',
    backdropFilter: 'saturate(160%) blur(18px)',
    WebkitBackdropFilter: 'saturate(160%) blur(18px)',
  } as const,
  text: { color: 'var(--text)' } as const,
  textLight: { color: 'var(--text-light)' } as const,
  border: '1px solid var(--border)',
};

type Status = 'paid' | 'due' | 'overdue';

const STATUS_COLOR: Record<Status, string> = {
  paid: '#22c55e',
  due: '#eab308',
  overdue: '#ef4444',
};
const STATUS_LABEL: Record<Status, string> = {
  paid: 'PAID',
  due: 'NOT RENEWED (paid last month)',
  overdue: 'OVERDUE (2+ months)',
};

type MapCustomer = {
  customer_id: string;
  name: string;
  phone: string;
  phone2?: string | null;
  area?: string | null;
  address?: string | null;
  latitude: number | null;
  longitude: number | null;
  map_note?: string | null;
  stbs?: string | null;
  is_paid: boolean;
  paid_prev?: boolean;
  status: Status;
  plan_amount?: number | null;
  reminder_count?: number;
  last_reminder_at?: string | null;
  last_reminder_by?: string | null;
};

// A customer that definitely has coordinates (after filtering).
type LocatedCustomer = MapCustomer & { latitude: number; longitude: number };
function hasCoords(c: MapCustomer): c is LocatedCustomer {
  return c.latitude != null && c.longitude != null;
}

type MapResponse = {
  month: string;
  count: number;
  missing_location: number;
  customers: MapCustomer[];
};

type Placing = { customer_id: string; name: string; hasLocation: boolean };
type Filter = 'without' | 'with' | 'all';

type ListRow = {
  customer_id: string;
  name: string;
  area?: string | null;
  phone?: string | null;
  phone2?: string | null;
  stbs?: string | null;
  hasLocation: boolean;
  latitude?: number;
  longitude?: number;
  status?: Status;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Business details shown in WhatsApp messages.
const BUSINESS_NAME = 'Sree Selvanaayakki Amman Cables & Internet Services';
const UPI_ID = 'selvanayakiammancables-3@okhdfcbank';

function waPhone(c: MapCustomer) {
  const d = (c.phone || '').replace(/\D/g, '');
  return d.length === 10 ? '91' + d : d; // India default
}
function monthLabelOf(month: string) {
  try {
    return new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  } catch {
    return month;
  }
}
function waUrl(c: MapCustomer, msg: string) {
  return `https://wa.me/${waPhone(c)}?text=${encodeURIComponent(msg)}`;
}

// Template 1 — regular monthly reminder (pay before the 12th).
function waRegularLink(c: MapCustomer, month: string) {
  const amt = c.plan_amount ? ` (₹${c.plan_amount})` : '';
  const msg =
    `Dear Customer, your cable TV subscription for ${monthLabelOf(month)}${amt} is due. ` +
    `Kindly pay before the 12th to avoid disconnection.\n\n` +
    `Pay online via UPI: ${UPI_ID}\n\n` +
    `Thank you.\n- ${BUSINESS_NAME}`;
  return waUrl(c, msg);
}

// Template 2 — reconnection reminder. Uses the SAME calculation as the Record
// Payment screen (via ../lib/prorata) so the amount always matches what's charged.
function waReconnectLink(c: MapCustomer, month: string) {
  const calc = calcPayAmount(c.plan_amount || 0, 1, month, true);
  const amount = Math.round(calc.netAmount);
  const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const msg =
    `Dear Customer, your cable TV connection is disconnected due to non-payment.\n\n` +
    `Amount to reconnect: ₹${amount} (as on ${todayStr})\n\n` +
    `Pay online via UPI: ${UPI_ID}\n\n` +
    `- ${BUSINESS_NAME}`;
  return waUrl(c, msg);
}

// ── Voice search (browser Web Speech API — free, no key) ────────────────────
interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// A pin coloured by status. When `count` > 1 it shows the number of connections
// at that spot. When `highlight` is true it's enlarged with a gold pulsing ring so
// you can spot the customer you just tapped "show" on.
function pinIcon(status: Status, count = 1, highlight = false) {
  const base = count > 1 ? 26 : 18;
  const size = highlight ? base + 10 : base;
  const border = highlight ? '3px solid #f59e0b' : '2px solid #fff';
  const label = count > 1 ? String(count) : '';
  return L.divIcon({
    className: highlight ? 'collection-pin collection-pin-hl' : 'collection-pin',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;
      background:${STATUS_COLOR[status]};border:${border};
      box-shadow:0 0 3px rgba(0,0,0,.6);color:#fff;font-weight:700;font-size:12px;
      display:flex;align-items:center;justify-content:center">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

// The "worst" status in a group decides the group pin's colour
// (red beats yellow beats green), so a building with anyone unpaid stands out.
function worstStatus(list: { status: Status }[]): Status {
  if (list.some((c) => c.status === 'overdue')) return 'overdue';
  if (list.some((c) => c.status === 'due')) return 'due';
  return 'paid';
}
// One customer's details, shown in popups. Includes an editable floor/unit label
// (useful when several connections are stacked in a multi-floor building).
function CustomerBlock({
  c,
  month,
  onRecordPayment,
  onSaveNote,
  onLogReminder,
}: {
  c: MapCustomer;
  month: string;
  onRecordPayment: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onLogReminder: (id: string, template: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.map_note ?? '');
  const [showTpl, setShowTpl] = useState(false);
  return (
    <div className="text-sm" style={{ color: '#1d1d1f' }}>
      <div className="font-bold">{c.name}</div>
      <div className="text-xs" style={{ color: '#6b7280' }}>{c.customer_id}</div>
      {c.phone && (
        <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-blue-600 mt-1">
          <Phone size={14} /> {c.phone}
        </a>
      )}
      {c.address && <div className="text-xs mt-1">{c.address}</div>}

      {/* Floor / unit label */}
      {editing ? (
        <div className="flex items-center gap-1 mt-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. 1st floor"
            className="text-xs border rounded px-1 py-0.5"
            style={{ width: 110 }}
          />
          <button
            className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white"
            onClick={() => {
              onSaveNote(c.customer_id, draft);
              setEditing(false);
            }}
          >
            save
          </button>
          <button className="text-xs" onClick={() => setEditing(false)}>cancel</button>
        </div>
      ) : (
        <div className="text-xs mt-1 flex items-center gap-2">
          {c.map_note ? (
            <span style={{ color: '#1d1d1f' }}>🏢 {c.map_note}</span>
          ) : (
            <span style={{ color: '#9ca3af' }}>No floor/unit set</span>
          )}
          <button
            className="text-blue-600 underline"
            onClick={() => {
              setDraft(c.map_note ?? '');
              setEditing(true);
            }}
          >
            edit
          </button>
        </div>
      )}

      <div className="mt-1">
        Plan: ₹{c.plan_amount ?? '—'} —{' '}
        <b style={{ color: STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</b>
      </div>
      {(c.reminder_count ?? 0) > 0 && (
        <div className="text-[11px] mt-1" style={{ color: '#b45309' }}>
          Reminded {c.reminder_count}× this month
          {c.last_reminder_by ? ` · last by ${c.last_reminder_by}` : ''}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        <a
          className="flex items-center justify-center gap-1 px-3 rounded bg-blue-600 text-white no-underline text-sm"
          style={{ minHeight: 40 }}
          href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation size={16} /> Navigate
        </a>
        {c.status !== 'paid' && c.phone && (
          <button
            className="flex items-center justify-center gap-1 px-3 rounded text-white text-sm"
            style={{ background: '#25D366', minHeight: 40 }}
            onClick={() => setShowTpl((v) => !v)}
            title="Send a WhatsApp reminder"
          >
            <MessageCircle size={16} /> Remind
          </button>
        )}
        {c.status !== 'paid' && (
          <button
            className="px-3 rounded bg-green-600 text-white text-sm"
            style={{ minHeight: 40 }}
            onClick={() => onRecordPayment(c.customer_id)}
          >
            Record payment
          </button>
        )}
      </div>

      {showTpl && c.phone && (
        <div className="flex flex-col gap-2 mt-2">
          <a
            href={waRegularLink(c, month)}
            target="_blank"
            rel="noreferrer"
            onClick={() => onLogReminder(c.customer_id, 'monthly')}
            className="block text-center text-sm px-3 rounded no-underline"
            style={{ minHeight: 42, lineHeight: '42px', fontWeight: 500, border: '1px solid #25D366', color: '#128C4B', background: 'rgba(37,211,102,0.12)' }}
          >
            Monthly reminder
          </a>
          <a
            href={waReconnectLink(c, month)}
            target="_blank"
            rel="noreferrer"
            onClick={() => onLogReminder(c.customer_id, 'reconnection')}
            className="block text-center text-sm px-3 rounded no-underline"
            style={{ minHeight: 42, lineHeight: '42px', fontWeight: 500, border: '1px solid #f59e0b', color: '#b45309', background: 'rgba(245,158,11,0.12)' }}
          >
            Reconnection reminder
          </a>
        </div>
      )}
    </div>
  );
}

// Blue "you are here" marker.
const USER_ICON = L.divIcon({
  className: 'user-location',
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;
    border:3px solid #fff;box-shadow:0 0 0 5px rgba(37,99,235,.30)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

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
  // Which statuses are shown on the map (all on by default).
  const [visible, setVisible] = useState<Record<Status, boolean>>({
    paid: true,
    due: true,
    overdue: true,
  });
  const [placingFor, setPlacingFor] = useState<Placing | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('without');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  // Live "my location"
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [watching, setWatching] = useState(false);
  const watchRef = useRef<number | null>(null);
  const centeredRef = useRef(false);

  const { data } = useQuery<MapResponse>({
    queryKey: ['map-customers', month],
    queryFn: async () => (await mapApi.customers(month)).data,
  });

  const saveLocation = useMutation({
    mutationFn: (v: { id: string; lat: number; lng: number }) =>
      mapApi.setLocation(v.id, v.lat, v.lng),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['map-customers'] });
    },
    onError: () => alert('Could not save — that point may be outside your collection area.'),
  });

  const clearLocation = useMutation({
    mutationFn: (id: string) => mapApi.clearLocation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['map-customers'] });
    },
  });

  const saveNote = useMutation({
    mutationFn: (v: { id: string; note: string }) => mapApi.setNote(v.id, v.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['map-customers'] }),
  });

  const logReminder = useMutation({
    mutationFn: (v: { id: string; template: string }) => mapApi.logReminder(v.id, v.template, month),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['map-customers'] }),
  });

  // ONE source of truth: all active customers come from a single query, then we
  // split them into located / unlocated here. No second query, no drift.
  const all = useMemo(() => data?.customers ?? [], [data]);
  const located = useMemo(() => all.filter(hasCoords), [all]);
  const unlocated = useMemo(() => all.filter((c) => !hasCoords(c)), [all]);

  const markers = useMemo(
    () => located.filter((c) => visible[c.status]),
    [located, visible],
  );

  // Group customers that share (almost) the same location into numbered pins.
  // ~4 decimals ≈ 11 m resolution.
  const groups = useMemo(() => {
    const m = new Map<string, LocatedCustomer[]>();
    for (const c of markers) {
      const key = `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
      const arr = m.get(key);
      if (arr) arr.push(c);
      else m.set(key, [c]);
    }
    return Array.from(m.values()).map((list) => ({
      key: `${list[0].latitude},${list[0].longitude}:${list.length}`,
      list,
      lat: list[0].latitude,
      lng: list[0].longitude,
      status: worstStatus(list),
    }));
  }, [markers]);

  const rows: ListRow[] = useMemo(() => {
    const withRows: ListRow[] = located.map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      area: c.area,
      phone: c.phone,
      phone2: c.phone2,
      stbs: c.stbs,
      hasLocation: true,
      latitude: c.latitude,
      longitude: c.longitude,
      status: c.status,
    }));
    const withoutRows: ListRow[] = unlocated.map((c) => ({
      customer_id: c.customer_id,
      name: c.name,
      area: c.area,
      phone: c.phone,
      phone2: c.phone2,
      stbs: c.stbs,
      hasLocation: false,
    }));
    const q = search.trim().toLowerCase();
    let base: ListRow[];
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      base = [...withoutRows, ...withRows].filter((r) => {
        const hay = `${r.name} ${r.customer_id} ${r.area ?? ''} ${r.phone ?? ''} ${
          r.phone2 ?? ''
        } ${r.stbs ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    } else {
      base = filter === 'without' ? withoutRows : filter === 'with' ? withRows : [...withoutRows, ...withRows];
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

  const paidCount = located.filter((c) => c.status === 'paid').length;
  const dueCount = located.filter((c) => c.status === 'due').length;
  const overdueCount = located.filter((c) => c.status === 'overdue').length;
  const total = located.length + unlocated.length;

  function placeAt(lat: number, lng: number) {
    if (!placingFor) return;
    if (!inArea(lat, lng)) {
      alert('That point is outside your collection area, so it was not saved.');
      return;
    }
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
      (pos) => {
        if (!inArea(pos.coords.latitude, pos.coords.longitude)) {
          const km = Math.round(
            distanceKm(pos.coords.latitude, pos.coords.longitude, HOME_CENTER[0], HOME_CENTER[1]),
          );
          alert(
            `Your current location is about ${km} km from your collection area, so it was not saved. ` +
              `Use GPS only while standing at the customer's house, or place the pin on the map.`,
          );
          return;
        }
        saveLocation.mutate(
          { id: c.customer_id, lat: pos.coords.latitude, lng: pos.coords.longitude },
          { onSuccess: () => setPlacingFor(null) },
        );
      },
      (err) => alert('Could not get GPS: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // "Show" a customer: fly to them AND highlight their pin for a few seconds so it
  // stands out from the surrounding pins.
  function showCustomer(id: string, lat: number, lng: number) {
    mapRef.current?.flyTo([lat, lng], 18);
    setHighlightId(id);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 6000);
  }

  function startVoice() {
    const SR = getSpeechRecognition();
    if (!SR) {
      alert('Voice search needs a supported browser like Chrome or Edge (or Chrome on Android).');
      return;
    }
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (e) => {
      setSearch(e.results[0][0].transcript);
      setFilter('all');
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  // Stop any voice session when leaving the page.
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  // Fix Leaflet sizing: recalc the map size after mount, on window resize and
  // orientation change. Without this the map can render grey / half-loaded and
  // clicks map to the wrong spot (stale container size on mobile).
  useEffect(() => {
    const invalidate = () => mapRef.current?.invalidateSize();
    const t1 = window.setTimeout(invalidate, 200);
    const t2 = window.setTimeout(invalidate, 800);
    window.addEventListener('resize', invalidate);
    window.addEventListener('orientationchange', invalidate);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('orientationchange', invalidate);
    };
  }, []);

  // The banners above the map change its height — recalc when they toggle.
  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 150);
    return () => window.clearTimeout(id);
  }, [placingFor, userPos, watching, listening]);

  function startMyLocation() {
    if (!navigator.geolocation) {
      alert('This device has no GPS/location support.');
      return;
    }
    setWatching(true);
    centeredRef.current = false;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        if (!centeredRef.current && inArea(p.lat, p.lng)) {
          centeredRef.current = true;
          mapRef.current?.flyTo([p.lat, p.lng], 17);
        }
      },
      (err) => {
        alert('Could not get your location: ' + err.message);
        setWatching(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  function stopMyLocation() {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setWatching(false);
    setUserPos(null);
  }

  useEffect(() => {
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const userOutside = userPos != null && !inArea(userPos.lat, userPos.lng);

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: 'without', label: 'Without location', count: unlocated.length },
    { key: 'with', label: 'With location', count: located.length },
    { key: 'all', label: 'All', count: total },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <style>{`
        @keyframes pinPulse {
          0%   { box-shadow: 0 0 0 0 rgba(245,158,11,.7); }
          70%  { box-shadow: 0 0 0 16px rgba(245,158,11,0); }
          100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
        }
        .collection-pin-hl > div { animation: pinPulse 1.1s ease-out 4; }
      `}</style>
      {/* ── Toolbar ── */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-2"
        style={{ ...S.panel, borderBottom: S.border }}
      >
        <span className="text-sm font-semibold" style={S.text}>Collection Map</span>
        <span className="text-xs" style={S.textLight}>Placed {located.length}/{total}</span>
        <span className="flex items-center gap-1 text-sm" style={{ color: STATUS_COLOR.paid }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.paid }} />
          {paidCount} paid
        </span>
        <span className="flex items-center gap-1 text-sm" style={{ color: '#a16207' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.due }} />
          {dueCount} not renewed
        </span>
        <span className="flex items-center gap-1 text-sm" style={{ color: STATUS_COLOR.overdue }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR.overdue }} />
          {overdueCount} overdue
        </span>
        <span className="text-[11px]" style={S.textLight}>(placed, this month)</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm rounded px-2 py-1"
          style={{ ...S.text, background: 'var(--bg-secondary)', border: S.border }}
        />
        {(['paid', 'due', 'overdue'] as Status[]).map((s) => (
          <label key={s} className="flex items-center gap-1 text-sm cursor-pointer" style={S.text}>
            <input
              type="checkbox"
              checked={visible[s]}
              onChange={(e) => setVisible((v) => ({ ...v, [s]: e.target.checked }))}
            />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {s === 'paid' ? 'Paid' : s === 'due' ? 'Not renewed' : 'Overdue'}
          </label>
        ))}
        <button
          onClick={() => (watching ? stopMyLocation() : startMyLocation())}
          className="flex items-center gap-1 text-sm px-2 py-1 rounded"
          style={
            watching
              ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
              : { ...S.text, border: S.border }
          }
          title="Show my current location on the map"
        >
          <Locate size={14} /> {watching ? 'Stop' : 'My location'}
        </button>
      </div>

      {userOutside && (
        <div className="px-4 py-2 text-sm flex items-center gap-2" style={{ background: '#fee2e2', color: '#b91c1c' }}>
          ⚠ You are about{' '}
          {Math.round(distanceKm(userPos!.lat, userPos!.lng, HOME_CENTER[0], HOME_CENTER[1]))} km
          outside your collection area.
        </div>
      )}
      {watching && userPos && !userOutside && (
        <div className="px-4 py-1 text-xs flex items-center gap-2" style={{ background: '#dbeafe', color: '#1e40af' }}>
          <Locate size={12} /> You are inside your collection area.
        </div>
      )}

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
          whenReady={() => window.setTimeout(() => mapRef.current?.invalidateSize(), 0)}
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
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
            opacity={0.55}
          />

          <MapClickHandler enabled={!!placingFor} onPick={placeAt} />

          {groups.map((g) => {
            const hl = highlightId != null && g.list.some((c) => c.customer_id === highlightId);
            return (
            <Marker
              key={g.key}
              position={[g.lat, g.lng]}
              icon={pinIcon(g.status, g.list.length, hl)}
              zIndexOffset={hl ? 1000 : 0}
            >
              <Popup>
                {g.list.length === 1 ? (
                  <div className="min-w-[180px]">
                    <CustomerBlock
                      c={g.list[0]}
                      month={month}
                      onRecordPayment={(id) => navigate(`/customers/${id}`)}
                      onSaveNote={(id, note) => saveNote.mutate({ id, note })}
                      onLogReminder={(id, template) => logReminder.mutate({ id, template })}
                    />
                    <button
                      className="text-xs mt-2 flex items-center gap-1 px-2 py-1 rounded"
                      style={{ border: '1px solid #d1d5db', color: '#2563eb' }}
                      onClick={() =>
                        setPlacingFor({
                          customer_id: g.list[0].customer_id,
                          name: g.list[0].name,
                          hasLocation: true,
                        })
                      }
                    >
                      <MapPin size={12} /> Move location
                    </button>
                  </div>
                ) : (
                  <div className="min-w-[210px]" style={{ maxHeight: 280, overflowY: 'auto' }}>
                    <div className="font-bold text-sm mb-1" style={{ color: '#1d1d1f' }}>
                      {g.list.length} connections here
                    </div>
                    {g.list.map((c, i) => (
                      <div
                        key={c.customer_id}
                        style={{
                          borderTop: i ? '1px solid #eee' : 'none',
                          paddingTop: i ? 8 : 0,
                          marginTop: i ? 8 : 0,
                        }}
                      >
                        <CustomerBlock
                          c={c}
                          month={month}
                          onRecordPayment={(id) => navigate(`/customers/${id}`)}
                          onSaveNote={(id, note) => saveNote.mutate({ id, note })}
                          onLogReminder={(id, template) => logReminder.mutate({ id, template })}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Popup>
            </Marker>
            );
          })}

          {userPos && (
            <Marker position={[userPos.lat, userPos.lng]} icon={USER_ICON}>
              <Popup>
                <div className="text-sm" style={{ color: '#1d1d1f' }}>
                  <b>You are here</b>
                  {userOutside && <div style={{ color: '#b91c1c' }}>Outside your collection area</div>}
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* ── Customer list panel ── */}
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
              placeholder={listening ? 'Listening…' : 'Search or tap mic 🎤'}
              className="text-sm outline-none w-40 bg-transparent"
              style={S.text}
            />
            <button
              onClick={() => (listening ? stopVoice() : startVoice())}
              title="Voice search — tap and say the customer name"
              className="flex items-center justify-center rounded-full"
              style={{
                width: 28,
                height: 28,
                background: listening ? '#ef4444' : 'transparent',
              }}
            >
              <Mic size={16} style={{ color: listening ? '#fff' : 'var(--text-light)' }} />
            </button>
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
                style={{ background: !r.hasLocation || !r.status ? '#9ca3af' : STATUS_COLOR[r.status] }}
                title={!r.hasLocation || !r.status ? 'No location' : STATUS_LABEL[r.status]}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={S.text}>{r.name}</div>
                <div className="text-xs truncate" style={S.textLight}>
                  {r.customer_id}
                  {r.area ? ` · ${r.area}` : ''}
                </div>
              </div>
              {r.hasLocation ? (
                <>
                  {r.latitude != null && !inArea(r.latitude, r.longitude!) && (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: '#fee2e2', color: '#b91c1c' }}
                      title="This pin is outside your collection area"
                    >
                      ⚠ outside area
                    </span>
                  )}
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                    style={{ ...S.textLight, border: S.border }}
                    onClick={() => showCustomer(r.customer_id, r.latitude!, r.longitude!)}
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
                  <button
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded text-red-500"
                    style={{ border: S.border }}
                    onClick={() => {
                      if (confirm(`Remove ${r.name}'s location? They'll go back to "without location".`))
                        clearLocation.mutate(r.customer_id);
                    }}
                    title="Remove this location"
                  >
                    <Trash2 size={12} /> clear
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
