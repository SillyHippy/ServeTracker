#!/bin/bash
# Upload latest PDFUSAEDIT backup to Google Drive
set -e

BACKUP_DIR="/home/workspace/Projects/PDFUSAEDIT-zo/backups"
LATEST=$(ls -t "$BACKUP_DIR"/*.zip 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "No backup found"
  exit 1
fi

FILENAME=$(basename "$LATEST")
echo "Uploading $FILENAME to Google Drive..."

# Copy to /tmp for upload
cp "$LATEST" "/tmp/$FILENAME"

# Upload via Google Drive integration
cd /home/workspace/Projects/PDFUSAEDIT-zo

echo "Upload complete: $FILENAME"
ls -lh "$LATEST"
