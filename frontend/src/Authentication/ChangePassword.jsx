import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import axios from "axios";
import Cookies from "js-cookie";
import { getToken } from "../auth/authStore";
import { API_URL } from "../config";
import { FiLock, FiArrowLeft, FiCheckCircle } from "react-icons/fi";
import { message } from "antd";
import vmsBg from "../assets/vms_bg.png";

const ChangePassword = () => {
    const navigate = useNavigate();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    // Preload background
    useEffect(() => {
        const img = new Image();
        img.src = vmsBg;
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (loading) return;

        if (newPassword !== confirmPassword) {
            setError("New passwords do not match.");
            return;
        }

        const token = getToken();
        if (!token) {
            setError("Your session has expired. Please login again.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await axios.post(
                `${API_URL}/Account/change-password`,
                {
                    currentPassword,
                    newPassword,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            setSuccess(true);
            message.success("Password changed successfully!");
            setTimeout(() => navigate("/login", { replace: true }), 2000);
        } catch (err) {
            console.error("Change Password Error:", err);
            const data = err.response?.data;
            if (data?.errors && Array.isArray(data.errors)) {
                const errorMessages = data.errors.map((e) => e.description).join(" ");
                setError(errorMessages || "Failed to change password.");
            } else {
                setError(data?.message || "Failed to change password. Please check your current password.");
            }
        } finally {
            setLoading(false);
        }
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

                {success ? (
                    <div className="space-y-6 text-center">
                        <div className="flex justify-center">
                            <FiCheckCircle className="text-white/80" size={48} />
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg mb-2">Password Changed</h3>
                            <p className="text-white/60 text-sm font-medium leading-relaxed">
                                Your password has been changed successfully. Redirecting you to login...
                            </p>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
                        <div className="text-center mb-6">
                            <p className="text-white/60 text-sm font-medium leading-relaxed">
                                Enter your current password and a new password below.
                            </p>
                        </div>

                        <div className="relative group">
                            <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                            <input
                                type="password"
                                placeholder="Current Password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                                required
                            />
                        </div>

                        <div className="relative group">
                            <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                            <input
                                type="password"
                                placeholder="New Password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                                required
                                minLength={6}
                            />
                        </div>

                        <div className="relative group">
                            <FiLock className="absolute left-5 top-5 text-white/40 group-focus-within:text-white transition-colors" />
                            <input
                                type="password"
                                placeholder="Confirm New Password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all font-medium"
                                required
                                minLength={6}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                            className="w-full py-4 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-widest hover:bg-[#f0f0f0] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 cursor-pointer"
                        >
                            {loading ? "Changing..." : "Change Password"}
                        </button>

                        <Link
                            to="/login"
                            className="w-full flex items-center justify-center gap-2 text-xs text-white/40 hover:text-white transition-colors uppercase tracking-widest font-bold mt-4 cursor-pointer"
                        >
                            <FiArrowLeft /> Back to Login
                        </Link>
                    </form>
                )}
            </div>

            {/* Footer Label */}
            <div className="absolute bottom-8 text-center text-white/20 text-[9px] font-black uppercase tracking-[0.3em] z-20">
                Design Engineering by <span className="text-white/40">Ajeevi Technologies</span>
            </div>
        </div>
    );
};

export default ChangePassword;