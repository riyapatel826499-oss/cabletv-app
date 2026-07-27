"""
Public marketing website (home + policy pages) served at the domain root so payment
gateways (Razorpay etc.) can verify the business. The customer app stays at /app.

Register by adding to main.py's _routers dict:
    "site": ("routes.site", "router"),

Routes: /  /about  /contact  /terms  /privacy  /refund
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["Public site"])

# ── Business details (from GST registration) ────────────────────────────────
BUSINESS = "Sree Selvanaayakki Amman Cables & Internet Services"
LEGAL = "Indhumathi"
GSTIN = "33AFMPI1642D1ZW"
ADDRESS = ("SF No 459/2, D.No 127, Perumal Kovil Street, Karumathampatti, "
           "Sulur, Coimbatore, Tamil Nadu \u2013 641659")
PHONE = "+91 77085 51139"
EMAIL = "selvanayakiammancables@gmail.com"
UPI = "selvanayakiammancables-3@okhdfcbank"


def page(title: str, body: str) -> HTMLResponse:
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title} \u00b7 {BUSINESS}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
    color:#1d1d1f;background:#f6f7fb;line-height:1.6}}
  a{{color:#2563eb;text-decoration:none}}
  header{{background:#0b1020;color:#fff;padding:16px 20px;display:flex;align-items:center;
    justify-content:space-between;flex-wrap:wrap;gap:8px}}
  header .brand{{font-weight:700;font-size:1.05rem}}
  nav a{{color:#cfd6ea;margin-left:16px;font-size:.9rem}}
  nav a:hover{{color:#fff}}
  .wrap{{max-width:860px;margin:0 auto;padding:28px 20px}}
  .hero{{background:linear-gradient(135deg,#5aa2ff,#8b5cff);color:#fff;padding:44px 20px;text-align:center}}
  .hero h1{{font-size:1.7rem;margin-bottom:8px}}
  .hero p{{opacity:.95}}
  .card{{background:#fff;border:1px solid #e6e8ef;border-radius:14px;padding:20px 22px;margin:16px 0;
    box-shadow:0 6px 20px rgba(0,0,0,.04)}}
  h2{{font-size:1.2rem;margin-bottom:10px}}
  h3{{font-size:1rem;margin:14px 0 6px}}
  p,li{{margin-bottom:8px;color:#3a3a3c}}
  ul{{padding-left:20px}}
  .muted{{color:#86868b;font-size:.85rem}}
  footer{{text-align:center;padding:24px 20px;color:#86868b;font-size:.8rem}}
  .btn{{display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:10px;
    font-weight:600;margin-top:8px}}
  table{{width:100%;border-collapse:collapse}}
  td{{padding:6px 0;vertical-align:top}}
  td:first-child{{color:#86868b;width:150px}}
</style></head>
<body>
<header>
  <div class="brand">{BUSINESS}</div>
  <nav>
    <a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a>
    <a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refund">Refund</a>
    <a href="/app">Login</a>
  </nav>
</header>
{body}
<footer>
  \u00a9 {BUSINESS} \u00b7 GSTIN {GSTIN}<br/>{ADDRESS}
</footer>
</body></html>"""
    return HTMLResponse(html)


@router.get("/", response_class=HTMLResponse)
def home():
    body = f"""
<div class="hero">
  <h1>{BUSINESS}</h1>
  <p>Cable TV &amp; broadband internet services in Karumathampatti, Coimbatore</p>
  <a class="btn" href="/app">Customer / Staff Login</a>
</div>
<div class="wrap">
  <div class="card">
    <h2>About us</h2>
    <p>{BUSINESS} is a proprietorship providing local cable television and broadband
    internet connections to homes and businesses in and around Karumathampatti, Sulur,
    Coimbatore. We offer monthly subscription plans, new connections, and prompt local
    support.</p>
  </div>
  <div class="card">
    <h2>Our services</h2>
    <ul>
      <li>Cable TV connections with a range of channel packages</li>
      <li>Broadband / internet service</li>
      <li>New connections, plan upgrades, and reconnections</li>
      <li>Monthly subscription billing and doorstep collection</li>
    </ul>
  </div>
  <div class="card">
    <h2>Pay your bill</h2>
    <p>Existing customers can pay their monthly subscription online via UPI.</p>
    <p class="muted">UPI ID: {UPI}</p>
  </div>
  <div class="card">
    <h2>Contact</h2>
    <table>
      <tr><td>Phone</td><td>{PHONE}</td></tr>
      <tr><td>Email</td><td>{EMAIL}</td></tr>
      <tr><td>Address</td><td>{ADDRESS}</td></tr>
      <tr><td>GSTIN</td><td>{GSTIN}</td></tr>
    </table>
  </div>
</div>"""
    return page("Home", body)


