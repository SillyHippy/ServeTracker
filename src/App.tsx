// BUILD_CACHE_BUST_$(date +%s)
import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePassword';
import RegisterServerPage from './pages/RegisterServerPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// Lazy load heavy page components for better initial load performance
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ActiveCases = lazy(() => import('./pages/ActiveCases'));
const NewServe = lazy(() => import('./pages/NewServe'));
const Clients = lazy(() => import('./pages/Clients'));
const History = lazy(() => import('./pages/History'));
const Settings = lazy(() => import('./pages/Settings'));
const MigrationPage = lazy(() => import('./pages/Migration'));
const DataExport = lazy(() => import('./pages/DataExport'));
const Servers = lazy(() => import('./pages/Servers'));
const MyProfile = lazy(() => import('./pages/MyProfile'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const DpaPage = lazy(() => import('./pages/DpaPage'));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center h-[50vh]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);
import { ServeAttemptData } from './types/ServeAttemptData';
import { ClientData } from './types/ClientData';
import { api, login, logout, checkAuth } from '@/lib/api';
import {
  getActiveBackend,
} from "./utils/dataSwitch";
import { ACTIVE_BACKEND, BACKEND_PROVIDER } from './config/backendConfig';
import { Button } from "@/components/ui/button";
import { initializeDebugTools } from '@/utils/debugUtils';
import { normalizeServeDataArray } from "@/utils/dataNormalization";
import { createServeEmailBody, createDeleteNotificationEmail } from "@/utils/email";
import { shouldSkipSync, logMemoryStats } from "@/utils/memoryUtils";

// Initialize debug tools for development
if (process.env.NODE_ENV !== 'production') {
  initializeDebugTools();
}

declare global {
  interface Window {
    debugApi: () => void;
    testDeleteClient: (clientId: string) => void;
  }
}

window.debugApi = function() {
  console.log('Local API config:', {
    baseUrl: import.meta.env.VITE_API_URL || '(same origin)',
  });

  api.getClients()
    .then(clients => console.log('Clients:', clients))
    .catch(err => console.error('Error fetching clients:', err));

  console.log('To test client deletion, run:');
  console.log('window.testDeleteClient("CLIENT_ID_HERE")');
};

// Test delete client function
window.testDeleteClient = function(clientId) {
  console.log(`Testing deletion of client ${clientId}`);
  api.deleteClient(clientId)
    .then(result => console.log('Delete result:', result))
    .catch(err => console.error('Error deleting client:', err));
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes - reduces unnecessary refetches
      gcTime: 1000 * 60 * 30,   // 30 minutes - keeps data in cache longer
    },
    mutations: {
      onError: (error) => {
        console.error("Mutation error:", error);
      }
    }
  }
});

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { NotificationProvider } from "@/context/NotificationContext";

