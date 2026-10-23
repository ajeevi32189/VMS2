import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { deviceApi } from "../../../../utils/axiosInstance";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
import axios from "axios"; // ✅ needed for streaming API call
import { useAuth } from "../../../../Authentication/AuthContext";
import CameraModal from "./CameraModal";
import AnalyticsModal from "./AnalyticsModal";
import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";
import { formatIndianDateTime } from "../../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const CameraDetailsTable = () => {
  const { role, hasPermission } = useAuth();
  const canWrite = (role || "").toLowerCase() === "admin" || hasPermission("camera.write");

  const [rawCameras, setRawCameras] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [viewCamera, setViewCamera] = useState(null);
  const [loading, setLoading] = useState(false);

  const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [analyticsField, setAnalyticsField] = useState(null);
  const [analyticsValue, setAnalyticsValue] = useState(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);

  // Filter states
  const [statusFilter, setStatusFilter] = useState("all");
  const [featureFilter, setFeatureFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [nvrFilter, setNvrFilter] = useState("all");

  const [zones, setZones] = useState([]);
  const [nvrs, setNvrs] = useState([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [deletingId, setDeletingId] = useState(null);

  const navigate = useNavigate();
  const userId = Cookies.get("userId");

  // Fetch filter options
  useEffect(() => {
    const loadFilters = async () => {
      if (!userId) return;
      try {
        const [zoneRes, nvrRes] = await Promise.allSettled([
          deviceApi.get(`/Zone/?userid=${userId}&page=1&page_size=100`),
          deviceApi.get(`/NVR/?userid=${userId}&page=1&page_size=100`),
        ]);

        if (zoneRes.status === "fulfilled") {
          setZones(zoneRes.value.data.results || []);
        }
        if (nvrRes.status === "fulfilled") {
          setNvrs(nvrRes.value.data.results || []);
        }
      } catch (err) {
        console.error("Unexpected error:", err);
      }
    };

    loadFilters();
  }, [userId]);

  // Fetch All Cameras and enrich with stats & recording
  const fetchData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [camRes, recRes, statsRes] = await Promise.allSettled([
        deviceApi.get(`/Camera/?userid=${userId}&page=1&page_size=200`),
        axios.get(`${RECORDING_API_URL}/api/v1/cameras`),
        axios.get(`${STREAMING_API_URL}/all-camera-stats`)
      ]);

      if (camRes.status === "rejected") throw camRes.reason;

      let allCameras = camRes.value.data.results || [];
      let nextUrl = camRes.value.data.next;
      let pageNum = 2;

      while (nextUrl && pageNum <= 10) {
        try {
          const nextRes = await deviceApi.get(`/Camera/?userid=${userId}&page=${pageNum}&page_size=200`);
          const more = nextRes.data.results || [];
          allCameras = [...allCameras, ...more];
          nextUrl = nextRes.data.next;
          pageNum++;
        } catch {
          break;
        }
      }

      const actualRecs = recRes.status === "fulfilled" ? (recRes.value.data?.cameras || []) : [];
      const stats = statsRes.status === "fulfilled" ? (statsRes.value.data || []) : [];

      const enriched = allCameras.map((cam) => {
        const recStatus = actualRecs.find((r) => r.camera_id === cam.name);
        const stat = stats.find((s) => s.id === `${cam.id}`);
        const zName = zones.find((z) => z.id === cam.zone)?.name || cam.zone_name;
        return {
          ...cam,
          zone_name: zName,
          isRecording: recStatus ? (recStatus.is_recording ? 1 : 0) : cam.isRecording,
          cameraStats: stat || null,
        };
      });

      setRawCameras(enriched);
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch cameras!");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [userId]);

  // Comprehensive client-side filtering that guarantees accurate status, search, and feature filtering
  const filteredCameras = useMemo(() => {
    return rawCameras.filter((cam) => {
      const stat = cam.cameraStats;
      const statusStr = stat?.status
        ? stat.status
        : (stat?.is_active ? "Online" : (cam.status === 0 ? "Online" : "Offline"));
      const isOnline = (statusStr || "").toLowerCase() === "online";

      // 1. Status Filter (All / Online / Offline)
      if (statusFilter === "online" && !isOnline) return false;
      if (statusFilter === "offline" && isOnline) return false;

      // 2. Feature Filter (All / Recording / Streaming / Analytics)
      if (featureFilter === "recording" && !cam.isRecording) return false;
      if (featureFilter === "streaming") {
        const isStreaming = cam.isStreaming || stat?.is_active || isOnline;
        if (!isStreaming) return false;
      }
      if (featureFilter === "analytics" && !cam.isAnalytics && !cam.analytics) return false;

      // 3. Zone Filter
      if (zoneFilter && zoneFilter !== "all") {
        if (String(cam.zone) !== String(zoneFilter) && cam.zone_name !== zoneFilter) {
          return false;
        }
      }

      // 4. NVR Filter
      if (nvrFilter && nvrFilter !== "all") {
        if (String(cam.nvr) !== String(nvrFilter) && cam.nvr_name !== nvrFilter) {
          return false;
        }
      }

      // 5. Global Search Filter
      if (globalFilter && globalFilter.trim()) {
        const q = globalFilter.trim().toLowerCase();
        const matchName = (cam.name || "").toLowerCase().includes(q);
        const matchLocation = (cam.location_name || "").toLowerCase().includes(q);
        const matchZone = (cam.zone_name || "").toLowerCase().includes(q);
        const matchIp = (cam.ip || cam.ip_address || "").toLowerCase().includes(q);
        const matchRtsp = (cam.rtsp_url || "").toLowerCase().includes(q);
        const matchStatus = (statusStr || "").toLowerCase().includes(q);
        const matchId = String(cam.id || "").toLowerCase().includes(q);

        if (!matchName && !matchLocation && !matchZone && !matchIp && !matchRtsp && !matchStatus && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [rawCameras, statusFilter, featureFilter, zoneFilter, nvrFilter, globalFilter]);

  const totalCount = filteredCameras.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCameras.slice(start, start + pageSize);
  }, [filteredCameras, page, pageSize]);

  // Filter change handlers that reset page to 1
  const handleSearch = (value) => {
    setGlobalFilter(value);
    setPage(1);
  };

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleFeatureFilterChange = (value) => {
    setFeatureFilter(value);
    setPage(1);
  };

  const handleZoneFilterChange = (value) => {
    setZoneFilter(value);
    setPage(1);
  };

  const handleNvrFilterChange = (value) => {
    setNvrFilter(value);
    setPage(1);
  };

  // ✅ Delete (camera always, streaming optional)
  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      // 1️⃣ Always delete camera first
      await deviceApi.delete(`/Camera/${id}/`);
      setData((prev) => prev.filter((item) => item.id !== id));

      let messageText = "Camera deleted successfully!";

      // 2️⃣ Then try to delete streaming using new API endpoint
      try {
        // Changed from: await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
        await axios.delete(`${STREAMING_API_URL}/stop/${id}`);
        messageText += ",Streaming stopped successfully!";
      } catch (streamErr) {
        console.error("Streaming delete failed:", streamErr);
        messageText += ",⚠️ Streaming not stopped!";
      }

      // 3️⃣ Then try to stop recording
      try {
        await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
        messageText += "and Recording stopped successfully!";
      } catch (recErr) {
        console.error("Recording stop failed:", recErr);
        messageText += ",⚠️ Recording not stopped!";
      }

      // 🔔 Final combined alert
      alert(messageText);
      fetchData(); // Refresh data after delete
    } catch (err) {
      console.error("Camera delete failed:", err);
      alert("❌ Failed to delete camera!");
    } finally {
      setDeletingId(null);
    }
  };

  // ✅ Helper function to encode RTSP URL for API call
  const encodeRTSPUrl = (url) => {
    return encodeURIComponent(url);
  };

  // ✅ Toggle Streaming / Recording with API support
  const handleToggle = async (row, field, value) => {
    // Optimistic UI update
    setData((prev) =>
      prev.map((cam) =>
        cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
      )
    );

    try {
      // 1️⃣ Update Camera DB
      const payload = {
        ...row,
        [field]: value ? 1 : 0,
        userid: String(userId),
      };
      await deviceApi.put(`/Camera/${row.id}/`, payload);

      // 2️⃣ External API calls
      if (field === "isStreaming") {
        const stopped = JSON.parse(localStorage.getItem("stoppedCams") || "[]");

  if (!value) {
    // ❌ TOGGLE OFF → ADD to stopped
    if (!stopped.includes(row.id)) {
      stopped.push(row.id);
    }
  } else {
    // ✅ TOGGLE ON → REMOVE from stopped
    const index = stopped.indexOf(row.id);
    if (index > -1) stopped.splice(index, 1);
  }

  localStorage.setItem("stoppedCams", JSON.stringify(stopped));
  window.dispatchEvent(new Event("stoppedCamsUpdated"));
        if (value) {
          // Start streaming using old working API endpoint
          await axios.post(`${STREAMING_API_URL}/add-camera`, {
            rtspurl: row.rtspurl,
            id: row.id.toString()
          });
          message.success("Streaming started successfully!");
        } else {
          // Stop streaming using old working API endpoint
          try {
            await axios.delete(`${STREAMING_API_URL}/remove-camera/${row.id}`);
            message.success("Streaming stopped successfully!");
          } catch (err) {
            console.error("Streaming stop failed:", err);
            message.warning("Camera updated but streaming not stopped!");
          }
        }
      } else if (field === "isRecording") {
        if (value) {
          // Start recording
          await axios.post(`${RECORDING_API_URL}/api/v1/record/start/${row.name}?rtsp_url=${encodeURIComponent(row.rtspurl)}`);
          message.success("Recording started successfully!");
        } else {
          // Stop recording
          try {
            await axios.post(`${RECORDING_API_URL}/api/v1/record/stop/${row.name}`);
            message.success("Recording stopped successfully!");
          } catch (err) {
            console.error("Recording stop failed:", err);
            message.warning("Camera updated but recording not stopped!");
          }
        }
      } else {
        // For other fields
        message.success(`${field} updated successfully`);
      }
    } catch (err) {
      console.error("Toggle error:", err);
      message.error(`Failed to update ${field}`);
      fetchData(); // rollback
    }
  };

  // ✅ Analytics toggle with modal warning
  const handleAnalyticsToggle = async (camera, field, value) => {
    if (value) {
      // ✅ Analytics ON → open modal
      setSelectedCamera(camera);
      setAnalyticsField(field);
      setAnalyticsValue(value);
      setAnalyticsModalOpen(true);
    } else {
      // ✅ Analytics OFF → call API directly
      try {
        // Mark this camera as loading
        setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

        const payload = {
          cameras: [
            {
              objectlist: "[]",
              camera_id: camera.id,
              url: camera.rtspurl || camera.url,
              camera_ip: camera.cameraIP || "",
              user_id: camera.user_id || userId,
              credit_id: camera.credit_id || 0,
              running: "False",
            },
          ],
        };

        await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

        // Update camera DB
        const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
        await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

        message.success("Analytics turned off successfully");
        fetchData(); // refresh table
      } catch (err) {
        console.error("Failed to turn off analytics:", err);
        message.error("Failed to turn off analytics");
      } finally {
        // Remove loading state
        setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
      }
    }
  };

  const columns = [
    columnHelper.display({
      id: "serial",
      header: "S.No",
      cell: (info) => (
        <span className="font-medium text-gray-700">
          {(page - 1) * pageSize + info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.accessor("name", {
      header: "Camera Name",
      cell: (info) => (
        <span className="font-semibold text-[#2c028d]">
          {info.getValue()}
        </span>
      ),
    }),

    columnHelper.accessor("location_name", { header: "Location" }),
    columnHelper.accessor("zone_name", { header: "Zone" }),
    columnHelper.display({
      id: "status",
      header: "Status",
      cell: (info) => {
        const stat = info.row.original.cameraStats;
        const statusStr = stat?.status
          ? stat.status
          : (stat?.is_active ? "Online" : (info.row.original.status === 0 ? "Online" : "Offline"));
        const isOnline = (statusStr || "").toLowerCase() === "online";
        return (
          <Tag color={isOnline ? "green" : "red"}>
            {isOnline ? "Online" : "Offline"}
          </Tag>
        );
      },
    }),
    columnHelper.accessor("isRecording", {
      header: "Recording",
      cell: (info) => (
        <Switch
          checked={!!info.getValue()}
          disabled={!canWrite}
          onChange={(val) =>
            handleToggle(info.row.original, "isRecording", val)
          }
        />
      ),
    }),
    columnHelper.accessor("isStreaming", {
      header: "Streaming",
      cell: (info) => (
        <Switch
          checked={!!info.getValue()}
          disabled={!canWrite}
          onChange={(val) =>
            handleToggle(info.row.original, "isStreaming", val)
          }
        />
      ),
    }),
    columnHelper.accessor("isAnalytics", {
      header: "Analytics",
      cell: (info) => {
        const camera = info.row.original;
        const loading = analyticsLoadingIds.includes(camera.id);
        return (
          <Switch
            checked={!!info.getValue()}
            onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
            loading={loading} // ✅ show spinner
            disabled={loading || !canWrite} // optional: disable toggle while processing
          />
        );
      },
    }),
    

    // columnHelper.accessor("objectName", { header: "Analytics Type" }),



   

    columnHelper.accessor("regDate", {
      header: "Created",
      cell: (info) => formatIndianDateTime(info.getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-3 items-center">
            <EyeOutlined
              style={{
                color: "#9000DB",
                fontSize: "15px",
                cursor: "pointer",
              }}
              onClick={() => setViewCamera(row)}
            />
            {canWrite && (
              <EditOutlined
                style={{
                  color: "#16a34a",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
                onClick={() =>
                  navigate(`/camera/form`, { state: { camera: row } })
                }
              />
            )}
            {canWrite && (
              <Popconfirm
                title="Are you sure to delete this camera?"
                onConfirm={() => handleDelete(row.id)}
                okText="Yes"
                cancelText="No"
              >
                {deletingId === row.id ? (
                  <Spin size="small" />
                ) : (
                  <DeleteOutlined
                    style={{
                      color: "#dc2626",
                      fontSize: "15px",
                      cursor: "pointer",
                    }}
                  />
                )}
              </Popconfirm>
            )}
            {/* <CameraFilled
              style={{
                color: "#16a34a",
                fontSize: "15px",
                cursor: "pointer",
              }}
              onClick={() => {
                setSelectedCamera(row);
                setIsCameraModalOpen(true);
              }}
            /> */}

            {/* Camera Modal is rendered outside the table to prevent duplicate instances */}

          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: paginatedData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header with Filters */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Search cameras..."
            value={globalFilter}
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
          >
            <option value="all" className="text-black">All Status</option>
            <option value="online" className="text-black">Online</option>
            <option value="offline" className="text-black">Offline</option>
          </select>
          <select
            value={featureFilter}
            onChange={(e) => handleFeatureFilterChange(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
          >
            <option value="all" className="text-black">All Features</option>
            <option value="recording" className="text-black">Recording</option>
            <option value="streaming" className="text-black">Streaming</option>
            <option value="analytics" className="text-black">Analytics</option>
          </select>
          <select
            value={zoneFilter}
            onChange={(e) => handleZoneFilterChange(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
          >
            <option value="all" className="text-black">All Zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id} className="text-black">
                {z.name}
              </option>
            ))}
          </select>
          <select
            value={nvrFilter}
            onChange={(e) => handleNvrFilterChange(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
          >
            <option value="all" className="text-black">All NVRs</option>
            {nvrs.map((n) => (
              <option key={n.id} value={n.id} className="text-black">
                {n.name}
              </option>
            ))}
          </select>
          {canWrite && (
            <button
              onClick={() => navigate("/camera/form")}
              className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
            >
              + Add Camera
            </button>
          )}
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
                    {header.column.getIsSorted() === "asc" && " 🔼"}
                    {header.column.getIsSorted() === "desc" && " 🔽"}
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
                <td
                  colSpan={columns.length}
                  className="py-6 text-center text-gray-500"
                >
                  No cameras found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ✅ FIXED Pagination */}
      <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Showing {totalCount > 0 ? ((page - 1) * pageSize) + 1 : 0} to {Math.min(page * pageSize, totalCount)} of {totalCount} cameras</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1 || loading}
              className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setPage(prev => Math.max(prev - 1, 1))}
              disabled={page === 1 || loading}
              className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
              disabled={page === totalPages || loading}
              className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || loading}
              className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      </div>

      {/* View Modal */}
      <Modal
        title="Camera Details"
        open={!!viewCamera}
        onCancel={() => setViewCamera(null)}
        footer={null}
      >
        {viewCamera && (
          <div className="space-y-2">
            <p><b>ID:</b> {viewCamera.id}</p>
            <p><b>Name:</b> {viewCamera.name}</p>
            <p><b>IP:</b> {viewCamera.cameraIP}</p>
            <p><b>Location:</b> {viewCamera.location}</p>
            <p><b>Zone:</b> {viewCamera.zone}</p>
            <p><b>Brand:</b> {viewCamera.brand}</p>
            <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
            <p><b>MAC:</b> {viewCamera.macAddress}</p>
            <p><b>Port:</b> {viewCamera.port}</p>
            <p><b>Channel:</b> {viewCamera.channelId}</p>
            <p><b>Latitude:</b> {viewCamera.latitude}</p>
            <p><b>Longitude:</b> {viewCamera.longitude}</p>
            <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
            <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
            <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
            <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
            <p><b>Registered:</b> {formatIndianDateTime(viewCamera.regDate)}</p>
          </div>
        )}
      </Modal>
      <CameraModal
        open={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        camera={selectedCamera}
      />
      
      {/* ✅ Analytics Modal */}
      <AnalyticsModal
        open={analyticsModalOpen}
        onClose={() => setAnalyticsModalOpen(false)}
        field={analyticsField}
        value={analyticsValue}
        userId={userId}
        camera={selectedCamera}
        onSaved={fetchData}   // ✅ refresh camera list after close
      />
      
      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default CameraDetailsTable;




/////////////////////////////////////



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios"; // ✅ needed for streaming API call
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);

//   // ✅ Change initial filter states to "all" instead of null
//   const [statusFilter, setStatusFilter] = useState("all");
//   const [featureFilter, setFeatureFilter] = useState("all");
//   const [zoneFilter, setZoneFilter] = useState("all");
//   const [nvrFilter, setNvrFilter] = useState("all");

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [totalCount, setTotalCount] = useState(0);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");
  

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ FIXED: Fetch camera data with proper pagination
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       // ✅ Build params correctly
//       const params = {
//         search: search || "",
//         page: currentPage,
//         page_size: 20, // ✅ Changed from pageSize to page_size
//         user_id: userId,
//       };

//       // ✅ Only add filters if they're not "all"
//       if (status && status !== "all") params.status = status;
//       if (feature && feature !== "all") params.feature = feature;
//       if (zone && zone !== "all") params.zone = zone;
//       if (nvr && nvr !== "all") params.nvr = nvr;

//       console.log("Fetching with params:", params); // Debug log

//       const res = await deviceApi.get(`/Camera/`, { params });
      
//       console.log("API Response:", res.data); // Debug log
      
//       setData(res.data.results || []);
      
//       // ✅ Calculate total pages from count
//       const count = res.data.count || 0;
//       setTotalCount(count);
      
//       // Calculate total pages
//       const calculatedTotalPages = Math.ceil(count / size);
//       setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//       setPage(1); // Reset to page 1 on error
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Filter change handlers that reset page to 1
//   const handleStatusFilterChange = (value) => {
//     setStatusFilter(value);
//     setPage(1);
//   };

//   const handleFeatureFilterChange = (value) => {
//     setFeatureFilter(value);
//     setPage(1);
//   };

//   const handleZoneFilterChange = (value) => {
//     setZoneFilter(value);
//     setPage(1);
//   };

//   const handleNvrFilterChange = (value) => {
//     setNvrFilter(value);
//     setPage(1);
//   };

//   // ✅ Delete (camera always, streaming optional)
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       // 1️⃣ Always delete camera first
//       await deviceApi.delete(`/Camera/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));

//       let messageText = "Camera deleted successfully!";

//       // 2️⃣ Then try to delete streaming using new API endpoint
//       try {
//         // Changed from: await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
//         await axios.delete(`${STREAMING_API_URL}/stop/${id}`);
//         messageText += ",Streaming stopped successfully!";
//       } catch (streamErr) {
//         console.error("Streaming delete failed:", streamErr);
//         messageText += ",⚠️ Streaming not stopped!";
//       }

//       // 3️⃣ Then try to stop recording
//       try {
//         await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//         messageText += "and Recording stopped successfully!";
//       } catch (recErr) {
//         console.error("Recording stop failed:", recErr);
//         messageText += ",⚠️ Recording not stopped!";
//       }

//       // 🔔 Final combined alert
//       alert(messageText);
//       fetchData(); // Refresh data after delete
//     } catch (err) {
//       console.error("Camera delete failed:", err);
//       alert("❌ Failed to delete camera!");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // ✅ Helper function to encode RTSP URL for API call
//   const encodeRTSPUrl = (url) => {
//     return encodeURIComponent(url);
//   };

//   // ✅ Toggle Streaming / Recording with API support
//   const handleToggle = async (row, field, value) => {
//     // Optimistic UI update
//     setData((prev) =>
//       prev.map((cam) =>
//         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//       )
//     );

//     try {
//       // 1️⃣ Update Camera DB
//       const payload = {
//         ...row,
//         [field]: value ? 1 : 0,
//         userid: String(userId),
//       };
//       await deviceApi.put(`/Camera/${row.id}/`, payload);

//       // 2️⃣ External API calls
//       if (field === "isStreaming") {
//         if (value) {
//           // Start streaming using new API endpoint
//           // Changed from: await axios.post(`${STREAMING_API_URL}/Streaming/add_camera/`, {
//           //   rtspUrl: row.rtspurl,
//           //   cameraId: row.id,
//           //   creditId: row.creditId || 0,
//           // });
          
//           const encodedRtspUrl = encodeRTSPUrl(row.rtspurl);
//           await axios.get(
//             `${STREAMING_API_URL}/start?rtspurl=${encodedRtspUrl}&id=${row.id}`,
//             {
//               headers: {
//                 'accept': 'application/json'
//               }
//             }
//           );
//           message.success("Streaming started successfully!");
//         } else {
//           // Stop streaming using new API endpoint
//           try {
//             // Changed from: await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${row.id}`);
//             await axios.delete(
//               `${STREAMING_API_URL}/stop/${row.id}`,
//               {
//                 headers: {
//                   'accept': 'application/json'
//                 }
//               }
//             );
//             message.success("Streaming stopped successfully!");
//           } catch (err) {
//             console.error("Streaming stop failed:", err);
//             message.warning("Camera updated but streaming not stopped!");
//           }
//         }
//       } else if (field === "isRecording") {
//         if (value) {
//           // Start recording
//           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//             streamUrl: row.rtspurl,
//             cameraId: row.id,
//           });
//           message.success("Recording started successfully!");
//         } else {
//           // Stop recording
//           try {
//             await axios.delete(
//               `${RECORDING_API_URL}/Recording/stop/${row.id}`
//             );
//             message.success("Recording stopped successfully!");
//           } catch (err) {
//             console.error("Recording stop failed:", err);
//             message.warning("Camera updated but recording not stopped!");
//           }
//         }
//       } else {
//         // For other fields
//         message.success(`${field} updated successfully`);
//       }
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error(`Failed to update ${field}`);
//       fetchData(); // rollback
//     }
//   };

//   // ✅ Analytics toggle with modal warning
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       // ✅ Analytics ON → open modal
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       // ✅ Analytics OFF → call API directly
//       try {
//         // Mark this camera as loading
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         // Update camera DB
//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData(); // refresh table
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         // Remove loading state
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading} // ✅ show spinner
//             disabled={loading} // optional: disable toggle while processing
//           />
//         );
//       },
//     }),
    


   

//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             {/* <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             /> */}

//             {/* Camera Modal */}
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />

//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => handleStatusFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => handleFeatureFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => handleZoneFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => handleNvrFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* ✅ FIXED Pagination */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} cameras</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">
//             Page {page} of {totalPages}
//           </span>
//           <div className="flex gap-2">
//             <button
//               onClick={() => setPage(1)}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               First
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.max(prev - 1, 1))}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Prev
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Next
//             </button>
//             <button
//               onClick={() => setPage(totalPages)}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Last
//             </button>
//           </div>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
      
//       {/* ✅ Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}   // ✅ refresh camera list after close
//       />
      
//       {/* Footer */}
//       <div className="fixed bottom-2 right-4 text-xs font-bold">
//         <span className="text-red-600">© Ajeevi</span>{" "}
//         <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//       </div>
//     </div>
//   );
// };

// export default CameraDetailsTable;



//////////////////


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios"; // ✅ needed for streaming API call
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);

//   // ✅ Change initial filter states to "all" instead of null
//   const [statusFilter, setStatusFilter] = useState("all");
//   const [featureFilter, setFeatureFilter] = useState("all");
//   const [zoneFilter, setZoneFilter] = useState("all");
//   const [nvrFilter, setNvrFilter] = useState("all");

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [totalCount, setTotalCount] = useState(0);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ FIXED: Fetch camera data with proper pagination
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       // ✅ Build params correctly
//       const params = {
//         search: search || "",
//         page: currentPage,
//         page_size: 20, // ✅ Changed from pageSize to page_size
//         user_id: userId,
//       };

//       // ✅ Only add filters if they're not "all"
//       if (status && status !== "all") params.status = status;
//       if (feature && feature !== "all") params.feature = feature;
//       if (zone && zone !== "all") params.zone = zone;
//       if (nvr && nvr !== "all") params.nvr = nvr;

//       console.log("Fetching with params:", params); // Debug log

//       const res = await deviceApi.get(`/Camera/`, { params });
      
//       console.log("API Response:", res.data); // Debug log
      
//       setData(res.data.results || []);
      
//       // ✅ Calculate total pages from count
//       const count = res.data.count || 0;
//       setTotalCount(count);
      
//       // Calculate total pages
//       const calculatedTotalPages = Math.ceil(count / size);
//       setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//       setPage(1); // Reset to page 1 on error
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Filter change handlers that reset page to 1
//   const handleStatusFilterChange = (value) => {
//     setStatusFilter(value);
//     setPage(1);
//   };

//   const handleFeatureFilterChange = (value) => {
//     setFeatureFilter(value);
//     setPage(1);
//   };

//   const handleZoneFilterChange = (value) => {
//     setZoneFilter(value);
//     setPage(1);
//   };

//   const handleNvrFilterChange = (value) => {
//     setNvrFilter(value);
//     setPage(1);
//   };

//   // ✅ Delete (camera always, streaming optional)
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       // 1️⃣ Always delete camera first
//       await deviceApi.delete(`/Camera/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));

//       let messageText = "Camera deleted successfully!";

//       // 2️⃣ Then try to delete streaming
//       try {
//         await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
//         messageText += ",Streaming stopped successfully!";
//       } catch (streamErr) {
//         console.error("Streaming delete failed:", streamErr);
//         messageText += ",⚠️ Streaming not stopped!";
//       }

//       // 3️⃣ Then try to stop recording
//       try {
//         await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//         messageText += "and Recording stopped successfully!";
//       } catch (recErr) {
//         console.error("Recording stop failed:", recErr);
//         messageText += ",⚠️ Recording not stopped!";
//       }

//       // 🔔 Final combined alert
//       alert(messageText);
//       fetchData(); // Refresh data after delete
//     } catch (err) {
//       console.error("Camera delete failed:", err);
//       alert("❌ Failed to delete camera!");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // ✅ Analytics toggle with modal warning
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       // ✅ Analytics ON → open modal
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       // ✅ Analytics OFF → call API directly
//       try {
//         // Mark this camera as loading
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         // Update camera DB
//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData(); // refresh table
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         // Remove loading state
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };

//   // ✅ Toggle Streaming / Recording with API support
//   const handleToggle = async (row, field, value) => {
//     // Optimistic UI update
//     setData((prev) =>
//       prev.map((cam) =>
//         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//       )
//     );

//     try {
//       // 1️⃣ Update Camera DB
//       const payload = {
//         ...row,
//         [field]: value ? 1 : 0,
//         userid: String(userId),
//       };
//       await deviceApi.put(`/Camera/${row.id}/`, payload);

//       // 2️⃣ External API calls
//       if (field === "isStreaming") {
//         if (value) {
//           // Start streaming
//           await axios.post(`${STREAMING_API_URL}/Streaming/add_camera/`, {
//             rtspUrl: row.rtspurl,
//             cameraId: row.id,
//             creditId: row.creditId || 0,
//           });
//           message.success("Streaming started successfully!");
//         } else {
//           // Stop streaming
//           try {
//             await axios.delete(
//               `${STREAMING_API_URL}/Streaming/remove_camera/${row.id}`
//             );
//             message.success("Streaming stopped successfully!");
//           } catch (err) {
//             console.error("Streaming stop failed:", err);
//             message.warning("Camera updated but streaming not stopped!");
//           }
//         }
//       } else if (field === "isRecording") {
//         if (value) {
//           // Start recording
//           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//             streamUrl: row.rtspurl,
//             cameraId: row.id,
//           });
//           message.success("Recording started successfully!");
//         } else {
//           // Stop recording
//           try {
//             await axios.delete(
//               `${RECORDING_API_URL}/Recording/stop/${row.id}`
//             );
//             message.success("Recording stopped successfully!");
//           } catch (err) {
//             console.error("Recording stop failed:", err);
//             message.warning("Camera updated but recording not stopped!");
//           }
//         }
//       } else {
//         // For other fields
//         message.success(`${field} updated successfully`);
//       }
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error(`Failed to update ${field}`);
//       fetchData(); // rollback
//     }
//   };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading} // ✅ show spinner
//             disabled={loading} // optional: disable toggle while processing
//           />
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             {/* <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             /> */}

//             {/* Camera Modal */}
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />

//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => handleStatusFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => handleFeatureFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => handleZoneFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => handleNvrFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* ✅ FIXED Pagination */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} cameras</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">
//             Page {page} of {totalPages}
//           </span>
//           <div className="flex gap-2">
//             <button
//               onClick={() => setPage(1)}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               First
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.max(prev - 1, 1))}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Prev
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Next
//             </button>
//             <button
//               onClick={() => setPage(totalPages)}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Last
//             </button>
//           </div>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
      
//       {/* ✅ Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}   // ✅ refresh camera list after close
//       />
      
//       {/* Footer */}
//       <div className="fixed bottom-2 right-4 text-xs font-bold">
//         <span className="text-red-600">© Ajeevi</span>{" "}
//         <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//       </div>
//     </div>
//   );
// };

// export default CameraDetailsTable;





//below code is running akash



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios"; // ✅ needed for streaming API call
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);

//   // ✅ Change initial filter states to "all" instead of null
//   const [statusFilter, setStatusFilter] = useState("all");
//   const [featureFilter, setFeatureFilter] = useState("all");
//   const [zoneFilter, setZoneFilter] = useState("all");
//   const [nvrFilter, setNvrFilter] = useState("all");

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [totalCount, setTotalCount] = useState(0);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ FIXED: Fetch camera data with proper pagination
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       // ✅ Build params correctly
//       const params = {
//         search: search || "",
//         page: currentPage,
//         page_size: 20, // ✅ Changed from pageSize to page_size
//         user_id: userId,
//       };

//       // ✅ Only add filters if they're not "all"
//       if (status && status !== "all") params.status = status;
//       if (feature && feature !== "all") params.feature = feature;
//       if (zone && zone !== "all") params.zone = zone;
//       if (nvr && nvr !== "all") params.nvr = nvr;

//       console.log("Fetching with params:", params); // Debug log

//       const res = await deviceApi.get(`/Camera/`, { params });
      
//       console.log("API Response:", res.data); // Debug log
      
//       setData(res.data.results || []);
      
//       // ✅ Calculate total pages from count
//       const count = res.data.count || 0;
//       setTotalCount(count);
      
//       // Calculate total pages
//       const calculatedTotalPages = Math.ceil(count / size);
//       setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//       setPage(1); // Reset to page 1 on error
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Filter change handlers that reset page to 1
//   const handleStatusFilterChange = (value) => {
//     setStatusFilter(value);
//     setPage(1);
//   };

//   const handleFeatureFilterChange = (value) => {
//     setFeatureFilter(value);
//     setPage(1);
//   };

//   const handleZoneFilterChange = (value) => {
//     setZoneFilter(value);
//     setPage(1);
//   };

//   const handleNvrFilterChange = (value) => {
//     setNvrFilter(value);
//     setPage(1);
//   };

//   // ✅ Delete (camera always, streaming optional)
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       // 1️⃣ Always delete camera first
//       await deviceApi.delete(`/Camera/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));

//       let messageText = "Camera deleted successfully!";

//       // 2️⃣ Then try to delete streaming
//       try {
//         await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
//         messageText += ",Streaming stopped successfully!";
//       } catch (streamErr) {
//         console.error("Streaming delete failed:", streamErr);
//         messageText += ",⚠️ Streaming not stopped!";
//       }

//       // 3️⃣ Then try to stop recording
//       try {
//         await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//         messageText += "and Recording stopped successfully!";
//       } catch (recErr) {
//         console.error("Recording stop failed:", recErr);
//         messageText += ",⚠️ Recording not stopped!";
//       }

//       // 🔔 Final combined alert
//       alert(messageText);
//       fetchData(); // Refresh data after delete
//     } catch (err) {
//       console.error("Camera delete failed:", err);
//       alert("❌ Failed to delete camera!");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // ✅ Analytics toggle with modal warning
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       // ✅ Analytics ON → open modal
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       // ✅ Analytics OFF → call API directly
//       try {
//         // Mark this camera as loading
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         // Update camera DB
//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData(); // refresh table
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         // Remove loading state
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };

//   // ✅ Toggle Streaming / Recording with API support
//   const handleToggle = async (row, field, value) => {
//     // Optimistic UI update
//     setData((prev) =>
//       prev.map((cam) =>
//         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//       )
//     );

//     try {
//       // 1️⃣ Update Camera DB
//       const payload = {
//         ...row,
//         [field]: value ? 1 : 0,
//         userid: String(userId),
//       };
//       await deviceApi.put(`/Camera/${row.id}/`, payload);

//       // 2️⃣ External API calls
//       if (field === "isStreaming") {
//         if (value) {
//           // Start streaming
//           await axios.post(`${STREAMING_API_URL}/Streaming/add_camera/`, {
//             rtspUrl: row.rtspurl,
//             cameraId: row.id,
//             creditId: row.creditId || 0,
//           });
//           message.success("Streaming started successfully!");
//         } else {
//           // Stop streaming
//           try {
//             await axios.delete(
//               `${STREAMING_API_URL}/Streaming/remove_camera/${row.id}`
//             );
//             message.success("Streaming stopped successfully!");
//           } catch (err) {
//             console.error("Streaming stop failed:", err);
//             message.warning("Camera updated but streaming not stopped!");
//           }
//         }
//       } else if (field === "isRecording") {
//         if (value) {
//           // Start recording
//           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//             streamUrl: row.rtspurl,
//             cameraId: row.id,
//           });
//           message.success("Recording started successfully!");
//         } else {
//           // Stop recording
//           try {
//             await axios.delete(
//               `${RECORDING_API_URL}/Recording/stop/${row.id}`
//             );
//             message.success("Recording stopped successfully!");
//           } catch (err) {
//             console.error("Recording stop failed:", err);
//             message.warning("Camera updated but recording not stopped!");
//           }
//         }
//       } else {
//         // For other fields
//         message.success(`${field} updated successfully`);
//       }
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error(`Failed to update ${field}`);
//       fetchData(); // rollback
//     }
//   };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading} // ✅ show spinner
//             disabled={loading} // optional: disable toggle while processing
//           />
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             {/* <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             /> */}

//             {/* Camera Modal */}
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />

//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => handleStatusFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => handleFeatureFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => handleZoneFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => handleNvrFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* ✅ FIXED Pagination */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} cameras</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">
//             Page {page} of {totalPages}
//           </span>
//           <div className="flex gap-2">
//             <button
//               onClick={() => setPage(1)}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               First
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.max(prev - 1, 1))}
//               disabled={page === 1 || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Prev
//             </button>
//             <button
//               onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Next
//             </button>
//             <button
//               onClick={() => setPage(totalPages)}
//               disabled={page === totalPages || loading}
//               className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Last
//             </button>
//           </div>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
      
//       {/* ✅ Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}   // ✅ refresh camera list after close
//       />
      
//       {/* Footer */}
//       <div className="fixed bottom-2 right-4 text-xs font-bold">
//         <span className="text-red-600">© Ajeevi</span>{" "}
//         <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//       </div>
//     </div>
//   );
// };

// export default CameraDetailsTable;



/////////////////////////////// above code running akash


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios";
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL, ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);

