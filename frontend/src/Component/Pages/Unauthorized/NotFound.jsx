import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../Authentication/AuthContext";

const PageNotFound = () => {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? "/live/stream" : "/login"} replace />;
};

export default PageNotFound;