// Create a protected route wrapper component
const ProtectedRoute = ({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) => {
  const { status, isAdmin, mustChangePassword } = useAuth();

  if (status === "loading") {
    return <PageLoader />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  // Forced password change blocks everything except the change-password page.
  if (mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const AnimatedRoutes = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status: authStatus, isAdmin } = useAuth();
  const [clients, setClients] = useState<ClientData[]>(() => {
    const savedClients = localStorage.getItem("serve-tracker-clients");
    return savedClients ? JSON.parse(savedClients) : [];
  });

  // Fetch clients only after an admin session exists. Field servers and the
  // login page must not hit /api/clients (401 loop / empty client leak).
  // Re-fetch on navigation so a newly added case (e.g. Campbell) jumps to #1.
  useEffect(() => {
    if (authStatus !== "authenticated" || !isAdmin) return;
    api.getClients().then(apiClients => {
      if (apiClients && apiClients.length > 0) {
        setClients(apiClients.map((c: any) => ({
          id: c.id || c.$id,
          name: c.name || "",
          email: c.email || "",
          additionalEmails: c.additionalEmails || c.additional_emails || [],
          phone: c.phone || "",
          address: c.address || "",
          notes: c.notes || "",
        })));
      }
    }).catch(() => {
      console.log("Could not fetch from API, using localStorage");
    });
  }, [authStatus, isAdmin, location.pathname]);

  // Data will be fetched fresh when needed

  useEffect(() => {
    localStorage.setItem("serve-tracker-clients", JSON.stringify(clients));
    console.log("Updated localStorage serve-tracker-clients:", clients.length, "clients");
  }, [clients]);

  const createClient = async (client) => {
    try {
      console.log("Creating new client:", client);
      const newClient = await api.createClient({
        name: client.name,
        email: client.email,
        additionalEmails: client.additionalEmails || [],
        phone: client.phone,
        address: client.address,
        notes: client.notes
      });
      
      if (newClient) {
        toast({
          title: "Client created",
          description: "New client has been added successfully",
          variant: "success",
        });
        
        const clientData = {
          id: newClient.id || newClient.$id,
          name: newClient.name,
          email: newClient.email,
          additionalEmails: newClient.additional_emails || [],
          phone: newClient.phone,
          address: newClient.address,
          notes: newClient.notes || "",
        };
        
        setClients(prev => [clientData, ...prev]);
        
        setTimeout(() => {
        }, 500);
        
        return clientData;
      }
    } catch (error) {
      console.error("Error creating client:", error);
      toast({
        title: "Error creating client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateClient = async (updatedClient) => {
    try {
      console.log("Updating client:", updatedClient);
      
      // Ensure we're sending the correct structure
      const clientData = {
        name: updatedClient.name,
        email: updatedClient.email,
        additionalEmails: updatedClient.additionalEmails || [],
        phone: updatedClient.phone,
        address: updatedClient.address,
        notes: updatedClient.notes || "",
      };
      
      console.log("Prepared client data:", clientData);
      
      const result = await api.updateClient(updatedClient.id, clientData);
      
      if (result) {
        toast({
          title: "Client updated",
          description: "Client has been successfully updated",
          variant: "success",
        });
        
        // Make sure we map the data correctly to account for field name differences
        const updatedClientWithSchema = {
          id: result.id || result.$id,
          name: result.name,
          email: result.email,
          additionalEmails: result.additional_emails || [],
          phone: result.phone,
          address: result.address,
          notes: result.notes || "",
        };
        
        setClients((prev) =>
          prev.map((client) =>
            client.id === updatedClient.id ? updatedClientWithSchema : client
          )
        );
        
        setTimeout(() => {
        }, 500);
        
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error updating client:", error);
      console.error("Error details:", error.response || error.message);
      
      toast({
        title: "Error updating client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteClient = async (clientId: string): Promise<boolean> => {
    try {
      if (!clientId) throw new Error("Missing client id");
      console.log(`Starting deletion process for client ${clientId}`);

      // First delete serve attempts (paginate through all)
      const serveAttempts = await api.getServeAttempts(500, 0);
      const clientServes = (serveAttempts || []).filter(
        (serve: any) => (serve.clientId || serve.client_id) === clientId
      );
      console.log(`Found ${clientServes.length} serve attempts to delete`);

      for (const serve of clientServes) {
        const serveId = serve.id || serve.$id;
        if (serveId) await api.deleteServeAttempt(serveId);
      }

      // Delete documents
      try {
        const documents = await api.getClientDocuments(clientId);
        for (const doc of documents || []) {
          const docId = doc.$id || doc.id;
          if (docId) await api.deleteClientDocument(docId, doc.file_path || doc.filePath);
        }
      } catch (docErr) {
        console.warn("Document cleanup during client delete:", docErr);
      }

      // Server cascade also removes cases/recipients/serves
      await api.deleteClient(clientId);

      setClients((prev) =>
        prev.filter((client) => (client.id || (client as any).$id) !== clientId)
      );

      toast({
        title: "Client deleted",
        description: "Client and associated data have been removed",
        variant: "success",
      });
      
      return true;
    } catch (error) {
      console.error("Error deleting client:", error);
      toast({
        title: "Error deleting client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const createServe = async (serveData) => {
    try {
      // Single save. Server /api/serves sends link-based email (no Photo-1 attachment).
      const newServe = await api.createServeAttempt(serveData);
      console.log("Serve attempt saved successfully:", newServe.id);

      toast({
        title: "Serve recorded",
        description: "Service attempt has been saved successfully",
        variant: "success",
      });

      return true;
    } catch (error) {
      console.error("Error creating serve attempt:", error);
      toast({
        title: "Error saving serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateServe = async (serveData) => {
    try {
      // Never send coordinates / gps_source on edit — original GPS stays locked
      const payload = {
        status: serveData.status || "unknown",
        notes: serveData.notes || "",
        case_number: serveData.caseNumber || serveData.case_number || null,
        case_name: serveData.caseName || serveData.case_name || "Unknown Case",
        serviceMethod: serveData.serviceMethod || serveData.service_method || "",
        service_method: serveData.serviceMethod || serveData.service_method || "",
        acceptedBy: serveData.acceptedBy || serveData.accepted_by || "",
        accepted_by: serveData.acceptedBy || serveData.accepted_by || "",
      };

      const updatedServe = await api.updateServeAttempt(serveData.id, payload);

      toast({
        title: "Serve updated",
        description: "Service attempt has been updated successfully",
        variant: "success",
      });

      return true;
    } catch (error) {
      console.error("Error updating serve attempt:", error);
      toast({
        title: "Error updating serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteServe = async (serveId: string): Promise<boolean> => {
    try {
      console.log("Attempting to delete serve with ID:", serveId);
      
      await api.deleteServeAttempt(serveId);

      toast({
        title: "Serve deleted",
        description: "Service attempt has been removed",
        variant: "success",
      });
      
      return true;
    } catch (error) {
      console.error("Error deleting serve attempt:", error);
      toast({
        title: "Error deleting serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  return (
    <>
      <Routes location={location}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/join" element={<RegisterServerPage />} />
        <Route path="/signup" element={<RegisterServerPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/terms" element={<Suspense fallback={<PageLoader />}><TermsPage /></Suspense>} />
        <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><PrivacyPage /></Suspense>} />
        <Route path="/dpa" element={<Suspense fallback={<PageLoader />}><DpaPage /></Suspense>} />
        
        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/" element={
            <Suspense fallback={<PageLoader />}>
              <Dashboard clients={clients} serves={[]} />
            </Suspense>
          } />
          <Route path="/dashboard" element={
            <Suspense fallback={<PageLoader />}>
              <Dashboard clients={clients} serves={[]} />
            </Suspense>
          } />
          <Route path="/active-cases" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <ActiveCases />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/new-serve" element={
            <Suspense fallback={<PageLoader />}>
              <NewServe clients={clients} addServe={createServe} />
            </Suspense>
          } />
          <Route path="/new-serve/:clientId" element={
            <Suspense fallback={<PageLoader />}>
              <NewServe clients={clients} addServe={createServe} />
            </Suspense>
          } />
          <Route path="/clients" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <Clients 
                  clients={clients} 
                  addClient={createClient}
                  updateClient={updateClient}
                  deleteClient={deleteClient}
                />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/history" element={
            <Suspense fallback={<PageLoader />}>
              <History 
                serves={[]} 
                clients={clients}
                deleteServe={deleteServe}
                updateServe={updateServe}
              />
            </Suspense>
          } />
          <Route path="/migration" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <MigrationPage />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/export" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <DataExport />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/settings" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <Settings />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/servers" element={
            <Suspense fallback={<PageLoader />}>
              <ProtectedRoute adminOnly>
                <Servers />
              </ProtectedRoute>
            </Suspense>
          } />
          <Route path="/profile" element={
            <Suspense fallback={<PageLoader />}>
              <MyProfile />
            </Suspense>
          } />
        </Route>
      </Routes>
    </>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
          <AnimatedRoutes />
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
// cache-bust-1780205047
const FORCE_NEW_BUILD = true;
// BUILD_CACHE_BUST_1780205619
// BUILD_CACHE_BUST_20260818_field_server_profile
// BUILD_CACHE_BUST_20260819_active_cases_menu_client_sort
