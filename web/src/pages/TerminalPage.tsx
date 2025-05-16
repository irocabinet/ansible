import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
// import { WebLinksAddon } from '@xterm/addon-web-links'; // Corrected import if needed
import 'xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { ReloadIcon, CheckCircledIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import { toast } from "sonner"; // Updated import for sonner
import { authStorage } from '@/contexts/AuthContext';
import api from '@/services/api';

// Define the shape of the resize message data
interface ResizeData {
  cols: number;
  rows: number;
}

function TerminalPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [wsToken, setWsToken] = useState<string | null>(null);
  
// Check the authentication status
  useEffect(() => {
// Check whether it is authenticated when the component is mounted
    const isAuthenticated = authStorage.getAuth();
    const hasToken = !!authStorage.getToken();
    
    if (!isAuthenticated || !hasToken) {
// If not authenticated, prompt message is displayed
      toast.error("Login required", { description: "Please log in to the system before using the terminal function" });
      
// Jump to login page
      navigate('/login', { replace: true });
      return;
    }
    
// Get WebSocket token
    fetchWsToken();
    
    return () => {
// Clean up when component uninstallation
      if (socket.current) {
        socket.current.close();
      }
      if (term.current) {
        term.current.dispose();
      }
    };
  }, [hostId, navigate]);

// Get the WebSocket connection token
  const fetchWsToken = async () => {
    try {
      if (!hostId) {
        toast.error("mistake", { description: "Invalid host ID" });
        return;
      }
      
// Add token to the request, automatically handled by the API interceptor
      const response = await api.get(`/api/ws-token/${hostId}`);
      const token = response.data.token;
      
      setWsToken(token);
      
// After obtaining the token, initialize the terminal and connect
      if (terminalRef.current) {
        initializeTerminal(token);
      }
    } catch (error: any) {
      toast.error("Authentication error", { description: `Unable to obtain terminal connection authorization` });
      
      // If it is a 401 error, redirect to the login page
      if (error.response?.status === 401) {
        navigate('/login', { replace: true });
      }
    }
  };

  const connectWebSocket = (token?: string) => {
 // Priority is given to the incoming token, or use wsToken in the state
    const currentToken = token || wsToken;
    
    if (!hostId || !currentToken) {
      toast.error("mistake", { description: currentToken ? "Invalid host ID": "Connection authorization not obtained" });
      setIsConnecting(false);
      return;
    }

    // Close existing socket if any
    if (socket.current && socket.current.readyState !== WebSocket.CLOSED) {
      socket.current.close();
    }

    setIsConnecting(true);
    setIsConnected(false);
    term.current?.clear();
    term.current?.write('ConnectingWebSocket...\r\n');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${hostId}?token=${encodeURIComponent(currentToken)}`;
      socket.current = new WebSocket(wsUrl);

      socket.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        term.current?.write('\r\n\x1b[1;32m Connecting to the host terminal \x1b[0m\r\n');
        // Fit terminal on connect and send initial size
        fitAddon.current?.fit(); 
        sendResize();
        term.current?.focus();
      };

      socket.current.onmessage = (event: MessageEvent) => {
        try {
          // Try to parse JSON messages
          const data = JSON.parse(event.data);
          if (data.error) {
            // Handle error messages
            term.current?.write(`\r\n\x1b[1;31m*** mistake: ${data.error} ***\x1b[0m\r\n`);
            return;
          }
        } catch {
          //Not JSON, process it according to normal text
          term.current?.write(event.data);
        }
      };

      socket.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        term.current?.write(`\r\n\x1b[1;31m*** The connection has been disconnected ***\x1b[0m\r\n`);
        
        //If it is an authentication error, re-get the token
        if (event.code === 1008) { // Policy violation (Probably the token expires)
          fetchWsToken();
        }
      };

      socket.current.onerror = (_error) => {
        setIsConnected(false);
        setIsConnecting(false);
        term.current?.write('\r\n\x1b[1;31m*** Connection error ***\x1b[0m\r\n');
        toast.error("WebSocket Error", { description: "Unable to connect to terminal service" });
      };
    } catch (error) {
      setIsConnecting(false);
      term.current?.write('\r\n\x1b[1;31m*** WebSocket Creation failed ***\x1b[0m\r\n');
      toast.error("Connection failed", { description: "Unable to create a WebSocket connection" });
    }
  };

  const sendResize = () => {
    if (socket.current?.readyState === WebSocket.OPEN && term.current) {
      const dimensions: ResizeData = {
        cols: term.current.cols,
        rows: term.current.rows,
      };
      socket.current.send(JSON.stringify({
        type: 'resize',
        data: dimensions,
      }));
    }
  };

  const initializeTerminal = (token: string) => {
    if (!terminalRef.current || term.current) return;
    
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e', // Dark background
        foreground: '#d4d4d4', // Light foreground
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      allowTransparency: false,
      scrollback: 5000, // Increase scrollback buffer
    });

    fitAddon.current = new FitAddon();
    terminal.loadAddon(fitAddon.current);
    // terminal.loadAddon(new WebLinksAddon()); // Optional: Add web links addon

    term.current = terminal;
    terminal.open(terminalRef.current);

    // Handle data input from terminal
    terminal.onData((data) => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify({ type: 'input', data: data }));
      }
    });

    // Handle resize events
    terminal.onResize(() => {
      sendResize();
    });
    
// Automatically fit the terminal when the window is resized
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.current?.fit();
    });
    
    if (terminalRef.current?.parentElement) {
      resizeObserver.observe(terminalRef.current.parentElement);
    }
    
// Add window resize listening as backup
    const handleWindowResize = () => fitAddon.current?.fit();
    window.addEventListener('resize', handleWindowResize);
    
// Connect to WebSocket immediately after initialization, pass in token to ensure that the latest token is used
    connectWebSocket(token);
    
// First adapt to terminal size
    fitAddon.current.fit();
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="p-2 border-b flex items-center justify-between bg-card text-card-foreground">
        <h1 className="text-lg font-semibold">Terminal - Host ID: {hostId}</h1>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-sm ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
            {isConnecting ? (
              <ReloadIcon className="h-4 w-4 animate-spin" />
            ) : isConnected ? (
              <CheckCircledIcon className="h-4 w-4" />
            ) : (
              <CrossCircledIcon className="h-4 w-4" />
            )}
            {isConnecting ? 'Connected' : isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => connectWebSocket()} 
            disabled={isConnecting}
          >
            <ReloadIcon className="mr-1 h-4 w-4" />
           Reconnect
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => term.current?.clear()}
          >
          Pure Screen
          </Button>
        </div>
      </header>
      {/* Terminal container takes remaining height */}
      <div ref={terminalRef} className="flex-grow p-1 w-full h-full overflow-hidden"></div>
    </div>
  );
}

export default TerminalPage;

