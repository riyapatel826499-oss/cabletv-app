# utils package - re-exports from utils.py (sibling file)
# This file exists because utils/ directory was created alongside utils.py
# and cannot be removed via FTP. It makes both coexist safely.
import os, importlib.util

_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_utils_py = os.path.join(_parent, "utils.py")

_spec = importlib.util.spec_from_file_location("_utils_module", _utils_py)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

# Re-export all public names
for _n in dir(_mod):
    if not _n.startswith("_"):
        globals()[_n] = getattr(_mod, _n)
