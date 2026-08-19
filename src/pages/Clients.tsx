import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PlusCircle, Users, Pencil, Trash2, UserCheck, ArrowLeft } from "lucide-react";
import ClientForm, { ClientData } from "@/components/ClientForm";
import ClientDetail from "@/components/ClientDetail";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ClientsProps {
  clients: ClientData[];
  addClient: (client: ClientData) => void;
  updateClient: (client: ClientData) => void;
  deleteClient: (clientId: string) => Promise<boolean>;
}

const Clients: React.FC<ClientsProps> = ({ 
  clients, 
  addClient, 
  updateClient, 
  deleteClient 
}) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [isDetailView, setIsDetailView] = useState(false);
  const [liveClients, setLiveClients] = useState<ClientData[]>(clients);
  const { toast } = useToast();

  useEffect(() => {
    setLiveClients(clients);
  }, [clients]);

  const refreshClients = async () => {
    try {
      const apiClients = await api.getClients();
      if (!Array.isArray(apiClients)) return;
      setLiveClients(
        apiClients.map((c: any) => ({
          id: c.id || c.$id,
          name: c.name || "",
          email: c.email || "",
          additionalEmails: c.additionalEmails || c.additional_emails || [],
          phone: c.phone || "",
          address: c.address || "",
          notes: c.notes || "",
        }))
      );
    } catch (err) {
      console.warn("Clients: live refresh failed, using current list", err);
    }
  };

  useEffect(() => {
    void refreshClients();
  }, []);

  const handleAddClient = async (client: ClientData) => {
    setIsLoading(true);
    
    try {
      await addClient(client);
      await refreshClients();
      toast({
        title: "Client added",
        description: "New client has been created successfully",
      });
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error("Error adding client:", error);
      toast({
        title: "Error",
        description: "Failed to add client",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateClient = async (client: ClientData) => {
    setIsLoading(true);
    
    try {
      await updateClient(client);
      toast({
        title: "Client updated",
        description: "Client information has been updated successfully",
      });
    } catch (error) {
      console.error("Error updating client:", error);
      toast({
        title: "Error",
        description: "Failed to update client",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clientIdOf = (client: ClientData | null | undefined) =>
    (client?.id || (client as any)?.$id || "").toString();

  const handleDeleteConfirm = async () => {
    const id = deleteClientId || clientIdOf(selectedClient);
    if (!id) {
      toast({
        title: "Error",
        description: "Cannot delete — client has no ID. Try refreshing the page.",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    try {
      const success = await deleteClient(id);
      if (success) {
        toast({
          title: "Client deleted",
          description: "Client has been successfully removed",
        });
        if (clientIdOf(selectedClient) === id) {
          setSelectedClient(null);
          setIsDetailView(false);
        }
      }
      setDeleteClientId(null);
    } catch (error) {
      console.error("Error in client deletion process:", error);
      toast({
        title: "Error",
        description: "An error occurred while deleting the client",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectClient = (client: ClientData) => {
    setSelectedClient({
      ...client,
      id: clientIdOf(client),
      name: client.name || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
    });
    setIsDetailView(true);
  };

  const handleBackToList = () => {
    setSelectedClient(null);
    setIsDetailView(false);
    void refreshClients();
  };

  const filteredClients = liveClients.filter((client) => {
    const q = searchTerm.toLowerCase();
    const name = (client.name || "").toLowerCase();
    const email = (client.email || "").toLowerCase();
    const address = (client.address || "").toLowerCase();
    // Blank-name clients always remain visible so they can be deleted
    if (!searchTerm.trim() && !name.trim()) return true;
    return name.includes(q) || email.includes(q) || address.includes(q);
  });

  if (isDetailView && selectedClient) {
    return (
      <div className="page-container pb-20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6">
          <div>
            <Button 
              variant="outline" 
              onClick={handleBackToList}
              className="mb-2"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Clients
            </Button>
            <h1 className="text-2xl font-bold">
              {(selectedClient.name || "").trim() || "(No name — blank client)"}
            </h1>
          </div>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="outline" 
                className="text-destructive hover:bg-destructive/10 mt-2 sm:mt-0"
                onClick={() => setDeleteClientId(clientIdOf(selectedClient))}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Client
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Client</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this client? This action will also remove all serve attempts, documents, and cases associated with this client. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                <AlertDialogCancel onClick={() => setDeleteClientId(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDeleteConfirm}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isLoading}
                >
                  {isLoading ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        
        <ClientDetail 
          client={selectedClient} 
          onUpdate={handleUpdateClient}
          onBack={handleBackToList}
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Client Management</h1>
        <p className="text-muted-foreground">
          Sorted by most recent case — the client you just added a job for is at the top
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between mb-6">
        <div className="relative w-full sm:w-72">
          <Input
            placeholder="Search clients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Client
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Client</DialogTitle>
              <DialogDescription>
                Enter client details to create a new record
              </DialogDescription>
            </DialogHeader>
            <ClientForm onSubmit={handleAddClient} isLoading={isLoading} />
          </DialogContent>
        </Dialog>
      </div>

      {liveClients.length === 0 ? (
        <Card className="neo-card">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center min-h-[200px]">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <CardTitle className="mb-2">No clients added yet</CardTitle>
            <CardDescription className="mb-4">
              Add your first client to get started
            </CardDescription>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClients.map(client => (
            <Card 
              key={clientIdOf(client) || `client-${Math.random()}`} 
              className="neo-card overflow-hidden animate-scale-in hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleSelectClient(client)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex justify-between items-center">
                  <span className={`truncate ${(client.name || "").trim() ? "" : "text-muted-foreground italic"}`}>
                    {(client.name || "").trim() || "(No name — blank client)"}
                  </span>
                  <UserCheck className="h-5 w-5 text-muted-foreground" />
                </CardTitle>
              </CardHeader>
              
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Email:</span>{" "}
                    <a 
                      href={`mailto:${client.email}`} 
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {client.email}
                    </a>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>{" "}
                    <a 
                      href={`tel:${client.phone}`} 
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {client.phone}
                    </a>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Address:</span>
                    <div className="mt-1">{client.address}</div>
                  </div>
                  {client.notes && (
                    <div className="pt-2">
                      <span className="text-muted-foreground">Notes:</span>
                      <div className="mt-1 text-muted-foreground line-clamp-2">{client.notes}</div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Clients;
