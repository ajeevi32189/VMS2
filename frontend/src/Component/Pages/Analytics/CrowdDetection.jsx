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
import { deviceApi } from "../../../utils/axiosInstance";
import { ANALYTICS_API_URL } from "../../../config";
import { createTicketForAlerts } from "../../../utils/autoTicket";
import { AlertSnapshot, formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const isCrowdAlert = (objectName, alertType) => {
  try {
    return (
      objectName?.toLowerCase().includes("crowd") ||
      alertType?.toLowerCase().includes("crowd")
    );
  } catch {
    return false;
  }
};

const CrowdDetection = () => {
  const isPreviewOpenRef = useRef(false);
  const lastFetchTimeRef = useRef(Date.now());
  const previousDataHashRef = useRef("");
  const previousTotalCountRef = useRef(0);
  const lastCheckTimeRef = useRef(Date.now());

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

  const userId = Cookies.get("userId");

  const calculateDataHash = useCallback((dataArray) => {
    if (!dataArray || dataArray.length === 0) return "empty";
    const ids = dataArray.map((item) => item.id).sort().join(",");
    const timestamps = dataArray.map((item) => item.regDate).sort().join(",");
    return `${ids}_${timestamps}`;
  }, []);

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
        <span className="px-3 py-1 text-xs rounded-full bg-purple-50 text-purple-700 border border-purple-200">
          👥 Crowd
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
                  if (visible) {
                    setAutoRefresh(false);
                  } else {
                    setTimeout(() => setAutoRefresh(true), 2000);
                  }
                },
              }}
            />
          </div>
        );
      },
    }),
  ];

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
      const checkUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}&alertType=Crowd&objectName=Crowd`;
      const res = await deviceApi.get(checkUrl);
      const crowdAlertsOnly = (res.data.results || []).filter((item) =>
        isCrowdAlert(item.objectName, item.alertType)
      );
      const newTotalCount = crowdAlertsOnly.length;
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
        const apiUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}&alertType=Crowd&objectName=Crowd`;
        const res = await deviceApi.get(apiUrl);
        let allCrowdAlerts = (res.data.results || []).filter((item) =>
          isCrowdAlert(item.objectName, item.alertType)
        );

        if (globalFilter && globalFilter.trim()) {
          const q = globalFilter.trim().toLowerCase();
          allCrowdAlerts = allCrowdAlerts.filter((item) =>
            (item.camera_name || "").toLowerCase().includes(q) ||
            (item.objectName || "").toLowerCase().includes(q) ||
            (item.alertType || "").toLowerCase().includes(q) ||
            (item.camera_location || "").toLowerCase().includes(q) ||
            String(item.deviceId || "").toLowerCase().includes(q) ||
            String(item.id || "").toLowerCase().includes(q)
          );
        }

        const accurateTotalCount = allCrowdAlerts.length;
        const startIndex = (page - 1) * pageSize;
        const newData = allCrowdAlerts.slice(startIndex, startIndex + pageSize);

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
        if (page > calculatedTotalPages && calculatedTotalPages > 0) {
          setPage(calculatedTotalPages);
        }
        // Auto-create tickets for new alerts
        createTicketForAlerts(newData, "Crowd Detection", "Surveillance Alert");
      } catch (err) {
        console.error("Crowd API Error:", err);
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

  const getAccurateTotalCount = useCallback(async () => {
    try {
      const apiUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}`;
      const res = await deviceApi.get(apiUrl);
      let crowdAlertsOnly = (res.data.results || []).filter((item) =>
        isCrowdAlert(item.objectName, item.alertType)
      );
      if (globalFilter && globalFilter.trim()) {
        const q = globalFilter.trim().toLowerCase();
        crowdAlertsOnly = crowdAlertsOnly.filter((item) =>
          (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
          (item.objectName || "").toLowerCase().includes(q) ||
          (item.alertType || "").toLowerCase().includes(q) ||
          (item.camera_location || item.location || "").toLowerCase().includes(q) ||
          String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
          String(item.id || "").toLowerCase().includes(q)
        );
      }
      return crowdAlertsOnly.length;
    } catch (err) {
      console.error("Error getting accurate total count:", err);
      return totalCount;
    }
  }, [cameraFilter, globalFilter, userId, totalCount]);

  // Initial fetch
  useEffect(() => {
    fetchCameras();
    fetchData(true);
  }, []);

  // Auto-check for new data
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(async () => {
      if (isPreviewOpenRef.current) return;
      const hasNew = await checkForNewData();
      if (hasNew && page === 1) {
        fetchData();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [checkForNewData, fetchData, autoRefresh, page]);

  // Filter changes
  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    setHasNewData(false);
    setNewDataCount(0);
    setPage(1);
    fetchData(true);
  }, [globalFilter, cameraFilter, pageSize]);

  // Page change
  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    const fetchPageData = async () => {
      try {
        setLoading(true);
        lastFetchTimeRef.current = Date.now();
        const apiUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}`;
        const res = await deviceApi.get(apiUrl);
        let allCrowdAlerts = (res.data.results || []).filter((item) =>
          isCrowdAlert(item.objectName, item.alertType)
        );

        if (globalFilter && globalFilter.trim()) {
          const q = globalFilter.trim().toLowerCase();
          allCrowdAlerts = allCrowdAlerts.filter((item) =>
            (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
            (item.objectName || "").toLowerCase().includes(q) ||
            (item.alertType || "").toLowerCase().includes(q) ||
            (item.camera_location || item.location || "").toLowerCase().includes(q) ||
            String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
            String(item.id || "").toLowerCase().includes(q)
          );
        }

        const accurateTotalCount = allCrowdAlerts.length;
        const startIndex = (page - 1) * pageSize;
        const newData = allCrowdAlerts.slice(startIndex, startIndex + pageSize);

        setData(newData);
        setTotalCount(accurateTotalCount);
        setTotalPages(Math.max(1, Math.ceil(accurateTotalCount / pageSize)));
        setLastRefreshTime(Date.now());
        previousDataHashRef.current = calculateDataHash(newData);
        previousTotalCountRef.current = accurateTotalCount;
        setHasNewData(false);
        setNewDataCount(0);
      } catch (err) {
        console.error("Crowd API Error on page change:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPageData();
  }, [page]);

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
      {/* Header */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h2 className="text-xl font-bold text-[#fce4e4]">Crowd Alerts</h2>
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
            <span className="text-xs text-gray-300">
              Last updated: {formatTimeSinceLastRefresh()}
            </span>
            {hasNewData && (
              <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-pulse">
                {newDataCount > 0 ? `${newDataCount} New` : "New!"}
              </span>
            )}
          </div>

          <input
            type="text"
            placeholder="Search alerts..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]"
          />

          <select
            value={cameraFilter}
            onChange={(e) => {
              setCameraFilter(e.target.value);
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
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
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm"
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size} className="text-black">
                Show {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
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
                    <div className="w-6 h-6 border-2 border-[#9864db] border-t-transparent rounded-full animate-spin"></div>
                    Loading Crowd Alerts...
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
                  No crowd alerts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages || 1}
          </span>
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
                if (value >= 1 && value <= totalPages) {
                  setPage(value);
                }
              }}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default CrowdDetection;
