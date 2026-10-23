import React, { useState, useRef, useEffect, useCallback } from "react";
import { Modal, Input, message } from "antd";
import axios from "axios";
import { ROI_API_URL, GO2RTC_URL, STREAMING_API_URL } from "../../../config";

const LEVEL_COLORS = {
  1: { fill: "rgba(59,130,246,0.15)", stroke: "#3b82f6", label: "Low", tagBg: "#dbeafe", tagText: "#1e40af" },
  2: { fill: "rgba(249,115,22,0.15)", stroke: "#f97316", label: "Medium", tagBg: "#ffedd5", tagText: "#9a3412" },
  3: { fill: "rgba(239,68,68,0.15)", stroke: "#ef4444", label: "High", tagBg: "#fee2e2", tagText: "#991b1b" },
};

// Helper to extract ONVIF profile stream name from any candidate string or object
const extractOnvifProfile = (target) => {
  if (!target) return null;
  const candidates = [
    target?.camera_name,
    target?.name,
    target?.cameraIP,
    target?.rtspurl,
    target?.stream_name,
    target?.description,
    typeof target === "string" ? target : null,
  ];
  for (const cand of candidates) {
    if (!cand) continue;
    const match = String(cand).match(/(MediaProfile_[^/\?\s,]+)/i);
    if (match) return match[1];
  }
  return null;
};

// Comprehensive check to determine if an ROI belongs to the target camera
const doesRoiBelongToCamera = (roi, cam) => {
  if (!roi || !cam) return false;

  const roiCamId = String(roi.camera_id || "").trim();
  const roiCamName = String(roi.camera_name || "").trim().toLowerCase();
  const roiName = String(roi.name || "").trim().toLowerCase();
  const roiDesc = String(roi.description || "").trim().toLowerCase();

  const camId = String(cam?.id || "").trim();
  const camName = String(cam?.name || "").trim().toLowerCase();
  const camStream = String(cam?.stream_name || "").trim().toLowerCase();

  // 1. Direct ID / string match
  if (camId && (roiCamId === camId || roiCamName === camId.toLowerCase())) return true;
  if (camName && (roiCamId.toLowerCase() === camName || roiCamName === camName || roiName === camName)) return true;
  if (camStream && (roiCamId.toLowerCase() === camStream || roiCamName === camStream)) return true;

  // 2. ONVIF profile match (e.g. MediaProfile_Channel4_MainStream)
  const camProfile = extractOnvifProfile(cam);
  const roiProfile = extractOnvifProfile(roi);
  if (camProfile && roiProfile && camProfile.toLowerCase() === roiProfile.toLowerCase()) return true;
  if (camProfile && (roiCamId.toLowerCase().includes(camProfile.toLowerCase()) || roiName.includes(camProfile.toLowerCase()))) return true;

  // 3. Channel number match (e.g. Channel 4, MediaProfile_Channel4)
  const extractChannel = (obj) => {
    const str = `${obj?.channelId || ""} ${obj?.channel_id || ""} ${obj?.name || ""} ${obj?.camera_name || ""} ${obj?.camera_id || ""} ${obj?.rtspurl || ""}`;
    const m = str.match(/channel[_\s-]?(\d+)/i) || str.match(/camera[_\s-]?(\d+)/i);
    return m ? m[1] : null;
  };

  const camCh = extractChannel(cam);
  const roiCh = extractChannel(roi);
  if (camCh && roiCh && String(camCh) === String(roiCh)) return true;

  return false;
};

