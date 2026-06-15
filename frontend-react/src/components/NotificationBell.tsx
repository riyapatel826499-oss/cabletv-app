import { useState, useEffect, useRef } from 'react';
import { Bell, Check, CheckCheck, Wifi, Tv, AlertTriangle, XCircle, RefreshCw, Zap } from 'lucide-react';
import { notificationsApi } from '../api';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  status: string; // success, error, warning
  mso: string | null;
  stb_no: string | null;
  customer_id: string | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

const STATUS_COLORS: Record<string, { bg: string; border: string; icon: typeof Check }> = {
  success: { bg: 'rgba(52,199,89,0.1)', border: 'rgba(52,199,89,0.3)', icon: Check },
  error: { bg: 'rgba(255,59,48,0.1)', border: 'rgba(255,59,48,0.3)', icon: XCircle },
  warning: { bg: 'rgba(255,149,0,0.1)', border: 'rgba(255,149,0,0.3)', icon: AlertTriangle },
};

const TYPE_ICONS: Record<string, { icon: typeof Wifi; color: string }> = {
  activation: { icon: Zap, color: '#34c759' },
  swap: { icon: RefreshCw, color: '#0071e3' },
  suspension: { icon: Wifi, color: '#ff9500' },
  renew: { icon: Tv, color: '#5856d6' },
  reconnect: { icon: Wifi, color: '#34c759' },
  failure: { icon: XCircle, color: '#ff3b30' },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await notificationsApi.list({ limit: 50 });
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch { /* silently fail */ }
  };

  // Poll every 30 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleMarkRead = async (id: number) => {
    try {
      await notificationsApi.markRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const handleBellClick = () => {
    setOpen(!open);
    if (!open) fetchNotifications();
  };

  const typeIcon = (type: string) => TYPE_ICONS[type] || TYPE_ICONS.activation;
  const statusStyle = (status: string) => STATUS_COLORS[status] || STATUS_COLORS.success;

  return (
    <div style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        ref={bellRef}
        onClick={handleBellClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: open ? 'var(--primary)' : 'var(--bg-secondary)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius-xs)',
          padding: 8,
          cursor: 'pointer',
          color: open ? '#fff' : 'var(--text-light)',
          transition: 'var(--transition)',
          position: 'relative',
        }}
      >
        <Bell style={{ width: 18, height: 18 }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: '#ff3b30',
              color: '#fff',
              fontSize: '0.6rem',
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid var(--bg)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: Math.min(380, typeof window !== 'undefined' ? window.innerWidth - 32 : 380),
            maxHeight: '70vh',
            background: 'var(--bg-card)',
            backdropFilter: 'var(--glass)',
            WebkitBackdropFilter: 'var(--glass)',
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-hover)',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderBottom: '0.5px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                Activity Status
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    background: '#ff3b30',
                    color: '#fff',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 10,
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--primary)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <CheckCheck style={{ width: 14, height: 14 }} />
                  Mark all read
                </button>
              )}
              <button
                onClick={fetchNotifications}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-light)',
                  padding: 2,
                }}
              >
                <RefreshCw style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.82rem' }}>
                <Bell style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.3, display: 'block' }} />
                No activity notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const ti = typeIcon(n.type);
                const ss = statusStyle(n.status);
                const TypeIcon = ti.icon;
                const StatusIcon = ss.icon;
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '10px 14px',
                      cursor: n.is_read ? 'default' : 'pointer',
                      background: n.is_read ? 'transparent' : ss.bg,
                      borderLeft: n.is_read ? 'none' : `3px solid ${ss.border}`,
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Type icon */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: `${ti.color}18`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <TypeIcon style={{ width: 16, height: 16, color: ti.color }} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: n.is_read ? 500 : 700,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {n.title}
                        </span>
                        {n.mso && (
                          <span
                            style={{
                              fontSize: '0.6rem',
                              fontWeight: 600,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: n.mso === 'GTPL' ? 'rgba(0,113,227,0.1)' :
                                           n.mso === 'TACTV' ? 'rgba(88,86,214,0.1)' :
                                           'rgba(255,149,0,0.1)',
                              color: n.mso === 'GTPL' ? '#0071e3' :
                                     n.mso === 'TACTV' ? '#5856d6' :
                                     '#ff9500',
                              flexShrink: 0,
                            }}
                          >
                            {n.mso}
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-light)',
                          lineHeight: 1.4,
                          margin: 0,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {n.message}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', opacity: 0.7 }}>
                          {timeAgo(n.created_at)}
                        </span>
                        <StatusIcon style={{ width: 12, height: 12, color: ss.border === 'rgba(52,199,89,0.3)' ? '#34c759' : ss.border === 'rgba(255,59,48,0.3)' ? '#ff3b30' : '#ff9500' }} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
