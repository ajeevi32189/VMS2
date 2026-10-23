import React, { useState, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from "@dnd-kit/core";

import { STREAMING_API_URL } from "../../../config";
import { CameraSidebar } from "./CameraSidebar";
import CameraGrid from "./CameraGrid";

/* =========================
   MAIN COMPONENT
========================= */
const LiveGrid = ({ isPanel = false, onClose }) => {
  const [stoppedCams, setStoppedCams] = useState(() =>
    JSON.parse(localStorage.getItem("stoppedCams") || "[]")
  );
  useEffect(() => {
    const sync = () => setStoppedCams(JSON.parse(localStorage.getItem("stoppedCams") || "[]"));
    window.addEventListener("stoppedCamsUpdated", sync);
    return () => window.removeEventListener("stoppedCamsUpdated", sync);
  }, []);
  useEffect(() => {
    localStorage.setItem("stoppedCams", JSON.stringify(stoppedCams));
  }, [stoppedCams]);

  const [gridSize, setGridSize] = useState(() =>
    Number(localStorage.getItem("gridSize")) || 2
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCameraPanelOpen, setIsCameraPanelOpen] = useState(true);
  const [gridCams, setGridCams] = useState(() => {
    const saved = localStorage.getItem("gridCams");
    return saved ? JSON.parse(saved) : Array(16).fill(null);
  });
  const [activeCam, setActiveCam] = useState(null);
  const fullscreenRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    localStorage.setItem("gridCams", JSON.stringify(gridCams));
  }, [gridCams]);

  // Fullscreen sync
  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      window.dispatchEvent(new CustomEvent("liveFullscreenChange", { detail: fs }));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Listen for Header events (only on full live page)
  useEffect(() => {
    if (isPanel) return;

    const onToggleFs = () => {
      if (!document.fullscreenElement) fullscreenRef.current?.requestFullscreen();
      else document.exitFullscreen?.();
    };
    const onSetGridSize = (e) => {
      setGridSize(e.detail);
      localStorage.setItem("gridSize", e.detail);
    };
    // When Header loads a saved view — reload gridCams from localStorage
    const onGridCamsUpdated = () => {
      const saved = localStorage.getItem("gridCams");
      if (saved) setGridCams(JSON.parse(saved));
      const size = Number(localStorage.getItem("gridSize"));
      if (size) setGridSize(size);
    };

    window.addEventListener("liveToggleFullscreen", onToggleFs);
    window.addEventListener("liveSetGridSize", onSetGridSize);
    window.addEventListener("gridCamsUpdated", onGridCamsUpdated);
    return () => {
      window.removeEventListener("liveToggleFullscreen", onToggleFs);
      window.removeEventListener("liveSetGridSize", onSetGridSize);
      window.removeEventListener("gridCamsUpdated", onGridCamsUpdated);
    };
  }, [isPanel]);

  // Notify Header when gridSize changes
  useEffect(() => {
    if (!isPanel) {
      window.dispatchEvent(new CustomEvent("liveGridSizeChange", { detail: gridSize }));
    }
  }, [gridSize, isPanel]);

  const handleRemove = async (i) => {
    const cam = gridCams[i];
    if (!cam) return;
    try { await fetch(`${STREAMING_API_URL}/stop/${cam.id}`, { method: "DELETE" }); }
    catch (err) { console.error("Stop API failed:", err); }
    setStoppedCams((prev) => [...prev, cam.id]);
    const updated = [...gridCams];
    updated[i] = null;
    setGridCams(updated);
  };

  const onDragStart = (event) => setActiveCam(event.active.data.current.cam);
  const onDragEnd = async (event) => {
    if (event.over?.id.startsWith("cell-")) {
      const index = parseInt(event.over.id.split("-")[1], 10);
      const cam = event.active.data.current.cam;
      if (!cam) return;

      // 🚀 RESTORED: Tell Backend/Go2RTC to start the stream BEFORE showing it in the grid
      try {
        await fetch(`${STREAMING_API_URL}/add-camera`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraId: cam.id,
            rtspUrl: cam.rtspurl,
            name: cam.name,
            channelId: cam.channelId || 0,
            port: cam.port || 0,
            nvrId: cam.nvrId || 0,
            creditId: 0,
          }),
        });
      } catch (err) {
        console.error("Failed to add camera to streaming API:", err);
      }

      const updated = [...gridCams];
      updated[index] = cam;
      setGridCams(updated);
    }
    setActiveCam(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      collisionDetection={closestCenter}
    >
      <div ref={fullscreenRef} className="relative flex h-full w-full overflow-hidden bg-white">

        {/* ── LEFT: Slim Camera Sidebar (160px) ── */}
        {isCameraPanelOpen && (
          <div
            className="flex-shrink-0 border-r border-gray-200 h-full overflow-hidden bg-white"
            style={{ width: "160px" }}
          >
            <CameraSidebar
              stoppedCams={stoppedCams}
              gridCams={gridCams}
              layout="side"
              onClose={() => setIsCameraPanelOpen(false)}
            />
          </div>
        )}

        {/* Reopen tab when sidebar is closed */}
        {!isCameraPanelOpen && (
          <button
            className="absolute left-0 top-24 z-20 flex h-10 items-center justify-center rounded-r-full bg-purple-600 px-3 text-xs font-semibold text-white shadow-lg hover:bg-purple-700"
            onClick={() => setIsCameraPanelOpen(true)}
            title="Open camera panel"
          >
            Cameras
          </button>
        )}

        {/* ── RIGHT: Grid fills 100% remaining height ── */}
        <div className={`flex-1 min-w-0 h-full overflow-hidden ${isCameraPanelOpen ? "" : "w-full"}`}>
          <CameraGrid
            gridSize={gridSize}
            gridCams={gridCams}
            onRemove={handleRemove}
            gridRef={fullscreenRef}
          />
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeCam && (
          <div className="px-2 py-1 bg-black border border-purple-300 shadow-md rounded text-white" style={{ fontSize: "11px" }}>
            {activeCam.name}
          </div>
        )}
      </DragOverlay>

      {/* Copyright */}
      {!isPanel && (
        <div className="fixed bottom-2 right-4 text-xs font-bold pointer-events-none z-10">
          <span className="text-red-600">© Ajeevi</span>{" "}
          <span className="text-blue-600">Technologies Pvt. Ltd.</span>
        </div>
      )}
    </DndContext>
  );
};

export default LiveGrid;