const FenceDrawer = ({ open, onClose, cam, onSaved }) => {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [level, setLevel] = useState(null); // null = picking level, 1/2/3 = drawing
  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null);
  const [currentPt, setCurrentPt] = useState(null);
  const [sections, setSections] = useState([]);
  const [fenceName, setFenceName] = useState("");
  const [fenceDesc, setFenceDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [existingFence, setExistingFence] = useState(null);
  const [pendingRawSections, setPendingRawSections] = useState([]);

  // Load snapshot and any existing fence configurations when modal opens
  useEffect(() => {
    if (!open || !cam) {
      setLevel(null);
      setSections([]);
      setFenceName("");
      setFenceDesc("");
      setSnapshotUrl(null);
      setImgLoaded(false);
      setExistingFence(null);
      setPendingRawSections([]);
      return;
    }

    let isMounted = true;

    const loadData = async () => {
      // 1. Snapshot
      try {
        const res = await fetch(`${STREAMING_API_URL}/snapshot/${cam.id}`, {
          method: "GET",
          cache: "no-store",
        });
        if (res.ok && isMounted) {
          const blob = await res.blob();
          setSnapshotUrl(URL.createObjectURL(blob));
        }
      } catch (err) {
        console.error("Failed to load snapshot:", err);
      }

      // 2. Existing fence from backend
      try {
        const roiRes = await axios.get(`${ROI_API_URL}/api/v1/rois`);
        const allRois = Array.isArray(roiRes.data)
          ? roiRes.data
          : (roiRes.data?.data || roiRes.data?.rois || []);

        const matched = allRois.filter((r) => doesRoiBelongToCamera(r, cam));
        if (matched.length > 0 && isMounted) {
          // Sort by section count / date to pick the most up-to-date
          matched.sort((a, b) => {
            const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
            const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
            return timeB - timeA || (b.sections?.length || 0) - (a.sections?.length || 0);
          });
          const best = matched[0];
          setExistingFence(best);
          setFenceName(best.name || `Fence_${cam.name || cam.id}`);
          setFenceDesc(best.description || "");
          setPendingRawSections(Array.isArray(best.sections) ? best.sections : []);
        } else if (isMounted) {
          setExistingFence(null);
          setPendingRawSections([]);
          setFenceName(`Fence_${cam.name || cam.id}`);
        }
      } catch (err) {
        console.warn("Failed to check existing fence for camera:", err);
        if (isMounted) {
          setFenceName(`Fence_${cam.name || cam.id}`);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [open, cam]);

  // Once snapshot image dimensions are available, restore any existing fence zones to canvas
  useEffect(() => {
    if (!imgLoaded || !pendingRawSections.length) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const sourceW = img.naturalWidth || img.width || 640;
    const sourceH = img.naturalHeight || img.height || 480;
    const unscaleX = sourceW / 640;
    const unscaleY = sourceH / 480;

    const restored = pendingRawSections.map((sec, idx) => {
      const bb = sec.bounding_box || {};
      const tl = bb.top_left || { x: 0, y: 0 };
      const tr = bb.top_right || { x: 0, y: 0 };
      const br = bb.bottom_right || { x: 0, y: 0 };
      const bl = bb.bottom_left || { x: 0, y: 0 };

      // Detect if saved coordinates were full resolution (e.g. 1920x1080) vs normalized 640x480
      const isAlreadyHighRes = tl.x > 640 || tl.y > 480 || tr.x > 640 || br.y > 480;
      const factorX = isAlreadyHighRes ? (sourceW / 1920) : unscaleX;
      const factorY = isAlreadyHighRes ? (sourceH / 1080) : unscaleY;

      return {
        section_level: Number(sec.section_level) || 1,
        label: sec.label || `${LEVEL_COLORS[sec.section_level || 1]?.label || "Zone"} ${idx + 1}`,
        bounding_box: {
          top_left: { x: Math.round(tl.x * factorX), y: Math.round(tl.y * factorY) },
          top_right: { x: Math.round(tr.x * factorX), y: Math.round(tr.y * factorY) },
          bottom_right: { x: Math.round(br.x * factorX), y: Math.round(br.y * factorY) },
          bottom_left: { x: Math.round(bl.x * factorX), y: Math.round(bl.y * factorY) },
        },
      };
    });

    setSections(restored);
  }, [imgLoaded, pendingRawSections]);

  // Draw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const ctx = canvas.getContext("2d");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw existing sections
    sections.forEach((sec) => {
      const c = LEVEL_COLORS[sec.section_level];
      const bb = sec.bounding_box;
      const x = bb.top_left.x;
      const y = bb.top_left.y;
      const w = bb.top_right.x - bb.top_left.x;
      const h = bb.bottom_left.y - bb.top_left.y;

      ctx.fillStyle = c.fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = c.stroke;
      ctx.font = "bold 14px Inter, sans-serif";
      ctx.fillText(`${c.label} — ${sec.label}`, x + 4, y - 6);
    });

    // Draw current drawing rect
    if (drawing && startPt && currentPt && level) {
      const c = LEVEL_COLORS[level];
      const x = Math.min(startPt.x, currentPt.x);
      const y = Math.min(startPt.y, currentPt.y);
      const w = Math.abs(currentPt.x - startPt.x);
      const h = Math.abs(currentPt.y - startPt.y);

      ctx.fillStyle = c.fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Show dimensions
      ctx.fillStyle = "white";
      ctx.font = "12px monospace";
      ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y + h - 6);
    }
  }, [sections, drawing, startPt, currentPt, level, imgLoaded]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Get mouse position relative to canvas (scaled)
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e) => {
    if (!level) return;
    const pos = getCanvasPos(e);
    setStartPt(pos);
    setCurrentPt(pos);
    setDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    setCurrentPt(getCanvasPos(e));
  };

  const handleMouseUp = () => {
    if (!drawing || !startPt || !currentPt || !level) return;
    setDrawing(false);

    const x1 = Math.min(startPt.x, currentPt.x);
    const y1 = Math.min(startPt.y, currentPt.y);
    const x2 = Math.max(startPt.x, currentPt.x);
    const y2 = Math.max(startPt.y, currentPt.y);

    // Minimum size check
    if (Math.abs(x2 - x1) < 20 || Math.abs(y2 - y1) < 20) {
      setStartPt(null);
      setCurrentPt(null);
      return;
    }

    const newSection = {
      section_level: level,
      bounding_box: {
        top_left: { x: x1, y: y1 },
        top_right: { x: x2, y: y1 },
        bottom_right: { x: x2, y: y2 },
        bottom_left: { x: x1, y: y2 },
      },
      label: `${LEVEL_COLORS[level].label} Zone ${sections.filter((s) => s.section_level === level).length + 1}`,
    };

    setSections((prev) => [...prev, newSection]);
    setStartPt(null);
    setCurrentPt(null);
    // Stay in same level for multiple draws
  };

  const removeLastSection = () => {
    setSections((prev) => prev.slice(0, -1));
  };

  // POST to ROI API
  const handleSave = async () => {
    if (!sections.length) return message.warning("Draw at least one fence zone!");
    if (!fenceName.trim()) return message.warning("Enter a fence name!");

    setSaving(true);
    try {
      // Backend AI script resizes all frames to exactly 640x480 before processing.
      // We must scale our snapshot coordinates to match this resolution.
      const canvas = canvasRef.current;
      const img = imgRef.current;
      const sourceW = img?.naturalWidth || canvas.width;
      const sourceH = img?.naturalHeight || canvas.height;
      const scaleX = 640 / sourceW;
      const scaleY = 480 / sourceH;

      console.log(`[FenceDrawer] Scaling: ${sourceW}x${sourceH} → 640x480 | scaleX=${scaleX.toFixed(4)}, scaleY=${scaleY.toFixed(4)}`);

      const mappedSections = sections.map((sec) => {
        const tl = {
          x: Math.round(sec.bounding_box.top_left.x * scaleX),
          y: Math.round(sec.bounding_box.top_left.y * scaleY),
        };
        const tr = {
          x: Math.round(sec.bounding_box.top_right.x * scaleX),
          y: Math.round(sec.bounding_box.top_right.y * scaleY),
        };
        const br = {
          x: Math.round(sec.bounding_box.bottom_right.x * scaleX),
          y: Math.round(sec.bounding_box.bottom_right.y * scaleY),
        };
        const bl = {
          x: Math.round(sec.bounding_box.bottom_left.x * scaleX),
          y: Math.round(sec.bounding_box.bottom_left.y * scaleY),
        };

        return {
          ...sec,
          // Sending the old format just in case the FastAPI strictly expects it
          bounding_box: {
            top_left: tl,
            top_right: tr,
            bottom_right: br,
            bottom_left: bl,
          },
          // Sending the NEW format that the Python script ACTUALLY reads
          coordinates: [
            { corner: "top-left", x: tl.x, y: tl.y },
            { corner: "top-right", x: tr.x, y: tr.y },
            { corner: "bottom-right", x: br.x, y: br.y },
            { corner: "bottom-left", x: bl.x, y: bl.y }
          ]
        };
      });

      const isIpAddress = (str) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(str).trim());
      const onvifName = (cam?.cameraIP && !isIpAddress(cam.cameraIP) && cam.cameraIP !== "N/A") ? cam.cameraIP : (cam?.name || `Camera ${cam.id}`);

      const payload = {
        name: fenceName.trim(),
        description: fenceDesc.trim() || `Fence for ${cam.name}`,
        camera_id: String(cam.id),
        camera_name: onvifName,
        sections: mappedSections,
      };

      // Find and delete ALL old/duplicate copies for this camera before saving to prevent duplicates
      try {
        const fetchRes = await axios.get(`${ROI_API_URL}/api/v1/rois`);
        const allRois = Array.isArray(fetchRes.data)
          ? fetchRes.data
          : (fetchRes.data?.data || fetchRes.data?.rois || []);

        const oldFences = allRois.filter((r) => doesRoiBelongToCamera(r, cam));
        console.log(`[FenceDrawer] Found ${oldFences.length} old fence entries to purge for this camera:`, oldFences);

        // Collect all possible keys that might exist for this camera in backend
        const keysToDelete = new Set();
        oldFences.forEach((old) => {
          if (old.camera_id) keysToDelete.add(String(old.camera_id).trim());
          if (old.id) keysToDelete.add(String(old.id).trim());
        });
        if (cam?.id) keysToDelete.add(String(cam.id).trim());
        const camProfile = extractOnvifProfile(cam);
        if (camProfile) keysToDelete.add(camProfile);
        if (onvifName && onvifName !== "N/A") keysToDelete.add(onvifName);

        // Delete all old copies from backend
        for (const key of keysToDelete) {
          if (!key) continue;
          try {
            await axios.delete(`${ROI_API_URL}/api/v1/rois/${encodeURIComponent(key)}`);
          } catch (_) {
            // Ignore if already deleted or 404
          }
        }
      } catch (err) {
        console.warn("Could not check/clean old fences:", err);
      }

      // Save the fresh fence
      await axios.post(`${ROI_API_URL}/api/v1/rois`, payload);
      message.success(existingFence ? "Fence updated successfully! ✅" : "Fence saved successfully! ✅");
      if (typeof onSaved === "function") {
        onSaved();
      }
      onClose();
    } catch (err) {
      console.error("Failed to save fence:", err);
      message.error("Failed to save fence: " + (err?.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={960}
      title={null}
      footer={null}
      destroyOnClose
      centered
      closeIcon={<span className="text-gray-300 hover:text-white text-xl bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center">✕</span>}
      bodyStyle={{ padding: 0, background: "#1a1a2e" }}
      className="overflow-hidden rounded-lg"
    >
      <div className="p-4">
        {/* Title Bar */}
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-lg font-bold text-white">
              🛡️ {existingFence ? "Update Intrusion Fence" : "Draw Intrusion Fence"} — <span className="text-purple-300">{cam?.name}</span>
            </h3>
            <p className="text-xs text-gray-400">
              {existingFence
                ? `Editing existing configured fence (${sections.length} zones loaded). Adjust or draw new rectangle → Save`
                : "Select priority level → Draw rectangle on camera feed → Save"}
            </p>
          </div>
        </div>

        {/* Level Selector */}
        <div className="flex gap-2 mb-3">
          {[1, 2, 3].map((lvl) => {
            const c = LEVEL_COLORS[lvl];
            return (
              <button
                key={lvl}
                onClick={() => setLevel(lvl)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${level === lvl
                    ? "ring-2 ring-white scale-105 shadow-lg"
                    : "opacity-70 hover:opacity-100"
                  }`}
                style={{
                  backgroundColor: c.tagBg,
                  color: c.tagText,
                  border: `2px solid ${c.stroke}`,
                }}
              >
                {c.label} Priority
              </button>
            );
          })}

          <div className="flex-1" />

          {sections.length > 0 && (
            <button
              onClick={removeLastSection}
              className="px-3 py-2 rounded-lg bg-gray-700 text-white text-sm hover:bg-gray-600"
            >
              ↩ Undo Last
            </button>
          )}
        </div>

        {/* Status bar */}
        {level && (
          <div
            className="mb-2 px-3 py-1.5 rounded text-sm font-medium"
            style={{
              backgroundColor: LEVEL_COLORS[level].tagBg,
              color: LEVEL_COLORS[level].tagText,
            }}
          >
            Drawing mode: <b>{LEVEL_COLORS[level].label}</b> priority — Click and drag to draw fence zone
          </div>
        )}
        {!level && (
          <div className="mb-2 px-3 py-1.5 rounded text-sm font-medium bg-gray-700 text-gray-300">
            👆 Select a priority level above to start drawing
          </div>
        )}

        {/* Canvas Area */}
        <div className="relative bg-black rounded-lg overflow-hidden" style={{ maxHeight: "60vh" }}>
          {snapshotUrl && (
            <img
              ref={imgRef}
              src={snapshotUrl}
              alt="Camera Feed"
              className="hidden"
              onLoad={() => setImgLoaded(true)}
            />
          )}
          <canvas
            ref={canvasRef}
            className="w-full cursor-crosshair"
            style={{ display: imgLoaded ? "block" : "none" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              if (drawing) handleMouseUp();
            }}
          />
          {!imgLoaded && (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Loading camera snapshot...
              </div>
            </div>
          )}
        </div>

        {/* Drawn sections summary */}
        {sections.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {sections.map((sec, idx) => {
              const c = LEVEL_COLORS[sec.section_level];
              return (
                <div
                  key={idx}
                  className="px-2 py-1 rounded text-xs font-medium"
                  style={{ backgroundColor: c.tagBg, color: c.tagText, border: `1px solid ${c.stroke}` }}
                >
                  {sec.label}
                </div>
              );
            })}
          </div>
        )}

        {/* Name & Description */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Fence Name</label>
            <Input
              value={fenceName}
              onChange={(e) => setFenceName(e.target.value)}
              placeholder="Enter fence name"
              className="bg-gray-800 border-gray-600 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description (Optional)</label>
            <Input
              value={fenceDesc}
              onChange={(e) => setFenceDesc(e.target.value)}
              placeholder="Optional description"
              className="bg-gray-800 border-gray-600 text-white"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => { setSections([]); setLevel(null); }}
            className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm hover:bg-gray-600"
          >
            Clear All
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-600 text-white text-sm hover:bg-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || sections.length === 0}
            className="px-6 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : `💾 ${existingFence ? "Update Fence" : "Save Fence"} (${sections.length} zones)`}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default FenceDrawer;
