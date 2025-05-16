import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import TerminalPage from './pages/TerminalPage';
import { Toaster } from "@/components/ui/sonner"; // Updated import to sonner
import { AuthProvider, useAuth, authStorage } from './contexts/AuthContext';

// Wrapper component to protect routes
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  // Use authStorage to check authentication status
  const isLocalAuth = authStorage.getAuth();
  
  // If there is valid authentication in the context or local storage, access is allowed
  if (isAuthenticated || isLocalAuth) {
    return <>{children}</>;
  }
  
  // Otherwise, redirect to the login page
  return <Navigate to="/login" replace />;
}

// Main App component
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Login page route */}
          <Route path="/login" element={<LoginPage />} />
          
          {/* Main page route - protected */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <MainPage />
              </ProtectedRoute>
            }
          />
          
          {/* Terminal page route - No mandatory authentication is required, but instead it is direct access. Internal API calls will handle authentication.*/}
          <Route 
            path="/terminal/:hostId"
            element={<TerminalPage />}
          />
          
          {/* Fallback route: Redirect unauthenticated users to login, authenticated users to main */}
          <Route 
            path="*" 
            element={
              <AuthRedirect />
            } 
          />
        </Routes>
      </Router>
      <Toaster richColors /> {/* Use sonner Toaster, added richColors prop */}
    </AuthProvider>
  );
}

// Helper component for the fallback route
function AuthRedirect() {
  const { isAuthenticated } = useAuth();
  const isLocalAuth = authStorage.getAuth();
  
  return (isAuthenticated || isLocalAuth) ? <Navigate to="/" replace /> : <Navigate to="/login" replace />;
}

export default App;
