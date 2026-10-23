import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { Image } from "antd";
import debounce from "lodash/debounce";
import Cookies from "js-cookie";
import axios from "axios";
import { deviceApi } from "../../../utils/axiosInstance";
import { ANALYTICS_API_URL } from "../../../config";
import { createTicketForAlerts } from "../../../utils/autoTicket";
import { AlertSnapshot, formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const isGarbageAlert = (objectName, alertType) => {
  try {
    const objStr = String(objectName || "").toLowerCase();
    const typeStr = String(alertType || "").toLowerCase();
    return (
      objStr.includes("garbage") ||
      objStr.includes("trash") ||
      objStr.includes("waste") ||
      objStr.includes("litter") ||
      typeStr.includes("garbage") ||
      typeStr.includes("trash") ||
      typeStr.includes("waste")
    );
  } catch {
    return false;
  }
};

/* ──────────────────────────────────────────────
   Camera Slot Component (simulates a live feed)
────────────────────────────────────────────── */
const CameraSlot = ({ slot, camera, onStartAnalytics, onVideoEnd, onClearSlot }) => {
  const videoRef = useRef(null);
  const isActive = !!slot.videoUrl;
  const isProcessing = slot.status === "processing";

  // Keep playback in sync
  useEffect(() => {
    if (videoRef.current && slot.videoUrl) {
      videoRef.current.src = slot.videoUrl;
      videoRef.current.play().catch(() => { });
    }
  }, [slot.videoUrl]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        background: "#0a0a0a",
        borderRadius: 6,
        overflow: "hidden",
        border: isActive ? "2px solid #9864db" : "2px solid #1a1a1a",
        boxShadow: isActive ? "0 0 18px #9864db55" : "none",
        transition: "border 0.3s, box-shadow 0.3s",
        cursor: "pointer",
      }}
      onClick={() => onStartAnalytics(slot.index)}
    >
      {/* Video or black screen */}
      {isActive ? (
        <>
          <video
            ref={videoRef}
            src={slot.videoUrl}
            autoPlay
            muted
            playsInline
            onEnded={() => onVideoEnd && onVideoEnd(slot.index)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {/* Close / Cross button */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (onClearSlot) onClearSlot(slot.index);
            }}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 30,
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
              width: 24,
              height: 24,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: "bold",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,59,59,0.8)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.6)")}
            title="Clear Feed"
          >
            ✕
          </div>
        </>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Ajeevi watermark style */}
          <div style={{ opacity: 0.18, pointerEvents: "none", userSelect: "none" }}>
            <svg width="80" height="30" viewBox="0 0 120 40">
              <text x="5" y="28" fontFamily="sans-serif" fontSize="22" fontWeight="bold" fill="#9864db">ajeevi</text>
            </svg>
          </div>
          <div style={{ color: "#444", fontSize: 11, marginTop: 4 }}>No Signal</div>
        </div>
      )}

      {/* Top-left label */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 10,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div style={{ color: "#fff", fontSize: 11, fontWeight: 600, textShadow: "0 1px 4px #000" }}>
          {camera ? camera.name || `Camera ${camera.id}` : `Slot ${slot.index + 1}`}
        </div>
        <div style={{ color: "#aaa", fontSize: 9, marginTop: 1, textShadow: "0 1px 4px #000" }}>
          {isActive ? "📡 Live Stream" : "Live Stream"}
        </div>
      </div>

      {/* REC badge */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 40,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 5,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#ff3b3b",
              display: "inline-block",
              animation: "blink 1.2s infinite",
            }}
          />
          <span style={{ color: "#ff3b3b", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>REC</span>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div
          style={{
            position: "absolute",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            background: "rgba(152,100,219,0.85)",
            color: "#fff",
            fontSize: 10,
            padding: "3px 10px",
            borderRadius: 20,
            backdropFilter: "blur(4px)",
            pointerEvents: "none",
            animation: "pulse 1.5s infinite",
          }}
        >
          ⚙️ Analyzing...
        </div>
      )}

      {/* Bottom stats bar (fps & latency - simulated) */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 10,
            zIndex: 10,
            display: "flex",
            gap: 10,
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "#00e676", fontSize: 10, fontWeight: 600, textShadow: "0 1px 4px #000" }}>
            ● {slot.fps || 25} FPS
          </span>
          <span style={{ color: "#ccc", fontSize: 10, textShadow: "0 1px 4px #000" }}>
            {slot.latency || "1038.2"}ms
          </span>
        </div>
      )}

      {/* Hover overlay: Start Analytics */}
      <div
        className="cam-hover-overlay"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 10,
          opacity: 0,
          transition: "opacity 0.2s",
          zIndex: 20,
        }}
      >
        <div
          style={{
            background: "#9864db",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 22px",
            fontWeight: 700,
            fontSize: 13,
            boxShadow: "0 4px 16px rgba(152,100,219,0.5)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ▶ {isActive ? "Reconfigure Detection" : "Enable Detection"}
        </div>
        <div style={{ color: "#ccc", fontSize: 11 }}>
          {isActive ? "Click to reconfigure analytics" : "Click to start garbage detection"}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .cam-slot-wrapper:hover .cam-hover-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
};

/* ──────────────────────────────────────
   Analytics Config Modal (looks like live camera analytics setup)
────────────────────────────────────── */
const AnalyticsConfigModal = ({
  open,
  onClose,
  cameras,
  slotIndex,
  onSubmit,
  submitting,
  progress,
  progressState,
}) => {
  const [selectedCamera, setSelectedCamera] = useState("");

  useEffect(() => {
    if (open) setSelectedCamera("");
  }, [open]);

  const handleSubmit = async () => {
    if (!selectedCamera) return;
    // Silently fetch the hardcoded garbage video and pass it as if it's a camera feed
    try {
      const res = await fetch(`/videos/garbage_video.mp4?t=${Date.now()}`);
      const blob = await res.blob();
      const file = new File([blob], "camera_feed.mp4", { type: "video/mp4" });
      onSubmit({ file, cameraId: selectedCamera, slotIndex });
    } catch (err) {
      console.error("Failed to initialize camera feed:", err);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: "28px 32px",
          width: "90%",
          maxWidth: 420,
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: "#9864db", color: "#fff", borderRadius: 6, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📡</span>
              Enable Garbage Detection
            </h3>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888" }}>
              Configure analytics on camera feed — Slot {slotIndex + 1}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ background: "none", border: "none", fontSize: 20, cursor: submitting ? "not-allowed" : "pointer", color: "#999" }}
          >
            ×
          </button>
        </div>

        {/* Camera Selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Camera Feed *
          </label>
          <select
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1.5px solid #ddd",
              borderRadius: 8,
              fontSize: 13,
              color: "#333",
              background: "#fafafa",
              outline: "none",
            }}
          >
            <option value="">-- Select camera feed --</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name || `Camera ${cam.id}`}
              </option>
            ))}
          </select>
        </div>

        {/* Detection Type (visual-only, always Garbage) */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Detection Model
          </label>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            border: "1.5px solid #9864db",
            borderRadius: 8,
            background: "#faf5ff",
          }}>
            <span style={{ fontSize: 16 }}>🗑️</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6b21a8" }}>Garbage / Waste Detection</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#9864db", background: "rgba(152,100,219,0.15)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>ACTIVE</span>
          </div>
        </div>

        {/* Connecting / Initializing indicator (disguised progress) */}
        {submitting && (
          <div style={{ marginBottom: 20, padding: "12px 16px", background: "#f5f3ff", borderRadius: 10, border: "1px solid #e9e0ff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ display: "inline-block", width: 16, height: 16, border: "2.5px solid #ddd5f5", borderTopColor: "#9864db", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#5b21b6" }}>
                {progressState === "uploading" && progress < 100
                  ? "Connecting to camera feed..."
                  : "Initializing analytics engine..."}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: i <= Math.floor(progress / 25) ? "#9864db" : "#e0d5f5",
                  transition: "background 0.4s",
                }} />
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#8b7aaf", marginTop: 6 }}>
              {progressState === "uploading" && progress < 100
                ? "Establishing secure connection to camera stream..."
                : "Loading detection models and configuring pipeline..."}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1.5px solid #ddd",
              background: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              color: "#555",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedCamera || submitting}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "none",
              background: !selectedCamera || submitting
                ? "#c4b5fd"
                : "linear-gradient(135deg, #9864db, #7c3aed)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: !selectedCamera || submitting ? "not-allowed" : "pointer",
              boxShadow: !selectedCamera ? "none" : "0 4px 14px rgba(152,100,219,0.4)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.2s",
            }}
          >
            {submitting ? (
              <>
                <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.5)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                Connecting...
              </>
            ) : (
              <>🔍 Start Detection</>
            )}
          </button>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────
   Main GarbageDetection Component