//   const [statusFilter, setStatusFilter] = useState("all");
//   const [featureFilter, setFeatureFilter] = useState("all");
//   const [zoneFilter, setZoneFilter] = useState("all");
//   const [nvrFilter, setNvrFilter] = useState("all");

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [totalCount, setTotalCount] = useState(0);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ Fetch camera data with FIXED pagination
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       // Build params object
//       const params = {
//         search: search || "",
//         page: currentPage,
//         page_size: size,
//         user_id: userId,
//       };

//       // Add optional filters only if they have values and not "all"
//       if (status && status !== "all") params.status = status;
//       if (feature && feature !== "all") params.feature = feature;
//       if (zone && zone !== "all") params.zone = zone;
//       if (nvr && nvr !== "all") params.nvr = nvr;

//       const res = await deviceApi.get(`/Camera/`, { params });
      
//       // Set data from results array
//       setData(res.data.results || []);
      
//       // Handle pagination metadata (Django REST Framework style)
//       const count = res.data.count || 0;
//       setTotalCount(count);
      
//       // Calculate total pages
//       const calculatedTotalPages = Math.ceil(count / size);
//       setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//       setPage(1);
//     } finally {
//       setLoading(false);
//     }
//   };

//   // ✅ Fetch data when dependencies change
//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Filter change handlers that reset page to 1
//   const handleStatusFilterChange = (value) => {
//     setStatusFilter(value);
//     setPage(1);
//   };

