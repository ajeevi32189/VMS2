import React, { useMemo, useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';
import { GO2RTC_URL, STREAMING_API_URL } from '../../config';
import { VideoCameraOutlined, ReloadOutlined } from '@ant-design/icons';

const HlsVideoPlayer = ({ cam }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const triedFallback = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!cam || !video) return;

    // 1. Ensure stream is active in Go2RTC / Streaming API
    if (STREAMING_API_URL && cam.rtspurl) {
      fetch(`${STREAMING_API_URL}/add-camera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: cam.id,
          rtspUrl: cam.rtspurl,
          name: cam.name,
          channelId: cam.channelId || 0,
          port: cam.port || 0,
          nvrId: cam.nvrId || 0,
          creditId: 0,
        }),
      }).catch(() => {
        // Safe ignore
      });
    }

    // 2. Primary stream URL uses cam.id (standard Go2RTC), fallback uses cam_{id}
    const primaryUrl = `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(cam.id)}&mp4`;
    const fallbackUrl = `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(`cam_${cam.id}`)}&mp4`;

    setLoading(true);
    setError(false);
    triedFallback.current = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        maxBufferLength: 10,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
      });

      hls.loadSource(primaryUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        setError(false);
        video.muted = true;
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!triedFallback.current) {
                triedFallback.current = true;
                hls.loadSource(fallbackUrl);
                hls.startLoad();
              } else {
                setError(true);
                setLoading(false);
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setError(true);
              setLoading(false);
              break;
          }
        }
      });

      hlsRef.current = hls;

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = primaryUrl;
      video.muted = true;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {});
      });
    }
  }, [cam]);

  const handleRetry = () => {
    setError(false);
    setLoading(true);
    triedFallback.current = false;
    if (hlsRef.current && cam) {
      const primaryUrl = `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(cam.id)}&mp4`;
      hlsRef.current.loadSource(primaryUrl);
      hlsRef.current.startLoad();
    }
  };

  return (
    <div className="relative w-full h-full bg-black">
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-400 text-[10px]">Connecting Stream...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/90 text-center p-2">
          <div className="flex flex-col items-center gap-1.5">
            <VideoCameraOutlined className="text-gray-500 text-lg" />
            <span className="text-gray-400 text-[10px]">Stream Offline</span>
            <button
              onClick={handleRetry}
              className="mt-1 px-2 py-0.5 bg-purple-700 hover:bg-purple-600 text-white rounded text-[10px] flex items-center gap-1 cursor-pointer transition"
            >
              <ReloadOutlined /> Retry
            </button>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-fill bg-black"
      />
    </div>
  );
};

const LiveViewGrid = ({ highlightedCameraId }) => {
  const { cameras = [], loading } = useDeviceInventory();

  // Pick up to 4 cameras for 2x2 grid; if a camera is focused from E-Map, prioritize it!
  const previewCameras = useMemo(() => {
    const all = cameras || [];
    if (all.length === 0) return [];

    const streaming = all.filter(
      (c) => c.isStreaming === 1 || c.isStreaming === true || c.isStreaming === '1'
    );
    const pool = streaming.length > 0 ? streaming : all;

    if (highlightedCameraId) {
      const target = all.find((c) => String(c.id) === String(highlightedCameraId));
      if (target) {
        const remaining = pool.filter((c) => String(c.id) !== String(highlightedCameraId));
        return [target, ...remaining].slice(0, 4);
      }
    }

    return pool.slice(0, 4);
  }, [cameras, highlightedCameraId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 w-full h-full p-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (previewCameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 w-full space-y-2 p-4">
        <VideoCameraOutlined className="text-3xl text-gray-600" />
        <span className="font-semibold text-sm">No Active Cameras Found</span>
        <span className="text-xs text-gray-400">Configure cameras in Device Management</span>
      </div>
    );
  }

  return (
    <div
      className={`grid gap-2 w-full h-full p-2 ${
        previewCameras.length === 1
          ? 'grid-cols-1'
          : previewCameras.length <= 2
          ? 'grid-cols-2'
          : 'grid-cols-2'
      }`}
    >
      {previewCameras.map((cam, i) => {
        const isHighlighted = highlightedCameraId && String(cam.id) === String(highlightedCameraId);

        return (
          <div
            key={cam.id || i}
            className={`bg-black rounded-lg flex flex-col justify-between relative overflow-hidden group transition-all ${
              isHighlighted
                ? 'ring-2 ring-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                : 'border border-gray-800'
            }`}
          >
            {/* Header Badge */}
            <div className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-1.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
              <span className="text-[11px] text-white px-1 font-semibold truncate drop-shadow-md">
                {cam.name || `Cam ${String(i + 1).padStart(2, '0')}`}
              </span>

              <div className="flex items-center gap-1.5">
                {isHighlighted && (
                  <span className="bg-purple-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow">
                    Focused
                  </span>
                )}
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]" />
              </div>
            </div>

            {/* Video Player */}
            <div className="w-full h-full flex items-center justify-center bg-gray-950 overflow-hidden">
              <HlsVideoPlayer cam={cam} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LiveViewGrid;
