// import React, { useState, useEffect, useRef } from "react";
// import { useNavigate } from "react-router-dom";
// import { useAuth } from "./AuthContext";
// import Cookies from "js-cookie";
// import { jwtDecode } from "jwt-decode";
// import { motion, AnimatePresence } from "framer-motion";
// import { API_URL } from "../config";
// import axios from "axios";
// import { FiUser, FiLock, FiRefreshCw, FiMail, FiArrowLeft } from "react-icons/fi";
// import { message } from "antd";
// import vmsBg from "../assets/vms_bg.png";

// const LoginPage = () => {
//   const { isAuthenticated, login } = useAuth();
//   const navigate = useNavigate();

//   // Mode: "login" | "forgotPassword" | "resetPassword"
//   const [mode, setMode] = useState("login");

//   // Login State
//   const [email, setEmail] = useState(localStorage.getItem("lastEmail") || "");
//   const [password, setPassword] = useState("");
//   const [captchaInput, setCaptchaInput] = useState("");
//   const [captchaData, setCaptchaData] = useState({ key: "", value: "" });

//   // Forgot/Reset Password State
//   const [forgotEmail, setForgotEmail] = useState("");
//   const [resetToken, setResetToken] = useState("");
//   const [newPassword, setNewPassword] = useState("");

//   // Shared State
//   const [error, setError] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const canvasRef = useRef(null);

//   // Redirect if already authenticated
//   useEffect(() => {
//     if (isAuthenticated) {
//       navigate("/live/stream", { replace: true });
//     }
//   }, [isAuthenticated, navigate]);

//   // Preload image
//   useEffect(() => {
//     const img = new Image();
//     img.src = vmsBg;
//   }, []);

//   // Fetch Captcha
//   const fetchCaptcha = async () => {
//     try {
//       const res = await axios.get(`${API_URL}/captcha/generate`);
//       setCaptchaData({ key: res.data.captchaKey, value: res.data.captchaValue });
//       setCaptchaInput("");
//     } catch (err) {
//       console.error("Failed to fetch captcha", err);
//     }
//   };

//   useEffect(() => {
//     if (mode === "login") {
//       fetchCaptcha();
//     }
//   }, [mode]);

//   // Draw Visual Captcha whenever value changes
//   useEffect(() => {
//     if (mode === "login" && captchaData.value) {
//       // Small timeout ensures Framer Motion has mounted the canvas DOM node after a mode switch
//       const timer = setTimeout(() => {
//         if (canvasRef.current) {
//           drawCaptcha(captchaData.value);
//         }
//       }, 100);
//       return () => clearTimeout(timer);
//     }
//   }, [captchaData, mode]);

//   const drawCaptcha = (text) => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//     const ctx = canvas.getContext("2d");
//     ctx.clearRect(0, 0, canvas.width, canvas.height);

//     // Background noise
//     ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
//     ctx.fillRect(0, 0, canvas.width, canvas.height);

//     for (let i = 0; i < 60; i++) {
//       ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
//       ctx.beginPath();
//       ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 2, 0, 2 * Math.PI);
//       ctx.fill();
//     }

//     // Text styling
//     ctx.font = "bold 26px monospace";
//     ctx.textAlign = "center";
//     ctx.textBaseline = "middle";

//     // Draw characters with slight rotation
//     const startX = 15; // Shifted right so it doesn't get cut off
//     for(let i=0; i<text.length; i++) {
//       ctx.save();
//       ctx.translate(startX + (i * 16), canvas.height / 2); // 16px spacing
//       ctx.rotate((Math.random() - 0.5) * 0.6);

//       // Randomize color slightly
//       const shade = Math.floor(200 + Math.random() * 55);
//       ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;

//       ctx.fillText(text[i], 0, 0);
//       ctx.restore();
//     }

//     // Interference Lines
//     for (let i = 0; i < 4; i++) {
//       ctx.strokeStyle = `rgba(255,255,255,0.3)`;
//       ctx.lineWidth = 1.5;
//       ctx.beginPath();
//       ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
//       ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
//       ctx.stroke();
//     }
//   };

//   const handleLoginSubmit = async (e) => {
//     e.preventDefault();
//     if (loading) return;

//     setLoading(true);
//     setError(null);

