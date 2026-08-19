import { api } from "@/lib/api";
import { normalizeServeData } from "./dataNormalization";

/**
 * Utility function to repair serve attempts data in both the API and localStorage
 */
export async function repairServeAttempts() {
  try {
    console.log("Starting serve attempts data repair");
    
    // First get raw data from the API
    const rawServes = await api.databases.listDocuments(
      api.DATABASE_ID,
      api.SERVE_ATTEMPTS_COLLECTION_ID
    );
    
    console.log(`Found ${rawServes.documents.length} serve attempts to repair`);
    
    let fixed = 0;
    const processed = rawServes.documents.length;
    
    // Process each document
    for (const doc of rawServes.documents) {
      const needsRepair = !doc.client_id || doc.client_id === "unknown";
      
      if (needsRepair) {
        // Get first client as fallback
        const clients = await api.getClients();
        if (clients && clients.length > 0) {
          const defaultClientId = clients[0].$id;
          
          // Update the document
          await api.databases.updateDocument(
            api.DATABASE_ID,
            api.SERVE_ATTEMPTS_COLLECTION_ID,
            doc.$id,
            { client_id: defaultClientId }
          );
          
          fixed++;
          console.log(`Repaired serve attempt ${doc.$id} with client ID: ${defaultClientId}`);
        }
      }
    }
    
    // Sync repaired data to localStorage
    if (fixed > 0) {
      await api.syncServesToLocal();
    }
    
    return {
      processed,
      fixed,
      message: `Processed ${processed} serve attempts, fixed ${fixed}`
    };
  } catch (error) {
    console.error("Error repairing serve attempts:", error);
    return {
      processed: 0,
      fixed: 0,
      message: `Error: ${error.message || "Unknown error"}`
    };
  }
}
