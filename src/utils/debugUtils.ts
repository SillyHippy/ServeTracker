import { api } from '@/lib/api';

interface ClientData {
  id: string;
  name: string;
  email: string;
  additionalEmails: string[];
  phone: string;
  address: string;
  notes: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    inspectApiConfig: () => void;
    testCreateClient: () => Promise<{ success: boolean; client?: unknown; error?: unknown }>;
    testDeleteClient: (clientId: string) => void;
    listClients: () => Promise<{ success: boolean; clients?: unknown[]; error?: unknown }>;
  }
}

export function initializeDebugTools() {
  console.log('Debug tools initialized');

  window.inspectApiConfig = () => {
    console.log('Local API config:', {
      baseUrl: import.meta.env.VITE_API_URL || '(same origin)',
    });
  };

  window.testCreateClient = async function() {
    try {
      const clientData: ClientData = {
        id: '',
        name: 'Test Client',
        email: 'test@example.com',
        additionalEmails: [],
        phone: '555-123-4567',
        address: '123 Test Street',
        notes: 'Created for testing'
      };

      const newClient = await api.createClient(clientData);
      console.log('Test client created:', newClient);
      return { success: true, client: newClient };
    } catch (error) {
      console.error('Error creating test client:', error);
      return { success: false, error };
    }
  };

  window.listClients = async function() {
    try {
      const clients = await api.getClients();
      console.log('Listing all clients:', clients);
      return { success: true, clients };
    } catch (error) {
      console.error('Error listing clients:', error);
      return { success: false, error };
    }
  };
}
