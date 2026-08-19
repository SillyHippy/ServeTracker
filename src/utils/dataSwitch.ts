import { toast } from 'sonner';

export const clearLocalStorage = () => {
  try {
    localStorage.removeItem("serve-tracker-clients");
    localStorage.removeItem("serve-tracker-serves");
    toast.success("Local storage cleared");
    return true;
  } catch (error) {
    console.error("Error clearing local storage:", error);
    toast.error("Failed to clear local storage");
    return false;
  }
};
import { api } from '@/lib/api';
import { ServeAttemptData } from '@/types/ServeAttemptData';
import { ClientData } from '@/components/ClientForm';

export const syncToBackend = async () => {
  try {
    const clientsStr = localStorage.getItem("serve-tracker-clients");
    const servesStr = localStorage.getItem("serve-tracker-serves");
    
    const clients = clientsStr ? JSON.parse(clientsStr) : [];
    const serves = servesStr ? JSON.parse(servesStr) : [];
    
    console.log(`Found ${clients.length} clients and ${serves.length} serve attempts in localStorage`);
    
    for (const client of clients) {
      try {
        await api.createClient(client);
        console.log(`Migrated client: ${client.name}`);
      } catch (error) {
        console.error(`Error migrating client ${client.id}:`, error);
      }
    }
    
    for (const serve of serves) {
      try {
        await api.createServeAttempt(serve);
        console.log(`Migrated serve attempt: ${serve.id}`);
      } catch (error) {
        console.error(`Error migrating serve attempt ${serve.id}:`, error);
      }
    }
    
    return {
      success: true,
      clientsCount: clients.length,
      servesCount: serves.length
    };
  } catch (error) {
    console.error("Error syncing to backend:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
};

export const loadDataFromBackend = async (): Promise<{
  clients: ClientData[];
  serves: ServeAttemptData[];
}> => {
  let clients: ClientData[] = [];
  let serves: ServeAttemptData[] = [];
  
  try {
    const backendClients = await api.getClients();
    clients = backendClients.map(client => ({
      id: client.id as string,
      name: client.name as string,
      email: client.email as string,
      additionalEmails: (client.additional_emails as string[]) || [],
      phone: client.phone as string,
      address: client.address as string,
      notes: (client.notes as string) || ""
    }));
  } catch (error) {
    console.error("Error loading clients from API:", error);
    const savedClients = localStorage.getItem("serve-tracker-clients");
    if (savedClients) {
      clients = JSON.parse(savedClients);
    }
  }
  
  try {
    const backendServes = await api.getServeAttempts();
    serves = backendServes.map(serve => ({
      id: serve.id as string,
      clientId: serve.client_id as string,
      date: serve.date as string,
      time: serve.time as string,
      address: serve.address as string,
      notes: serve.notes as string,
      status: serve.status as string,
      imageData: serve.imageData as string,
      coordinates: serve.coordinates as string
    }));
  } catch (error) {
    console.error("Error loading serve attempts from API:", error);
  }
  
  return { clients, serves };
};

export const saveClientToBackend = async (client: ClientData): Promise<ClientData | null> => {
  try {
    await api.createClient(client);
    return client;
  } catch (error) {
    console.error("Error saving client to API:", error);
    return null;
  }
};

export const checkBackendConnection = async (): Promise<boolean> => {
  try {
    await api.getClients();
    return true;
  } catch {
    return false;
  }
};
