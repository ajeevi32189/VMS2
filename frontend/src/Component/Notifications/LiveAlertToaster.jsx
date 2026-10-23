import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Cookies from 'js-cookie';
import { deviceApi, ticketApi } from '../../utils/axiosInstance';
import { FiBell, FiX } from 'react-icons/fi';
import { ANALYTICS_API_URL } from '../../config';
import { AlertSnapshot, formatIndianDateTime } from '../../utils/imageUtils';
import dayjs from 'dayjs';

const LiveAlertToaster = () => {
    const [alerts, setAlerts] = useState([]);
    const lastAlertIdRef = useRef(null);
    const defaultSlaIdRef = useRef(1);
    const userId = Cookies.get('userId');
    const navigate = useNavigate();

    // Fetch SLAs to get a default ID on load
    useEffect(() => {
        const fetchSla = async () => {
            try {
                const res = await ticketApi.get("/api/sla");
                const slaData = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.data || []);
                if (slaData.length > 0) {
                    defaultSlaIdRef.current = slaData[0].id;
                }
            } catch (err) {
                console.error("Toaster: SLA fetch failed, using default ID 1:", err);
            }
        };
        if (userId) {
            fetchSla();
        }
    }, [userId]);

    const generateTicketsForAlerts = async (newAlerts) => {
        let processed = [];
        try {
            processed = JSON.parse(localStorage.getItem('vms_processed_alerts') || '[]');
        } catch (e) {
            processed = [];
        }

        for (const alert of newAlerts) {
            if (processed.includes(alert.id)) continue;

            const eventName = getEventName(alert);
            const cameraName = parseCameraName(alert.camera_name);
            
            const framePath = alert.framePath || alert.frame_path || alert.image_path || "";
            const framePart = framePath ? ` Frame: ${framePath}.` : "";

            try {
                await ticketApi.post("/api/tickets", {
                    title: `[Alert] ${eventName} on ${cameraName}`,
                    description: `Automatic ticket for ${eventName} alert detected on ${cameraName}. Alert ID: ${alert.id}.${framePart} Location: ${alert.camera_location || "N/A"}`,
                    category: "Surveillance Alert",
                    subCategory: eventName,
                    reporterId: Cookies.get("email") || "vms_auto_generator",
                    severity: "High",
                    priority: "High",
                    slaId: defaultSlaIdRef.current || 1,
                    latitude: 0,
                    longitude: 0,
                    landmark: alert.camera_location || "",
                    ticketType: "Auto-Generated",
                    deviceId: cameraName || "",
                    attachmentUrl: framePath || "",
                    projectName: "VMS"
                });

                processed.push(alert.id);
                localStorage.setItem('vms_processed_alerts', JSON.stringify(processed));
                console.log(`Successfully generated auto-ticket for alert #${alert.id}`);
            } catch (err) {
                console.error(`Auto ticket generation failed for alert #${alert.id}:`, err);
            }
        }
    };

    const fetchLatestAlerts = async () => {
        if (!userId) return;
        try {
            const res = await deviceApi.get('/CameraAlert/', {
                params: { userid: userId, page: 1, pageSize: 5 },
            });
            const latestAlerts = res.data.results || [];

            if (latestAlerts.length > 0) {
                if (lastAlertIdRef.current === null) {
                    lastAlertIdRef.current = latestAlerts[0].id;
                    
                    // Backfill initial alerts to processed list to prevent duplicate tickets on page reload
                    let processed = [];
                    try {
                        processed = JSON.parse(localStorage.getItem('vms_processed_alerts') || '[]');
                    } catch (e) {
                        processed = [];
                    }
                    const initialIds = latestAlerts.map(a => a.id);
                    const merged = Array.from(new Set([...processed, ...initialIds]));
                    localStorage.setItem('vms_processed_alerts', JSON.stringify(merged));
                } else if (latestAlerts[0].id > lastAlertIdRef.current) {
                    const newAlerts = latestAlerts.filter(a => a.id > lastAlertIdRef.current);
                    lastAlertIdRef.current = latestAlerts[0].id;

                    // Show new alerts
                    setAlerts(prev => {
                        const updated = [...newAlerts, ...prev].slice(0, 3);
                        return updated;
                    });

                    // Auto remove after 10 seconds
                    newAlerts.forEach(alert => {
                        setTimeout(() => {
                            removeAlert(alert.id);
                        }, 10000);
                    });

                    // Trigger Auto Ticket Generation for new alerts
                    generateTicketsForAlerts(newAlerts);
                }
            }
        } catch (error) {
            console.error("Toaster fetch error:", error);
        }
    };

    useEffect(() => {
        if (userId) {
            fetchLatestAlerts(); // Immediate check
            const interval = setInterval(fetchLatestAlerts, 10000); // Check every 10s
            return () => clearInterval(interval);
        }
    }, [userId]);

    const removeAlert = (id) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
    };

    const getTargetPath = (alert) => {
        const objStr = String(alert.objectName || "").toLowerCase();
        const typeStr = String(alert.alertType || "").toLowerCase();
        const cameraStr = String(alert.camera_name || "").toLowerCase();
        const combined = objStr + " " + typeStr;

        // Video upload analytics job alerts (camera_name starts with job_timestamp pattern)
        if (cameraStr.startsWith("job_") || /^job_\d+$/.test(String(alert.camera_name || ""))) {
            return '/video-analytics';
        }

        if (combined.includes('fire')) return '/fire';
        if (combined.includes('smoke')) return '/smoke';
        if (combined.includes('rodent')) return '/rodent';
        if (combined.includes('crowd')) return '/crowd';
        if (combined.includes('anpr') || combined.includes('plate') || combined.includes('license')) return '/anpr';
        if (combined.includes('warehouse') || combined.includes('volumetric')) return '/volumetric';
        if (combined.includes('garbage') || combined.includes('trash') || combined.includes('waste') || combined.includes('litter')) return '/reports/alerts';
        if (combined.includes('sweeping') || combined.includes('truck_sweeper')) return '/reports/alerts';
        if (combined.includes('event')) return '/event';
        if (combined.includes('facial') || combined.includes('face')) return '/facial';
        if (combined.includes('abandoned')) return '/abandoned';
        if (combined.includes('tamper')) return '/tamper';

        // Fallback: try to detect from camera_id if it matches job pattern
        if (String(alert.camera_id || "").startsWith("job_")) return '/video-analytics';

        return '/reports/alerts';
    };

    const handleAlertClick = (alert) => {
        const targetPath = getTargetPath(alert);
        navigate(targetPath);
        removeAlert(alert.id);
    };

    const handleImageClick = (e, alert) => {
        e.stopPropagation();
        const targetPath = getTargetPath(alert);
        navigate(targetPath);
        removeAlert(alert.id);
    };

    const parseCameraName = (raw) => {
        try {
            const cleaned = raw.replace(/'/g, '"');
            const parsed = JSON.parse(cleaned);
            return Object.values(parsed).join(' - ');
        } catch {
            return raw;
        }
    };

    const getEventName = (alert) => {
        const objStr = String(alert.objectName || "");
        const typeStr = String(alert.alertType || "");
        
        if (typeStr && typeStr !== "undefined") {
            return typeStr;
        }
        
        try {
            if (objStr.includes('{')) {
                const cleaned = objStr.replace(/'/g, '"');
                const parsed = JSON.parse(cleaned);
                return Object.keys(parsed)[0];
            }
        } catch {}
        
        if (objStr && objStr !== "undefined") {
            return objStr;
        }
        
        return "Event";
    };

    const getImageUrl = (path, cameraName) => {
        if (!path) return null;
        if (path.startsWith("http")) return path;
        
        let finalPath = path.replace(/^\//, '');
        if (cameraName && !finalPath.includes(`/${cameraName}/`)) {
            finalPath = finalPath.replace(/^app\/media\//, `app/media/${cameraName}/`);
        }
        
        return `${ANALYTICS_API_URL.replace(/\/$/, "")}/${finalPath}`;
    };

    return (
        <div className="fixed bottom-6 right-6 z-[10000] flex flex-col gap-3 pointer-events-none items-end">
            <AnimatePresence>
                {alerts.map((alert) => (
                    <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, y: 50, x: 20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8, x: 20, transition: { duration: 0.2 } }}
                        className="pointer-events-auto bg-white border border-purple-100 shadow-[-10px_10px_30px_rgba(0,0,0,0.1)] rounded-2xl p-4 w-72 md:w-80 cursor-pointer overflow-hidden relative group"
                        onClick={() => handleAlertClick(alert)}
                        whileHover={{ y: -5, boxShadow: "-10px_15px_40px_rgba(145,100,217,0.2)" }}
                        title={`Click to view ${getEventName(alert)} detections`}
                    >
                        <div className="flex gap-4">
                            <div
                                className="relative flex-shrink-0 w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100 overflow-hidden cursor-pointer"
                                onClick={(e) => handleImageClick(e, alert)}
                                title="Click to view detections"
                            >
                                {alert.framePath ? (
                                    <AlertSnapshot
                                        path={alert.framePath}
                                        cameraName={alert.camera_name}
                                        alt="Alert snapshot"
                                        width={48}
                                        height={48}
                                        className="w-full h-full object-cover pointer-events-none"
                                        preview={false}
                                    />
                                ) : (
                                    <FiBell className="w-6 h-6" />
                                )}
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                                {/* Hover overlay on image */}
                                <div className="absolute inset-0 bg-purple-700/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span className="text-white text-[8px] font-bold">VIEW</span>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h4 className="font-bold text-gray-800 text-sm">New Alert!</h4>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); removeAlert(alert.id); }}
                                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                    >
                                        <FiX size={16} />
                                    </button>
                                </div>
                                <div className="mt-1">
                                    <span className="text-xs font-black uppercase tracking-wider text-purple-600">
                                        {getEventName(alert)} Detected
                                    </span>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1 line-clamp-1 italic">
                                    {parseCameraName(alert.camera_name)}
                                </p>
                            </div>
                        </div>

                        {/* Progress Bar for Auto-dismiss Visual */}
                        <motion.div
                            className="absolute bottom-0 left-0 h-1 bg-purple-500/30 w-full origin-left"
                            initial={{ scaleX: 1 }}
                            animate={{ scaleX: 0 }}
                            transition={{ duration: 10, ease: "linear" }}
                        />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
};

export default LiveAlertToaster;