//   const handleFeatureFilterChange = (value) => {
//     setFeatureFilter(value);
//     setPage(1);
//   };

//   const handleZoneFilterChange = (value) => {
//     setZoneFilter(value);
//     setPage(1);
//   };

//   const handleNvrFilterChange = (value) => {
//     setNvrFilter(value);
//     setPage(1);
//   };

//   // ✅ Handle page size change
//   const handlePageSizeChange = (size) => {
//     setPageSize(size);
//     setPage(1);
//   };

//   // ✅ Delete camera
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       await deviceApi.delete(`/Camera/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));
      
//       let messageText = "Camera deleted successfully!";

//       try {
//         await axios.delete(`${STREAMING_API_URL}/stop/${id}`);
//         messageText += ", Streaming stopped successfully!";
//       } catch (streamErr) {
//         console.error("Streaming delete failed:", streamErr);
//         messageText += ", ⚠️ Streaming not stopped!";
//       }

//       try {
//         await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//         messageText += " and Recording stopped successfully!";
//       } catch (recErr) {
//         console.error("Recording stop failed:", recErr);
//         messageText += ", ⚠️ Recording not stopped!";
//       }

//       alert(messageText);
//       fetchData();
//     } catch (err) {
//       console.error("Camera delete failed:", err);
//       alert("❌ Failed to delete camera!");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // ✅ Analytics toggle
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       try {
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData();
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };

//   // ✅ Toggle streaming/recording
//   const handleToggle = async (row, field, value) => {
//     setData((prev) =>
//       prev.map((cam) =>
//         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//       )
//     );

//     try {
//       const payload = {
//         ...row,
//         [field]: value ? 1 : 0,
//         userid: String(userId),
//       };
//       await deviceApi.put(`/Camera/${row.id}/`, payload);

//       if (field === "isStreaming") {
//         if (value) {
//           await axios.get(`${STREAMING_API_URL}/start`, {
//             params: {
//               rtspurl: row.rtspurl,
//               id: row.id,
//             },
//           });
//           message.success("Streaming started successfully!");
//         } else {
//           try {
//             await axios.delete(`${STREAMING_API_URL}/stop/${row.id}`);
//             message.success("Streaming stopped successfully!");
//           } catch (err) {
//             console.error("Streaming stop failed:", err);
//             message.warning("Camera updated but streaming not stopped!");
//           }
//         }
//       } else if (field === "isRecording") {
//         if (value) {
//           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//             streamUrl: row.rtspurl,
//             cameraId: row.id,
//           });
//           message.success("Recording started successfully!");
//         } else {
//           try {
//             await axios.delete(`${RECORDING_API_URL}/Recording/stop/${row.id}`);
//             message.success("Recording stopped successfully!");
//           } catch (err) {
//             console.error("Recording stop failed:", err);
//             message.warning("Camera updated but recording not stopped!");
//           }
//         }
//       } else {
//         message.success(`${field} updated successfully`);
//       }
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error(`Failed to update ${field}`);
//       fetchData();
//     }
//   };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading}
//             disabled={loading}
//           />
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             />
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />
//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => handleStatusFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => handleFeatureFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => handleZoneFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => handleNvrFilterChange(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* Pagination - SIMPLE AND WORKING */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
//         <div className="flex items-center gap-2">
//           <span className="text-sm text-gray-600">Show:</span>
//           <select
//             value={pageSize}
//             onChange={(e) => handlePageSizeChange(Number(e.target.value))}
//             className="px-2 py-1 border rounded text-sm"
//           >
//             <option value={5}>5</option>
//             <option value={10}>10</option>
//             <option value={20}>20</option>
//             <option value={50}>50</option>
//           </select>
//           <span className="text-sm text-gray-600">entries</span>
//         </div>
        
//         <div className="text-sm text-gray-600 text-center">
//           Showing {data.length > 0 ? (page - 1) * pageSize + 1 : 0} to{" "}
//           {Math.min(page * pageSize, totalCount)} of {totalCount} cameras
//         </div>
        
//         <div className="flex gap-1">
//           <button
//             onClick={() => setPage(1)}
//             disabled={page === 1 || loading}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             First
//           </button>
//           <button
//             onClick={() => setPage(prev => Math.max(prev - 1, 1))}
//             disabled={page === 1 || loading}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             Prev
//           </button>
          
//           <span className="px-3 py-1 border rounded bg-white text-gray-700 min-w-[100px] text-center">
//             Page {page} of {totalPages}
//           </span>
          
//           <button
//             onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
//             disabled={page === totalPages || loading || totalPages === 0}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             Next
//           </button>
//           <button
//             onClick={() => setPage(totalPages)}
//             disabled={page === totalPages || loading || totalPages === 0}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             Last
//           </button>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
      
//       {/* Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}
//       />
      
//       {/* Footer */}
//       <div className="fixed bottom-2 right-4 text-xs font-bold">
//         <span className="text-red-600">© Ajeevi</span>{" "}
//         <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//       </div>
//     </div>
//   );
// };

// export default CameraDetailsTable;

////////////////////////////


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios"; // ✅ needed for streaming API call
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);


// //   const [statusFilter, setStatusFilter] = useState("all");
// // const [featureFilter, setFeatureFilter] = useState("all");
// // const [zoneFilter, setZoneFilter] = useState("all");
// // const [nvrFilter, setNvrFilter] = useState("all");


//     const [statusFilter, setStatusFilter] = useState(null);
//     const [featureFilter, setFeatureFilter] = useState(null);
//     const [zoneFilter, setZoneFilter] = useState(null);
//     const [nvrFilter, setNvrFilter] = useState(null);

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ Fetch camera data
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       const res = await deviceApi.get(`/Camera/?user_id=${userId}`, {
//         params: {
//           search,
//           page: currentPage,
//           pageSize: size,
//           status,
//           feature,
//           zone,
//           nvr,
//         },
//       });
//       setData(res.data.results || []);
//       setTotalPages(res.data.totalPages || 1);
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Delete (camera always, streaming optional)
//   // const handleDelete = async (id) => {
//   //   setDeletingId(id);
//   //   try {
//   //     // 1️⃣ Always delete camera first
//   //     await deviceApi.delete(`/Camera/${id}/`);
//   //     setData((prev) => prev.filter((item) => item.id !== id));

//   //     let messageText = "Camera deleted successfully!";

//   //     // 2️⃣ Then try to delete streaming
//   //     try {
//   //       await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
//   //       messageText += ",Streaming stopped successfully!";
//   //     } catch (streamErr) {
//   //       console.error("Streaming delete failed:", streamErr);
//   //       messageText += ",⚠️ Streaming not stopped!";
//   //     }

//   //     // 3️⃣ Then try to stop recording
//   //     try {
//   //       await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//   //       messageText += "and Recording stopped successfully!";
//   //     } catch (recErr) {
//   //       console.error("Recording stop failed:", recErr);
//   //       messageText += ",⚠️ Recording not stopped!";
//   //     }

//   //     // 🔔 Final combined alert
//   //     alert(messageText);
//   //   } catch (err) {
//   //     console.error("Camera delete failed:", err);
//   //     alert("❌ Failed to delete camera!");
//   //   } finally {
//   //     setDeletingId(null);
//   //   }
//   // };

//   const handleDelete = async (id) => {
//   setDeletingId(id);
//   try {
//     // 1️⃣ Always delete camera first
//     await deviceApi.delete(`/Camera/${id}/`);
//     setData((prev) => prev.filter((item) => item.id !== id));

//     let messageText = "Camera deleted successfully!";

//     // 2️⃣ Then try to stop streaming - NEW API
//     try {
//       await axios.delete(`${STREAMING_API_URL}/stop/${id}`);
//       messageText += ", Streaming stopped successfully!";
//     } catch (streamErr) {
//       console.error("Streaming delete failed:", streamErr);
//       messageText += ", ⚠️ Streaming not stopped!";
//     }

//     // 3️⃣ Then try to stop recording
//     try {
//       await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//       messageText += " and Recording stopped successfully!";
//     } catch (recErr) {
//       console.error("Recording stop failed:", recErr);
//       messageText += ", ⚠️ Recording not stopped!";
//     }

//     // 🔔 Final combined alert
//     alert(messageText);
//   } catch (err) {
//     console.error("Camera delete failed:", err);
//     alert("❌ Failed to delete camera!");
//   } finally {
//     setDeletingId(null);
//   }
// };


//   // ✅ Analytics toggle with modal warning
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       // ✅ Analytics ON → open modal
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       // ✅ Analytics OFF → call API directly
//       try {
//         // Mark this camera as loading
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         // Update camera DB
//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData(); // refresh table
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         // Remove loading state
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };



//   // ✅ Toggle with streaming API support
//   // ✅ Toggle Streaming / Recording with API support
// //   const handleToggle = async (row, field, value) => {
// //     // Optimistic UI update
// //     setData((prev) =>
// //       prev.map((cam) =>
// //         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
// //       )
// //     );

// //     try {
// //       // 1️⃣ Update Camera DB
// //       const payload = {
// //         ...row,
// //         [field]: value ? 1 : 0,
// //         userid: String(userId),
// //       };
// //       await deviceApi.put(`/Camera/${row.id}/`, payload);

// //       // 2️⃣ External API calls
// //       if (field === "isStreaming") {
// //   if (value) {
// //     // ▶ START STREAMING
// //     await axios.get("http://14.195.152.244:9014/start", {
// //       params: {
// //         rtspurl: row.rtspurl, // RTSP URL
// //         id: row.id,          // Camera ID
// //       },
// //     });

// //     message.success("Streaming started successfully!");
// //   } else {
// //     // ⏹ STOP STREAMING
// //     await axios.post(`http://14.195.152.244:9014/stop/${row.id}`);

// //     message.success("Streaming stopped successfully!");
// //   }
// // }

// //        else if (field === "isRecording") {
// //         if (value) {
// //           // Start recording
// //           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
// //             streamUrl: row.rtspurl,
// //             cameraId: row.id,
// //           });
// //           message.success("Recording started successfully!");
// //         } else {
// //           // Stop recording
// //           try {
// //             await axios.delete(
// //               `${RECORDING_API_URL}/Recording/stop/${row.id}`
// //             );
// //             message.success("Recording stopped successfully!");
// //           } catch (err) {
// //             console.error("Recording stop failed:", err);
// //             message.warning("Camera updated but recording not stopped!");
// //           }
// //         }
// //       } else {
// //         // For other fields
// //         message.success(`${field} updated successfully`);
// //       }
// //     } catch (err) {
// //       console.error("Toggle error:", err);
// //       message.error(`Failed to update ${field}`);
// //       fetchData(); // rollback
// //     }
// //   };


// // ✅ Toggle with streaming API support - UPDATED VERSION
// const handleToggle = async (row, field, value) => {
//   // Optimistic UI update
//   setData((prev) =>
//     prev.map((cam) =>
//       cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//     )
//   );

//   try {
//     // 1️⃣ Update Camera DB
//     const payload = {
//       ...row,
//       [field]: value ? 1 : 0,
//       userid: String(userId),
//     };
//     await deviceApi.put(`/Camera/${row.id}/`, payload);

//     // 2️⃣ External API calls
//     if (field === "isStreaming") {
//       if (value) {
//         // Start streaming - NEW API
//         await axios.get(`${STREAMING_API_URL}/start`, {
//           params: {
//             rtspurl: row.rtspurl,
//             id: row.id,
//           },
//         });
//         message.success("Streaming started successfully!");
//       } else {
//         // Stop streaming - NEW API
//         try {
//           await axios.delete(`${STREAMING_API_URL}/stop/${row.id}`);
//           message.success("Streaming stopped successfully!");
//         } catch (err) {
//           console.error("Streaming stop failed:", err);
//           message.warning("Camera updated but streaming not stopped!");
//         }
//       }
//     } else if (field === "isRecording") {
//       if (value) {
//         // Start recording (keep your existing recording API)
//         await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//           streamUrl: row.rtspurl,
//           cameraId: row.id,
//         });
//         message.success("Recording started successfully!");
//       } else {
//         // Stop recording (keep your existing recording API)
//         try {
//           await axios.delete(
//             `${RECORDING_API_URL}/Recording/stop/${row.id}`
//           );
//           message.success("Recording stopped successfully!");
//         } catch (err) {
//           console.error("Recording stop failed:", err);
//           message.warning("Camera updated but recording not stopped!");
//         }
//       }
//     } else {
//       // For other fields
//       message.success(`${field} updated successfully`);
//     }
//   } catch (err) {
//     console.error("Toggle error:", err);
//     message.error(`Failed to update ${field}`);
//     fetchData(); // rollback
//   }
// };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading} // ✅ show spinner
//             disabled={loading} // optional: disable toggle while processing
//           />
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             {/* <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             /> */}

//             {/* Camera Modal */}
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />

//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4  max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md  flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA] ">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => setStatusFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => setFeatureFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => setZoneFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => setNvrFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md   border border-[#e7e5ec] shadow ">
//         <table className="min-w-full text-sm  ">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* Pagination */}
//       <div className="flex flex-col sm:flex-row  justify-between items-center mt-4 gap-2 ">
//         <span className="text-sm text-gray-600">
//           Page {page} of {totalPages}
//         </span>
//         <div className="flex gap-2">
//           <button
//             onClick={() => setPage((p) => Math.max(p - 1, 1))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === 1}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === totalPages}
//           >
//             Next
//           </button>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
//       {/* // ✅ Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}   // ✅ refresh camera list after close
//       />
//  {/* Footer */}
// <div className="fixed bottom-2 right-4 text-xs font-bold">
//   <span className="text-red-600">© Ajeevi</span>{" "}
//   <span className="text-blue-600">Technologies Pvt. Ltd.</span>
// </div>

//     </div>
//   );
// };

// export default CameraDetailsTable;






/////////////////////RRRRRRRRRRRRRRRR


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Tag, Switch } from "antd";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraFilled } from "@ant-design/icons";
// import axios from "axios"; // ✅ needed for streaming API call
// import CameraModal from "./CameraModal";
// import AnalyticsModal from "./AnalyticsModal";
// import { STREAMING_API_URL, RECORDING_API_URL , ANALYTICS_API_URL } from "../../../../config";

