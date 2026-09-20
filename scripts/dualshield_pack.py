#!/usr/bin/env python3
"""Build Dual-Shield zip: manifest.json + photo files. JSON on stdin."""
import json
import os
import sys
import zipfile

payload = json.load(sys.stdin)
out = payload["zip_path"]
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("manifest.json", json.dumps(payload["manifest"], separators=(",", ":")))
    for item in payload.get("files") or []:
        src = item.get("src") or ""
        arc = item.get("arc") or ""
        if src and arc and os.path.isfile(src):
            zf.write(src, arcname=arc)
print(out)
