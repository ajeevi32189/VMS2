import axios from "axios";
import Cookies from "js-cookie";
import {
  API_URL,
  CAMERA_API_URL,
  TICKET_API_URL,
} from "../config";

/*
 * Session-expiry handling
 * ------------------------
 * The backend expires the access token ~30 min after login (security
 * policy) and starts returning 401 on every API call. No silent
 * refresh-token retry anymore (removed on purpose, per instruction) — the
 * moment any API call comes back 401, the session is treated as over:
 * clear the auth cookies and tell the rest of the app so it can send the
 * user straight back to /login.
 *
 * This file has no access to react-router's navigate() (it's plain JS,
 * outside any component), so it broadcasts a window CustomEvent instead —
 * the same pattern already used elsewhere in this app (see
 * "liveGridSizeChange" / "savedViewsUpdated" in Header.jsx / LiveStreaming).
 * A listener for "auth:sessionExpired" lives in App.jsx, where navigate()
 * and the auth context are both available.
 *
 * `notified` guards against firing this more than once: if several
 * requests are in flight when the token expires (e.g. a dashboard that
 * fires 4-5 API calls at once), they can all fail with 401 within
 * milliseconds of each other — without this guard that would clear
 * cookies and dispatch the event repeatedly. It's re-armed by
 * resetSessionExpiredFlag(), called from AuthContext's login() the moment
 * a fresh session starts.
 */
import { getToken, setToken, clearToken } from "../auth/authStore";

let notified = false;

export const resetSessionExpiredFlag = () => {
  notified = false;
};

const notifySessionExpired = () => {
  clearToken();
  Cookies.remove("token");
  Cookies.remove("refreshToken");
  Cookies.remove("userId");
  Cookies.remove("role");
  Cookies.remove("email");
  Cookies.remove("puid");

  if (notified) return;
  notified = true;
  window.dispatchEvent(new CustomEvent("auth:sessionExpired"));
};

// Single concurrent refresh guard: only 1 refresh even if multiple APIs fail simultaneously
let isRefreshing = false;
let pendingRequests = [];

const processPendingRequests = (error, token = null) => {
  pendingRequests.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  pendingRequests = [];
};

// 1.5 Page reload / app start session restoration
export const restoreSession = async () => {
  if (isRefreshing) return false;
  isRefreshing = true;
  try {
    const res = await axios.post(
      `${API_URL}/Account/refresh-token`,
      {},
      { withCredentials: true }
    );
    const newToken = res.data?.accessToken;
    if (newToken) {
      setToken(newToken);
      processPendingRequests(null, newToken);
      return true;
    }
    processPendingRequests(new Error("No token"));
    return false;
  } catch (err) {
    processPendingRequests(err);
    return false;
  } finally {
    isRefreshing = false;
  }
};

// 1.6 Logout API call: POST /api/Account/logout with withCredentials and clear memory
export const callLogoutAPI = async () => {
  const token = getToken();
  try {
    await axios.post(`${API_URL}/Account/logout`, null, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      withCredentials: true
    });
  } catch {
    // Even if API fails, local token must be cleared
  } finally {
    clearToken();
  }
};

// Factory function to create axios instances with interceptors
const createAxiosInstance = (baseURL, withCredentials = true) => {
  const instance = axios.create({
    baseURL,
    headers: { "Content-Type": "application/json" },
    withCredentials
  });

  // Attach token from memory (if restoring/refreshing, wait until token arrives)
  instance.interceptors.request.use(
    async (config) => {
      if (isRefreshing) {
        await new Promise((resolve) => {
          pendingRequests.push({ resolve, reject: resolve });
        }).catch(() => {});
      }
      const token = getToken();
      if (token) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // 401 interceptor: single refresh call using HttpOnly cookie, then retry
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        if (isRefreshing) {
          // Queue request until refresh completes
          return new Promise((resolve, reject) => {
            pendingRequests.push({ resolve, reject });
          }).then((token) => {
            originalRequest.headers["Authorization"] = `Bearer ${token}`;
            return instance(originalRequest);
          });
        }

        isRefreshing = true;
        try {
          const refreshRes = await axios.post(
            `${API_URL}/Account/refresh-token`,
            {},
            { withCredentials: true }
          );
          const newToken = refreshRes.data?.accessToken;
          if (newToken) {
            setToken(newToken);
            instance.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
            processPendingRequests(null, newToken);
            originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
            return instance(originalRequest);
          }
          throw new Error("No token in refresh response");
        } catch (refreshErr) {
          clearToken();
          processPendingRequests(refreshErr);
          notifySessionExpired();
          return Promise.reject(refreshErr);
        } finally {
          isRefreshing = false;
        }
      }

      // 403 = no permission, not logged out
      return Promise.reject(error);
    }
  );

  return instance;
};

