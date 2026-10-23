



/////////////////// RRRRRRRRRRRRRRRRRRRR/////////////////


import React, { createContext, useState, useContext, useEffect } from 'react';
import Cookies from 'js-cookie';
import { api, resetSessionExpiredFlag, restoreSession } from '../utils/axiosInstance';
import { setToken, getToken, clearToken } from '../auth/authStore';

// Create a Context for Auth
const AuthContext = createContext();

// Create a provider component
export const AuthProvider = ({ children }) => {
  // Clear any legacy JS cookies that might exist in browser
  if (typeof window !== 'undefined' && !sessionStorage.getItem('sessionActive')) {
    Cookies.remove('token');
    Cookies.remove('refreshToken');
    Cookies.remove('role');
    Cookies.remove('email');
    Cookies.remove('userId');
    Cookies.remove('puid');
    sessionStorage.removeItem('vms_stqc_userId');
    sessionStorage.removeItem('vms_stqc_email');
    sessionStorage.removeItem('vms_stqc_role');
    sessionStorage.setItem('sessionActive', 'true');
  }

  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());
  // STQC Step 1 (Point 26): role/email/userId NOT read from cookies - memory only
  const [role, setRole] = useState(null);
  const [user, setUser] = useState({ email: "", userId: "" });
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch permissions based on role
  const fetchPermissions = async (userRole) => {
    if (!userRole || userRole === 'undefined' || userRole === 'null') {
      setPermissions([]);
      return;
    }
    try {
      const res = await api.get(`/permissions/role/${userRole}`);
      if (res.data?.status && Array.isArray(res.data.permissions)) {
        setPermissions(res.data.permissions);
      } else {
        setPermissions([]);
      }
    } catch (err) {
      console.error("Failed to fetch permissions:", err);
      setPermissions([]);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Point 1.5: On app load / page refresh, restore session via /Account/refresh-token
        let currentToken = getToken();
        if (!currentToken) {
          const restored = await restoreSession();
          if (restored) {
            currentToken = getToken();
          }
        }

        if (currentToken) {
          setIsAuthenticated(true);
          // STQC Point 26: Call /me to restore user details and role into memory
          const meRes = await api.get('/Account/me');
          if (meRes.data?.status !== false) {
            const userRole = Array.isArray(meRes.data.roles) ? meRes.data.roles[0] : "";
            const userEmail = meRes.data.email || meRes.data.userName || "";
            const userId = meRes.data.userId || "";
            const perms = Array.isArray(meRes.data.permissions) ? meRes.data.permissions : [];
            setRole(userRole);
            setUser({ email: userEmail, userId });
            setPermissions(perms);
            
            sessionStorage.setItem("vms_stqc_userId", userId);
            sessionStorage.setItem("vms_stqc_email", userEmail);
            sessionStorage.setItem("vms_stqc_role", userRole);
          }
        } else {
          setIsAuthenticated(false);
          setRole(null);
          setPermissions([]);
        }
      } catch (err) {
        setIsAuthenticated(false);
        setRole(null);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // Point 1.3: login stores token strictly in memory, user data in memory only
  const login = async (token, role, email, userId = "", preloadedPermissions = []) => {
    if (token) {
      setToken(token);
    }
    // Clean up any legacy JS cookies
    Cookies.remove('token');
    Cookies.remove('refreshToken');

    setIsAuthenticated(true);
    setRole(role);
    setUser({ email, userId });
    
    sessionStorage.setItem("vms_stqc_userId", userId);
    sessionStorage.setItem("vms_stqc_email", email);
    sessionStorage.setItem("vms_stqc_role", role);
    
    resetSessionExpiredFlag();
    if (preloadedPermissions.length > 0) {
      setPermissions(preloadedPermissions);
    } else {
      await fetchPermissions(role);
    }
  };

  const logout = () => {
    clearToken();
    Cookies.remove('token');
    Cookies.remove('refreshToken');
    Cookies.remove('role');    // clean up legacy cookies if any
    Cookies.remove('puid');
    Cookies.remove('userId');
    Cookies.remove('email');
    
    sessionStorage.removeItem("vms_stqc_userId");
    sessionStorage.removeItem("vms_stqc_email");
    sessionStorage.removeItem("vms_stqc_role");
    
    setIsAuthenticated(false);
    setRole(null);
    setUser({ email: "", userId: "" });
    setPermissions([]);
  };

  const hasPermission = (permission) => {
    if ((role || "").toLowerCase() === "admin") return true; // Admins have all permissions
    if (!permission) return true;
    if (!permissions || !Array.isArray(permissions)) return false;
    return permissions.some(p => p.toLowerCase() === permission.toLowerCase());
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, role, user, permissions, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to access auth context
export const useAuth = () => useContext(AuthContext);








// import React, { createContext, useState, useContext, useEffect } from 'react';
// import Cookies from 'js-cookie'; // Import js-cookie

// // Create a Context for Auth
// const AuthContext = createContext();

// // Create a provider component
// export const AuthProvider = ({ children }) => {
//   const [isAuthenticated, setIsAuthenticated] = useState(false);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     // Check if there is a token in cookies
//     const token = Cookies.get('token'); // Use js-cookie to get the token
//     if (token) {
//       setIsAuthenticated(true);
//     }
//     setLoading(false);
//   }, []);

//   const login = (token) => {
//     // Store the token in cookies
//     Cookies.set('token', token, { expires: 7 }); // Expires in 7 days
//     setIsAuthenticated(true);
//   };

//   const logout = () => {
//     // Remove the token from cookies
//     Cookies.remove('token');
//     setIsAuthenticated(false);
//   };

//   return (
//     <AuthContext.Provider value={{ isAuthenticated, loading, login, logout }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };

// // Custom hook to access auth context
// export const useAuth = () => useContext(AuthContext);
