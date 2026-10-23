import React, { useEffect, useRef, useState } from "react";
import { Modal, Spin } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import Hls from "hls.js";
import { STREAMING_API_URL, GO2RTC_URL } from "../../../../config";

const CameraModal = ({ open, onClose, camera }) => {
  const videoRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const hlsUrl = camera
    ? `${GO2RTC_URL}/api/stream.m3u8?src=${encodeURIComponent(`${camera.id}`)}&mp4`
    : null;

  useEffect(() => {
    if (hlsUrl && open) {
      const video = videoRef.current;
      setLoading(true);

      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
        hls.on(Hls.Events.ERROR, () => setLoading(false));

        return () => hls.destroy();
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        video.onloadedmetadata = () => setLoading(false);
      }
    }
  }, [hlsUrl, open]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      className="!p-0 !m-0 modal-custom"
      width={1000}
      styles={{
        body: { padding: 0, background: "transparent" },
        content: { background: "transparent", boxShadow: "none" },
        header: { display: "none" },
      }}
    >

      {camera ? (
        <div className="relative rounded-xl overflow-hidden shadow-lg border border-gray-900">
          {/* Header (floating on top of video) */}
          <div className="absolute top-0 left-0 w-full flex justify-between items-center px-4 py-2 bg-black/60 z-20">
            <span className="text-white font-semibold text-lg">
              {camera.name || "Live Camera"}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 hover:bg-red-500 hover:text-white transition"
            >
              <CloseOutlined />
            </button>
          </div>

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
              <Spin size="large" tip="Loading stream..." />
            </div>
          )}

          {/* Video fills all area */}
          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            className="w-full h-[550px] bg-black"
          />
        </div>
      ) : (
        <p className="text-center text-gray-500">No camera selected</p>
      )}
    </Modal>
  );
};

export default CameraModal;