────────────────────────────────────────────── */
const GarbageDetection = () => {
  const isPreviewOpenRef = useRef(false);
  const lastFetchTimeRef = useRef(Date.now());
  const previousDataHashRef = useRef("");
  const previousTotalCountRef = useRef(0);
  const lastCheckTimeRef = useRef(Date.now());
  const pollingRef = useRef(null);

  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [cameraFilter, setCameraFilter] = useState("");
  const [cameras, setCameras] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasNewData, setHasNewData] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
  const [newDataCount, setNewDataCount] = useState(0);

  // Camera grid slots  (2 slots)
  const [slots, setSlots] = useState([
    { index: 0, videoUrl: null, cameraId: null, cameraName: null, status: "idle", jobId: null, fps: 25, latency: "1038.2" },
    { index: 1, videoUrl: null, cameraId: null, cameraName: null, status: "idle", jobId: null, fps: 25, latency: "942.7" },
  ]);

  // Upload modal
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressState, setProgressState] = useState("");

  const userId = Cookies.get("userId");

  const calculateDataHash = useCallback((dataArray) => {
    if (!dataArray || dataArray.length === 0) return "empty";
    const ids = dataArray.map((item) => item.id).sort().join(",");
    const timestamps = dataArray.map((item) => item.regDate).sort().join(",");
    return `${ids}_${timestamps}`;
  }, []);

  // ─── Table columns ───
  const columns = [
    columnHelper.display({
      id: "sno",
      header: "Sr. No.",
      cell: (info) => pageSize * (page - 1) + info.row.index + 1,
    }),
    columnHelper.accessor("camera_name", {
      header: "Camera Name",
      cell: (info) => (
        <span className="whitespace-normal break-words">
          {info.getValue() || "-"}
        </span>
      ),
    }),
    columnHelper.display({
      id: "event",
      header: "Event",
      cell: () => (
        <span className="px-3 py-1 text-xs rounded-full bg-green-50 text-green-700 border border-green-200">
          🗑️ Garbage
        </span>
      ),
    }),
    columnHelper.accessor("alertStatus", {
      header: "Severity",
      cell: (info) => {
        const code = info.getValue();
        let label = "Unknown";
        let color = "bg-gray-100 text-gray-600";
        switch (code) {
          case "B": label = "Basic"; color = "bg-blue-50 text-blue-700 border border-blue-200"; break;
          case "C": label = "Critical"; color = "bg-red-50 text-red-700 border border-red-200"; break;
          case "S": label = "Severe"; color = "bg-orange-50 text-orange-700 border border-orange-200"; break;
          case "N": label = "Normal"; color = "bg-green-50 text-green-700 border border-green-200"; break;
        }
        return (
          <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
            <span className="w-2 h-2 rounded-full bg-current" />
            {label}
          </span>
        );
      },
    }),
    columnHelper.accessor("regDate", {
      header: "Timestamp",
      cell: (info) => formatIndianDateTime(info.getValue()),
    }),
    columnHelper.accessor("framePath", {
      header: "Snapshot",
      cell: (info) => {
        const path = info.getValue();
        if (!path) return <span>-</span>;
        const row = info.row.original;
        return (
          <div className="flex justify-center">
            <AlertSnapshot
              path={path}
              cameraName={row.camera_name}
              alt="frame"
              width={80}
              height={60}
              className="object-cover rounded border border-purple-100 shadow-sm"
              preview={{
                mask: "View",
                onVisibleChange: (visible) => {
                  isPreviewOpenRef.current = visible;
                  if (visible) setAutoRefresh(false);
                  else setTimeout(() => setAutoRefresh(true), 2000);
                },
              }}
            />
          </div>
        );
      },
    }),
  ];

  // ─── Fetch cameras list ───
  const fetchCameras = async () => {
    try {
      const res = await deviceApi.get(`/Camera/?userid=${userId}&page=1&pageSize=100`);
      setCameras(res.data.results || []);
    } catch (err) {
      console.error("Camera fetch failed:", err);
    }
  };

  const checkForNewData = useCallback(async () => {
    if (isPreviewOpenRef.current || !autoRefresh) return;
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 5000) return;
    lastCheckTimeRef.current = now;
    try {
      const checkUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}&search=${globalFilter}&alertType=Garbage&objectName=Garbage`;
      const res = await deviceApi.get(checkUrl);
      const garbageAlertsOnly = (res.data.results || []).filter((item) =>
        isGarbageAlert(item.objectName, item.alertType)
      );
      const newTotalCount = garbageAlertsOnly.length;
      if (newTotalCount !== previousTotalCountRef.current) {
        const difference = newTotalCount - previousTotalCountRef.current;
        setNewDataCount(Math.max(0, difference));
        setHasNewData(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Check for new data failed:", err);
      return false;
    }
  }, [cameraFilter, globalFilter, autoRefresh, userId]);

  const fetchData = useCallback(
    async (forceFetch = false, isManualRefresh = false) => {
      if (isPreviewOpenRef.current && !forceFetch) return;
      if (!autoRefresh && !forceFetch && !isManualRefresh) return;
      const now = Date.now();
      if (now - lastFetchTimeRef.current < 2000 && !forceFetch) return;
      try {
        setLoading(true);
        lastFetchTimeRef.current = now;
        const apiUrl = `/CameraAlert/?userid=${userId}&page=${page}&pageSize=${pageSize}&camera_id=${cameraFilter || ""}&search=${globalFilter}&alertType=Garbage&objectName=Garbage`;
        const res = await deviceApi.get(apiUrl);
        const newData = (res.data.results || []).filter((item) =>
          isGarbageAlert(item.objectName, item.alertType)
        );
        let accurateTotalCount = 0;
        try {
          const countUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}&search=${globalFilter}&alertType=Garbage&objectName=Garbage`;
          const countRes = await deviceApi.get(countUrl);
          const allGarbageAlerts = (countRes.data.results || []).filter((item) =>
            isGarbageAlert(item.objectName, item.alertType)
          );
          accurateTotalCount = allGarbageAlerts.length;
        } catch {
          accurateTotalCount = res.data.count || 0;
        }
        const newDataHash = calculateDataHash(newData);
        setData(newData);
        setTotalCount(accurateTotalCount);
        previousDataHashRef.current = newDataHash;
        previousTotalCountRef.current = accurateTotalCount;
        const calculatedTotalPages = Math.max(1, Math.ceil(accurateTotalCount / pageSize));
        setTotalPages(calculatedTotalPages);
        setHasNewData(false);
        setNewDataCount(0);
        setLastRefreshTime(Date.now());
        if (page > calculatedTotalPages && calculatedTotalPages > 0) setPage(calculatedTotalPages);
        // Auto-create tickets for new alerts
        createTicketForAlerts(newData, "Garbage Detection", "Surveillance Alert");
      } catch (err) {
        console.error("Garbage API Error:", err);
      } finally {
        setLoading(false);
      }
    },
    [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash, userId]
  );

  const handleManualRefresh = () => {
    setHasNewData(false);
    setNewDataCount(0);
    fetchData(true, true);
  };

  const formatTimeSinceLastRefresh = () => {
    const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // ─── Initial fetch ───
  useEffect(() => {
    fetchCameras();
    fetchData(true);
  }, []);

  // ─── Auto-check for new data ───
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(async () => {
      if (isPreviewOpenRef.current) return;
      const hasNew = await checkForNewData();
      if (hasNew && page === 1) fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkForNewData, fetchData, autoRefresh, page]);

  // ─── Filter changes ───
  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    setHasNewData(false);
    setNewDataCount(0);
    setPage(1);
    fetchData(true);
  }, [globalFilter, cameraFilter, pageSize]);

  // ─── Page change ───
  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    const fetchPageData = async () => {
      try {
        setLoading(true);
        lastFetchTimeRef.current = Date.now();
        const apiUrl = `/CameraAlert/?userid=${userId}&page=${page}&pageSize=${pageSize}&camera_id=${cameraFilter || ""}&search=${globalFilter}&alertType=Garbage&objectName=Garbage`;
        const res = await deviceApi.get(apiUrl);
        const newData = (res.data.results || []).filter((item) =>
          isGarbageAlert(item.objectName, item.alertType)
        );
        setData(newData);
        setLastRefreshTime(Date.now());
        previousDataHashRef.current = calculateDataHash(newData);
        setHasNewData(false);
        setNewDataCount(0);
      } catch (err) {
        console.error("Garbage API Error on page change:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPageData();
  }, [page]);

  // ─── Upload video & start analytics ───
  const handleUploadAndStartAnalytics = async ({ file, cameraId, slotIndex }) => {
    setSubmitting(true);
    setUploadProgress(0);
    setProgressState("uploading");

    const jobId = `job_garbage_${Date.now()}`;
    const camera = cameras.find((c) => String(c.id) === String(cameraId));
    const cameraName = camera ? camera.name || `Camera ${cameraId}` : `Camera ${cameraId}`;

    try {
      const formData = new FormData();
      formData.append("camera_id", cameraId);
      formData.append("camera_name", cameraName);
      formData.append("objectlist", JSON.stringify(["Garbage"]));
      formData.append("user_id", userId);
      formData.append("file", file);

      const blobUrl = URL.createObjectURL(file);

      const response = await axios.post(`${ANALYTICS_API_URL}/UploadVideo`, formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(pct);
            if (pct === 100) setProgressState("processing");
          }
        },
      });

      if (response.status === 200 || response.status === 201) {
        // Update slot with video feed
        setSlots((prev) =>
          prev.map((s) =>
            s.index === slotIndex
              ? { ...s, videoUrl: blobUrl, cameraId, cameraName, status: "processing", jobId }
              : s
          )
        );

        // Start polling alerts for this camera
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(() => {
          fetchData(true);
        }, 5000);

        setModalOpen(false);
      }
    } catch (err) {
      console.error("Connection failed:", err);
      alert("Failed to connect to camera feed. Please check the server connection and try again.");
    } finally {
      setSubmitting(false);
      setProgressState("");
      setUploadProgress(0);
    }
  };

  const handleVideoEnd = (index) => {
    setSlots((prev) =>
      prev.map((s) => (s.index === index ? { ...s, status: "completed" } : s))
    );
  };

  const handleClearSlot = (index) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.index === index
          ? { ...s, videoUrl: null, cameraId: null, cameraName: null, status: "idle", jobId: null }
          : s
      )
    );
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: { pageIndex: page - 1, pageSize },
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
  });

  const handleSearch = useMemo(
    () =>
      debounce((value) => {
        setGlobalFilter(value);
        setPage(1);
      }, 300),
    []
  );

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* ── Header ── */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h2 className="text-xl font-bold text-[#fce4e4]">🗑️ Garbage Alerts</h2>
          {hasNewData && (
            <button
              onClick={handleManualRefresh}
              className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors flex items-center gap-1 animate-pulse"
            >
              <span>🔄</span>
              {newDataCount > 0
                ? `${newDataCount} New Alert${newDataCount > 1 ? "s" : ""}! Click to Refresh`
                : "New Alerts Available! Click to Refresh"}
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">Last updated: {formatTimeSinceLastRefresh()}</span>
            {hasNewData && (
              <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-pulse">
                {newDataCount > 0 ? `${newDataCount} New` : "New!"}
              </span>
            )}
            {loading && (
              <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full animate-pulse">
                Loading...
              </span>
            )}
          </div>
          <input
            type="text"
            placeholder="Search alerts..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]"
            disabled={loading}
          />
          <select
            value={cameraFilter}
            onChange={(e) => { setCameraFilter(e.target.value); setPage(1); }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
            disabled={loading}
          >
            <option value="" className="text-black">All Cameras</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id} className="text-black">
                {cam.name || `Camera ${cam.id}`}
              </option>
            ))}
          </select>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm"
            disabled={loading}
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size} className="text-black">Show {size}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Camera Grid + Sidebar ── */}
      <div style={{ display: "flex", gap: 16 }}>
        {/* Left sidebar: camera list */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            background: "#111",
            borderRadius: 10,
            padding: "12px 0",
            border: "1px solid #222",
            maxHeight: 320,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              color: "#888",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              padding: "0 12px 8px",
              borderBottom: "1px solid #222",
              marginBottom: 6,
              textTransform: "uppercase",
            }}
          >
            📷 Cameras ({cameras.length})
          </div>
          {cameras.length === 0 ? (
            <div style={{ color: "#555", fontSize: 11, padding: "16px 12px", textAlign: "center" }}>
              No cameras found
            </div>
          ) : (
            cameras.map((cam, i) => {
              const occupiedSlot = slots.find((s) => String(s.cameraId) === String(cam.id));
              return (
                <div
                  key={cam.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                    background: occupiedSlot ? "rgba(152,100,219,0.15)" : "transparent",
                    borderLeft: occupiedSlot ? "3px solid #9864db" : "3px solid transparent",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => { if (!occupiedSlot) e.currentTarget.style.background = "#1a1a1a"; }}
                  onMouseLeave={(e) => { if (!occupiedSlot) e.currentTarget.style.background = "transparent"; }}
                  onClick={() => {
                    const emptySlot = slots.find((s) => !s.videoUrl);
                    if (emptySlot !== undefined) {
                      setActiveSlotIndex(emptySlot ? emptySlot.index : 0);
                    }
                    setModalOpen(true);
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: occupiedSlot ? "#9864db" : "#333",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: occupiedSlot ? "#c4b5fd" : "#bbb",
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cam.name || `Camera ${cam.id}`}
                    </div>
                    {occupiedSlot && (
                      <div style={{ color: "#9864db", fontSize: 9, marginTop: 1 }}>
                        ● Slot {occupiedSlot.index + 1} Active
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: 2 camera slots */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {slots.map((slot) => {
            const camera = cameras.find((c) => String(c.id) === String(slot.cameraId));
            return (
              <div
                key={slot.index}
                className="cam-slot-wrapper"
                style={{ position: "relative" }}
                onClick={() => {
                  setActiveSlotIndex(slot.index);
                  setModalOpen(true);
                }}
              >
                <CameraSlot
                  slot={slot}
                  camera={camera}
                  onStartAnalytics={() => {
                    setActiveSlotIndex(slot.index);
                    setModalOpen(true);
                  }}
                  onVideoEnd={handleVideoEnd}
                  onClearSlot={handleClearSlot}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Alert badges for active streams ── */}
      {slots.some((s) => s.status === "processing") && (
        <div
          style={{
            background: "linear-gradient(135deg, #1a0a2e, #2d1560)",
            border: "1px solid #4c2a8a",
            borderRadius: 10,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#9864db", display: "inline-block", animation: "blink 1s infinite" }} />
            <span style={{ color: "#c4b5fd", fontSize: 12, fontWeight: 600 }}>Analytics Running</span>
          </div>
          {slots.filter((s) => s.status === "processing").map((s) => (
            <span
              key={s.index}
              style={{
                background: "rgba(152,100,219,0.2)",
                border: "1px solid #9864db",
                borderRadius: 20,
                padding: "3px 12px",
                color: "#c4b5fd",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              📡 Slot {s.index + 1}: {s.cameraName} — Detecting garbage...
            </span>
          ))}
          <span style={{ color: "#7c5cbf", fontSize: 11, marginLeft: "auto" }}>
            Alerts are auto-refreshing every 5s
          </span>
        </div>
      )}

      {/* ── Alerts Table ── */}
      <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-[#9864db] text-[#E6E6FA]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted()] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-green-100">
            {loading && data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-6">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-[#9864db] border-t-transparent rounded-full animate-spin" />
                    Loading Garbage Alerts...
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-green-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 border border-green-100 whitespace-normal break-words"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-gray-500">
                  No garbage alerts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <span className="text-sm text-gray-600">Page {page} of {totalPages || 1}</span>
          <span className="text-sm text-gray-600">
            Showing {data.length} of {totalCount} alert{totalCount !== 1 ? "s" : ""}
          </span>
          {hasNewData && page !== 1 && (
            <span className="text-xs text-yellow-600">New alerts available on page 1</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={page === 1 || loading}
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={page === totalPages || loading}
          >
            Next
          </button>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-sm text-gray-600">Go to:</span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={page}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                if (value >= 1 && value <= totalPages) setPage(value);
              }}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
              disabled={loading}
            />
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="fixed bottom-2 right-4 text-xs font-bold z-50">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>

      {/* ── Global styles for camera hover ── */}
      <style>{`
        .cam-slot-wrapper:hover .cam-hover-overlay {
          opacity: 1 !important;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>

      {/* ── Analytics Config Modal ── */}
      <AnalyticsConfigModal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        cameras={cameras}
        slotIndex={activeSlotIndex}
        onSubmit={handleUploadAndStartAnalytics}
        submitting={submitting}
        progress={uploadProgress}
        progressState={progressState}
      />
    </div>
  );
};

export default GarbageDetection;
