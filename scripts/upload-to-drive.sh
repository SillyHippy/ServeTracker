#!/bin/bash
# Upload latest backup to Google Drive
# Requires rclone configured with remote name "gdrive"

BACKUP_DIR="/home/workspace/Projects/PDFUSAEDIT-zo/backups"
LATEST=$(ls -t "$BACKUP_DIR"/pdfusaedit-backup-*.zip 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "No backup files found in $BACKUP_DIR"
  exit 1
fi

FILENAME=$(basename "$LATEST")
echo "Uploading $FILENAME to Google Drive..."

# Try rclone first
if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q gdrive; then
  rclone copy "$LATEST" "gdrive:PDFUSAEDIT-Backups/" --progress
  echo "Uploaded via rclone: gdrive:PDFUSAEDIT-Backups/$FILENAME"
  exit 0
fi

# Fallback: try gdrive CLI
if command -v gdrive &>/dev/null; then
  # Check if "PDFUSAEDIT-Backups" folder exists, create if not
  FOLDER_ID=$(gdrive files list --name "PDFUSAEDIT-Backups" --fields "files(id)" 2>/dev/null | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$FOLDER_ID" ]; then
    FOLDER_ID=$(gdrive files mkdir --name "PDFUSAEDIT-Backups" 2>/dev/null | grep -o '^[a-zA-Z0-9_-]*')
  fi
  gdrive files upload --parent "$FOLDER_ID" "$LATEST"
  echo "Uploaded via gdrive"
  exit 0
fi

echo "Error: Neither rclone (with gdrive remote) nor gdrive CLI is configured."
echo "Run: rclone config  (add remote named 'gdrive' pointing to Google Drive)"
exit 1
