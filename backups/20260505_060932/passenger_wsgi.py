import sys
import os

APP_ROOT = os.path.dirname(os.path.abspath(__file__))

# Add BOTH app root AND backend/ to path
sys.path.insert(0, APP_ROOT)
sys.path.insert(0, os.path.join(APP_ROOT, 'backend'))

from a2wsgi import ASGIMiddleware
from backend.main import app

application = ASGIMiddleware(app)
