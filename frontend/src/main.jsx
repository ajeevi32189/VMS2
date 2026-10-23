import React from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import mpegts from 'mpegts.js'
import { StyleProvider } from '@ant-design/cssinjs'
import axios from 'axios'
import Cookies from 'js-cookie'

import { getToken, setToken } from './auth/authStore';

window.mpegts = mpegts;

// Intercept Cookies to ensure NO tokens ever touch document.cookie
const originalGet = Cookies.get;
Cookies.get = function() {
  const name = arguments[0];
  if (name === "token") {
    return getToken();
  }
  if (name === "refreshToken") {
    return null; // HttpOnly on backend, inaccessible to JS
  }
  if (name === "userId" || name === "email" || name === "role") {
    const val = sessionStorage.getItem("vms_stqc_" + name);
    if (val) return val;
  }
  return originalGet.apply(this, arguments);
};

const originalSet = Cookies.set;
Cookies.set = function() {
  const name = arguments[0];
  if (name === "token") {
    // Save in memory only - never in document.cookie
    if (arguments[1]) setToken(arguments[1]);
    return;
  }
  if (name === "refreshToken") {
    // Refresh token is HttpOnly in backend cookie - never write to document.cookie
    return;
  }
  return originalSet.apply(this, arguments);
};

// ─── Global STQC Auth & Credentials Setup for All Microservices ───────────────
// 1. Configure default Axios (fixes Recording API, ROI API, Analytics, etc.)
axios.defaults.withCredentials = true;
axios.interceptors.request.use((config) => {
  const token = getToken();
  if (token && (!config.headers || !config.headers["Authorization"])) {
    config.headers = config.headers || {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// 2. Global Fetch Patch (fixes Stream API camera-stats, snapshot, add-camera, Watchlist)
const _originalFetch = window.fetch;
window.fetch = function(input, init = {}) {
  const token = getToken();
  const options = { ...init };
  options.credentials = options.credentials || "include";

  if (token) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    options.headers = headers;
  }
  return _originalFetch.call(this, input, options);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StyleProvider>
      <App />
    </StyleProvider>
  </StrictMode>
)

