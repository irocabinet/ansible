import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from '@/services/api';
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { CheckCircleIcon, XCircleIcon } from 'lucide-react';

interface PlaybookExecutorProps {
  targetHostIds: number[] | 'all';
  onExecutionComplete: () => void;
  onClose: () => void;
}

// Execution result interface
interface PlaybookResult {
  success: boolean;
  return_code: number;
  logs: string[];
  summary: {
    success: string[];
    failed: string[];
    unreachable: string[];
  };
}

const defaultPlaybook = `---
# Ansible Playbook Example
- name: Sample task
hosts: all
tasks:
- name: Execute a simple command
command: echo "Hello, Ansible!"
register: hello_result

- name: Show command results
debug:
var: hello_result.stdout
`;

function PlaybookExecutor({ targetHostIds, onExecutionComplete, onClose }: PlaybookExecutorProps) {
  const [playbook, setPlaybook] = useState(defaultPlaybook);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionResult, setExecutionResult] = useState<PlaybookResult | null>(null);

  const handleExecution = async () => {
    if (!playbook.trim()) {
      toast.error("Error", { description: "Please enter Playbook content" });
      return;
    }

    setIsExecuting(true);
    setExecutionProgress(10); // Start progress
    setExecutionResult(null);

    try {
      //Prepare request data
      const requestData = {
        playbook: playbook.trim(),
        host_ids: targetHostIds === 'all' ? [] : targetHostIds
      };

      // Send a request to execute the Playbook
      setExecutionProgress(30);
      const response = await api.post<PlaybookResult>("/api/playbook/execute", requestData);
      setExecutionProgress(100);

      // Save the execution results
      setExecutionResult(response.data);
      
      // Show different messages according to the result returned
      if (response.data.success) {
        const successCount = response.data.summary.success.length;
        const failedCount = response.data.summary.failed.length;
        const unreachableCount = response.data.summary.unreachable.length;
        
        if (failedCount === 0 && unreachableCount === 0) {
          // All succeeded
          toast.success("Playbook execution succeeded", { 
            description: `Successfully executed Playbook and all host tasks are completed` 
          });
        } else {
          // Partially successful
          toast.warning("Partial execution of the Playbook is successful", { 
            description: `Success: ${successCount}, failed: ${failedCount}, unreachable: ${unreachableCount}`
          });
        }
        
        // The dialog box does not automatically close, allowing users to view the results
        onExecutionComplete(); // Notify the parent component to complete execution only
      } else {
        // Display when execution fails
toast.error("Playbook execution failed", {
          description: `Execution failed, return code:${response.data.return_code}`,
        });
      }
    } catch (error) {
      console.error('Playbook execution failed:', error);
      const errorMsg = error instanceof Error 
        ? error.message 
        : ((error as any).response?.data?.message || (error as any).response?.data?.error || "An unknown error occurred");
      
      toast.error("Playbook execution failed", {
        description: errorMsg,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="playbookContent">Playbook content (YAML format)</Label>
        <Textarea 
          id="playbookContent" 
          placeholder="Enter Ansible Playbook content..." 
          value={playbook}
          onChange={(e) => setPlaybook(e.target.value)}
          className="font-mono text-sm min-h-[300px]"
          disabled={isExecuting}
        />
        <p className="text-xs text-muted-foreground">Enter the standard Ansible Playbook format and will be executed on the selected host.</p>
      </div>

      {isExecuting && (
        <Progress value={executionProgress} className="w-full" />
      )}

   {/* Execution result display area */}
      {executionResult && (
        <div className="border rounded-md p-3 bg-muted/90">
          <h4 className="text-sm font-medium mb-2">Execution results</h4>
          <p className="text-sm mb-2">
            {executionResult.success ? "Playbook execution succeeded" : "Playbook execution failed"} 
            (Return to the code: {executionResult.return_code})
          </p>
          
          <div className="text-xs space-y-1 mb-3">
            {executionResult.summary.success.length > 0 && (
              <div>
                <p className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircleIcon className="h-3 w-3" />
                  Successful host ({executionResult.summary.success.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.success.map(host => (
                    <li key={`success-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {executionResult.summary.failed.length > 0 && (
              <div>
                <p className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1 mt-2">
                  <XCircleIcon className="h-3 w-3" />
                 Failed host({executionResult.summary.failed.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.failed.map(host => (
                    <li key={`fail-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}

            {executionResult.summary.unreachable.length > 0 && (
              <div>
                <p className="font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-1 mt-2">
                  <XCircleIcon className="h-3 w-3" />
                 Unreachable host({executionResult.summary.unreachable.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.unreachable.map(host => (
                    <li key={`unreachable-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-4">
            <h5 className="text-sm font-medium mb-1">Detailed log</h5>
            <div className="bg-black text-green-400 p-2 rounded font-mono text-xs h-[200px] overflow-y-auto whitespace-pre-wrap">
              {executionResult.logs.join('\n')}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
         <Button variant="outline" onClick={onClose} disabled={isExecuting}>
           {executionResult ? 'Close' : 'Cancel'}
         </Button>
         {!executionResult && (
           <Button onClick={handleExecution} disabled={!playbook.trim() || isExecuting}>
             {isExecuting ? 'Execution...' : 'Execute the Playbook'}
           </Button>
         )}
         {executionResult && (
           <Button variant="default" onClick={onClose}>
           Finish
           </Button>
         )}
      </div>
    </div>
  );
}

export default PlaybookExecutor; 