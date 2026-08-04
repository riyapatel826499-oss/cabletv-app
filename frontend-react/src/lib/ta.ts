// ── Tamil dictionary (English-as-key) ──────────────────────────────────────
// Merged from per-area files so parallel edits never conflict.
// Each area file exports `Record<string,string>` partials.
import layout from './dict/layout';
import login from './dict/login';
import portal from './dict/portal';
import dashboard from './dict/dashboard';
import customers from './dict/customers';
import payments from './dict/payments';
import reports from './dict/reports';
import settings from './dict/settings';
import common from './dict/common';
import map from './dict/map';
import pay from './dict/pay';

export const TA: Record<string, string> = {
  ...common,
  ...layout,
  ...login,
  ...portal,
  ...dashboard,
  ...customers,
  ...payments,
  ...reports,
  ...settings,
  ...map,
  ...pay,
};
