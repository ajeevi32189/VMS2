import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import axios from "axios";
import { Spin, Tag, Select, message, Empty, Modal } from "antd";
import Cookies from "js-cookie";
import { deviceApi } from "../../../utils/axiosInstance";
import { ROI_API_URL, STREAMING_API_URL, GO2RTC_URL } from "../../../config";
import { FaTrash } from "react-icons/fa";
import {
  EyeOutlined,
  VideoCameraOutlined,
  CameraOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import Hls from "hls.js";
import { formatIndianDateTime } from "../../../utils/imageUtils";

const { Option } = Select;
const columnHelper = createColumnHelper();

const LEVEL_COLORS = {
  1: {
    fill: "rgba(59,130,246,0.22)",
    fillHover: "rgba(59,130,246,0.45)",
    stroke: "#3b82f6",
    label: "Low",
    tagBg: "#dbeafe",
    tagText: "#1e40af",
    border: "#93c5fd",
  },
  2: {
    fill: "rgba(249,115,22,0.22)",
    fillHover: "rgba(249,115,22,0.45)",
    stroke: "#f97316",
    label: "Medium",
    tagBg: "#ffedd5",
    tagText: "#9a3412",
    border: "#fdba74",
  },
  3: {
    fill: "rgba(239,68,68,0.22)",
    fillHover: "rgba(239,68,68,0.45)",
    stroke: "#ef4444",
    label: "High",
    tagBg: "#fee2e2",
    tagText: "#991b1b",
    border: "#fca5a5",
  },
};

// Calculate exact bounding coordinates relative to 640x480 coordinate reference (standardized by FenceDrawer)
const getNormalizedBox = (sec) => {
  const bb = sec.bounding_box || {};
  if (!bb || !bb.top_left || !bb.top_right || !bb.bottom_left) return null;

  const rawX = Number(bb.top_left.x) || 0;
  const rawY = Number(bb.top_left.y) || 0;
  const rawX2 = Number(bb.top_right.x) || rawX;
  const rawY2 = Number(bb.bottom_left.y) || rawY;

  const rawW = Math.max(0, rawX2 - rawX);
  const rawH = Math.max(0, rawY2 - rawY);

  // If coordinates exceed 640x480, they were saved at full sensor resolution (e.g. 1920x1080)
  const isHighRes = rawX + rawW > 640 || rawY + rawH > 480;
  const baseW = isHighRes ? 1920 : 640;
  const baseH = isHighRes ? 1080 : 480;

  return {
    rawX,
    rawY,
    rawW,
    rawH,
    baseW,
    baseH,
    // Exact position in 640x480 SVG coordinate space (matches video overlay regardless of screen size)
    svgX: (rawX / baseW) * 640,
    svgY: (rawY / baseH) * 480,
    svgW: (rawW / baseW) * 640,
    svgH: (rawH / baseH) * 480,
    // Percentages for UI breakdown
    leftPct: ((rawX / baseW) * 100).toFixed(1),
    topPct: ((rawY / baseH) * 100).toFixed(1),
    widthPct: ((rawW / baseW) * 100).toFixed(1),
    heightPct: ((rawH / baseH) * 100).toFixed(1),
  };
};

const FencePreviewModal = ({ open, onClose, fence }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [viewMode, setViewMode] = useState("stream"); // "stream" | "snapshot"
  const [streamConnecting, setStreamConnecting] = useState(true);
  const [streamError, setStreamError] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState(null);
  const [loadingImg, setLoadingImg] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(null);

  // Determine valid camera IDs to try for streaming & snapshot
  const cam = fence?.matchedCamera;
  const numId = String(fence?.camera_name || fence?.camera_id || "").match(/\d+/)?.[0];

  // Candidates for both stream & snapshot
  const getCandidateIds = () => {
    const list = [
      cam?.id,
      cam?.name,
      fence?.camera_id,
      numId,
      numId ? `cam_${numId}` : null,
      numId ? `MediaProfile_Channel${numId}_MainStream` : null,
      // Go2rtc registered stream keys
      numId === "5" ? "cam_46" : null,
      numId === "5" ? "test" : null,
      numId === "4" ? "cam_47" : null,
      numId === "4" ? "48" : null,
      numId === "2" ? "cam_44" : null,
      numId === "2" ? "50" : null,
      numId === "3" ? "cam_45" : null,
      numId === "3" ? "49" : null,
      cam?.stream_name,
    ].filter(Boolean);
    return [...new Set(list)];
  };

  // 1. Fetch Snapshot (tries STREAMING_API and GO2RTC frame endpoint)
  const loadSnapshot = async () => {
    if (!open || !fence) return;
    setLoadingImg(true);

    const uniqueIds = getCandidateIds();
    const urls = [];

    // First: Streaming API /snapshot/
    for (const id of uniqueIds) {
      urls.push(`${STREAMING_API_URL}/snapshot/${encodeURIComponent(id)}`);
    }
    // Second: GO2RTC /api/frame.jpeg
    for (const id of uniqueIds) {
      urls.push(`${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(id)}`);
    }

    let loaded = false;
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const blob = await res.blob();
          if (blob && blob.size > 800) {
            const objectUrl = URL.createObjectURL(blob);
            setSnapshotUrl(objectUrl);
            setLoadingImg(false);
            loaded = true;
            return;
          }
        }
      } catch (err) {
        // try next candidate URL
      }
    }

    if (!loaded) {
      setSnapshotUrl(null);
      setLoadingImg(false);
      // If snapshot is unavailable, switch seamlessly to live video stream
      setViewMode("stream");
    }
  };

  useEffect(() => {
    if (!open || !fence) {
      setSnapshotUrl(null);
      setLoadingImg(false);
      setStreamError(false);
      setStreamConnecting(true);
      return;
    }
    setViewMode("snapshot");
    loadSnapshot();
  }, [open, fence]);

  // 2. Setup HLS Live Video Stream
  useEffect(() => {
    if (!open || !fence || viewMode !== "stream") {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setStreamConnecting(true);
    setStreamError(false);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const candidateIds = getCandidateIds();
    let candidateIdx = 0;

    const tryPlayStream = (id) => {
      const hlsUrl = `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(id)}&mp4`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          debug: false,
          lowLatencyMode: true,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 5,
          maxBufferLength: 8,
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStreamConnecting(false);
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            candidateIdx++;
            if (candidateIdx < candidateIds.length) {
              hls.destroy();
              tryPlayStream(candidateIds[candidateIdx]);
            } else {
              setStreamError(true);
              setStreamConnecting(false);
            }
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        video.addEventListener("loadedmetadata", () => {
          setStreamConnecting(false);
          video.play().catch(() => {});
        });
      }
    };

    if (candidateIds.length > 0) {
      tryPlayStream(candidateIds[0]);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [open, fence, viewMode, fence?.camera_id, cam?.id]);

  if (!open || !fence) return null;

  const sections = Array.isArray(fence.sections) ? fence.sections : [];

  return (
    <Modal
      title={
        <div className="flex items-center justify-between border-b border-purple-100 pb-3 pr-6">
          <div className="flex items-center gap-2 text-purple-900">
            <span className="text-xl">🛡️</span>
            <div>
              <h3 className="font-bold text-base leading-tight">Fence Zones: {fence.camera_name}</h3>
              <p className="text-xs text-gray-500 font-normal">
                Configured intrusion boundary zones overlay on camera stream
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-purple-50 p-1 rounded-lg border border-purple-200">
            <button
              onClick={() => setViewMode("stream")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                viewMode === "stream"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-purple-700 hover:bg-purple-100"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${viewMode === "stream" ? "bg-red-400 animate-pulse" : "bg-gray-400"}`} />
              <VideoCameraOutlined />
              <span>Live Stream</span>
            </button>
            <button
              onClick={() => setViewMode("snapshot")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                viewMode === "snapshot"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-purple-700 hover:bg-purple-100"
              }`}
            >
              <CameraOutlined />
              <span>Snapshot</span>
            </button>
          </div>
        </div>
      }
      open={open}
      onCancel={() => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        onClose();
      }}
      footer={null}
      width={900}
      centered
      destroyOnClose
    >
      <div className="space-y-3 pt-2">
        {/* Info bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-purple-50 px-3.5 py-2.5 rounded-lg border border-purple-100 text-xs">
          <div>
            <span className="text-gray-500">Camera:</span>{" "}
            <span className="font-bold text-purple-900">{fence.camera_name}</span>
          </div>
          <div>
            <span className="text-gray-500">Location:</span>{" "}
            <span className="font-semibold text-gray-800">{fence.location_name || "—"}</span>
          </div>
          <div>
            <span className="text-gray-500">Configured:</span>{" "}
            <span className="font-semibold text-gray-800">{fence.formattedTime || "—"}</span>
          </div>
          <div className="flex gap-1 items-center">
            <span className="text-gray-500 mr-1">Zones:</span>
            {fence.highCount > 0 && <Tag color="red">{fence.highCount} High</Tag>}
            {fence.mediumCount > 0 && <Tag color="orange">{fence.mediumCount} Medium</Tag>}
            {fence.lowCount > 0 && <Tag color="blue">{fence.lowCount} Low</Tag>}
          </div>
        </div>

        {/* Video / Snapshot Container with Overlay */}
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border-2 border-purple-200 shadow-inner flex items-center justify-center">
          {/* Live Video Player */}
          {viewMode === "stream" && (
            <>
              {streamConnecting && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/80 text-white text-xs gap-2">
                  <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  <span>Connecting to camera live stream...</span>
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-fill bg-black"
              />
            </>
          )}

          {/* Snapshot View */}
          {viewMode === "snapshot" && (
            <>
              {loadingImg && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/80 text-white text-xs gap-2">
                  <Spin size="small" />
                  <span>Loading camera snapshot...</span>
                </div>
              )}
              {snapshotUrl ? (
                <img
                  src={snapshotUrl}
                  alt={fence.camera_name}
                  className="w-full h-full object-fill bg-black"
                />
              ) : (
                /* Fallback grid if snapshot not yet captured */
                <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-500 font-mono text-xs select-none">
                  <div className="text-3xl mb-1">📹</div>
                  <span className="font-bold text-slate-400">{fence.camera_name}</span>
                  <span className="text-[11px] text-slate-500">Camera preview connecting — displaying configured boundary grid</span>
                </div>
              )}
            </>
          )}

          {/* Live Fence Indicator Badge */}
          <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded text-[11px] text-white font-mono pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>{viewMode === "stream" ? "LIVE STREAM" : "SNAPSHOT"}</span>
            <span className="text-gray-400">|</span>
            <span className="text-purple-300 font-bold">{sections.length} Zone{sections.length !== 1 ? "s" : ""} Configured</span>
          </div>

          {/* Snapshot Refresh Button (when in snapshot mode) */}
          {viewMode === "snapshot" && (
            <button
              onClick={loadSnapshot}
              className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-xs px-2.5 py-1 rounded border border-white/20 transition cursor-pointer"
              title="Refresh Snapshot"
            >
              <ReloadOutlined spin={loadingImg} />
              <span>Refresh</span>
            </button>
          )}

          {/* EXACT INTRUSION FENCE BOUNDARIES OVERLAY */}
          {/* viewBox="0 0 640 480" ensures 100% pixel-perfect alignment with FenceDrawer and AI detector */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none select-none z-20"
            viewBox="0 0 640 480"
            preserveAspectRatio="none"
          >
            {sections.map((sec, idx) => {
              const box = getNormalizedBox(sec);
              if (!box) return null;
              const c = LEVEL_COLORS[sec.section_level] || LEVEL_COLORS[2];
              const isHovered = highlightedIndex === idx;

              const labelText = `${c.label.toUpperCase()} : ${sec.label || `Zone ${idx + 1}`}`;
              const badgeWidth = Math.min(220, Math.max(90, labelText.length * 7.5 + 24));

              return (
                <g key={idx} className="transition-all duration-150">
                  {/* Shaded zone polygon/rectangle */}
                  <rect
                    x={box.svgX}
                    y={box.svgY}
                    width={box.svgW}
                    height={box.svgH}
                    fill={isHovered ? c.fillHover : c.fill}
                    stroke={c.stroke}
                    strokeWidth={isHovered ? "3.5" : "2.5"}
                    strokeDasharray={isHovered ? "none" : "8 4"}
                  />

                  {/* Corner markers for clarity */}
                  <circle cx={box.svgX} cy={box.svgY} r="3" fill={c.stroke} />
                  <circle cx={box.svgX + box.svgW} cy={box.svgY} r="3" fill={c.stroke} />
                  <circle cx={box.svgX} cy={box.svgY + box.svgH} r="3" fill={c.stroke} />
                  <circle cx={box.svgX + box.svgW} cy={box.svgY + box.svgH} r="3" fill={c.stroke} />

                  {/* Priority Label Pill */}
                  <rect
                    x={box.svgX}
                    y={Math.max(0, box.svgY - 22)}
                    width={badgeWidth}
                    height={20}
                    fill={c.stroke}
                    rx="3"
                  />
                  <text
                    x={box.svgX + 6}
                    y={Math.max(14, box.svgY - 7)}
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="bold"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {labelText}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Zones Breakdown Table */}
        <div className="border border-purple-100 rounded-lg overflow-hidden bg-white shadow-sm">
          <div className="bg-purple-50/70 px-3 py-2 text-xs font-bold text-purple-950 flex justify-between items-center border-b border-purple-100">
            <span>Configured Intrusion Zones ({sections.length})</span>
            <span className="text-gray-500 font-normal text-[11px]">Hover over a zone to highlight boundary on stream</span>
          </div>

          <div className="max-h-40 overflow-y-auto divide-y divide-purple-50 text-xs">
            {sections.length > 0 ? (
              sections.map((sec, idx) => {
                const c = LEVEL_COLORS[sec.section_level] || LEVEL_COLORS[2];
                const box = getNormalizedBox(sec);
                const isHovered = highlightedIndex === idx;

                return (
                  <div
                    key={idx}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseLeave={() => setHighlightedIndex(null)}
                    className={`p-2.5 flex items-center justify-between transition cursor-pointer ${
                      isHovered ? "bg-purple-100/70" : "hover:bg-purple-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-200 text-purple-800 font-bold flex items-center justify-center text-[10px]">
                        {idx + 1}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-bold border"
                        style={{ backgroundColor: c.tagBg, color: c.tagText, borderColor: c.border }}
                      >
                        {c.label} Priority
                      </span>
                      <span className="font-semibold text-gray-800">{sec.label || `Zone ${idx + 1}`}</span>
                    </div>

                    {box && (
                      <div className="text-right text-gray-500 font-mono text-[11px] flex items-center gap-2">
                        <span>Position: {box.leftPct}% L, {box.topPct}% T</span>
                        <span className="text-gray-300">|</span>
                        <span>Coverage: {box.widthPct}% × {box.heightPct}%</span>
                        <span className="text-gray-300">|</span>
                        <span className="text-gray-400">({box.rawX}, {box.rawY})</span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-center text-gray-400">No zone boundaries configured for this camera.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

const Fencing = () => {
  const [rois, setRois] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState([]);
  const [cameraFilter, setCameraFilter] = useState("all");
  const [selectedFence, setSelectedFence] = useState(null);

  const userId = Cookies.get("userId");

  // Fetch cameras list with full pagination loop
  const fetchCameras = async () => {
    try {
      let all = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const res = await deviceApi.get(`/Camera/`, {
          params: { userid: userId, user_id: userId, page, page_size: 100, pageSize: 100 },
        });
        const data = res.data;
        const list = Array.isArray(data) ? data : (data?.results || data?.cameras || []);
        if (list.length > 0) {
          all = [...all, ...list];
          hasMore = !!data?.next;
          page++;
        } else {
          hasMore = false;
        }
      }
      console.log("DEBUG: All Cameras from /Camera/ API:", all);
      setCameras(all);
    } catch (err) {
      console.error("Failed to fetch cameras:", err);
    }
  };

  // Fetch all ROIs (fence configurations)
  const fetchRois = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${ROI_API_URL}/api/v1/rois`);
      const data = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.rois || []);
      console.log("DEBUG: All ROIs from ROI API:", data);

      // Auto-purge stale duplicate ROIs from backend database if any camera has multiple records
      try {
        const groups = new Map();
        data.forEach((r) => {
          const profile =
            String(r.camera_name || r.camera_id || "").match(/(MediaProfile_[^/\?\s,]+)/i)?.[1] ||
            (String(r.camera_name || r.camera_id || "").match(/channel[_\s-]?(\d+)/i)
              ? `channel_${String(r.camera_name || r.camera_id || "").match(/channel[_\s-]?(\d+)/i)[1]}`
              : null) ||
            r.camera_name ||
            r.camera_id;
          if (!profile) return;
          const k = String(profile).trim().toLowerCase();
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(r);
        });

        groups.forEach((group) => {
          if (group.length > 1) {
            // Sort: newest timestamp or highest section count first
            group.sort((a, b) => {
              const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
              const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
              return timeB - timeA || (b.sections?.length || 0) - (a.sections?.length || 0);
            });
            const keeper = group[0];
            const staleList = group.slice(1);
            staleList.forEach(async (stale) => {
              const key = stale.camera_id || stale.id;
              if (key && String(key).trim() !== String(keeper.camera_id).trim()) {
                try {
                  console.log(`[Fencing] Auto-purging stale duplicate ROI from backend:`, key);
                  await axios.delete(`${ROI_API_URL}/api/v1/rois/${encodeURIComponent(key)}`);
                } catch (_) {}
              }
            });
          }
        });
      } catch (cleanErr) {
        console.warn("Auto-clean duplicates error:", cleanErr);
      }

      setRois(data);
    } catch (err) {
      console.error("Failed to fetch ROIs:", err);
      setRois([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRoi = async (row) => {
    try {
      const cam = cameras.find(
        (c) => String(c.id) === String(row.camera_id) || c.name === row.camera_id
      );
      const finalId = cam ? cam.id : row.camera_id;

      if (!finalId && !row.camera_id) {
        message.error("Error: Could not determine valid Camera ID to delete.");
        return;
      }

      const camName = row.camera_name || finalId;
      if (window.confirm(`Are you sure you want to delete all fence zones for Camera: ${camName}?`)) {
        try {
          // Collect all potential IDs for this camera to ensure complete cleanup of duplicates
          const idsToDelete = new Set([
            String(row.camera_id || "").trim(),
            String(finalId || "").trim(),
            String(cam?.id || "").trim(),
            String(cam?.name || "").trim(),
            ...(row.duplicateCameraIds || []).map((id) => String(id).trim()),
          ]);

          let deletedAny = false;
          for (const id of idsToDelete) {
            if (!id) continue;
            try {
              await axios.delete(`${ROI_API_URL}/api/v1/rois/${encodeURIComponent(id)}`);
              deletedAny = true;
            } catch (_) {
              // Ignore if already deleted
            }
          }

          if (deletedAny) {
            message.success(`Successfully deleted fence for Camera: ${camName}`);
          } else {
            message.info(`Fence for Camera: ${camName} removed.`);
          }
          fetchRois();
        } catch (err) {
          console.error("Failed to delete ROI:", err);
          message.error(`Failed to delete ROI for ${camName}.`);
        }
      }
    } catch (outerErr) {
      console.error("Error in handleDeleteRoi:", outerErr);
      message.error("Error trying to process delete: " + outerErr.message);
    }
  };

  useEffect(() => {
    fetchCameras();
    fetchRois();

    const interval = setInterval(() => {
      fetchCameras();
      fetchRois();
    }, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  // Merge ROIs with camera names & calculate counts
  const roiData = useMemo(() => {
    const safeRois = Array.isArray(rois) ? rois : [];
    const mapped = safeRois.map((roi) => {
      const roiCamIdStr = String(roi.camera_id || "").trim();
      const roiCamNameStr = String(roi.camera_name || "").trim();

      const extractNums = (str) => {
        const m = String(str || "").match(/\d+/g);
        return m ? m.map(Number) : [];
      };

      const roiNums = [
        ...extractNums(roi.camera_id),
        ...extractNums(roi.camera_name),
        ...extractNums(roi.name),
      ];

      const cam = cameras.find((c) => {
        if (!c) return false;
        const cId = String(c.id || "").trim();
        const cCamId = String(c.camera_id || "").trim();
        const cName = String(c.name || "").trim();
        const cStream = String(c.stream_name || "").trim();
        const cChannel = String(c.channelId || c.channel_id || c.channel_no || "").trim();

        // 1. Direct match on ID, name, or stream
        if (
          (cId && cId === roiCamIdStr) ||
          (cCamId && cCamId === roiCamIdStr) ||
          (cName && cName === roiCamIdStr) ||
          (cStream && cStream === roiCamIdStr) ||
          (cName && cName === roiCamNameStr) ||
          (cStream && cStream === roiCamNameStr)
        ) {
          return true;
        }

        // 2. Channel matching
        const lowerRoiId = roiCamIdStr.toLowerCase();
        const lowerRoiName = roiCamNameStr.toLowerCase();
        const lowerCName = cName.toLowerCase();

        if (
          (cChannel && lowerRoiId.includes(`channel${cChannel.toLowerCase()}`)) ||
          (cChannel && lowerRoiId.includes(`channel_${cChannel.toLowerCase()}`)) ||
          (lowerRoiId && lowerCName.includes(lowerRoiId)) ||
          (lowerRoiName && lowerCName.includes(lowerRoiName)) ||
          (lowerCName && lowerRoiId.includes(lowerCName))
        ) {
          return true;
        }

        // 3. Channel/Camera number matching (e.g. "Camera 4" -> channel 4 or ID 4)
        if (roiNums.length > 0) {
          const cNums = [
            ...extractNums(c.id),
            ...extractNums(c.channelId),
            ...extractNums(c.channel_id),
            ...extractNums(c.channel_no),
            ...extractNums(c.name),
          ];
          for (const rn of roiNums) {
            if (cNums.includes(rn)) return true;
          }
        }

        return false;
      });
      const safeSections = Array.isArray(roi.sections) ? roi.sections : [];

      // Check timestamp: updated_at if updated, created_at if created first time
      const rawTime = roi.updated_at || roi.created_at || roi.timestamp || roi.createdDate || roi.time;
      const formattedTime = rawTime ? formatIndianDateTime(rawTime) : null;

      // Helper to extract ONVIF profile stream name from any field, ROI name/description, or RTSP URL
      const getOnvifStreamName = (c, r) => {
        const candidates = [
          r?.camera_name,
          r?.name,        // e.g. "Fence_MediaProfile_Channel3_MainStream"
          r?.description, // e.g. "Fence for MediaProfile_Channel3_MainStream"
          r?.camera_id,
          c?.rtspurl,
          c?.cameraIP,
          c?.stream_name,
          c?.name,
        ];
        for (const cand of candidates) {
          if (!cand) continue;
          const match = String(cand).match(/(MediaProfile_[^/\?\s,]+)/i);
          if (match) return match[1];
        }
        return null;
      };

      const onvifName = getOnvifStreamName(cam, roi);

      let displayName = "";
      if (onvifName) {
        displayName = onvifName;
      } else if (cam?.name && !/^Camera\s*\d+$/i.test(String(cam.name).trim())) {
        displayName = cam.name;
      } else if (roi?.camera_name && !/^Camera\s*\d+$/i.test(String(roi.camera_name).trim()) && isNaN(roi.camera_name)) {
        displayName = roi.camera_name;
      } else if (roiNums.length > 0) {
        // Enforce consistent ONVIF profile format so it NEVER reverts to "Camera X"
        displayName = `MediaProfile_Channel${roiNums[0]}_MainStream`;
      } else if (cam?.channelId || cam?.channel_id) {
        displayName = `MediaProfile_Channel${cam.channelId || cam.channel_id}_MainStream`;
      } else if (cam?.name) {
        displayName = cam.name;
      } else if (roi?.camera_name) {
        displayName = roi.camera_name;
      } else {
        displayName = roi.camera_id ? (isNaN(roi.camera_id) ? roi.camera_id : `Camera ${roi.camera_id}`) : "—";
      }

      return {
        ...roi,
        rawTime,
        matchedCamera: cam,
        camera_name: displayName,
        location_name: cam?.location_name || "—",
        formattedTime,
        sectionCount: safeSections.length,
        highCount: safeSections.filter((s) => s.section_level === 3).length,
        mediumCount: safeSections.filter((s) => s.section_level === 2).length,
        lowCount: safeSections.filter((s) => s.section_level === 1).length,
      };
    });

    // Deduplicate by camera: keep only the newest / most recently updated fence per camera
    const cameraMap = new Map();
    mapped.forEach((item) => {
      const key = item.camera_name || (item.matchedCamera ? `cam_${item.matchedCamera.id}` : item.camera_id);
      if (!cameraMap.has(key)) {
        cameraMap.set(key, { ...item, duplicateCameraIds: [] });
      } else {
        const existing = cameraMap.get(key);
        const existingTime = new Date(existing.rawTime || 0).getTime();
        const itemTime = new Date(item.rawTime || 0).getTime();

        if (item.camera_id && item.camera_id !== existing.camera_id) {
          existing.duplicateCameraIds.push(item.camera_id);
        }

        // Keep the newer one or the one with the higher zone count
        if (itemTime > existingTime || (itemTime === existingTime && item.sectionCount >= existing.sectionCount)) {
          const duplicates = [existing.camera_id, ...(existing.duplicateCameraIds || [])].filter(
            (id) => id && id !== item.camera_id
          );
          cameraMap.set(key, { ...item, duplicateCameraIds: duplicates });
        }
      }
    });

    return Array.from(cameraMap.values());
  }, [rois, cameras]);

  const filteredData = useMemo(() => {
    if (cameraFilter === "all") return roiData;
    return roiData.filter(
      (r) => String(r.camera_id) === String(cameraFilter) || r.camera_name === cameraFilter
    );
  }, [roiData, cameraFilter]);

  // Check if any ROI has a valid time stamp
  const hasTimeData = useMemo(() => {
    return roiData.some((r) => !!r.formattedTime);
  }, [roiData]);

  const columns = [
    columnHelper.display({
      id: "serial",
      header: "S.No",
      cell: (info) => (
        <span className="font-medium text-gray-700">
          {info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.accessor("camera_name", {
      header: "Camera",
      cell: (info) => (
        <button
          type="button"
          onClick={() => setSelectedFence(info.row.original)}
          className="font-medium text-purple-700 hover:text-purple-900 hover:underline text-left cursor-pointer flex items-center gap-1.5"
          title="Click to view fence map"
        >
          <span>{info.getValue()}</span>
        </button>
      ),
    }),
    columnHelper.display({
      id: "sections",
      header: "Fence Zones",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div
            onClick={() => setSelectedFence(row)}
            className="flex gap-1 items-center cursor-pointer hover:opacity-80 transition"
            title="Click to view fence preview"
          >
            {row.highCount > 0 && (
              <Tag color="red">{row.highCount} High</Tag>
            )}
            {row.mediumCount > 0 && (
              <Tag color="orange">{row.mediumCount} Medium</Tag>
            )}
            {row.lowCount > 0 && (
              <Tag color="blue">{row.lowCount} Low</Tag>
            )}
            {row.sectionCount === 0 && (
              <span className="text-gray-400">No zones</span>
            )}
          </div>
        );
      },
    }),
    ...(hasTimeData
      ? [
          columnHelper.accessor("formattedTime", {
            header: "Created / Updated At",
            cell: (info) => info.getValue() || "—",
          }),
        ]
      : [
          columnHelper.accessor("location_name", {
            header: "Location",
            cell: (info) => info.getValue() || "—",
          }),
        ]),
    columnHelper.display({
      id: "status",
      header: "Status",
      cell: () => <Tag color="green">Active</Tag>,
    }),
    columnHelper.display({
      id: "actions",
      header: "Action",
      cell: (info) => (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setSelectedFence(info.row.original)}
            className="text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 p-2 rounded transition flex items-center justify-center"
            title="View Fence Map"
          >
            <EyeOutlined style={{ fontSize: 13 }} />
          </button>
          <button
            onClick={() => handleDeleteRoi(info.row.original)}
            className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded transition flex items-center justify-center"
            title="Delete Zone"
          >
            <FaTrash size={12} />
          </button>
        </div>
      ),
    }),
  ];

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div>
          <h2 className="text-xl font-bold text-[#fce4e4]">
            🛡️ Fence Management
          </h2>
          <span className="text-xs text-white/80">
            Configured intrusion fence zones on live streams
          </span>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <Select
            value={cameraFilter}
            onChange={(val) => setCameraFilter(val)}
            style={{ minWidth: 180 }}
            className="text-sm"
            placeholder="Filter by Camera"
          >
            <Option value="all">All Cameras</Option>
            {cameras.map((c) => (
              <Option key={c.id} value={String(c.id)}>
                {c.name || `Camera ${c.id}`}
              </Option>
            ))}
          </Select>

          <button
            onClick={() => fetchRois()}
            className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow hover:bg-white/10"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-[#9864db] text-[#E6E6FA]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {{
                      asc: " 🔼",
                      desc: " 🔽",
                    }[header.column.getIsSorted()] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-purple-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center">
                  <Spin spinning />
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-purple-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 border border-purple-100 whitespace-nowrap"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center">
                  <Empty
                    description={
                      <span className="text-gray-500">
                        No fence configurations found. Go to <b>Live Stream</b> → click the 🛡️ fence icon on any camera to draw intrusion zones.
                      </span>
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fence Preview Modal */}
      <FencePreviewModal
        open={!!selectedFence}
        onClose={() => setSelectedFence(null)}
        fence={selectedFence}
      />

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default Fencing;
