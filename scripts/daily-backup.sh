#!/bin/bash
# Daily backup script - runs at 2 AM
BACKUP_DIR="/home/workspace/Projects/PDFUSAEDIT-zo/backups"
DATA_DIR="/home/workspace/Projects/PDFUSAEDIT-zo/data"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
ZIP_FILE="$BACKUP_DIR/pdfusaedit-backup-$TIMESTAMP.zip"

mkdir -p "$BACKUP_DIR"

# Create zip backup
cd /home/workspace/Projects/PDFUSAEDIT-zo
zip -r "$ZIP_FILE" data/ -x "data/*.db-wal" "data/*.db-shm" 2>/dev/null

# Upload to Google Drive if configured
if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q gdrive; then
  rclone copy "$ZIP_FILE" "gdrive:PDFUSAEDIT-Backups/" 2>/dev/null
  echo "$(date): Backup uploaded to Drive" >> /dev/shm/backup-cron.log
else
  echo "$(date): Local backup created (Drive not configured)" >> /dev/shm/backup-cron.log
fi

# Clean up backups older than 30 days
find "$BACKUP_DIR" -name "pdfusaedit-backup-*.zip" -mtime +30 -delete 2>/dev/null

echo "$(date): Backup complete ($ZIP_FILE)" >> /dev/shm/backup-cron.log