//     try {
//       const response = await axios.post(`${API_URL}/Account/login`, {
//         username: email,
//         password,
//         CaptchaKey: captchaData.key,
//         CaptchaValue: captchaInput,
//       });

//       const { accessToken, refreshToken } = response.data;

//       if (accessToken) {
//         const decoded = jwtDecode(accessToken);
//         const userId = decoded["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
//         const userEmail = decoded["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
//         const userRole = decoded["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];

//         Cookies.set("token", accessToken);
//         if (refreshToken) {
//           Cookies.set("refreshToken", refreshToken);
//         } else {
//           Cookies.remove("refreshToken");
//         }
//         Cookies.set("userId", userId);
//         Cookies.set("email", userEmail);
//         Cookies.set("role", userRole);
//         localStorage.setItem("lastEmail", email);

//         await login(accessToken, userRole, userEmail);
//         navigate("/live/stream", { replace: true });
//       } else {
//         setError("Invalid credentials");
//         fetchCaptcha();
//       }
//     } catch (err) {
//       console.error("Login Error:", err);
//       if (err.response?.status === 400) {
//         setError("Invalid Captcha or Credentials.");
//       } else {
//         setError("Login failed. Please check your credentials.");
//       }
//       fetchCaptcha();
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotSubmit = async (e) => {
//     e.preventDefault();
//     if (loading) return;

//     setLoading(true);
//     setError(null);

//     try {
//       const res = await axios.post(`${API_URL}/Account/forgot-password`, {
//         email: forgotEmail
//       });
//       setResetToken(res.data.token);
//       setMode("resetPassword");
//     } catch (err) {
//       console.error("Forgot Password Error:", err);
//       setError(err.response?.data?.message || "Failed to process request. Ensure the email is registered.");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleResetSubmit = async (e) => {
//     e.preventDefault();
//     if (loading) return;

//     setLoading(true);
//     setError(null);

//     try {
//       await axios.post(`${API_URL}/Account/reset-password`, {
//         email: forgotEmail,
//         token: resetToken,
//         newPassword: newPassword
//       });
//       message.success("Password reset successfully! Please login with your new password.");
//       setMode("login");
//       setForgotEmail("");
//       setResetToken("");
//       setNewPassword("");
//     } catch (err) {
//       console.error("Reset Password Error:", err);
//       const data = err.response?.data;
//       if (data?.errors && Array.isArray(data.errors)) {
//         const errorMessages = data.errors.map(e => e.description).join(" ");
//         setError(errorMessages || "Failed to reset password.");
//       } else {
//         setError(data?.message || "Failed to reset password.");
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
//       {/* BACKGROUND LAYER */}
//       <div
//         className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
//         style={{
//           backgroundImage: `url(${vmsBg})`,
//           transform: 'translateZ(0)',
//         }}
//       />
//       <div className="absolute inset-0 z-10 bg-black/40 backdrop-brightness-75" />

//       {/* CARD */}
//       <div className="relative w-full max-w-md bg-black/60 backdrop-blur-xl rounded-[40px] shadow-2xl p-12 z-20 border border-white/10 overflow-hidden min-h-[550px] flex flex-col justify-center">

//         <div className="text-center mb-8">
//           <h1 className="text-4xl sm:text-5xl font-black text-white mb-2 tracking-tighter uppercase italic leading-none">
//             Gyanakshi
//           </h1>
//           <h2 className="text-2xl font-bold text-white/80 mb-2 uppercase tracking-wide">
//             Ajeevi VMS
//           </h2>
//           <p className="text-white/40 text-[10px] sm:text-xs tracking-widest font-bold uppercase mt-2">
//             Secure . Connected . Sustainable
//           </p>
//         </div>

//         {error && (
//           <motion.div 
//             initial={{ opacity: 0, y: -10 }}
//             animate={{ opacity: 1, y: 0 }}
//             className="mb-6 p-3 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-200 text-sm text-center"
//           >
//             {error}
//           </motion.div>
//         )}

//         <AnimatePresence mode="wait">
//           {mode === "login" ? (
//             <motion.form 
//               key="login"
//               initial={{ opacity: 0, x: -20 }}
//               animate={{ opacity: 1, x: 0 }}
//               exit={{ opacity: 0, x: 20 }}
//               transition={{ duration: 0.3 }}
//               onSubmit={handleLoginSubmit} 
//               className="space-y-5"
//             >
//               <div className="relative group">
//                 <FiUser className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
//                 <input
//                   type="text"
//                   placeholder="Username / Email"
//                   value={email}
//                   onChange={(e) => setEmail(e.target.value)}
//                   className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
//                   required
//                 />
//               </div>

//               <div className="relative group">
//                 <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
//                 <input
//                   type="password"
//                   placeholder="Password"
//                   value={password}
//                   onChange={(e) => setPassword(e.target.value)}
//                   className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
//                   required
//                 />
//               </div>

//               {/* Captcha Section */}
//               <div className="flex gap-3">
//                 <div className="relative flex-1 group">
//                   <input
//                     type="text"
//                     placeholder="Enter Captcha"
//                     value={captchaInput}
//                     onChange={(e) => setCaptchaInput(e.target.value)}
//                     className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium tracking-widest"
//                     maxLength={6}
//                     required
//                   />
//                 </div>
//                 <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-1 pr-2 overflow-hidden">
//                   <canvas 
//                     ref={canvasRef} 
//                     width={120} 
//                     height={46} 
//                     className="rounded-xl cursor-pointer"
//                     onClick={fetchCaptcha}
//                     title="Click to refresh captcha"
//                   />
//                   <button 
//                     type="button" 
//                     onClick={fetchCaptcha}
//                     className="text-white/40 hover:text-white p-2 transition-colors cursor-pointer"
//                   >
//                     <FiRefreshCw className={loading ? "animate-spin" : ""} />
//                   </button>
//                 </div>
//               </div>

//               <div className="flex justify-end mt-2">
//                 <button 
//                   type="button" 
//                   onClick={() => { setError(null); setMode("forgotPassword"); }}
//                   className="text-xs text-white/70 hover:text-white transition-all uppercase tracking-widest font-black underline underline-offset-4 decoration-white/30 hover:decoration-white"
//                 >
//                   Forgot Password?
//                 </button>
//               </div>

//               <button
//                 type="submit"
//                 disabled={loading || !captchaData.key}
//                 className="w-full py-4 mt-2 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
//               >
//                 {loading ? "Verifying..." : "Login"}
//               </button>
//             </motion.form>
//           ) : mode === "forgotPassword" ? (
//             <motion.form 
//               key="forgotPassword"
//               initial={{ opacity: 0, x: 20 }}
//               animate={{ opacity: 1, x: 0 }}
//               exit={{ opacity: 0, x: -20 }}
//               transition={{ duration: 0.3 }}
//               onSubmit={handleForgotSubmit} 
//               className="space-y-6"
//             >
//               <div className="text-center mb-6">
//                 <p className="text-white/60 text-sm font-medium leading-relaxed">
//                   Enter your registered email address to authorize a password reset.
//                 </p>
//               </div>

//               <div className="relative group">
//                 <FiMail className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
//                 <input
//                   type="email"
//                   placeholder="Email Address"
//                   value={forgotEmail}
//                   onChange={(e) => setForgotEmail(e.target.value)}
//                   className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
//                   required
//                 />
//               </div>

//               <button
//                 type="submit"
//                 disabled={loading}
//                 className="w-full py-4 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
//               >
//                 {loading ? "Verifying..." : "Verify & Continue"}
//               </button>

//               <button 
//                 type="button" 
//                 onClick={() => { setError(null); setMode("login"); }}
//                 className="w-full flex items-center justify-center gap-2 text-xs text-white/40 hover:text-white transition-colors uppercase tracking-widest font-bold mt-4 cursor-pointer"
//               >
//                 <FiArrowLeft /> Back to Login
//               </button>
//             </motion.form>
//           ) : mode === "resetPassword" ? (
//             <motion.form 
//               key="resetPassword"
//               initial={{ opacity: 0, x: 20 }}
//               animate={{ opacity: 1, x: 0 }}
//               exit={{ opacity: 0, x: -20 }}
//               transition={{ duration: 0.3 }}
//               onSubmit={handleResetSubmit} 
//               className="space-y-6"
//             >
//               <div className="text-center mb-6">
//                 <p className="text-white/60 text-sm font-medium leading-relaxed">
//                   Authentication successful. Please enter your new password below for <br/><span className="text-white font-bold">{forgotEmail}</span>.
//                 </p>
//               </div>

//               <div className="relative group">
//                 <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
//                 <input
//                   type="password"
//                   placeholder="New Password"
//                   value={newPassword}
//                   onChange={(e) => setNewPassword(e.target.value)}
//                   className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
//                   required
//                   minLength={6}
//                 />
//               </div>

//               <button
//                 type="submit"
//                 disabled={loading || !newPassword}
//                 className="w-full py-4 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
//               >
//                 {loading ? "Resetting..." : "Reset Password"}
//               </button>

//               <button 
//                 type="button" 
//                 onClick={() => { setError(null); setMode("login"); }}
//                 className="w-full flex items-center justify-center gap-2 text-xs text-white/40 hover:text-white transition-colors uppercase tracking-widest font-bold mt-4 cursor-pointer"
//               >
//                 <FiArrowLeft /> Back to Login
//               </button>
//             </motion.form>
//           ) : null}
//         </AnimatePresence>

//         <div className="mt-10 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-white/20">
//           <button type="button" className="hover:text-white transition-colors cursor-pointer">Support Hub</button>
//           <button type="button" className="hover:text-white transition-colors cursor-pointer">Privacy Shield</button>
//         </div>
//       </div>

//       {/* Footer Label */}
//       <div className="absolute bottom-8 text-center text-white/20 text-[9px] font-black uppercase tracking-[0.3em] z-20">
//         Design Engineering by <span className="text-white/40">Ajeevi Technologies</span>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;












import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Cookies from "js-cookie";
import { jwtDecode } from "jwt-decode";
import { motion, AnimatePresence } from "framer-motion";
import { API_URL } from "../config";
import axios from "axios";
import { FiUser, FiLock, FiRefreshCw, FiMail, FiArrowLeft, FiCheckCircle } from "react-icons/fi";
import { message } from "antd";
import vmsBg from "../assets/vms_bg.png";
import { setToken } from "../auth/authStore";

const LoginPage = () => {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Mode: "login" | "forgotPassword" | "forgotSuccess"
  const [mode, setMode] = useState("login");

  // Login State
  // NOTE: this used to prefill from localStorage("lastEmail") saved on a
  // previous successful login — that was effectively the app doing its own
  // "remember my ID" autofill. Removed on purpose: the field must always
  // start blank.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaData, setCaptchaData] = useState({ key: "", value: "" });

  // Forgot Password State
  const [forgotEmail, setForgotEmail] = useState("");

  // Shared State
  const [error, setError] = useState(
    searchParams.get("expired") === "1"
      ? "Your session has expired. Please login again."
      : null
  );
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/live/stream", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Preload image
  useEffect(() => {
    const img = new Image();
    img.src = vmsBg;
  }, []);

  const isFetchingCaptcha = useRef(false);
  const lastCaptchaFetchTime = useRef(0);
  const hasMountedCaptcha = useRef(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);

  // Fetch Captcha with rate-limit protection (prevents React StrictMode double calls & spam)
  const fetchCaptcha = async (force = false) => {
    const now = Date.now();
    if (isFetchingCaptcha.current) return;
    if (!force && now - lastCaptchaFetchTime.current < 2000) return;

    isFetchingCaptcha.current = true;
    lastCaptchaFetchTime.current = now;
    setCaptchaLoading(true);

    try {
      const res = await axios.get(`${API_URL}/captcha/generate`);
      if (res?.data) {
        setCaptchaData({ key: res.data.captchaKey, value: res.data.captchaValue });
        setCaptchaInput("");
        setError((prev) => (prev && prev.includes("Too many requests") ? null : prev));
      }
    } catch (err) {
      if (err.response?.status === 429) {
        setError("Too many requests from server. Please wait 15-30 seconds before retrying.");
        message.warning("Server rate limit reached. Please wait 15-30 seconds.");
      } else {
        console.error("Failed to fetch captcha", err);
      }
    } finally {
      isFetchingCaptcha.current = false;
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "login") {
      if (!hasMountedCaptcha.current) {
        hasMountedCaptcha.current = true;
        fetchCaptcha(true);
      }
    }
  }, [mode]);

  // Draw Visual Captcha whenever value changes
  useEffect(() => {
    if (mode === "login" && captchaData.value) {
      // Small timeout ensures Framer Motion has mounted the canvas DOM node after a mode switch
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawCaptcha(captchaData.value);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [captchaData, mode]);

  const drawCaptcha = (text) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background noise
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 2, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Text styling
    ctx.font = "bold 26px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Draw characters with slight rotation
    const startX = 15; // Shifted right so it doesn't get cut off
    for (let i = 0; i < text.length; i++) {
      ctx.save();
      ctx.translate(startX + i * 16, canvas.height / 2); // 16px spacing
      ctx.rotate((Math.random() - 0.5) * 0.6);

      // Randomize color slightly
      const shade = Math.floor(200 + Math.random() * 55);
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;

      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }

    // Interference Lines
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(255,255,255,0.3)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
      ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
      ctx.stroke();
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API_URL}/Account/login`, {
        username: email,
        password,
        CaptchaKey: captchaData.key,
        CaptchaValue: captchaInput,
      }, { withCredentials: true });

      const { accessToken, refreshToken } = response.data;

      // In HttpOnly mode, accessToken might be undefined. We check status instead.
      if (response.status === 200) {
        // Point 1.3: Store accessToken strictly in memory (authStore). Never set cookies!
        if (accessToken) {
          setToken(accessToken);
        }

        // STQC Point 26: fetch /me using withCredentials (so HttpOnly cookie is sent automatically)
        const meRes = await axios.get(`${API_URL}/Account/me`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
          withCredentials: true
        });
        const userId = meRes.data.userId || "";
        const userEmail = meRes.data.email || meRes.data.userName || "";
        const userRole = Array.isArray(meRes.data.roles) ? meRes.data.roles[0] : "";
        const userPermissions = Array.isArray(meRes.data.permissions) ? meRes.data.permissions : [];

        await login(accessToken, userRole, userEmail, userId, userPermissions);
        navigate("/live/stream", { replace: true });
      } else {
        setError("Invalid credentials");
        fetchCaptcha();
      }
    } catch (err) {
      console.error("Login Error:", err);
      if (err.response?.status === 400) {
        setError("Invalid Captcha or Credentials.");
      } else {
        setError("Login failed. Please check your credentials.");
      }
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  // Just sends the email — backend generates token and emails the reset link.
  // Response is intentionally enumeration-proof (same message whether or not
  // the email exists), so we never read a token out of it here.
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      await axios.post(`${API_URL}/Account/forgot-password`, {
        email: forgotEmail,
      });
      setMode("forgotSuccess");
    } catch (err) {
      console.error("Forgot Password Error:", err);
      setError(err.response?.data?.message || "Failed to process request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resetToLogin = () => {
    setError(null);
    setForgotEmail("");
    setMode("login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
      {/* BACKGROUND LAYER */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${vmsBg})`,
          transform: "translateZ(0)",
        }}
      />
      <div className="absolute inset-0 z-10 bg-black/40 backdrop-brightness-75" />

      {/* CARD */}
      <div className="relative w-full max-w-md bg-black/60 backdrop-blur-xl rounded-[40px] shadow-2xl p-12 z-20 border border-white/10 overflow-hidden min-h-[550px] flex flex-col justify-center">
        <div className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-2 tracking-tighter uppercase italic leading-none">
            Gyanakshi
          </h1>
          <h2 className="text-2xl font-bold text-white/80 mb-2 uppercase tracking-wide">Ajeevi VMS</h2>
          <p className="text-white/40 text-[10px] sm:text-xs tracking-widest font-bold uppercase mt-2">
            Secure . Connected . Sustainable
          </p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-3 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-200 text-sm text-center"
          >
            {error}
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {mode === "login" ? (
            <motion.form
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleLoginSubmit}
              className="space-y-5"
              autoComplete="off"
            >
              {/*
                Honeypot fields: invisible, unreachable by tab, and not the
                inputs we actually read from. Browsers' & password managers'
                autofill engines fill fields by scanning the form's inputs
                top-to-bottom, so we give them these decoys to fill instead
                of the real id/password fields below.
              */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
              />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
              />

              <div className="relative group">
                <FiUser className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                <input
                  type="text"
                  name="vms-login-id"
                  placeholder="Username / Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                  required
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                />
              </div>

              <div className="relative group">
                <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                <input
                  type="password"
                  name="vms-login-secret"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                  required
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                />
              </div>

              {/* Captcha Section */}
              <div className="flex gap-3">
                <div className="relative flex-1 group">
                  <input
                    type="text"
                    placeholder="Enter Captcha"
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium tracking-widest"
                    maxLength={6}
                    required
                  />
                </div>
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-1 pr-2 overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    width={120}
                    height={46}
                    className="rounded-xl cursor-pointer"
                    onClick={() => fetchCaptcha(true)}
                    title="Click to refresh captcha"
                  />
                  <button
                    type="button"
                    onClick={() => fetchCaptcha(true)}
                    disabled={captchaLoading}
                    className="text-white/40 hover:text-white p-2 transition-colors cursor-pointer disabled:opacity-30"
                  >
                    <FiRefreshCw className={captchaLoading ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {/*
                NOTE: there used to be a "Change Password" link here too, next
                to "Forgot Password?". It was removed: Change Password calls
                an authenticated endpoint (it sends the "token" cookie as a
                Bearer header) and only makes sense for a user who is already
                logged in, but this screen is shown BEFORE login — there is
                no token cookie yet, so it always failed with
                "Your session has expired. Please login again."
                Change Password now lives in the profile menu (Header.jsx),
                reachable only after logging in. "Forgot Password?" below is
                the correct flow for someone who isn't logged in and doesn't
                know their password — it emails a reset link instead.
              */}
              <div className="flex justify-end items-center gap-4 mt-2">
  <button
    type="button"
    onClick={() => {
      setError(null);
      setMode("forgotPassword");
    }}
    className="text-xs text-white/70 hover:text-white transition-all uppercase tracking-widest font-black underline underline-offset-4 decoration-white/30 hover:decoration-white"
  >
    Forgot Password?
  </button>
</div>

              <button
                type="submit"
                disabled={loading || !captchaData.key}
                className="w-full py-4 mt-2 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Verifying..." : "Login"}
              </button>
            </motion.form>
          ) : mode === "forgotPassword" ? (
            <motion.form
              key="forgotPassword"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleForgotSubmit}
              className="space-y-6"
            >
              <div className="text-center mb-6">
                <p className="text-white/60 text-sm font-medium leading-relaxed">
                  Enter your registered email address. If it matches an account, we'll send a
                  password reset link to it.
                </p>
              </div>

              <div className="relative group">
                <FiMail className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full flex items-center justify-center gap-2 text-xs text-white/40 hover:text-white transition-colors uppercase tracking-widest font-bold mt-4 cursor-pointer"
              >
                <FiArrowLeft /> Back to Login
              </button>
            </motion.form>
          ) : mode === "forgotSuccess" ? (
            <motion.div
              key="forgotSuccess"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6 text-center"
            >
              <div className="flex justify-center">
                <FiCheckCircle className="text-white/80" size={48} />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg mb-2">Check Your Email</h3>
                <p className="text-white/60 text-sm font-medium leading-relaxed">
                  If <span className="text-white font-bold">{forgotEmail}</span> is registered with
                  us, a password reset link has been sent to it. The link will expire shortly, so
                  use it soon.
                </p>
              </div>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full flex items-center justify-center gap-2 text-xs text-white/70 hover:text-white transition-colors uppercase tracking-widest font-black mt-6 cursor-pointer"
              >
                <FiArrowLeft /> Back to Login
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-10 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-white/20">
          <button type="button" className="hover:text-white transition-colors cursor-pointer">
            Support Hub
          </button>
          <button type="button" className="hover:text-white transition-colors cursor-pointer">
            Privacy Shield
          </button>
        </div>
      </div>

      {/* Footer Label */}
      <div className="absolute bottom-8 text-center text-white/20 text-[9px] font-black uppercase tracking-[0.3em] z-20">
        Design Engineering by <span className="text-white/40">Ajeevi Technologies</span>
      </div>
    </div>
  );
};

export default LoginPage;