// const columnHelper = createColumnHelper();

// const CameraDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [viewCamera, setViewCamera] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const [analyticsLoadingIds, setAnalyticsLoadingIds] = useState([]);
//   const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
//   const [analyticsField, setAnalyticsField] = useState(null);
//   const [analyticsValue, setAnalyticsValue] = useState(null);
//   const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
//   const [selectedCamera, setSelectedCamera] = useState(null);


//   const [statusFilter, setStatusFilter] = useState(null);
//   const [featureFilter, setFeatureFilter] = useState(null);
//   const [zoneFilter, setZoneFilter] = useState(null);
//   const [nvrFilter, setNvrFilter] = useState(null);

//   const [zones, setZones] = useState([]);
//   const [nvrs, setNvrs] = useState([]);

//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch filter options
//   useEffect(() => {
//     const loadFilters = async () => {
//       try {
//         const [zoneRes, nvrRes] = await Promise.allSettled([
//           deviceApi.get("/Zone/?page=1&page_size=100"),
//           deviceApi.get(`/NVR/?user_id=${userId}&page=1&page_size=100`),
//         ]);

//         if (zoneRes.status === "fulfilled") {
//           setZones(zoneRes.value.data.results || []);
//         }
//         if (nvrRes.status === "fulfilled") {
//           setNvrs(nvrRes.value.data.results || []);
//         }
//       } catch (err) {
//         console.error("Unexpected error:", err);
//       }
//     };

