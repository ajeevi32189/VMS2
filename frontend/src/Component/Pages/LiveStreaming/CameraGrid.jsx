import React, { useRef, useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Button, Space, Tooltip } from "antd";
import { 
  CloseOutlined, 
  CameraOutlined, 
  VideoCameraAddOutlined, 
  VideoCameraOutlined, 
  FullscreenOutlined, 
  FullscreenExitOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  UpOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  HomeOutlined,
  MinusOutlined,
  PlusOutlined,
  AudioOutlined,
  AudioMutedOutlined
} from "@ant-design/icons";
import Hls from "hls.js";
import axios from "axios";
import Cookies from "js-cookie";
import { message } from "antd";
import { STREAMING_API_URL, GO2RTC_URL, RECORDING_API_URL } from "../../../config";
import { deviceApi } from "../../../utils/axiosInstance";
import AjeeviLogo from "../../../assets/ajeevi_logo.png";
import FenceDrawer from "./FenceDrawer";
/* =========================
   HLS VIDEO PLAYER
========================= */
const HlsVideoPlayer = ({ cam }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
    }
  }, []); // Only set initial state on mount

  useEffect(() => {
    const video = videoRef.current;

    // 🔥 IF CAM REMOVED → FORCE STOP VIDEO
    if (!cam) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.src = "";
      }
      return;
    }

    const hlsUrl = `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(cam.id)}&mp4`;

    setError(false);
    setLoading(true);

    // 🔥 destroy old stream
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        lowLatencyMode: true,
        liveSyncDurationCount: 3, // Increased to prevent racing the live edge (fixes 404s)
        liveMaxLatencyDurationCount: 5,
        maxBufferLength: 10,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => { });
      });

      hlsRef.current = hls;

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }
  }, [cam]);

  return (
    <div className="relative w-full h-full bg-black">
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-400 text-xs">Connecting...</span>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted={isMuted}
        playsInline
        className="w-full h-full object-fill bg-black"
      />

      {/* Audio Controls */}
      <div 
        className="absolute bottom-2 left-2 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-auto"
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { 
            e.preventDefault(); 
            e.stopPropagation(); 
            const newMuted = !isMuted;
            setIsMuted(newMuted);
            if (videoRef.current) {
              videoRef.current.muted = newMuted;
              if (!newMuted) {
                videoRef.current.play().catch(err => console.warn("Audio play error", err));
              }
            }
          }}
          className="text-white/80 hover:text-white focus:outline-none flex items-center justify-center transition-colors"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <AudioMutedOutlined className="text-red-400 text-base" /> : <AudioOutlined className="text-green-400 text-base" />}
        </button>
        <div className="w-16 md:w-24 flex items-center">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              e.stopPropagation();
              const val = parseFloat(e.target.value);
              setVolume(val);
              if (videoRef.current) {
                videoRef.current.volume = val;
                if (val > 0) {
                  setIsMuted(false);
                  videoRef.current.muted = false;
                  videoRef.current.play().catch(() => {});
                } else {
                  setIsMuted(true);
                  videoRef.current.muted = true;
                }
              }
            }}
            className="w-full h-1.5 bg-gray-500 rounded-lg cursor-pointer accent-purple-500"
          />
        </div>
      </div>
    </div>
  );
};