@router.get("/about", response_class=HTMLResponse)
def about():
    body = f"""<div class="wrap">
  <div class="card">
    <h2>About us</h2>
    <p>{BUSINESS} ({LEGAL}, Proprietor) is a locally-run cable TV and internet service
    provider based in Karumathampatti, Coimbatore, Tamil Nadu. We serve residential and
    commercial customers with reliable cable television and broadband connections, backed
    by responsive on-ground support.</p>
    <h3>Business details</h3>
    <table>
      <tr><td>Legal name</td><td>{LEGAL}</td></tr>
      <tr><td>Trade name</td><td>{BUSINESS}</td></tr>
      <tr><td>Constitution</td><td>Proprietorship</td></tr>
      <tr><td>GSTIN</td><td>{GSTIN}</td></tr>
      <tr><td>Address</td><td>{ADDRESS}</td></tr>
    </table>
  </div>
</div>"""
    return page("About", body)


@router.get("/contact", response_class=HTMLResponse)
def contact():
    body = f"""<div class="wrap">
  <div class="card">
    <h2>Contact us</h2>
    <table>
      <tr><td>Business</td><td>{BUSINESS}</td></tr>
      <tr><td>Proprietor</td><td>{LEGAL}</td></tr>
      <tr><td>Phone</td><td>{PHONE}</td></tr>
      <tr><td>Email</td><td>{EMAIL}</td></tr>
      <tr><td>Address</td><td>{ADDRESS}</td></tr>
      <tr><td>GSTIN</td><td>{GSTIN}</td></tr>
    </table>
    <p class="muted" style="margin-top:12px">Support hours: Monday\u2013Saturday, 9:00 AM \u2013 8:00 PM.</p>
  </div>
</div>"""
    return page("Contact", body)


@router.get("/terms", response_class=HTMLResponse)
def terms():
    body = f"""<div class="wrap">
  <div class="card">
    <h2>Terms &amp; Conditions</h2>
    <p>By subscribing to or using services provided by {BUSINESS}, you agree to the
    following terms:</p>
    <ul>
      <li>Subscriptions are billed monthly in advance. Service is provided for the paid period.</li>
      <li>Payments can be made in cash to our collection staff or online via UPI.</li>
      <li>Non-payment beyond the due date may result in temporary disconnection until dues are cleared.</li>
      <li>Reconnection after non-payment may include a pro-rata charge for the current period plus the applicable monthly amount.</li>
      <li>Plans, channel line-ups, and prices may change as per broadcaster/regulatory guidelines.</li>
      <li>Equipment (set-top box, etc.) provided remains the property of {BUSINESS} unless sold outright.</li>
    </ul>
    <p class="muted">For questions about these terms, contact us at {EMAIL} or {PHONE}.</p>
  </div>
</div>"""
    return page("Terms & Conditions", body)


@router.get("/privacy", response_class=HTMLResponse)
def privacy():
    body = f"""<div class="wrap">
  <div class="card">
    <h2>Privacy Policy</h2>
    <p>{BUSINESS} collects only the information needed to provide cable TV and internet
    services and to process payments \u2014 such as your name, address, phone number, and
    subscription/payment records.</p>
    <ul>
      <li>We do not sell or rent your personal information to third parties.</li>
      <li>Payment transactions are processed through secure, PCI-compliant payment providers; we do not store your card or bank credentials.</li>
      <li>Information is used only for billing, service delivery, support, and legal/regulatory compliance.</li>
      <li>You may contact us to review or update your details.</li>
    </ul>
    <p class="muted">Questions? Email {EMAIL} or call {PHONE}.</p>
  </div>
</div>"""
    return page("Privacy Policy", body)


@router.get("/refund", response_class=HTMLResponse)
def refund():
    body = f"""<div class="wrap">
  <div class="card">
    <h2>Refund &amp; Cancellation Policy</h2>
    <ul>
      <li>Subscription charges are billed in advance and are generally non-refundable once the service period has begun.</li>
      <li>You may cancel your subscription at any time; service continues until the end of the period already paid for.</li>
      <li>If you are charged incorrectly (for example, a duplicate online payment), contact us within 7 days and we will verify and refund the excess to the original payment method.</li>
      <li>Approved refunds are processed within 5\u20137 working days.</li>
    </ul>
    <p class="muted">For refund requests, contact {EMAIL} or {PHONE} with your customer ID and payment details.</p>
  </div>
</div>"""
    return page("Refund & Cancellation Policy", body)
