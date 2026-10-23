

/////////////////////  RRRRRRRRRRRRRRRRRR

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ProtectedRoute = ({ children, allowedRoles = [], requiredPermissions = [] }) => {
  const { isAuthenticated, role, permissions, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white">
        <div className="text-xl font-bold animate-pulse text-purple-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Role check
  if (allowedRoles.length > 0) {
    const userRoleLower = (role || "").toLowerCase();
    const isAllowedByRole = allowedRoles.some(
      (r) => r.toLowerCase() === userRoleLower
    );

    if (!isAllowedByRole) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  // Permission check
  if (requiredPermissions.length > 0) {
    if ((role || "").toLowerCase() === "admin") return children; // Admin bypass

    const hasRequiredPermission = requiredPermissions.some(p =>
      permissions.some(perm => perm.toLowerCase() === p.toLowerCase())
    );

    if (!hasRequiredPermission) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;



// import React from 'react';
// import { Navigate } from 'react-router-dom';
// import { useAuth } from './AuthContext';

// const ProtectedRoute = ({ children }) => {
//   const { isAuthenticated, loading } = useAuth();

//   if (loading) {
//     return <div>Loading...</div>; // Show loading while checking authentication
//   }

//   return isAuthenticated ? children : <Navigate to="/" replace />;
// };

// export default ProtectedRoute;
