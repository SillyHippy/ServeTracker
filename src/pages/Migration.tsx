import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Database, ArrowLeftRight, Loader2, Check, AlertCircle, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { migrateLocalStorageToServer } from "@/utils/migrationHelper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const MigrationPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{
    success: boolean;
    clientsCount?: number;
    servesCount?: number;
    error?: string;
  } | null>(null);

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      const result = await migrateLocalStorageToServer();
      setMigrationResult(result);
      
      if (result.success) {
        toast({
          title: "Migration Complete",
          description: `Successfully migrated ${result.clientsCount} clients and ${result.servesCount} serve attempts`,
          variant: "success"
        });
      } else {
        toast({
          title: "Migration Failed",
          description: result.error || "An unknown error occurred",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error during migration:", error);
      setMigrationResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      
      toast({
        title: "Migration Error",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setIsMigrating(false);
    }
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
        <h1 className="text-3xl font-bold tracking-tight mb-2">Data Migration</h1>
        <p className="text-muted-foreground">
          Migrate your data from browser local storage to the local API and SQLite database
        </p>
      </div>
      
      <Card className="neo-card mb-8">
        <CardHeader>
          <CardTitle>Data Migration Tool</CardTitle>
          <CardDescription>
            This tool moves clients and serve attempts from browser local storage into the server SQLite database
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-4">
            <div className="flex items-center justify-center mb-6">
              <div className="text-center p-4 bg-muted rounded-lg">
                <Database className="h-12 w-12 text-primary/70 mx-auto mb-2" />
                <p className="font-medium">Browser Local Storage</p>
              </div>
              <ArrowLeftRight className="mx-6 h-6 w-6 text-muted-foreground" />
              <div className="text-center p-4 bg-primary/10 rounded-lg">
                <Server className="h-12 w-12 text-primary mx-auto mb-2" />
                <p className="font-medium">Local API / SQLite</p>
              </div>
            </div>
            
            {migrationResult && (
              <Alert className="mb-6" variant={migrationResult.success ? "default" : "destructive"}>
                <div className="flex items-center gap-2">
                  {migrationResult.success ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {migrationResult.success ? "Migration Successful" : "Migration Failed"}
                  </AlertTitle>
                </div>
                <AlertDescription className="pt-2">
                  {migrationResult.success ? (
                    <div>
                      <p>Successfully migrated:</p>
                      <ul className="list-disc pl-5 mt-1">
                        <li>{migrationResult.clientsCount} clients</li>
                        <li>{migrationResult.servesCount} serve attempts</li>
                      </ul>
                    </div>
                  ) : (
                    <p>{migrationResult.error || "An unknown error occurred"}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            <Button 
              onClick={handleMigrate} 
              className="w-full" 
              disabled={isMigrating || (migrationResult?.success === true)}
            >
              {isMigrating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Migrating Data...
                </>
              ) : migrationResult?.success ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Migration Complete
                </>
              ) : (
                <>
                  <ArrowLeftRight className="mr-2 h-4 w-4" />
                  Start Migration
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Migration Information</h2>
        <div className="space-y-2">
          <p>This migration tool will help you:</p>
          <ul className="list-disc pl-5">
            <li>Transfer clients from browser local storage to SQLite</li>
            <li>Transfer serve attempts from browser local storage to SQLite</li>
            <li>Ensure your data is persisted on the server across restarts</li>
          </ul>
        </div>
        
        <div className="bg-amber-50 p-4 rounded-md mt-4">
          <h3 className="font-medium text-amber-800 mb-2">Important Notes</h3>
          <ul className="list-disc pl-5 text-amber-700 text-sm">
            <li>This process may take a few minutes depending on how much data you have</li>
            <li>Your local data will not be deleted and can still be accessed offline</li>
            <li>If you encounter any errors, you can retry the migration later</li>
            <li>Make sure the server is running before starting the migration</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MigrationPage;
