
import { ACTIVE_BACKEND, BACKEND_PROVIDER } from '@/config/backendConfig';
import { checkApiConnection } from '@/lib/api';
import { toast } from 'sonner';

export const isUsingLocalApi = () => ACTIVE_BACKEND === BACKEND_PROVIDER.LOCAL;

export const checkBackendConnection = async () => {
  try {
    const connected = await checkApiConnection();
    if (connected) {
      window.localStorage.removeItem('useLocalStorageFallback');
      console.log("Successfully connected to local API");
      return { connected: true, provider: 'Local API' };
    }
    throw new Error('Health check failed');
  } catch (error) {
    console.error("API connection check failed:", error);
    window.localStorage.setItem('useLocalStorageFallback', 'true');

    if (!window.localStorage.getItem('connectionErrorShown')) {
      toast.error("Server connection failed", {
        description: "Using local storage as fallback. Data will sync when connection is restored."
      });
      window.localStorage.setItem('connectionErrorShown', 'true');
    }

    return { connected: false, provider: 'Local API', error };
  }
};

export const getBackendInfo = () => {
  return {
    name: "Zo SQLite",
    icon: "🖥️",
    color: "bg-emerald-500"
  };
};

export default {
  isUsingLocalApi,
  checkBackendConnection,
  getBackendInfo
};