// Export API clients
export const api = createAxiosInstance(API_URL);
export const deviceApi = createAxiosInstance(CAMERA_API_URL);
export const ticketApi = createAxiosInstance(TICKET_API_URL, false);



//////////////// rrrrrrrrrrrr ////////////

// import axios from "axios";
// import Cookies from "js-cookie";
// import {
//   API_URL,
//   CAMERA_API_URL,
// } from "../config";

// // Factory function to create axios instances with interceptors
// const createAxiosInstance = (baseURL) => {
//   const instance = axios.create({
//     baseURL,
//     headers: { "Content-Type": "application/json" },
//   });

//   // Attach token
//   instance.interceptors.request.use(
//     (config) => {
//       const token = Cookies.get("token");
//       if (token) {
//         config.headers["Authorization"] = `Bearer ${token}`;
//       }
//       return config;
//     },
//     (error) => Promise.reject(error)
//   );

//   // Refresh token handling
//   instance.interceptors.response.use(
//     (response) => response,
//     async (error) => {
//       const originalRequest = error.config;

//       if (error.response?.status === 403 && !originalRequest._retry) {
//         originalRequest._retry = true;

//         try {
//           const refreshToken = Cookies.get("refreshToken");
//           if (!refreshToken) throw new Error("No refresh token found");

//           const res = await axios.post(`${API_URL}/Account/refresh-token`, {
//             refreshToken,
//           });

//           const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
//             res.data;

//           // Save new tokens
//           Cookies.set("token", newAccessToken, { secure: true });
//           Cookies.set("refreshToken", newRefreshToken, { secure: true });

//           // Retry original request
//           originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
//           return instance(originalRequest);
//         } catch (refreshError) {
//           Cookies.remove("token");
//           Cookies.remove("refreshToken");
//           window.location.href = "/login"; // logout
//           return Promise.reject(refreshError);
//         }
//       }

//       return Promise.reject(error);
//     }
//   );

//   return instance;
// };

// // Export API clients
// export const api = createAxiosInstance(API_URL);
// export const deviceApi = createAxiosInstance(CAMERA_API_URL);










////////////////////////////////









// import axios from "axios";
// import Cookies from "js-cookie";
// import { API_URL } from "../config";

// const axiosInstance = axios.create({
//   baseURL: API_URL,
//   headers: { "Content-Type": "application/json" },
// });

// // Attach access token
// axiosInstance.interceptors.request.use(
//   (config) => {
//     const token = Cookies.get("token");
//     if (token) {
//       config.headers["Authorization"] = `Bearer ${token}`;
//     }
//     return config;
//   },
//   (error) => Promise.reject(error)
// );

// // Handle refresh token on 401
// axiosInstance.interceptors.response.use(
//   (response) => response,
//   async (error) => {
//     const originalRequest = error.config;

//     if (error.response?.status === 401 && !originalRequest._retry) {
//       originalRequest._retry = true;

//       try {
//         const refreshToken = Cookies.get("refreshToken");
//         if (!refreshToken) throw new Error("No refresh token found");

//         const res = await axios.post(`${API_URL}/Account/refresh-token`, {
//           refreshToken,
//         });

//         const { accessToken: newAccessToken, refreshToken: newRefreshToken } = res.data;

//         // Save new tokens
//         Cookies.set("token", newAccessToken, { secure: true });
//         Cookies.set("refreshToken", newRefreshToken, { secure: true });

//         // Retry original request
//         originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
//         return axiosInstance(originalRequest);
//       } catch (refreshError) {
//         Cookies.remove("token");
//         Cookies.remove("refreshToken");
//         window.location.href = "/login"; // force logout
//         return Promise.reject(refreshError);
//       }
//     }

//     return Promise.reject(error);
//   }
// );

// export const api = {
//   get: (url, config = {}) => axiosInstance.get(url, config),
//   post: (url, data, config = {}) => axiosInstance.post(url, data, config),
//   put: (url, data, config = {}) => axiosInstance.put(url, data, config),
//   delete: (url, config = {}) => axiosInstance.delete(url, config),
// };

// export default axiosInstance;
