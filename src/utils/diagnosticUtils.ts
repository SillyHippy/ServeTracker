/**
 * Utility functions for diagnosing and fixing issues in the application
 */
import { api } from "@/lib/api";

/**
 * Function to check email sending functionality by trying multiple methods
 */
export const diagnosticEmailTest = async (recipientEmail: string): Promise<{ 
  success: boolean; 
  results: Array<{ method: string; success: boolean; message: string }>;
}> => {
  const results: Array<{ method: string; success: boolean; message: string }> = [];
  let overallSuccess = false;
  
  const testSubject = "ServeTracker Email Diagnostic - " + new Date().toLocaleString();
  const testBody = `
    <h1>ServeTracker Email Diagnostic Test</h1>
    <p>This is a test email to diagnose email delivery issues.</p>
    <p>Time: ${new Date().toLocaleString()}</p>
    <p>If you receive this, please reply to confirm.</p>
  `;

  // Method 1: Local API (Resend via server — keys stay server-side)
  try {
    console.log("Diagnostic: Trying local API email route...");
    const result = await api.sendEmailViaFunction({
      to: recipientEmail,
      subject: testSubject + " (Local API)",
      html: testBody,
    });
    results.push({
      method: "Local API / Resend SMTP",
      success: result.success,
      message: result.message || "Unknown result",
    });
    if (result.success) overallSuccess = true;
  } catch (error) {
    results.push({
      method: "Local API / Resend SMTP",
      success: false,
      message: error instanceof Error ? error.message : "Exception occurred",
    });
  }

  // Method 2: Legacy alias (same server route)
  try {
    console.log("Diagnostic: Trying email function shim...");
    const response = await api.functions.createExecution(
      "email",
      JSON.stringify({
        to: [recipientEmail],
        subject: testSubject + " (Email function shim)",
        html: testBody,
      })
    );
    
    const success = response.status === 'completed';
    let message = "Function completed";
    
    if (response.response) {
      try {
        const parsedResponse = JSON.parse(response.response);
        message = parsedResponse.message || "Function completed successfully";
      } catch (parseError) {
        message = "Couldn't parse function response";
      }
    }
    
    results.push({
      method: "Email function shim",
      success,
      message,
    });
    
    if (success) overallSuccess = true;
  } catch (error) {
    results.push({
      method: "Email function shim",
      success: false,
      message: error instanceof Error ? error.message : "Exception occurred",
    });
  }

  return {
    success: overallSuccess,
    results
  };
};

// Add diagnostic command to window for console use
if (typeof window !== 'undefined') {
  (window as any).diagnosticEmailTest = diagnosticEmailTest;
}

/**
 * Function to fix serve attempts with client ID issues
 */
export const fixClientIdsInServeAttempts = async (): Promise<{
  processed: number;
  fixed: number;
  message: string;
}> => {
  try {
    // Get all serve attempts - these will now be in the frontend format
    const serves = await api.getServeAttempts();
    
    if (!serves || !Array.isArray(serves) || serves.length === 0) {
      return { processed: 0, fixed: 0, message: "No serve attempts found" };
    }
    
    // Get all clients for reference
    const clients = await api.getClients();
    if (!clients || clients.length === 0) {
      return { processed: 0, fixed: 0, message: "No clients found to reference" };
    }
    
    const defaultClientId = clients[0].$id;
    console.log(`Will use ${defaultClientId} as fallback client ID`);
    
    let processed = 0;
    let fixed = 0;
    
    // Process each serve attempt
    for (const serve of serves) {
      processed++;
      
      // Check if client ID is valid
      const hasValidClientId = serve.clientId && 
                             clients.some(c => c.$id === serve.clientId);
      
      if (!hasValidClientId) {
        console.log(`Fixing serve ${serve.id} with invalid client ID: ${serve.clientId}`);
        
        try {
          // Need to update the server record with snake_case fields
          await api.databases.updateDocument(
            api.DATABASE_ID,
            api.SERVE_ATTEMPTS_COLLECTION_ID,
            serve.id,
            { client_id: defaultClientId }
          );
          
          fixed++;
        } catch (error) {
          console.error(`Failed to fix serve ${serve.id}:`, error);
        }
      }
    }
    
    // If we fixed any, sync back to local storage
    if (fixed > 0) {
      await api.syncServesToLocal();
    }
    
    return {
      processed,
      fixed,
      message: `Processed ${processed} serve attempts, fixed ${fixed} with invalid client IDs`
    };
  } catch (error) {
    console.error("Error fixing client IDs:", error);
    return {
      processed: 0,
      fixed: 0,
      message: `Error: ${error.message || "Unknown error"}`
    };
  }
};

// Add fix function to window for console use
if (typeof window !== 'undefined') {
  (window as any).fixClientIdsInServeAttempts = fixClientIdsInServeAttempts;
}
