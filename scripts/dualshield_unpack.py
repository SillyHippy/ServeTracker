#!/usr/bin/env python3
"""Unpack Dual-Shield zip to a dir. Args: zip_path dest_dir"""
import os
import sys
import zipfile

zip_path, dest = sys.argv[1], sys.argv[2]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(zip_path, "r") as zf:
    zf.extractall(dest)
print(dest)