//     loadFilters();
//   }, [userId]);

//   // ✅ Fetch camera data
//   const fetchData = async (
//     search = globalFilter,
//     currentPage = page,
//     size = pageSize,
//     status = statusFilter,
//     feature = featureFilter,
//     zone = zoneFilter,
//     nvr = nvrFilter
//   ) => {
//     setLoading(true);
//     try {
//       const res = await deviceApi.get(`/Camera/?user_id=${userId}`, {
//         params: {
//           search,
//           page: currentPage,
//           pageSize: size,
//           status,
//           feature,
//           zone,
//           nvr,
//         },
//       });
//       setData(res.data.results || []);
//       setTotalPages(res.data.totalPages || 1);
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch cameras!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(
//       globalFilter,
//       page,
//       pageSize,
//       statusFilter,
//       featureFilter,
//       zoneFilter,
//       nvrFilter
//     );
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [
//     globalFilter,
//     page,
//     pageSize,
//     statusFilter,
//     featureFilter,
//     zoneFilter,
//     nvrFilter,
//   ]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Delete (camera always, streaming optional)
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       // 1️⃣ Always delete camera first
//       await deviceApi.delete(`/Camera/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));

//       let messageText = "Camera deleted successfully!";

//       // 2️⃣ Then try to delete streaming
//       try {
//         await axios.delete(`${STREAMING_API_URL}/Streaming/remove_camera/${id}`);
//         messageText += ",Streaming stopped successfully!";
//       } catch (streamErr) {
//         console.error("Streaming delete failed:", streamErr);
//         messageText += ",⚠️ Streaming not stopped!";
//       }

//       // 3️⃣ Then try to stop recording
//       try {
//         await axios.delete(`${RECORDING_API_URL}/Recording/stop/${id}`);
//         messageText += "and Recording stopped successfully!";
//       } catch (recErr) {
//         console.error("Recording stop failed:", recErr);
//         messageText += ",⚠️ Recording not stopped!";
//       }

//       // 🔔 Final combined alert
//       alert(messageText);
//     } catch (err) {
//       console.error("Camera delete failed:", err);
//       alert("❌ Failed to delete camera!");
//     } finally {
//       setDeletingId(null);
//     }
//   };


//   // ✅ Analytics toggle with modal warning
//   const handleAnalyticsToggle = async (camera, field, value) => {
//     if (value) {
//       // ✅ Analytics ON → open modal
//       setSelectedCamera(camera);
//       setAnalyticsField(field);
//       setAnalyticsValue(value);
//       setAnalyticsModalOpen(true);
//     } else {
//       // ✅ Analytics OFF → call API directly
//       try {
//         // Mark this camera as loading
//         setAnalyticsLoadingIds((prev) => [...prev, camera.id]);

//         const payload = {
//           cameras: [
//             {
//               objectlist: "[]",
//               camera_id: camera.id,
//               url: camera.rtspurl || camera.url,
//               camera_ip: camera.cameraIP || "",
//               user_id: camera.user_id || userId,
//               credit_id: camera.credit_id || 0,
//               running: "False",
//             },
//           ],
//         };

//         await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, payload);

//         // Update camera DB
//         const dbPayload = { ...camera, [field]: 0, userid: String(userId) };
//         await deviceApi.put(`/Camera/${camera.id}/`, dbPayload);

//         message.success("Analytics turned off successfully");
//         fetchData(); // refresh table
//       } catch (err) {
//         console.error("Failed to turn off analytics:", err);
//         message.error("Failed to turn off analytics");
//       } finally {
//         // Remove loading state
//         setAnalyticsLoadingIds((prev) => prev.filter((id) => id !== camera.id));
//       }
//     }
//   };



//   // ✅ Toggle with streaming API support
//   // ✅ Toggle Streaming / Recording with API support
//   const handleToggle = async (row, field, value) => {
//     // Optimistic UI update
//     setData((prev) =>
//       prev.map((cam) =>
//         cam.id === row.id ? { ...cam, [field]: value ? 1 : 0 } : cam
//       )
//     );

//     try {
//       // 1️⃣ Update Camera DB
//       const payload = {
//         ...row,
//         [field]: value ? 1 : 0,
//         userid: String(userId),
//       };
//       await deviceApi.put(`/Camera/${row.id}/`, payload);

//       // 2️⃣ External API calls
//       if (field === "isStreaming") {
//         if (value) {
//           // Start streaming
//           await axios.post(`${STREAMING_API_URL}/Streaming/add_camera/`, {
//             rtspUrl: row.rtspurl,
//             cameraId: row.id,
//             creditId: row.creditId || 0,
//           });
//           message.success("Streaming started successfully!");
//         } else {
//           // Stop streaming
//           try {
//             await axios.delete(
//               `${STREAMING_API_URL}/Streaming/remove_camera/${row.id}`
//             );
//             message.success("Streaming stopped successfully!");
//           } catch (err) {
//             console.error("Streaming stop failed:", err);
//             message.warning("Camera updated but streaming not stopped!");
//           }
//         }
//       } else if (field === "isRecording") {
//         if (value) {
//           // Start recording
//           await axios.post(`${RECORDING_API_URL}/Recording/start/`, {
//             streamUrl: row.rtspurl,
//             cameraId: row.id,
//           });
//           message.success("Recording started successfully!");
//         } else {
//           // Stop recording
//           try {
//             await axios.delete(
//               `${RECORDING_API_URL}/Recording/stop/${row.id}`
//             );
//             message.success("Recording stopped successfully!");
//           } catch (err) {
//             console.error("Recording stop failed:", err);
//             message.warning("Camera updated but recording not stopped!");
//           }
//         }
//       } else {
//         // For other fields
//         message.success(`${field} updated successfully`);
//       }
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error(`Failed to update ${field}`);
//       fetchData(); // rollback
//     }
//   };

//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("name", {
//       header: "Camera Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => {
//         const val = info.getValue();
//         return (
//           <Tag color={val === 0 ? "green" : "red"}>
//             {val === 0 ? "Online" : "Offline"}
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("isRecording", {
//       header: "Recording",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isRecording", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isStreaming", {
//       header: "Streaming",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) =>
//             handleToggle(info.row.original, "isStreaming", val)
//           }
//         />
//       ),
//     }),
//     columnHelper.accessor("isAnalytics", {
//       header: "Analytics",
//       cell: (info) => {
//         const camera = info.row.original;
//         const loading = analyticsLoadingIds.includes(camera.id);
//         return (
//           <Switch
//             checked={!!info.getValue()}
//             onChange={(val) => handleAnalyticsToggle(camera, "isAnalytics", val)}
//             loading={loading} // ✅ show spinner
//             disabled={loading} // optional: disable toggle while processing
//           />
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{
//                 color: "#9000DB",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => setViewCamera(row)}
//             />
//             <EditOutlined
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() =>
//                 navigate(`/camera/form`, { state: { camera: row } })
//               }
//             />
//             <Popconfirm
//               title="Are you sure to delete this camera?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{
//                     color: "#dc2626",
//                     fontSize: "15px",
//                     cursor: "pointer",
//                   }}
//                 />
//               )}
//             </Popconfirm>
//             <CameraFilled
//               style={{
//                 color: "#16a34a",
//                 fontSize: "15px",
//                 cursor: "pointer",
//               }}
//               onClick={() => {
//                 setSelectedCamera(row);
//                 setIsCameraModalOpen(true);
//               }}
//             />

//             {/* Camera Modal */}
//             <CameraModal
//               open={isCameraModalOpen}
//               onClose={() => setIsCameraModalOpen(false)}
//               camera={selectedCamera}
//             />

//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header with Filters */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Camera Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search cameras..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <select
//             value={statusFilter}
//             onChange={(e) => setStatusFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Status</option>
//             <option value="online" className="text-black">Online</option>
//             <option value="offline" className="text-black">Offline</option>
//           </select>
//           <select
//             value={featureFilter}
//             onChange={(e) => setFeatureFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Features</option>
//             <option value="recording" className="text-black">Recording</option>
//             <option value="streaming" className="text-black">Streaming</option>
//             <option value="analytics" className="text-black">Analytics</option>
//           </select>
//           <select
//             value={zoneFilter}
//             onChange={(e) => setZoneFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All Zones</option>
//             {zones.map((z) => (
//               <option key={z.id} value={z.id} className="text-black">
//                 {z.name}
//               </option>
//             ))}
//           </select>
//           <select
//             value={nvrFilter}
//             onChange={(e) => setNvrFilter(e.target.value)}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
//           >
//             <option value="all" className="text-black">All NVRs</option>
//             {nvrs.map((n) => (
//               <option key={n.id} value={n.id} className="text-black">
//                 {n.name}
//               </option>
//             ))}
//           </select>
//           <button
//             onClick={() => navigate("/camera/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Camera
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(
//                       header.column.columnDef.header,
//                       header.getContext()
//                     )}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(
//                         cell.column.columnDef.cell,
//                         cell.getContext()
//                       )}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td
//                   colSpan={columns.length}
//                   className="py-6 text-center text-gray-500"
//                 >
//                   No cameras found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* Pagination */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <span className="text-sm text-gray-600">
//           Page {page} of {totalPages}
//         </span>
//         <div className="flex gap-2">
//           <button
//             onClick={() => setPage((p) => Math.max(p - 1, 1))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === 1}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === totalPages}
//           >
//             Next
//           </button>
//         </div>
//       </div>

//       {/* View Modal */}
//       <Modal
//         title="Camera Details"
//         open={!!viewCamera}
//         onCancel={() => setViewCamera(null)}
//         footer={null}
//       >
//         {viewCamera && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewCamera.id}</p>
//             <p><b>Name:</b> {viewCamera.name}</p>
//             <p><b>IP:</b> {viewCamera.cameraIP}</p>
//             <p><b>Location:</b> {viewCamera.location}</p>
//             <p><b>Zone:</b> {viewCamera.zone}</p>
//             <p><b>Brand:</b> {viewCamera.brand}</p>
//             <p><b>Manufacture:</b> {viewCamera.manufacture}</p>
//             <p><b>MAC:</b> {viewCamera.macAddress}</p>
//             <p><b>Port:</b> {viewCamera.port}</p>
//             <p><b>Channel:</b> {viewCamera.channelId}</p>
//             <p><b>Latitude:</b> {viewCamera.latitude}</p>
//             <p><b>Longitude:</b> {viewCamera.longitude}</p>
//             <p><b>RTSP URL:</b> {viewCamera.rtspurl}</p>
//             <p><b>Status:</b> {viewCamera.status === 1 ? "Online" : "Offline"}</p>
//             <p><b>Recording:</b> {viewCamera.isRecording ? "Yes" : "No"}</p>
//             <p><b>Streaming:</b> {viewCamera.isStreaming ? "Yes" : "No"}</p>
//             <p><b>Registered:</b> {new Date(viewCamera.regDate).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>
//       {/* // ✅ Analytics Modal */}
//       <AnalyticsModal
//         open={analyticsModalOpen}
//         onClose={() => setAnalyticsModalOpen(false)}
//         field={analyticsField}
//         value={analyticsValue}
//         userId={userId}
//         camera={selectedCamera}
//         onSaved={fetchData}   // ✅ refresh camera list after close
//       />
//  {/* Footer */}
// <div className="fixed bottom-2 right-4 text-xs font-bold">
//   <span className="text-red-600">© Ajeevi</span>{" "}
//   <span className="text-blue-600">Technologies Pvt. Ltd.</span>
// </div>

//     </div>
//   );
// };

// export default CameraDetailsTable;
