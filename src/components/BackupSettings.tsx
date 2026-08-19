import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Cloud, CloudUpload, Download, Loader2, CheckCircle2, AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  isGdriveConfigured,
  isGdriveReady,
  isGdriveSetUp,
  getStoredToken,
  getLastBackupTime,
  signInWithGoogle,
  disconnectGdrive,
  backupToDrive,
  listBackupFiles,
  restoreFromDrive,
} from '@/lib/gdrive';
import { api } from '@/lib/api';

interface BackupSettingsProps {
  onRestore?: (data: any) => void;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return '1 hour ago';
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function BackupSettings({ onRestore }: BackupSettingsProps) {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [backupFiles, setBackupFiles] = useState<{ id: string; name: string; modifiedTime: string; size: number }[]>([]);
  const [showRestoreList, setShowRestoreList] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const gisCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isGdriveReady()) {
      setGisReady(true);
      return;
    }
    let ticks = 0;
    gisCheckRef.current = setInterval(() => {
      ticks += 1;
      if (isGdriveReady()) {
        setGisReady(true);
        if (gisCheckRef.current) clearInterval(gisCheckRef.current);
        return;
      }
      if (ticks >= 25) {
        if (gisCheckRef.current) clearInterval(gisCheckRef.current);
        setGisReady(false);
      }
    }, 200);
    return () => { if (gisCheckRef.current) clearInterval(gisCheckRef.current); };
  }, []);

  useEffect(() => {
    if (!gisReady || !isGdriveConfigured()) return;
    const token = getStoredToken();
    setIsConnected(!!token && isGdriveSetUp());
    setLastBackup(getLastBackupTime());
  }, [gisReady]);

  const handleConnect = async () => {
    try {
      const token = await signInWithGoogle();
      setIsConnected(true);
      if (token) {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const info = await res.json();
          setGoogleEmail(info.email || '');
        }
      }
      toast({ title: 'Connected', description: 'Google Drive linked successfully' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Connection failed', description: err.message });
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const token = getStoredToken();
      if (!token) throw new Error('Sign in first');
      
      // Fetch all data from the API via api.* — these prefix the public base path
      // (e.g. /servetracker-staging) and use the session cookie, not the Google token.
      const [clients, cases, serves] = await Promise.all([
        api.getClients(),
        api.getCases(),
        api.getServeAttempts(500, 0),
      ]);
      
      const data = {
        clients: Array.isArray(clients) ? clients : [],
        cases: Array.isArray(cases) ? cases : [],
        serves: Array.isArray(serves) ? serves : [],
        timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
      };
      
      const filename = await backupToDrive(data);
      setLastBackup(new Date().toISOString());
      toast({ title: 'Backup complete', description: `Saved as ${filename}` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Backup failed', description: err.message });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleListFiles = async () => {
    setIsLoadingFiles(true);
    setShowRestoreList(true);
    try {
      const files = await listBackupFiles();
      setBackupFiles(files);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to list backups', description: err.message });
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleRestore = async (file: { id: string; name: string }) => {
    setIsRestoring(true);
    try {
      const data = await restoreFromDrive(file.id);
      if (onRestore) {
        await onRestore(data);
      }
      toast({ title: 'Restore complete', description: `Restored from ${file.name}` });
      setShowRestoreList(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Restore failed', description: err.message });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGdrive();
    setIsConnected(false);
    setGoogleEmail('');
    setLastBackup(null);
    setBackupFiles([]);
    setShowRestoreList(false);
    toast({ title: 'Disconnected', description: 'Google Drive unlinked' });
  };

  if (!isGdriveConfigured()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            Google Drive Backup
          </CardTitle>
          <CardDescription>
            Optional JSON export of clients, cases, and serve data. Not used for court packets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not configured on this host. Live data already lives in Zo SQLite. Add a Google OAuth client id later if you want personal Drive copies.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="w-5 h-5" />
          Google Drive Backup
        </CardTitle>
        <CardDescription>
          Back up your clients, cases, and serve data to Google Drive
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Google Drive to create JSON backups of clients, cases, and serve data in your personal Drive. This does not store court packets.
            </p>
            <Button onClick={handleConnect} disabled={!gisReady || !isGdriveConfigured()}>
              <CloudUpload className="w-4 h-4 mr-2" />
              {gisReady ? 'Connect Google Drive' : 'Google sign-in unavailable'}
            </Button>
            {!gisReady && (
              <p className="text-xs text-amber-700">
                Google Identity Services did not load. Staging has no Google client id, so this button cannot finish. Server SQLite is the live backup.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm font-medium">{googleEmail || 'Connected'}</p>
                {lastBackup && (
                  <p className="text-xs text-muted-foreground">Last backup: {formatRelativeTime(lastBackup)}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                <LogOut className="w-4 h-4 mr-1" />
                Disconnect
              </Button>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleBackup} disabled={isBackingUp}>
                {isBackingUp ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                {isBackingUp ? 'Backing up...' : 'Back Up Now'}
              </Button>
              <Button variant="outline" onClick={handleListFiles} disabled={isLoadingFiles}>
                <RefreshCw className="w-4 h-4 mr-2" />
                List Backups
              </Button>
            </div>

            {showRestoreList && (
              <div className="border rounded-lg p-3 space-y-2">
                <h4 className="text-sm font-medium">Stored Backups</h4>
                {isLoadingFiles ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </div>
                ) : backupFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No backups found</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {backupFiles.map((file) => (
                      <div key={file.id} className="flex items-center justify-between p-2 bg-background rounded border">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(file.modifiedTime).toLocaleString()} &middot; {file.size ? `${Math.round(file.size / 1024)} KB` : ''}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(file)}
                          disabled={isRestoring}
                        >
                          {isRestoring ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Download className="w-4 h-4 mr-1" />
                          )}
                          Restore
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
export default BackupSettings;
