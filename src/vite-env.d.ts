
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    [key: string]: unknown;
  }

  type Storage = globalThis.Storage;
  type Request = globalThis.Request;
  type Response = globalThis.Response;
  type EventSource = globalThis.EventSource;

  interface GeolocationCoordinatesCompatible {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }

  type CoordinateTypes = string | GeolocationCoordinatesCompatible | null;
}
