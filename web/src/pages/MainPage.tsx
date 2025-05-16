import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from '@/services/api';
import { PlusCircledIcon, Pencil1Icon, TrashIcon, CheckCircledIcon, CrossCircledIcon, PlayIcon, UploadIcon, ReaderIcon, ReloadIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import FileUpload from '@/components/FileUpload';
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth, authStorage } from '@/contexts/AuthContext';
import { TerminalIcon, Github } from 'lucide-react';
import PlaybookExecutor from '@/components/PlaybookExecutor';
import { prepareHostData } from '@/utils/crypto';

// Define Host type based on backend API
interface Host {
  id: number;
  comment: string;
  address: string;
  username: string;
  port: number;
  password?: string;
  status?: 'checking' | 'success' | 'unreachable' | 'failed' | null;
  is_password_encrypted?: boolean;
}

// Define Access Log type
interface AccessLog {
  id: number;
  access_time: string;
  ip_address: string;
  path: string;
  status_code: number;
}

function MainPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [command, setCommand] = useState('');
  const [commandLogs, setCommandLogs] = useState<string[]>([]);
  const [isLoadingHosts, setIsLoadingHosts] = useState(false);
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [isEditingHost, setIsEditingHost] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [batchInput, setBatchInput] = useState('');
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [isLoadingAccessLogs, setIsLoadingAccessLogs] = useState(false);
  const [accessLogIpFilter, setAccessLogIpFilter] = useState('');
  const [accessLogPathFilter, setAccessLogPathFilter] = useState('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<'selected' | 'all' | null>(null);
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false); // Control batch add dialog
  const [isAuthChecking, setIsAuthChecking] = useState(true); // New: Certification check status
  const [isPlaybookDialogOpen, setIsPlaybookDialogOpen] = useState(false);
  const [playbookTarget, setPlaybookTarget] = useState<'selected' | 'all' | null>(null);
  
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  //Improved authentication status check logic
  useEffect(() => {
    const checkAuth = () => {
      try {
        const isLocalAuth = authStorage.getAuth();
        
        // If there is neither React context authentication nor localStorage authentication, then jump to the login page
        if (!isAuthenticated && !isLocalAuth) {
          navigate('/login');
          return false;
        }
        return true;
      } catch (error) {
        return false;
      }
    };

    // Check the certification status immediately
    const isAuthed = checkAuth();
    
    // Only after passing the authentication check will subsequent data loading be performed
    if (isAuthed) {
      fetchHosts();
    }
    
    // Complete the certification check
    setIsAuthChecking(false);
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    fetchHosts();
  }, []);

  const fetchHosts = async () => {
    setIsLoadingHosts(true);
    try {
      const response = await api.get<Host[]>('/api/hosts');
      const hostsWithStatus = response.data.map(host => ({ ...host, status: null }));
      setHosts(hostsWithStatus);
    } catch (error) {
      console.error('Failed to fetch hosts:', error);
      toast.error("Failed to get host list", {
        description: error instanceof Error ? error.message : "Unable to connect to the server",
      });
    } finally {
      setIsLoadingHosts(false);
    }
  };

  const fetchAccessLogs = async (ipFilter = '', pathFilter = '') => {
    setIsLoadingAccessLogs(true);
    try {
      const response = await api.get<AccessLog[]>('/api/access-logs', {
        params: { ip: ipFilter, path: pathFilter }
      });
      setAccessLogs(response.data);
    } catch (error) {
      console.error('Failed to fetch access logs:', error);
      toast.error("Failed to get access log", {
        description: error instanceof Error ? error.message : "Unable to connect to the server",
      });
    } finally {
      setIsLoadingAccessLogs(false);
    }
  };

  const handleAddHosts = async () => {
    if (!batchInput.trim()) {
        toast.error("mistake", { description: "Please enter host information" });
        return;
    }
    const lines = batchInput.trim().split('\n');
    const hostsData: Omit<Host, 'id'>[] = [];
    const errors: string[] = [];
    lines.forEach((line, index) => {
        if (line.trim() === '') return;
        const parts = line.trim().split(/\s+/);
        if (parts.length !== 5) {
            errors.push(`1.${index + 1}Line: The format is wrong, it should be 'Remarks Address Username Port Password'`);
        } else {
            const [comment, address, username, portStr, password] = parts;
            const port = parseInt(portStr, 10);
            if (isNaN(port)) {
                errors.push(`1.${index + 1}Line: Port number '${portStr}' is invalid`);
            } else {
                hostsData.push({ comment, address, username, port, password });
            }
        }
    });
    if (errors.length > 0) {
        errors.forEach(err => toast.error("Error in input", { description: err }));
        return;
    }
    if (hostsData.length === 0) {
        toast.error("mistake", { description: "No valid host information was found" });
        return;
    }
    setIsAddingHost(true);
    try {
// Process each host data
        const processedHostsData = hostsData.map(host => prepareHostData(host));
        const response = await api.post('/api/hosts/batch', processedHostsData);
        toast.success("success", { description: response.data.message || `Added successfully ${response.data.count} Host` });
        setBatchInput('');
        fetchHosts();
        setIsBatchAddOpen(false); // Close dialog on success
    } catch (error) {
        console.error('Failed to add hosts:', error);
        toast.error("Failed to add host", {
            description: error instanceof Error ? error.message : (error as any).response?.data?.error || "An unknown error occurred",
        });
    } finally {
        setIsAddingHost(false);
    }
  };

  const handleEditHost = (host: Host) => {
    setEditingHost(host);
  };

  const handleSaveEdit = async (editedHost: Host) => {
    if (!editingHost) return;
    setIsEditingHost(true);
    try {
// Process host data, especially password fields
      const dataToSend = prepareHostData(editedHost, editingHost);
      
      await api.put(`/api/hosts/${editingHost.id}`, dataToSend);
      toast.success("success", { description: "Host information has been updated" });
      setEditingHost(null);
      fetchHosts();
    } catch (error) {
      console.error('Failed to update host:', error);
      toast.error("Failed to update the host", {
        description: error instanceof Error ? error.message : (error as any).response?.data?.error || "An unknown error occurred",
      });
    } finally {
      setIsEditingHost(false);
    }
  };

  const handleDeleteHost = async (hostId: number) => {
    if (!confirm(`Confirm to delete the hostID: ${hostId} Is it?`)) return;
    try {
      await api.delete(`/api/hosts/${hostId}`);
      toast.success("success", { description: `Host ID: ${hostId} Deleted` });
      fetchHosts();
    } catch (error) {
      console.error('Failed to delete host:', error);
      toast.error("Failed to delete the host", {
        description: error instanceof Error ? error.message : (error as any).response?.data?.error || "An unknown error occurred",
      });
    }
  };

  const handlePingHost = async (hostId: number) => {
    setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: 'checking' } : h));
    try {
      const response = await api.get(`/api/hosts/${hostId}/ping`);
      setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: response.data.status } : h));
      if (response.data.status === 'success') {
        toast.success(`Ping Host ${hostId}`, { description: response.data.message });
      } else {
        toast.warning(`Ping Host ${hostId}`, { description: response.data.message });
      }
    } catch (error) {
      console.error(`Failed to ping host ${hostId}:`, error);
      setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: 'failed' } : h));
      toast.error(`Ping Host ${hostId}fail`, {
        description: error instanceof Error ? error.message : "The check failed",
      });
    }
  };

  const handlePingAllHosts = () => {
    hosts.forEach(host => handlePingHost(host.id));
  };

  const handleExecuteCommand = async (target: 'selected' | 'all') => {
    if (!command.trim()) {
      toast.error("mistake", { description: "Please enter the command to execute" });
      return;
    }
    let targetHostIds: number[] | 'all';
    if (target === 'selected') {
      if (selectedHostIds.length === 0) {
        toast.error("mistake", { description: "Please select the target host in the table below" });
        return;
      }
      targetHostIds = selectedHostIds;
    } else {
      targetHostIds = 'all';
    }
    setIsExecutingCommand(true);
    addLog(`[${new Date().toLocaleTimeString()}] Execute the command '${command}' At ${target === 'all' ? 'All hosts' : 'Host ' + (Array.isArray(targetHostIds) ? targetHostIds.join(', ') : '')}...`);
    try {
      const response = await api.post('/api/execute', { command: command, hosts: targetHostIds });
      addLog(`[${new Date().toLocaleTimeString()}] Command execution result:\n${JSON.stringify(response.data, null, 2)}`);
      toast.success("The command execution was successful");
    } catch (error) {
      console.error('Command execution failed:', error);
      const errorMsg = error instanceof Error ? error.message : (error as any).response?.data?.error || "An unknown error occurred";
      addLog(`[${new Date().toLocaleTimeString()}] Command execution failed: ${errorMsg}`);
      toast.error("Command execution failed", { description: errorMsg });
    } finally {
      setIsExecutingCommand(false);
    }
  };

  const addLog = (message: string) => {
     setCommandLogs([]);
    setCommandLogs(prevLogs => [...prevLogs.slice(-100), message]);
  };

  const handleSelectAllHosts = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedHostIds(hosts.map(h => h.id));
    } else {
      setSelectedHostIds([]);
    }
  };

  const handleHostSelectionChange = (hostId: number, checked: boolean) => {
    setSelectedHostIds(prev =>
      checked ? [...prev, hostId] : prev.filter(id => id !== hostId)
    );
  };

  const openTerminal = (hostId: number) => {
    // Open a new window
    const terminalWindow = window.open(`/terminal/${hostId}`, `terminal_${hostId}`, 'width=800,height=600');
    
    // Make sure the new window opens successfully
    if (!terminalWindow) {
      toast.error('Unable to open the terminal', { description: 'Please allow the browser to exit window' });
      return;
    }
    
    // Wait for the new window to load
    const sendAuthInfo = () => {
      try {
        // Get the authentication token
        const token = authStorage.getToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 5); // 5 hours expiration time
        
        // If terminalWindow is available and loaded, send authentication information
        if (terminalWindow && terminalWindow.document.readyState === 'complete') {
          localStorage.setItem('isAuthenticated', 'true');
          localStorage.setItem('authExpiresAt', expiresAt.toISOString());
          if (token) {
            localStorage.setItem('token', token);
          }
          
          // Try sending a message to a new window so it can detect authentication status
          terminalWindow.postMessage({
            type: 'AUTH_INFO',
            isAuthenticated: true,
            authExpiresAt: expiresAt.toISOString(),
            token: token
          }, '*');
          
          // Remove sensitive logs
        } else {
          // If the window does not load, try again later
          setTimeout(sendAuthInfo, 500);
        }
      } catch (e) {
        //Remove sensitive logs
        toast.error('Unable to connect to terminal', { description: 'Authentication information transmission failed' });
      }
    };
    
    // Start trying to send authentication information
    setTimeout(sendAuthInfo, 500);
  };

  const openUploadDialog = (target: 'selected' | 'all') => {
    if (target === 'selected' && selectedHostIds.length === 0) {
      toast.error("mistake", { description: "Please select the host to upload the file" });
      return;
    }
    if (target === 'all' && hosts.length === 0) {
        toast.error("mistake", { description: "No host available for upload" });
        return;
    }
    setUploadTarget(target);
    setIsUploadDialogOpen(true);
  };

  const handleUploadComplete = () => {
    console.log("Upload complete callback triggered");
  };

  const handleCleanupAccessLogs = async () => {
    if (!confirm('Are you sure you want to clean up the access logs from 7 days ago?')) return;
    try {
      const response = await api.post('/api/access-logs/cleanup');
      toast.success("success", { description: response.data.message });
      fetchAccessLogs(accessLogIpFilter, accessLogPathFilter);
    } catch (error) {
      console.error('Failed to cleanup access logs:', error);
      toast.error("Failed to clean the log", {
        description: error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  };

  const openPlaybookDialog = (target: 'selected' | 'all') => {
    if (target === 'selected' && selectedHostIds.length === 0) {
      toast.error("mistake", { description: "Please select the host to perform the task" });
      return;
    }
    if (target === 'all' && hosts.length === 0) {
      toast.error("mistake", { description: "No host is available for tasks" });
      return;
    }
    setPlaybookTarget(target);
    setIsPlaybookDialogOpen(true);
  };
  
  const handlePlaybookComplete = () => {
    console.log("Playbook execution complete");
  };

  const isAllSelected = hosts.length > 0 && selectedHostIds.length === hosts.length;
  const isIndeterminate = selectedHostIds.length > 0 && selectedHostIds.length < hosts.length;

// Add load indicator
  if (isAuthChecking) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">Verify login status...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Ansible panel</h1>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" onClick={() => fetchAccessLogs()}> <ReaderIcon className="mr-2 h-4 w-4" />Access log</Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-3xl">
              <SheetHeader>
                <SheetTitle>System Access Log</SheetTitle>
                <SheetDescription>Check the most recent system access history.</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 py-4">
                <div className="flex flex-col sm:flex-row gap-2 items-center">
                  <Input
                    placeholder="Search for IP address"
                    value={accessLogIpFilter}
                    onChange={(e) => setAccessLogIpFilter(e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="Search path"
                    value={accessLogPathFilter}
                    onChange={(e) => setAccessLogPathFilter(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button className="flex-1 sm:flex-none" onClick={() => fetchAccessLogs(accessLogIpFilter, accessLogPathFilter)} disabled={isLoadingAccessLogs}>
                      {isLoadingAccessLogs ? 'Searching...' : 'Search'}
                    </Button>
                    <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => { setAccessLogIpFilter(''); setAccessLogPathFilter(''); fetchAccessLogs(); }}>Reset</Button>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>time</TableHead>
                        <TableHead>IP address</TableHead>
                        <TableHead>path</TableHead>
                        <TableHead>Status code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoadingAccessLogs ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-4">loading...</TableCell></TableRow>
                      ) : accessLogs.length > 0 ? (
                        accessLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs sm:text-sm">{new Date(log.access_time).toLocaleString()}</TableCell>
                            <TableCell className="text-xs sm:text-sm">{log.ip_address}</TableCell>
                            <TableCell className="text-xs sm:text-sm break-all">{log.path}</TableCell>
                            <TableCell className={`text-xs sm:text-sm ${log.status_code >= 400 ? 'text-red-500' : 'text-green-500'}`}>{log.status_code}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={4} className="text-center py-4">No access log</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={handleCleanupAccessLogs} className="text-black dark:text-white">Clean up the log 7 days ago</Button>
                <SheetClose asChild>
                  <Button variant="outline">close</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Host Management Panel (Takes 2/3 width on large screens) */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Host Management</CardTitle>
              <CardDescription>Add, edit, and manage your Ansible host.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-2 mb-2">
                <Dialog open={isBatchAddOpen} onOpenChange={setIsBatchAddOpen}>
                  <DialogTrigger asChild>
                    <Button><PlusCircledIcon className="mr-2 h-4 w-4" />Add host in batches</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[600px] dialog-content-scroll-hide">
                    <DialogHeader>
                      <DialogTitle>Add host in batches</DialogTitle>
                      <DialogDescription>
                       Enter one host information per line, format: Notes Address Username Port SSH Password.For example:<br />
                        <code>1 192.168.1.1 root 22 yourpassword</code>
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <Textarea
                        placeholder="Input in accordance with the example format"
                        rows={5}
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        className="placeholder:opacity-40 batch-input-textarea"
                      />
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button type="button" onClick={handleAddHosts} disabled={isAddingHost}>
                        {isAddingHost ? 'Adding...' : 'Confirm to add'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" 
                        disabled={selectedHostIds.length === 0} 
                        onClick={() => openPlaybookDialog('selected')}>
                        <PlayIcon className="mr-2 h-4 w-4" /> Perform tasks
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Perform custom tasks on the selected host</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" 
                        disabled={selectedHostIds.length === 0} 
                        onClick={() => openUploadDialog('selected')}>
                        <UploadIcon className="mr-2 h-4 w-4" /> Upload file
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Upload the file to the selected host</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                       <Button variant="outline" size="sm" onClick={handlePingAllHosts} disabled={isLoadingHosts || hosts.some(h => h.status === 'checking')}>
                         <ReloadIcon className={`mr-2 h-4 w-4 ${hosts.some(h => h.status === 'checking') ? 'animate-spin' : ''}`} /> Pingall
                       </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Check connectivity of all hosts</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Host List Table - Responsive Container */}
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px] px-2 sm:px-4">
                        <Checkbox
                          checked={isIndeterminate ? 'indeterminate' : isAllSelected}
                          onCheckedChange={handleSelectAllHosts}
                          aria-label="Select all hosts"
                        />
                      </TableHead>
                      <TableHead>Remark</TableHead>
                      <TableHead>address</TableHead>
                      <TableHead className="hidden md:table-cell">username</TableHead>
                      <TableHead className="hidden lg:table-cell">port</TableHead>
                      <TableHead>state</TableHead>
                      <TableHead className="text-right">operate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingHosts ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-4">loading...</TableCell></TableRow>
                    ) : hosts.length > 0 ? (
                      hosts.map((host) => (
                        <TableRow key={host.id}>
                          <TableCell className="px-2 sm:px-4">
                            <Checkbox
                              checked={selectedHostIds.includes(host.id)}
                              onCheckedChange={(checked) => handleHostSelectionChange(host.id, !!checked)}
                              aria-label={`Select host ${host.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{host.comment}</TableCell>
                          <TableCell>{host.address}</TableCell>
                          <TableCell className="hidden md:table-cell">{host.username}</TableCell>
                          <TableCell className="hidden lg:table-cell">{host.port}</TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger>
                                {host.status === 'checking' && <ReloadIcon className="h-4 w-4 animate-spin text-blue-500" />}
                                {host.status === 'success' && <CheckCircledIcon className="h-4 w-4 text-green-500" />}
                                {host.status === 'unreachable' && <CrossCircledIcon className="h-4 w-4 text-red-500" />}
                                {host.status === 'failed' && <InfoCircledIcon className="h-4 w-4 text-orange-500" />}
                                {!host.status && <span className="text-gray-400">-</span>}
                              </TooltipTrigger>
                              <TooltipContent>
                                {host.status === 'checking' && <p>Inspecting...</p>}
                                {host.status === 'success' && <p>Connection successfully</p>}
                                {host.status === 'unreachable' && <p>Unable to connect</p>}
                                {host.status === 'failed' && <p>Check failed</p>}
                                {!host.status && <p>Not checked</p>}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right space-x-0.5 sm:space-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => handlePingHost(host.id)} disabled={host.status === 'checking'}>
                                  <ReloadIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>PingHost</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => openTerminal(host.id)}>
                                  <TerminalIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Open the terminal</p></TooltipContent>
                            </Tooltip>
                            <Dialog open={editingHost?.id === host.id} onOpenChange={(isOpen) => !isOpen && setEditingHost(null)}>
                              <DialogTrigger asChild>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleEditHost(host)}>
                                      <Pencil1Icon className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent><p>Edit the host</p></TooltipContent>
                                </Tooltip>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                  <DialogTitle>Edit the host: {editingHost?.comment}</DialogTitle>
                                  <DialogDescription>Modify host information.Leave a blank password field without updating the password.</DialogDescription>
                                </DialogHeader>
                                {editingHost && (
                                  <div className="grid gap-4 py-4">
                                    {/* Form fields remain the same */}
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-comment" className="text-right">Remark</Label>
                                      <Input id="edit-comment" value={editingHost.comment} onChange={(e) => setEditingHost({...editingHost, comment: e.target.value})} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-address" className="text-right">address</Label>
                                      <Input id="edit-address" value={editingHost.address} onChange={(e) => setEditingHost({...editingHost, address: e.target.value})} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-username" className="text-right">username</Label>
                                      <Input id="edit-username" value={editingHost.username} onChange={(e) => setEditingHost({...editingHost, username: e.target.value})} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-port" className="text-right">port</Label>
                                      <Input id="edit-port" type="number" value={editingHost.port} onChange={(e) => setEditingHost({...editingHost, port: parseInt(e.target.value, 10) || 22})} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-password" className="text-right">password</Label>
                                      <Input id="edit-password" type="password" placeholder="Leave it blank and not modify it" onChange={(e) => setEditingHost({...editingHost, password: e.target.value})} className="col-span-3" />
                                    </div>
                                  </div>
                                )}
                                <DialogFooter>
                                  <DialogClose asChild>
                                     <Button type="button" variant="outline">Cancel</Button>
                                  </DialogClose>
                                  <Button type="button" onClick={() => editingHost && handleSaveEdit(editingHost)} disabled={isEditingHost}>
                                    {isEditingHost ? 'Saving...' : 'Save changes'}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteHost(host.id)} className="text-red-500 hover:text-red-700">
                                  <TrashIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Delete the host</p></TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={7} className="text-center py-4">No host found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Command Execution Panel (Takes 1/3 width on large screens) */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Command area</CardTitle>
              <CardDescription>Execute the shell command.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex flex-col h-full">
              <div className="grid gap-2">
                <Label htmlFor="commandInput">Enter a command</Label>
                <Textarea
                  id="commandInput"
                  placeholder="For example: ls /home"
                  rows={3} // Reduced rows
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="resize-y min-h-[80px] placeholder:opacity-40"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1 sm:flex-none" onClick={() => handleExecuteCommand('selected')} disabled={isExecutingCommand || selectedHostIds.length === 0}>
                  <PlayIcon className="mr-2 h-4 w-4" /> Send to selected ({selectedHostIds.length})
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={() => handleExecuteCommand('all')} disabled={isExecutingCommand || hosts.length === 0}>
                  <PlayIcon className="mr-2 h-4 w-4" /> Send to all({hosts.length})
                </Button>
              </div>

              {/* Command Log Output - Takes remaining space */}
              <div className="flex flex-col flex-grow min-h-[200px]">
                <h3 className="text-lg font-semibold mb-2">Execution log</h3>
                <div className="border rounded-md p-3 flex-grow overflow-y-auto bg-muted/90 dark:bg-muted/90 text-sm font-mono whitespace-pre-wrap">
                  {commandLogs.length > 0 ? commandLogs.join('\n') : <span className="text-muted-foreground">No logs yet</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* File Upload Dialog */}
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                <DialogTitle>File upload</DialogTitle>
                <DialogDescription>
                   Select the file and specify the remote path, and upload to {uploadTarget === 'all' ? 'All hosts': 'Selected hosts'}。
                </DialogDescription>
                </DialogHeader>
                {uploadTarget && (
                    <FileUpload
                        targetHostIds={uploadTarget === 'all' ? 'all' : selectedHostIds}
                        onUploadComplete={handleUploadComplete}
                        onClose={() => setIsUploadDialogOpen(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
        
        {/* Playbook Execution Dialog */}
        <Dialog open={isPlaybookDialogOpen} onOpenChange={setIsPlaybookDialogOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto dialog-content-scroll-hide">
            <DialogHeader>
              <DialogTitle>Execute Ansible Playbook</DialogTitle>
              <DialogDescription>
                exist {playbookTarget === 'all' ? 'All hosts': 'Selected hosts'} Execute a custom playbook on.
              </DialogDescription>
            </DialogHeader>
            
            {playbookTarget && (
              <PlaybookExecutor
                targetHostIds={playbookTarget === 'all' ? 'all' : selectedHostIds}
                onExecutionComplete={handlePlaybookComplete}
                onClose={() => setIsPlaybookDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* GitHub Link */}
        <div className="text-center mt-6 mb-2">
          <a 
            href="https://github.com/irocabinet/ansible" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            title="GitHub"
          >
            <Github size={16} />
          </a>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default MainPage;

