
import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ServeAttempt from "@/components/ServeAttempt";
import { ServeAttemptData } from "@/types/ServeAttemptData";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { isGeolocationCoordinates } from "@/utils/gps";
import { ClientData } from '@/components/ClientForm';
import { useAuth } from "@/context/AuthContext";

interface NewServeProps {
  clients: any[];
  addServe: (serve: ServeAttemptData) => void;
}

const NewServe: React.FC<NewServeProps> = ({ clients: propClients, addServe }) => {
  const navigate = useNavigate();
  const { isServer } = useAuth();
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get("clientId");
  const caseNumber = searchParams.get("caseNumber");

  const [caseAttempts, setCaseAttempts] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [clients, setClients] = useState<any[]>(propClients || []);

  useEffect(() => {
    if (propClients && propClients.length > 0) {
      setClients(propClients);
    } else {
      api.getClients().then((res: any) => {
        if (res && res.length > 0) {
          setClients(res.map((c: any) => ({
            id: c.id || c.$id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            notes: c.notes || "",
          })));
        }
      });
    }
  }, [propClients]);

  useEffect(() => {
    if (clientId && caseNumber) {
      fetchAttemptCount(clientId, caseNumber);
    }
  }, [clientId, caseNumber]);

  const fetchAttemptCount = async (clientId: string, caseNumber: string) => {
    setIsLoading(true);
    try {
      const serveAttempts = await api.getClientServeAttempts(clientId);
      const attemptsForCase = serveAttempts.filter(
        (attempt) => attempt.case_number === caseNumber
      );
      setCaseAttempts(attemptsForCase.length);
    } catch (error) {
      console.error("Error fetching serve attempts:", error);
      toast({
        title: "Error",
        description: "Failed to fetch serve attempts",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleServeComplete = async (_serveData: ServeAttemptData) => {
    // ServeAttempt.tsx already POSTs /api/serves once.
    // Do NOT call createServeAttempt again here — that was causing
    // duplicate DB rows and duplicate client emails.
    toast({
      title: "Serve recorded",
      description: "Service attempt has been saved successfully.",
      variant: "success",
    });
    navigate("/history");
  };

  return (
    <div className="page-container">
      <div className="mb-8">
        <Button
          variant="ghost"
          className="mb-2"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold tracking-tight mb-2">New Serve Attempt</h1>
        <p className="text-muted-foreground">
          Create a new serve record with photo evidence and GPS location
        </p>
        {caseAttempts > 0 && (
          <p className="text-sm bg-primary/10 text-primary mt-2 p-1 px-2 rounded-full inline-block">
            Attempt #{caseAttempts + 1}
          </p>
        )}
      </div>

      {/* Field servers get [] from GET /api/clients by design (routes.ts) — don't block
          them with the admin "no clients" empty state; the form lists assigned cases. */}
      {clients.length === 0 && !isServer ? (
        <div className="max-w-md mx-auto text-center">
          <h2 className="text-lg font-medium mb-2">No clients found</h2>
          <p className="text-muted-foreground mb-4">
            You need to add a client before creating a serve attempt.
          </p>
          <Button onClick={() => navigate("/clients")}>
            Add Client
          </Button>
        </div>
      ) : (
        <ServeAttempt
          clients={clients}
          onComplete={handleServeComplete}
          previousAttempts={caseAttempts}
        />
      )}
    </div>
  );
};

export default NewServe;