/* =========================
   GRID CELL
========================= */
const GridCell = ({ index, cam, onRemove, showPtzToast, gridSize = 2 }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });
  const cellContainerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fenceDrawerOpen, setFenceDrawerOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Responsive sizing based on grid dimension
  const isSmall = gridSize >= 4 && !isFullscreen;
  const isMedium = gridSize === 3 && !isFullscreen;

  // Sync fullscreen state
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === cellContainerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!cam) return;
    if (!document.fullscreenElement) {
      cellContainerRef.current?.requestFullscreen().catch(err => {
        console.error("Failed to enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch(err => {
        console.error("Failed to exit fullscreen:", err);
      });
    }
  };

  // Digital PTZ State (100% Client-Side for instant high-performance control)
  const [ptz, setPtz] = useState({ zoom: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });

  // Reset PTZ when camera source changes
  useEffect(() => {
    setPtz({ zoom: 1, x: 0, y: 0 });
  }, [cam?.id]);

  const getPanBounds = (zoomLevel) => {
    const w = cellContainerRef.current?.clientWidth || 640;
    const h = cellContainerRef.current?.clientHeight || 360;
    return {
      maxX: Math.max(0, ((zoomLevel - 1) * w) / 2),
      maxY: Math.max(0, ((zoomLevel - 1) * h) / 2),
    };
  };

  const handlePanClick = (direction) => {
    setPtz(prev => {
      let currentZoom = prev.zoom;
      let nextX = prev.x;
      let nextY = prev.y;

      if (currentZoom === 1) {
        // First click from unzoomed state: Auto-zoom to 1.5x AND pan to that direction immediately!
        currentZoom = 1.5;
        const { maxX, maxY } = getPanBounds(currentZoom);

        if (direction === "UP") nextY = maxY * 0.75;
        if (direction === "DOWN") nextY = -maxY * 0.75;
        if (direction === "LEFT") nextX = maxX * 0.75;
        if (direction === "RIGHT") nextX = -maxX * 0.75;

        showPtzToast?.(`PTZ: Pan ${direction} (${currentZoom.toFixed(1)}x)`);
        return { zoom: currentZoom, x: nextX, y: nextY };
      }

      // Already zoomed: continue panning smoothly with step
      const { maxX, maxY } = getPanBounds(currentZoom);
      const step = isFullscreen ? 80 : isSmall ? 25 : 50;

      if (direction === "UP") nextY = Math.min(maxY, nextY + step);
      if (direction === "DOWN") nextY = Math.max(-maxY, nextY - step);
      if (direction === "LEFT") nextX = Math.min(maxX, nextX + step);
      if (direction === "RIGHT") nextX = Math.max(-maxX, nextX - step);

      showPtzToast?.(`PTZ: Pan ${direction} (${currentZoom.toFixed(1)}x)`);
      return { zoom: currentZoom, x: nextX, y: nextY };
    });
  };

  const handleZoomClick = (delta) => {
    setPtz(prev => {
      let nextZoom = Math.min(Math.max(1, prev.zoom + delta), 4.5);
      nextZoom = Math.round(nextZoom * 10) / 10;
      if (nextZoom === 1) {
        showPtzToast?.("PTZ: Reset (1.0x)");
        return { zoom: 1, x: 0, y: 0 };
      }
      const { maxX, maxY } = getPanBounds(nextZoom);
      showPtzToast?.(`PTZ: Zoom ${nextZoom.toFixed(1)}x`);
      return {
        zoom: nextZoom,
        x: Math.max(-maxX, Math.min(maxX, prev.x)),
        y: Math.max(-maxY, Math.min(maxY, prev.y))
      };
    });
  };
  const handleHomeClick = () => {
    setPtz({ zoom: 1, x: 0, y: 0 });
    showPtzToast?.("PTZ: Home Position (1.0x)");
  };

  const handlePreset = (num) => {
    const presetConfig = {
      1: { zoom: 1.8, xRatio: 0.65, yRatio: 0.65, label: "Preset 1: Top-Left Focus" },
      2: { zoom: 2.4, xRatio: 0, yRatio: 0, label: "Preset 2: Center Focus (2.4x)" },
      3: { zoom: 1.8, xRatio: -0.65, yRatio: -0.65, label: "Preset 3: Bottom-Right Focus" },
    };
    const p = presetConfig[num];
    if (!p) return;
    const { maxX, maxY } = getPanBounds(p.zoom);
    setPtz({
      zoom: p.zoom,
      x: maxX * p.xRatio,
      y: maxY * p.yRatio,
    });
    showPtzToast?.(p.label);
  };

  // Drag to pan when zoomed
  const handleMouseDown = (e) => {
    if (ptz.zoom <= 1 || e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: ptz.x,
      origY: ptz.y,
    };

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragStartRef.current.startX;
      const dy = moveEvent.clientY - dragStartRef.current.startY;
      const { maxX, maxY } = getPanBounds(ptz.zoom);

      setPtz(prev => ({
        ...prev,
        x: Math.max(-maxX, Math.min(maxX, dragStartRef.current.origX + dx)),
        y: Math.max(-maxY, Math.min(maxY, dragStartRef.current.origY + dy))
      }));
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    if (!cam) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    setPtz(prev => {
      let nextZoom = Math.min(Math.max(1, prev.zoom + delta), 4.5);
      nextZoom = Math.round(nextZoom * 10) / 10;
      if (nextZoom === 1) {
        return { zoom: 1, x: 0, y: 0 };
      }
      const { maxX, maxY } = getPanBounds(nextZoom);
      return {
        zoom: nextZoom,
        x: Math.max(-maxX, Math.min(maxX, prev.x)),
        y: Math.max(-maxY, Math.min(maxY, prev.y))
      };
    });
  };

  const handleSnapshot = async () => {
    try {
      const res = await fetch(`${STREAMING_API_URL}/snapshot/${cam.id}`, {
        method: "GET",
        cache: "no-store",
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `camera_${cam.name}_snapshot.jpg`;
      a.click();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Snapshot error:", err);
    }
  };

  const [togglingRec, setTogglingRec] = useState(false);
  const [isRecording, setIsRecording] = useState(!!cam?.isRecording);
  const [fps, setFps] = useState(null);
  const [latency, setLatency] = useState(null);

  useEffect(() => {
    setIsRecording(!!cam?.isRecording);
  }, [cam]);

  useEffect(() => {
    if (!cam) {
      setFps(null);
      return;
    }
    let mounted = true;
    const fetchStats = async () => {
      try {
        const res = await fetch(`${STREAMING_API_URL}/camera-stats/${cam.id}`);
        if (res.ok) {
          const data = await res.json();
          if (mounted) {
            setFps(data.hardware_fps);
            setLatency(data.latency);
          }
        }
      } catch {
        // ignore
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [cam]);

  const toggleRecording = async () => {
    if (!cam) return;
    setTogglingRec(true);
    const start = !isRecording;

    try {
      // 1. Update Database Status
      const payload = {
        ...cam,
        isRecording: start ? 1 : 0,
        userid: String(Cookies.get("userId")),
      };
      await deviceApi.put(`/Camera/${cam.id}/`, payload);

      // 2. Call Sidecar Recording API
      const endpoint = start
        ? `${RECORDING_API_URL}/api/v1/record/start/${cam.name}?rtsp_url=${encodeURIComponent(cam.rtspurl)}`
        : `${RECORDING_API_URL}/api/v1/record/stop/${cam.name}`;

      await axios.post(endpoint);

      setIsRecording(start);
      message.success(`${start ? "Started" : "Stopped"} recording for ${cam.name}`);
    } catch (err) {
      console.error("Grid recording toggle error:", err);
      message.error("Failed to toggle recording");
    } finally {
      setTogglingRec(false);
    }
  };

  // Assign both refs to the top div
  const attachRefs = (el) => {
    setNodeRef(el);
    cellContainerRef.current = el;
  };

  return (
    <div
      ref={attachRefs}
      className={`relative group overflow-hidden border border-gray-700 bg-black flex items-center justify-center w-full h-full transition-all select-none ${isOver ? "ring-2 ring-purple-500" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={(e) => {
        if (e.detail > 1) {
          e.preventDefault(); // Prevents blue text selection on double click
        }
      }}
    >
      {cam ? (
        <>
          <div className="relative w-full h-full select-none overflow-hidden">
            {/* Interactive Overlay: Double-click to fullscreen (or reset PTZ if zoomed), Drag to pan, Wheel to zoom */}
            <div
              className={`absolute inset-0 z-10 select-none ${
                ptz.zoom > 1
                  ? isDragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "cursor-pointer"
              }`}
              onDoubleClick={() => {
                if (ptz.zoom > 1) {
                  handleHomeClick();
                } else {
                  toggleFullscreen();
                }
              }}
              onMouseDown={handleMouseDown}
              onWheel={handleWheel}
            />

            {/* Transform Container applying Digital PTZ */}
            <div
              className="w-full h-full origin-center select-none"
              style={{
                transform: `translate(${ptz.x}px, ${ptz.y}px) scale(${ptz.zoom})`,
                transition: isDragging ? "none" : "transform 0.22s cubic-bezier(0.2, 0, 0, 1)",
                willChange: "transform",
              }}
            >
              <HlsVideoPlayer key={cam?.id} cam={cam} />
            </div>
          </div>

          {/* Sleek Top Header Bar */}
          <div className={`absolute top-0 left-0 right-0 z-30 bg-gradient-to-b from-black/70 via-black/25 to-transparent backdrop-blur-[1px] text-white ${isSmall ? "text-[10px] p-1.5" : "text-[11px] p-2"} flex justify-between items-start pointer-events-none`}>
            <div className="flex flex-col select-none truncate max-w-[45%]">
              <span className="font-bold tracking-wide drop-shadow-md truncate">{cam.name}</span>
              {!isSmall && <span className="text-[9px] opacity-90 drop-shadow-md">Live Stream</span>}
            </div>

            <Space size={isSmall ? 1 : 4} className="pointer-events-auto">
              <Tooltip title={isFullscreen ? "Exit Full Screen" : "Full Screen"}>
                <Button size="small" type="text" className="flex items-center justify-center border-none hover:bg-white/20 text-white p-1"
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={toggleFullscreen} />
              </Tooltip>
              <Tooltip title={isRecording ? "Stop Recording" : "Start Recording"}>
                <Button size="small" type="text"
                  className={`flex items-center justify-center border-none hover:bg-white/20 text-white p-1 ${isRecording ? "text-red-500 animate-pulse" : ""}`}
                  icon={isRecording ? <VideoCameraOutlined /> : <VideoCameraAddOutlined />}
                  onClick={toggleRecording} loading={togglingRec} />
              </Tooltip>
              <Tooltip title="Snapshot">
                <Button size="small" type="text" className="flex items-center justify-center border-none hover:bg-white/20 text-white p-1"
                  icon={<CameraOutlined />}
                  onClick={handleSnapshot} />
              </Tooltip>

              {/* 🛡️ FENCE DRAWING BUTTON */}
              <Tooltip title="Draw Intrusion Fence">
                <Button
                  size="small"
                  type="text"
                  className="flex items-center justify-center border-none hover:bg-purple-500/50 text-white p-1"
                  onClick={() => {
                    if (document.fullscreenElement) {
                      document.exitFullscreen().catch(err => console.error(err));
                    }
                    setFenceDrawerOpen(true);
                  }}
                >
                  🛡️
                </Button>
              </Tooltip>

              <Tooltip title="Remove">
                <Button size="small" type="text" className="flex items-center justify-center border-none hover:bg-red-500/50 text-white p-1"
                  icon={<CloseOutlined />}
                  onClick={onRemove} />
              </Tooltip>
            </Space>
          </div>

          {/* ePTZ Active Indicator Badge (Minimal & Sleek) */}
          {ptz.zoom > 1 && (
            <div className={`absolute z-20 bg-black/60 border border-purple-500/40 backdrop-blur-md rounded-full text-purple-300 font-mono font-medium select-none flex items-center gap-1 shadow-lg ${
              isSmall ? "top-7 left-1 px-1.5 py-0.5 text-[8px]" : "top-10 left-2.5 px-2.5 py-0.5 text-[10px]"
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
              <span>ePTZ {ptz.zoom.toFixed(1)}x</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleHomeClick(); }}
                className="text-white/60 hover:text-white underline ml-0.5 cursor-pointer font-sans"
              >
                Reset
              </button>
            </div>
          )}

          {fps !== null && (
            <div className={`absolute ${isSmall ? "bottom-1 right-1 px-1.5 py-0.5 text-[9px]" : "bottom-2 right-2 px-2.5 py-0.5 text-[11px]"} z-20 bg-black/50 backdrop-blur-sm rounded-md text-green-400 font-mono font-medium select-none pointer-events-none flex items-center gap-1`}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              {fps} FPS {latency ? `| ${latency}` : ""}
            </div>
          )}

          {/* PTZ Seamless HUD Overlay (Scaled proportionally for 4x4, 3x3, 2x2 and Fullscreen) */}
          <div
            className={`absolute top-0 right-0 bottom-0 z-20 flex flex-col items-center justify-center bg-gradient-to-l from-black/45 via-black/15 to-transparent transition-opacity duration-300 overflow-y-auto [&::-webkit-scrollbar]:hidden ${
              isSmall ? "w-[4.6rem] px-1 py-1" : isMedium ? "w-[5.8rem] px-1.5 py-2" : "w-[7.5rem] px-2.5 py-4"
            } ${
              isHovered || ptz.zoom > 1 ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* CP-Plus Inspired Circular D-Pad */}
            <div className={`relative rounded-full bg-gradient-to-br from-gray-800/90 to-gray-950/95 border border-white/15 shadow-2xl flex items-center justify-center shrink-0 backdrop-blur-sm ${
              isSmall ? "w-[3.2rem] h-[3.2rem] mb-1" : isMedium ? "w-[4.2rem] h-[4.2rem] mb-2" : "w-[5.5rem] h-[5.5rem] mb-3.5"
            }`}>
              {/* Inner ring */}
              <div className="absolute inset-1 rounded-full border border-gray-600/40 pointer-events-none" />

              {/* Up */}
              <button
                className="absolute top-0.5 left-1/2 -translate-x-1/2 text-white/60 hover:text-white hover:scale-125 active:scale-95 transition-all p-0.5"
                onClick={() => handlePanClick("UP")}
                title="Pan Up"
              >
                <UpOutlined className={`${isSmall ? "text-[8px]" : isMedium ? "text-[10px]" : "text-[12px]"} block`} />
              </button>

              {/* Down */}
              <button
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-white/60 hover:text-white hover:scale-125 active:scale-95 transition-all p-0.5"
                onClick={() => handlePanClick("DOWN")}
                title="Pan Down"
              >
                <DownOutlined className={`${isSmall ? "text-[8px]" : isMedium ? "text-[10px]" : "text-[12px]"} block`} />
              </button>

              {/* Left */}
              <button
                className="absolute left-0.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white hover:scale-125 active:scale-95 transition-all p-0.5"
                onClick={() => handlePanClick("LEFT")}
                title="Pan Left"
              >
                <LeftOutlined className={`${isSmall ? "text-[8px]" : isMedium ? "text-[10px]" : "text-[12px]"} block`} />
              </button>

              {/* Right */}
              <button
                className="absolute right-0.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white hover:scale-125 active:scale-95 transition-all p-0.5"
                onClick={() => handlePanClick("RIGHT")}
                title="Pan Right"
              >
                <RightOutlined className={`${isSmall ? "text-[8px]" : isMedium ? "text-[10px]" : "text-[12px]"} block`} />
              </button>

              {/* Center / Home */}
              <button
                className={`relative z-10 rounded-full border flex items-center justify-center transition-all ${
                  isSmall ? "w-3.5 h-3.5" : isMedium ? "w-5.5 h-5.5" : "w-7 h-7"
                } ${
                  ptz.zoom > 1
                    ? "bg-purple-600 border-purple-400 text-white shadow-[0_0_8px_rgba(168,85,247,0.6)] active:scale-90"
                    : "bg-gradient-to-b from-gray-600 to-gray-800 border-gray-500 text-white/80 hover:text-white active:scale-90"
                }`}
                onClick={handleHomeClick}
                title="Reset to 1.0x (Home)"
              >
                <HomeOutlined className={isSmall ? "text-[7.5px]" : isMedium ? "text-[10px]" : "text-[13px]"} />
              </button>
            </div>

            {/* Zoom Controls */}
            <div className={`flex items-center justify-between w-full bg-gray-950/80 backdrop-blur-sm rounded-full border border-white/10 shadow-xl shrink-0 ${
              isSmall ? "py-0.5 px-1 mb-1" : isMedium ? "py-0.5 px-1.5 mb-2" : "py-1 px-1.5 mb-3"
            }`}>
              <button
                className={`flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 active:scale-90 transition-all disabled:opacity-20 ${
                  isSmall ? "w-3.5 h-3.5" : isMedium ? "w-5 h-5" : "w-6 h-6"
                }`}
                onClick={() => handleZoomClick(-0.4)}
                disabled={ptz.zoom <= 1}
                title="Zoom Out"
              >
                <MinusOutlined className={isSmall ? "text-[7.5px]" : isMedium ? "text-[9px]" : "text-[11px]"} />
              </button>

              <span className={`text-purple-300 font-mono font-bold tracking-wider select-none ${
                isSmall ? "text-[7px]" : isMedium ? "text-[8.5px]" : "text-[10px]"
              }`}>
                {ptz.zoom > 1 ? `${ptz.zoom.toFixed(1)}x` : "1.0x"}
              </span>

              <button
                className={`flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 active:scale-90 transition-all disabled:opacity-20 ${
                  isSmall ? "w-3.5 h-3.5" : isMedium ? "w-5 h-5" : "w-6 h-6"
                }`}
                onClick={() => handleZoomClick(0.4)}
                disabled={ptz.zoom >= 4.5}
                title="Zoom In"
              >
                <PlusOutlined className={isSmall ? "text-[7.5px]" : isMedium ? "text-[9px]" : "text-[11px]"} />
              </button>
            </div>

            {/* Presets */}
            <div className={`flex flex-col w-full bg-gray-950/80 backdrop-blur-sm border border-white/10 shadow-xl shrink-0 ${
              isSmall ? "p-1 rounded-md" : isMedium ? "p-1.5 rounded-lg" : "p-2 rounded-xl"
            }`}>
              <span className={`text-white/40 uppercase font-bold text-center tracking-widest select-none ${
                isSmall ? "text-[6px] mb-0.5" : isMedium ? "text-[7.5px] mb-1" : "text-[8px] mb-1.5"
              }`}>Presets</span>
              <div className="flex justify-between gap-1">
                <button
                  className={`flex-1 bg-gray-800/80 hover:bg-purple-600/70 active:scale-95 text-white/90 rounded border border-white/10 transition-all font-semibold ${
                    isSmall ? "text-[7.5px] py-0.5" : isMedium ? "text-[8.5px] py-0.5" : "text-[10px] py-1"
                  }`}
                  onClick={() => handlePreset(1)}
                  title="Preset 1: Top-Left Focus"
                >
                  1
                </button>
                <button
                  className={`flex-1 bg-gray-800/80 hover:bg-purple-600/70 active:scale-95 text-white/90 rounded border border-white/10 transition-all font-semibold ${
                    isSmall ? "text-[7.5px] py-0.5" : isMedium ? "text-[8.5px] py-0.5" : "text-[10px] py-1"
                  }`}
                  onClick={() => handlePreset(2)}
                  title="Preset 2: Center Focus (2.4x)"
                >
                  2
                </button>
                <button
                  className={`flex-1 bg-gray-800/80 hover:bg-purple-600/70 active:scale-95 text-white/90 rounded border border-white/10 transition-all font-semibold ${
                    isSmall ? "text-[7.5px] py-0.5" : isMedium ? "text-[8.5px] py-0.5" : "text-[10px] py-1"
                  }`}
                  onClick={() => handlePreset(3)}
                  title="Preset 3: Bottom-Right Focus"
                >
                  3
                </button>
              </div>
            </div>
          </div>

          {/* Fence Drawer Modal */}
          <FenceDrawer
            open={fenceDrawerOpen}
            onClose={() => setFenceDrawerOpen(false)}
            cam={cam}
          />
        </>

      ) : (
        <img
          src={AjeeviLogo}
          alt="Ajeevi"
          className="h-10 w-auto opacity-40 select-none"
        />
      )}
    </div>
  );
};

/* =========================
   GRID LAYOUT
========================= */
const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

const CameraGrid = ({ gridSize, gridCams, onRemove }) => {
  const [toastMessage, setToastMessage] = useState(null);

  const showPtzToast = (msg) => {
    setToastMessage(msg);
    if (window.ptzToastTimeout) clearTimeout(window.ptzToastTimeout);
    window.ptzToastTimeout = setTimeout(() => {
      setToastMessage(null);
    }, 1500);
  };

  return (
    <div
      className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-full bg-black relative`}
    >
      {Array.from({ length: gridSize * gridSize }).map((_, i) => (
        <GridCell
          key={i}
          index={i}
          cam={gridCams[i]}
          onRemove={() => onRemove(i)}
          showPtzToast={showPtzToast}
          gridSize={gridSize}
        />
      ))}
      
      {/* Global PTZ Toast */}
      {toastMessage && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-gray-900/95 text-white px-5 py-2 rounded shadow-2xl z-[9999] text-[13px] font-medium tracking-wide pointer-events-none border border-gray-700 backdrop-blur-sm transition-all duration-300 transform scale-100 opacity-100">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default CameraGrid;




///////////////////


// import React, { useState } from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// import { CameraOutlined } from "@ant-design/icons";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";

// /* =========================
// GRID CELL
// ========================= */
// const GridCell = ({ index, cam, onZoom, onRemove, onRefresh }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   const [playerKey, setPlayerKey] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);

//   // m3u8 ready hone ka wait (HEAD polling)
//   const waitForStreamReady = async (cameraId) => {
//     const maxAttempts = 5; // max ~10 sec
//     const delayMs = 1000;

//     for (let i = 0; i < maxAttempts; i++) {
//       try {
//         const res = await fetch(`${STREAMING_API_URL}/view/${cameraId}`, {
//           method: "HEAD",
//           cache: "no-store",
//         });

//         if (res.ok) {
//           return true;
//         }
//       } catch (e) {
//         // ignore error, retry
//       }

//       await new Promise((r) => setTimeout(r, delayMs));
//     }

//     return false;
//   };

//   const handleSnapshot = async () => {
//     try {
//       const res = await fetch(`${STREAMING_API_URL}/snapshot/${cam.id}`, {
//         method: "GET",
//         cache: "no-store",
//       });

//       if (!res.ok) {
//         throw new Error("Snapshot failed");
//       }

//       const blob = await res.blob();
//       const url = window.URL.createObjectURL(blob);

//       const a = document.createElement("a");
//       a.href = url;
//       a.download = `camera_${cam.id}_snapshot.jpg`;
//       document.body.appendChild(a);
//       a.click();

//       document.body.removeChild(a);
//       window.URL.revokeObjectURL(url);
//     } catch (err) {
//       console.error("Snapshot error:", err);
//     }
//   };

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           {/* CLICK OVERLAY */}
//           <div className="relative w-full h-full">
//             {/* DOUBLE CLICK OVERLAY */}
//             <div
//               className="absolute inset-0 z-10 cursor-pointer"
//               onDoubleClick={() => onZoom(cam)}
//             />

//             {/* VIDEO */}
//             <iframe
//               key={`${cam.id}-${playerKey}`}
//               src={`${STREAMING_API_URL}/view/${cam.id}`}
//               className="w-full h-full border-0 relative z-0"
//               allow="autoplay; fullscreen"
//               loading="lazy"
//               title={`Camera feed - ${cam.name}`}
//             />
//           </div>

//           {/* Bottom Controls */}
//           <div className="absolute bottom-0 left-0 right-0 z-20 bg-purple-700 bg-opacity-70 text-white text-sm p-1 flex justify-between items-center">
//             <span className="truncate">{cam.name}</span>

//             <Space>
//               {/* SNAPSHOT BUTTON */}
//               <Tooltip title="Take Snapshot">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CameraOutlined />}
//                   onClick={handleSnapshot}
//                 />
//               </Tooltip>

//               {/* Removed Zoom Button - Using only double click */}
//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// /* =========================
// GRID LAYOUT
// ========================= */
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({
//   gridSize,
//   gridCams,
//   onZoom,
//   onRemove,
//   onRefresh,
//   gridRef,
// }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={i} // Stable key by grid position
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//         onRefresh={onRefresh} // New prop for parent sync
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);



/////////////////////////

// import React, { useState } from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// // import HlsPlayer from "react-hls-player";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";

// /* =========================
// GRID CELL
// ========================= */
// const GridCell = ({ index, cam, onZoom, onRemove, onRefresh }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   const [playerKey, setPlayerKey] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);

//   // m3u8 ready hone ka wait (HEAD polling)
//   const waitForStreamReady = async (cameraId) => {
//     const maxAttempts = 5; // max ~10 sec
//     const delayMs = 1000;

//     for (let i = 0; i < maxAttempts; i++) {
//       try {
//         const res = await fetch(`${STREAMING_API_URL}/view/${cameraId}`, {
//           method: "HEAD",
//           cache: "no-store",
//         });

//         if (res.ok) {
//           return true;
//         }
//       } catch (e) {
//         // ignore error, retry
//       }

//       await new Promise((r) => setTimeout(r, delayMs));
//     }

//     return false;
//   };

//   // const handleRefresh = async () => {
//   //   if (!cam || refreshing) return;

//   //   try {
//   //     setRefreshing(true);

//   //     // 1️⃣ DELETE camera
//   //     await fetch(`${STREAMING_API_URL}/stop/${cam.id}`, {
//   //       method: "DELETE",
//   //     });

//   //     // 2️⃣ ADD camera again
//   //     await fetch(`${STREAMING_API_URL}/Streaming/add_camera`, {
//   //       method: "POST",
//   //       headers: { "Content-Type": "application/json" },
//   //       body: JSON.stringify({
//   //         cameraId: cam.id,
//   //         rtspUrl: cam.rtspurl,
//   //         name: cam.name,
//   //         channelId: cam.channelId,
//   //         port: cam.port,
//   //         nvrId: cam.nvrId,
//   //         creditId: 0,
//   //       }),
//   //     });

//   //     // 3️⃣ Wait until HLS playlist is really ready
//   //     const ready = await waitForStreamReady(cam.id);

//   //     if (ready) {
//   //       setPlayerKey((prev) => prev + 1);
//   //       // Notify parent to keep same cam at same index
//   //       onRefresh?.(index, cam);
//   //     } else {
//   //       console.warn("Stream not ready in time for camera", cam.id);
//   //     }
//   //   } catch (error) {
//   //     console.error("Camera refresh failed", error);
//   //   } finally {
//   //     setRefreshing(false);
//   //   }
//   // };

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           <iframe
//             key={`${cam.id}-${playerKey}`}
//             src={`${STREAMING_API_URL}/view/${cam.id}`}
//             width="100%"
//             height="100%"
//             className="w-full h-full border-0 cursor-pointer"
//             allow="autoplay; fullscreen"
//             loading="lazy"
//             onDoubleClick={() => onZoom(cam)} // ✅ DOUBLE CLICK ZOOM
//           />

//           {/* Bottom Controls */}
//           <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-1 flex justify-between items-center">
//             <span className="truncate">{cam.name}</span>

//             <Space>
//               <Tooltip title="Zoom">
//                 <Button
//                   type="primary"
//                   size="small"
//                   shape="circle"
//                   icon={<ZoomInOutlined />}
//                   onClick={() => onZoom(cam)}
//                 />
//               </Tooltip>

//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// /* =========================
// GRID LAYOUT
// ========================= */
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({
//   gridSize,
//   gridCams,
//   onZoom,
//   onRemove,
//   onRefresh,
//   gridRef,
// }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={i} // Stable key by grid position
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//         onRefresh={onRefresh} // New prop for parent sync
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);

//////////////////////

// import React, { useState } from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// import HlsPlayer from "react-hls-player";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";

// /* =========================
// GRID CELL
// ========================= */
// const GridCell = ({ index, cam, onZoom, onRemove, onRefresh }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   const [playerKey, setPlayerKey] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);

//   // m3u8 ready hone ka wait (HEAD polling)
//   const waitForStreamReady = async (cameraId) => {
//     const maxAttempts = 5; // max ~10 sec
//     const delayMs = 1000;

//     for (let i = 0; i < maxAttempts; i++) {
//       try {
//         const res = await fetch(
//           `${STREAMING_API_URL}/Streaming/stream/${cameraId}/stream.m3u8`,
//           { method: "HEAD", cache: "no-store" }
//         );

//         if (res.ok) {
//           return true;
//         }
//       } catch (e) {
//         // ignore error, retry
//       }

//       await new Promise((r) => setTimeout(r, delayMs));
//     }

//     return false;
//   };

//   const handleRefresh = async () => {
//     if (!cam || refreshing) return;

//     try {
//       setRefreshing(true);

//       // 1️⃣ DELETE camera
//       await fetch(`${STREAMING_API_URL}/stop/${cam.id}`, {
//         method: "DELETE",
//       });

//       // 2️⃣ ADD camera again
//       await fetch(`${STREAMING_API_URL}/Streaming/add_camera`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           cameraId: cam.id,
//           rtspUrl: cam.rtspurl,
//           name: cam.name,
//           channelId: cam.channelId,
//           port: cam.port,
//           nvrId: cam.nvrId,
//           creditId: 0,
//         }),
//       });

//       // 3️⃣ Wait until HLS playlist is really ready
//       const ready = await waitForStreamReady(cam.id);

//       if (ready) {
//         setPlayerKey((prev) => prev + 1);
//         // Notify parent to keep same cam at same index
//         onRefresh?.(index, cam);
//       } else {
//         console.warn("Stream not ready in time for camera", cam.id);
//       }
//     } catch (error) {
//       console.error("Camera refresh failed", error);
//     } finally {
//       setRefreshing(false);
//     }
//   };

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           <HlsPlayer
//             key={`${cam.id}-${playerKey}`}  // Only this remounts, same cam.id
//             src={`${STREAMING_API_URL}/Streaming/stream/${cam.id}/stream.m3u8`}
//             autoPlay
//             muted
//             playsInline
//             width="100%"
//             height="100%"
//             className="object-cover w-full h-full"
//             hlsConfig={{
//               lowLatencyMode: true,
//               liveSyncDurationCount: 1,
//               liveMaxLatencyDurationCount: 3,
//               liveBackBufferLength: 0,
//               maxBufferLength: 2,
//               maxMaxBufferLength: 4,
//             }}
//           />

//           {/* Bottom Controls */}
//           <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-1 flex justify-between items-center">
//             <span className="truncate">{cam.name}</span>

//             <Space>
//               <Tooltip title="Refresh">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<ReloadOutlined spin={refreshing} />}
//                   loading={refreshing}
//                   disabled={refreshing}
//                   onClick={handleRefresh}
//                 />
//               </Tooltip>

//               <Tooltip title="Zoom">
//                 <Button
//                   type="primary"
//                   size="small"
//                   shape="circle"
//                   icon={<ZoomInOutlined />}
//                   onClick={() => onZoom(cam)}
//                 />
//               </Tooltip>

//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// /* =========================
// GRID LAYOUT
// ========================= */
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({ gridSize, gridCams, onZoom, onRemove, onRefresh, gridRef }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={i}  // Stable key by grid position
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//         onRefresh={onRefresh}  // New prop for parent sync
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);

//////////////////////

// import React, { useState } from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// import HlsPlayer from "react-hls-player";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";

// /* =========================
//    GRID CELL
// ========================= */
// const GridCell = ({ index, cam, onZoom, onRemove }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   const [playerKey, setPlayerKey] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);

//   // m3u8 ready hone ka wait (HEAD polling)
//   const waitForStreamReady = async (cameraId) => {
//     const maxAttempts = 5; // max ~10 sec
//     const delayMs = 1000;

//     for (let i = 0; i < maxAttempts; i++) {
//       try {
//         const res = await fetch(
//           `${STREAMING_API_URL}/Streaming/stream/${cameraId}/stream.m3u8`,
//           { method: "HEAD", cache: "no-store" }
//         );

//         if (res.ok) {
//           return true;
//         }
//       } catch (e) {
//         // ignore error, retry
//       }

//       await new Promise((r) => setTimeout(r, delayMs));
//     }

//     return false;
//   };

//   const handleRefresh = async () => {
//     if (!cam || refreshing) return;

//     try {
//       setRefreshing(true);

//       // 1️⃣ DELETE camera
//       await fetch(`${STREAMING_API_URL}/stop/${cam.id}`, {
//         method: "DELETE",
//       });

//       // 2️⃣ ADD camera again
//       await fetch(`${STREAMING_API_URL}/Streaming/add_camera`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           cameraId: cam.id,
//           rtspUrl: cam.rtspurl,
//           name: cam.name,
//           channelId: cam.channelId,
//           port: cam.port,
//           nvrId: cam.nvrId,
//           creditId: 0,
//         }),
//       });

//       // 3️⃣ Wait until HLS playlist is really ready
//       const ready = await waitForStreamReady(cam.id);

//       if (ready) {
//         setPlayerKey((prev) => prev + 1);
//       } else {
//         console.warn("Stream not ready in time for camera", cam.id);
//       }
//     } catch (error) {
//       console.error("Camera refresh failed", error);
//     } finally {
//       setRefreshing(false);
//     }
//   };

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           <HlsPlayer
//             key={`${cam.id}-${playerKey}`}
//             src={`${STREAMING_API_URL}/Streaming/stream/${cam.id}/stream.m3u8`}
//             autoPlay
//             muted
//             playsInline
//             width="100%"
//             height="100%"
//             className="object-cover w-full h-full"
//             hlsConfig={{
//               // low latency friendly config
//               lowLatencyMode: true,
//               liveSyncDurationCount: 1, // latest ke kareeb
//               liveMaxLatencyDurationCount: 3,
//               liveBackBufferLength: 0,
//               maxBufferLength: 2,
//               maxMaxBufferLength: 4,
//             }}
//           />

//           {/* Bottom Controls */}
//           <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-1 flex justify-between items-center">
//             <span className="truncate">{cam.name}</span>

//             <Space>
//               <Tooltip title="Refresh">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<ReloadOutlined spin={refreshing} />}
//                   loading={refreshing}
//                   disabled={refreshing}
//                   onClick={handleRefresh}
//                 />
//               </Tooltip>

//               <Tooltip title="Zoom">
//                 <Button
//                   type="primary"
//                   size="small"
//                   shape="circle"
//                   icon={<ZoomInOutlined />}
//                   onClick={() => onZoom(cam)}
//                 />
//               </Tooltip>

//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// /* =========================
//    GRID LAYOUT
// ========================= */
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({ gridSize, gridCams, onZoom, onRemove, gridRef }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={cam?.id || i}
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);

/////////////

// import React, { useState } from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// import HlsPlayer from "react-hls-player";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";

// /* =========================
//    GRID CELL
// ========================= */
// const GridCell = ({ index, cam, onZoom, onRemove }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   const [playerKey, setPlayerKey] = useState(0);
//   const [refreshing, setRefreshing] = useState(false);

//   const handleRefresh = async () => {
//     if (!cam || refreshing) return;

//     try {
//       setRefreshing(true);

//       // 1️⃣ DELETE camera
//       await fetch(
//         `${STREAMING_API_URL}/stop/${cam.id}`,
//         { method: "DELETE" }
//       );

//       // 2️⃣ ADD camera again (USING DATA FROM /Camera API)
//       await fetch(`${STREAMING_API_URL}/Streaming/add_camera`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           cameraId: cam.id,
//           rtspUrl: cam.rtspurl, // ✅ FIXED
//           name: cam.name,
//           channelId: cam.channelId,
//           port: cam.port,
//           nvrId: cam.nvrId,
//           creditId: 0,
//         }),
//       });

//       // 3️⃣ Reload HLS player after backend generates stream
//       setTimeout(() => {
//         setPlayerKey((prev) => prev + 1);
//         setRefreshing(false);
//       }, 3000);
//     } catch (error) {
//       console.error("Camera refresh failed", error);
//       setRefreshing(false);
//     }
//   };

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           <HlsPlayer
//             key={`${cam.id}-${playerKey}`}
//             src={`${STREAMING_API_URL}/Streaming/stream/${cam.id}/stream.m3u8`}
//             autoPlay
//             muted
//             playsInline
//             width="100%"
//             height="100%"
//             className="object-cover w-full h-full"
//           />

//           {/* Bottom Controls */}
//           <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-1 flex justify-between items-center">
//             <span className="truncate">{cam.name}</span>

//             <Space>
//               <Tooltip title="Refresh">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<ReloadOutlined spin={refreshing} />}
//                   loading={refreshing}
//                   disabled={refreshing}
//                   onClick={handleRefresh}
//                 />
//               </Tooltip>

//               <Tooltip title="Zoom">
//                 <Button
//                   type="primary"
//                   size="small"
//                   shape="circle"
//                   icon={<ZoomInOutlined />}
//                   onClick={() => onZoom(cam)}
//                 />
//               </Tooltip>

//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// /* =========================
//    GRID LAYOUT
// ========================= */
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({
//   gridSize,
//   gridCams,
//   onZoom,
//   onRemove,
//   gridRef,
// }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={cam?.id || i}
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);

/////////////////////////////

// import React from "react";
// import { useDroppable } from "@dnd-kit/core";
// import { Button, Space, Tooltip } from "antd";
// import {
//   ZoomInOutlined,
//   CloseOutlined,
//   ReloadOutlined,
// } from "@ant-design/icons";
// import HlsPlayer from "react-hls-player";
// import { STREAMING_API_URL } from "../../../config";
// import AjeeviLogo from "../../../assets/ajeevi_logo.png";
// const GridCell = ({ index, cam, onZoom, onRemove, refreshKey }) => {
//   const { setNodeRef, isOver } = useDroppable({ id: `cell-${index}` });

//   return (
//     <div
//       ref={setNodeRef}
//       className={`relative rounded-sm overflow-hidden border border-gray-700 bg-gray-800 flex items-center justify-center w-full h-full ${
//         isOver ? "ring-2 ring-purple-500" : ""
//       }`}
//     >
//       {cam ? (
//         <>
//           <HlsPlayer
//             src={`${STREAMING_API_URL}/Streaming/stream/${cam.id}/stream.m3u8`}
//             autoPlay
//             muted
//             playsInline
//             width="100%"
//             height="100%"
//             key={`${cam.id}-${refreshKey}`}
//             className="object-cover w-full h-full"
//           />
//           <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-0.5 flex justify-between items-center">
//             {/* <div className="absolute bottom-0 left-0 right-0 bg-purple-700 bg-opacity-70 text-white text-sm p-2 flex justify-between items-center opacity-0 hover:opacity-100 transition-opacity"> */}
//             <span>{cam.name}</span>
//             <Space>
//               <Tooltip title="Refresh">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<ReloadOutlined />}
//                   onClick={() => onRefresh(cam)} // refresh handler
//                 />
//               </Tooltip>
//               <Tooltip title="Zoom">
//                 <Button
//                   type="primary"
//                   size="small"
//                   shape="circle"
//                   icon={<ZoomInOutlined />}
//                   onClick={() => onZoom(cam)}
//                 />
//               </Tooltip>
//               <Tooltip title="Remove">
//                 <Button
//                   size="small"
//                   shape="circle"
//                   icon={<CloseOutlined />}
//                   onClick={onRemove}
//                 />
//               </Tooltip>
//             </Space>
//           </div>
//         </>
//       ) : (
//         // <span className="text-gray-400 text-xs">Ajeevi Technologies Pvt. Ltd.</span>
//         <span className="inline-flex items-center">
//           <img
//             src={AjeeviLogo}
//             alt="Ajeevi Technologies Pvt. Ltd."
//             className="h-10 w-auto"
//           />
//         </span>
//       )}
//     </div>
//   );
// };

// // Define grid columns dynamically
// const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
// const gridRows = { 2: "grid-rows-2", 3: "grid-rows-3", 4: "grid-rows-4" };

// const CameraGrid = ({
//   gridSize,
//   gridCams,
//   onZoom,
//   onRemove,
//   refreshKey,
//   gridRef,
// }) => (
//   <div
//     ref={gridRef}
//     className={`grid ${gridCols[gridSize]} ${gridRows[gridSize]} gap-0 h-[calc(100vh-130px)]`}
//   >
//     {gridCams.slice(0, gridSize * gridSize).map((cam, i) => (
//       <GridCell
//         key={i}
//         index={i}
//         cam={cam}
//         onZoom={onZoom}
//         onRemove={() => onRemove(i)}
//         refreshKey={refreshKey}
//       />
//     ))}
//   </div>
// );

// export default React.memo(CameraGrid);
