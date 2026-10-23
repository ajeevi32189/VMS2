import React, { useState, useEffect } from "react";
import { Input, Select, Spin, message } from "antd";
import { useDraggable } from "@dnd-kit/core";
import { useAuth } from "../../../Authentication/AuthContext";
import { deviceApi } from "../../../utils/axiosInstance";

const { Option } = Select;

const CameraItem = ({ cam, layout }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: cam.id, data: { cam } });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
        minWidth: layout === "top" ? 130 : undefined,
      }}
      className={`rounded-lg border border-purple-100 bg-white px-2 py-1.5 text-left cursor-grab hover:bg-purple-50 hover:border-purple-300 transition-colors ${
        layout === "top" ? "flex-shrink-0" : "w-full"
      }`}
    >
      <div className="font-medium text-gray-800 truncate" style={{ fontSize: "11px" }}>
        {cam.name}
      </div>
      <div className="text-gray-400 truncate mt-0.5" style={{ fontSize: "10px" }}>
        {cam.zone_name || "No Zone"} • {cam.location_name || "No Loc"}
      </div>
    </div>
  );
};

const CameraSidebar = ({ stoppedCams = [], gridCams = [], layout = "side", onClose }) => {
  const [search, setSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  const topLayout = layout === "top";
  const { user } = useAuth();
  const userId = user?.userId;

  useEffect(() => {
    const fetchZones = async () => {
      try {
        let all = [], page = 1, hasMore = true;
        while (hasMore) {
          const res = await deviceApi.get(`/Zone/?userid=${userId}&page=${page}&page_size=100`);
          const data = res.data;
          if (data.results?.length > 0) { all = [...all, ...data.results]; hasMore = !!data.next; page++; }
          else hasMore = false;
        }
        setZones(all);
      } catch (err) { console.error("Error fetching zones:", err); }
    };
    fetchZones();
  }, [userId]);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        let all = [], page = 1, hasMore = true;
        while (hasMore) {
          const res = await deviceApi.get(`/Location/?userid=${userId}&page=${page}&page_size=100`);
          const data = res.data;
          if (data.results?.length > 0) { all = [...all, ...data.results]; hasMore = !!data.next; page++; }
          else hasMore = false;
        }
        setLocations(all);
      } catch (err) { console.error("Error fetching locations:", err); }
    };
    fetchLocations();
  }, [userId]);

  useEffect(() => {
    const fetchCameras = async () => {
      if (!userId || zones.length === 0 || locations.length === 0) return;
      setLoading(true);
      try {
        let all = [], page = 1, hasMore = true;
        const params = new URLSearchParams({ userid: userId, page_size: 100 });
        if (selectedZone) params.append("zone", selectedZone);
        if (selectedLocation) params.append("location", selectedLocation);
        while (hasMore) {
          params.set("page", page);
          const res = await deviceApi.get(`/Camera/?${params.toString()}`);
          const data = res.data;
          if (data.results?.length > 0) {
            const enriched = data.results.map((cam) => ({
              ...cam,
              zone_name: zones.find((z) => z.id === cam.zone)?.name || cam.zone_name,
              location_name: locations.find((l) => l.id === cam.location)?.name || cam.location_name,
            }));
            all = [...all, ...enriched]; hasMore = !!data.next; page++;
          } else hasMore = false;
        }
        setCameras(all);
      } catch (err) {
        console.error("Error fetching cameras:", err);
        message.error("Failed to load cameras");
      } finally { setLoading(false); }
    };
    fetchCameras();
  }, [userId, selectedZone, selectedLocation, zones, locations]);

  const uniqueZones = [...new Map(zones.map((z) => [z.id, z])).values()];
  const filteredLocations = selectedZone
    ? locations.filter((loc) => cameras.some((cam) => cam.zone === selectedZone && cam.location === loc.id))
    : locations;
  const uniqueLocations = [...new Map(filteredLocations.map((l) => [l.id, l])).values()];

  const filteredCameras = cameras.filter((c) => {
    const matchesSearch = c.name?.toLowerCase().includes(search.toLowerCase());
    const isStopped = stoppedCams.includes(c.id);
    return matchesSearch && !isStopped;
  });

  if (topLayout) {
    return (
      <div className="w-full bg-transparent p-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-purple-700">Cameras</span>
          <Input.Search placeholder="Search" allowClear onChange={(e) => setSearch(e.target.value)} style={{ width: 160 }} size="small" />
          <Select allowClear placeholder="Zone" value={selectedZone} onChange={setSelectedZone} size="small" style={{ width: 100 }}>
            {uniqueZones.map((z) => <Option key={z.id} value={z.id}>{z.name}</Option>)}
          </Select>
          <Select allowClear placeholder="Location" value={selectedLocation} onChange={setSelectedLocation} size="small" style={{ width: 100 }}>
            {uniqueLocations.map((l) => <Option key={l.id} value={l.id}>{l.name}</Option>)}
          </Select>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {loading ? <Spin size="small" /> : filteredCameras.map((cam) => <CameraItem key={cam.id} cam={cam} layout="top" />)}
        </div>
      </div>
    );
  }

  // ── SIDE LAYOUT ──
  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-white">

      {/* Header row: label + close button */}
      <div className="flex items-center justify-between px-2 pt-2 pb-1 flex-shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-purple-700">Cameras</span>
          <span className="text-gray-400" style={{ fontSize: "10px" }}>· drag to grid</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-500 text-gray-400 transition"
            title="Close panel"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-2 pb-1 flex-shrink-0">
        <Input.Search
          placeholder="Search camera"
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          style={{ width: "100%", fontSize: "11px" }}
        />
      </div>

      {/* Zone + Location stacked */}
      <div className="px-2 pb-1 flex flex-col gap-1 flex-shrink-0">
        <Select
          allowClear placeholder="Zone" value={selectedZone} onChange={setSelectedZone}
          size="small" style={{ width: "100%", fontSize: "11px" }}
        >
          {uniqueZones.map((z) => <Option key={z.id} value={z.id} style={{ fontSize: "11px" }}>{z.name}</Option>)}
        </Select>
        <Select
          allowClear placeholder="Location" value={selectedLocation} onChange={setSelectedLocation}
          size="small" style={{ width: "100%", fontSize: "11px" }}
        >
          {uniqueLocations.map((l) => <Option key={l.id} value={l.id} style={{ fontSize: "11px" }}>{l.name}</Option>)}
        </Select>
      </div>

      {/* Camera list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {loading ? (
          <div className="flex justify-center items-center mt-4"><Spin size="small" /></div>
        ) : filteredCameras.length > 0 ? (
          filteredCameras.map((cam) => <CameraItem key={cam.id} cam={cam} layout="side" />)
        ) : (
          <div className="text-gray-400 text-center mt-4" style={{ fontSize: "11px" }}>No cameras found</div>
        )}
      </div>
    </div>
  );
};

export { CameraSidebar };