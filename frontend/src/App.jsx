import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './Authentication/AuthContext';
import { DeviceInventoryProvider } from './contexts/DeviceInventoryContext';
import Layout from './Layout/Layout';
import AppRoutes from './Authentication/AppRoutes';
import LoginPage from './Authentication/Login';
import ProtectedRoute from './Authentication/ProtectedRoute';
import ResetPassword from './Authentication/Resetpassword';
import ChangePassword from './Authentication/ChangePassword';
import { useIdleTimer } from './utils/useIdleTimer';
import { callLogoutAPI } from './utils/axiosInstance';


const HomeRedirect = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Default landing page for all authenticated users
  return <Navigate to="/live/stream" replace />;
};

/*
 * Listens for the "auth:sessionExpired" event dispatched by
 * utils/axiosInstance.jsx whenever an API call comes back 401 and the
 * silent token refresh also fails (i.e. the backend's ~30 min session
 * really has expired). Renders nothing — it just clears local auth state
 * and sends the user back to /login as soon as that happens, from
 * whichever page they were on.
 *
 * Needs to sit inside both <Router> (for useNavigate) and <AuthProvider>
 * (for useAuth/logout) — it does, since AuthProvider wraps Router below.
 */
const SessionExpiryWatcher = () => {
  const { logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    if (!isAuthenticated) return;
    await callLogoutAPI(); // Step 2.3: POST /api/Account/logout
    logout();
    navigate("/login?expired=1", { replace: true });
  }, [logout, navigate, isAuthenticated]);

  // Step 2.1 (Point 25): 15-min idle timer — only real user input resets it
  useIdleTimer(handleLogout);

  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener("auth:sessionExpired", onSessionExpired);
    return () => window.removeEventListener("auth:sessionExpired", onSessionExpired);
  }, [handleLogout]);

  return null;
};

const App = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AuthProvider>
      <DeviceInventoryProvider>
        <Router>
          <SessionExpiryWatcher />
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Redirect root (/) based on role */}
            <Route path="/" element={<HomeRedirect />} />

            {/*
              Change Password requires being logged in — ChangePassword.jsx
              sends the "token" cookie as a Bearer header and shows
              "Your session has expired" when there isn't one. It used to be
              a public route linked from the Login screen, where no token
              exists yet, so it always failed. It's now protected like the
              rest of the app and is reached from the profile menu instead.
            */}
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePassword />
                </ProtectedRoute>
              }
            />

            {/* Protected Routes */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Layout collapsed={collapsed} setCollapsed={setCollapsed}>
                    <AppRoutes />
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </DeviceInventoryProvider>
    </AuthProvider>
  );
};

export default App;
