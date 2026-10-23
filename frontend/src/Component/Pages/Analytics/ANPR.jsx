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

const isANPRAlert = (objectName, alertType) => {
  try {
    const objStr = String(objectName || "").toLowerCase();
    const typeStr = String(alertType || "").toLowerCase();
    return objStr.includes("plate") || objStr.includes("numberplate") || typeStr.includes("anpr");
  } catch {
    return false;
  }
};

const ANPRTable = () => {
  // Refs for managing state across renders
  const isPreviewOpenRef = useRef(false);
  const lastFetchTimeRef = useRef(Date.now());
  const previousDataHashRef = useRef("");
  const previousTotalCountRef = useRef(0);
  const lastCheckTimeRef = useRef(Date.now());
  
  // State variables
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

  // Calculate hash of data to detect changes
  const calculateDataHash = useCallback((dataArray) => {
    if (!dataArray || dataArray.length === 0) return "empty";
    const ids = dataArray.map(item => item.id).sort().join(",");
    const timestamps = dataArray.map(item => item.regDate).sort().join(",");
    return `${ids}_${timestamps}`;
  }, []);

  // Define table columns
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
        <span className="px-3 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          🚗 ANPR
        </span>
      ),
    }),
    columnHelper.accessor("objectName", {
      header: "Plate Number",
      cell: (info) => {
        const val = info.getValue();
        if (!val) return "-";
        try {
          // If it's a JSON string like "{'Rodent': 1}" or just the plate text
          if (val.includes("{")) {
             // In ANPR case it might be different, let's try to extract if it stays in similar format
             return val;
          }
          return val;
        } catch {
          return val;
        }
      }
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
              className="object-cover rounded border border-blue-100 shadow-sm"
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

  // Fetch cameras from API
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
      const checkUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}`;
      const res = await deviceApi.get(checkUrl);
      const alertsOnly = (res.data.results || []).filter(item => isANPRAlert(item.objectName, item.alertType));
      const newTotalCount = alertsOnly.length;
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
  }, [cameraFilter, autoRefresh, userId]);

  const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false) => {
    if (isPreviewOpenRef.current && !forceFetch) return;
    if (!autoRefresh && !forceFetch && !isManualRefresh) return;
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 2000 && !forceFetch) return;

    try {
      setLoading(true);
      lastFetchTimeRef.current = now;
      const apiUrl = `/CameraAlert/?userid=${userId}&page=1&pageSize=1000&camera_id=${cameraFilter || ""}`;
      const res = await deviceApi.get(apiUrl);
      let allAlerts = (res.data.results || []).filter(item => isANPRAlert(item.objectName, item.alertType));
      
      if (globalFilter && globalFilter.trim()) {
        const q = globalFilter.trim().toLowerCase();
        allAlerts = allAlerts.filter(item =>
          (item.plateNumber || item.plate_number || item.licensePlate || item.license_plate || "").toLowerCase().includes(q) ||
          (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
          (item.objectName || "").toLowerCase().includes(q) ||
          (item.alertType || "").toLowerCase().includes(q) ||
          (item.camera_location || item.location || "").toLowerCase().includes(q) ||
          String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
          String(item.id || "").toLowerCase().includes(q)
        );
      }

      const accurateTotalCount = allAlerts.length;
      const startIndex = (page - 1) * pageSize;
      const newData = allAlerts.slice(startIndex, startIndex + pageSize);

      setData(newData);
      setTotalCount(accurateTotalCount);
      previousDataHashRef.current = calculateDataHash(newData);
      previousTotalCountRef.current = accurateTotalCount;
      const calculatedPages = Math.max(1, Math.ceil(accurateTotalCount / pageSize));
      setTotalPages(calculatedPages);
      setHasNewData(false);
      setNewDataCount(0);
      setLastRefreshTime(Date.now());
      if (page > calculatedPages && accurateTotalCount > 0) {
        setPage(calculatedPages);
      }
      // Auto-create tickets for new alerts
      createTicketForAlerts(newData, "ANPR", "Surveillance Alert");
    } catch (err) {
      console.error("ANPR API Error:", err);
    } finally {
      setLoading(false);
    }
  }, [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash, userId]);

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
    return `${Math.floor(minutes / 60)}h ago`;
  };

  useEffect(() => {
    fetchCameras();
    fetchData(true);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(async () => {
      if (isPreviewOpenRef.current) return;
      const found = await checkForNewData();
      if (found && page === 1) fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkForNewData, fetchData, autoRefresh, page]);

  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    setHasNewData(false);
    setNewDataCount(0);
    setPage(1);
    fetchData(true);
  }, [globalFilter, cameraFilter, pageSize]);

  useEffect(() => {
    if (previousDataHashRef.current === "") return;
    fetchData(true);
  }, [page]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination: { pageIndex: page - 1, pageSize } },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
  });

  const handleSearch = useMemo(() => debounce((val) => { setGlobalFilter(val); setPage(1); }, 300), []);

  return (
    <div className="p-4 space-y-4 max-w-full">
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h2 className="text-xl font-bold text-[#fce4e4]">ANPR Detections</h2>
          {hasNewData && (
            <button onClick={handleManualRefresh} className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex items-center gap-1 animate-pulse">
              <span>🔄</span> {newDataCount > 0 ? `${newDataCount} New Alert${newDataCount > 1 ? 's' : ''}!` : 'New Alerts!'}
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
          <span className="text-xs text-gray-300">Last updated: {formatTimeSinceLastRefresh()}</span>
          <input type="text" placeholder="Search plates..." defaultValue={globalFilter} onChange={(e) => handleSearch(e.target.value)} className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-blue-300 min-w-[150px] text-black" />
          <select value={cameraFilter} onChange={(e) => { setCameraFilter(e.target.value); setPage(1); }} className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px] text-black">
            <option value="">All Cameras</option>
            {cameras.map((cam) => (<option key={cam.id} value={cam.id}>{cam.name || `Camera ${cam.id}`}</option>))}
          </select>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="px-2 py-1 border border-gray-300 rounded-md text-sm text-black">
            {[10, 25, 50].map((size) => (<option key={size} value={size}>Show {size}</option>))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-[#9864db] text-[#E6E6FA]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 border border-[#e7e5ec] text-left cursor-pointer" onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted()] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading && data.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center py-6 text-black">Loading ANPR Detections...</td></tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-green-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 border border-green-100 whitespace-normal break-words">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr><td colSpan={columns.length} className="text-center py-12 text-gray-500">No plates detected.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <span className="text-sm text-gray-600">Page {page} of {totalPages || 1}</span>
          <span className="text-sm text-gray-600">Showing {data.length} of {totalCount} detection{totalCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => setPage((p) => Math.max(p - 1, 1))} className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={page === 1 || loading}>Prev</button>
          <button onClick={() => setPage((p) => Math.min(p + 1, totalPages))} className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={page === totalPages || loading}>Next</button>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-sm text-gray-600">Go to:</span>
            <input type="number" min="1" max={totalPages} value={page} onChange={(e) => { const v = parseInt(e.target.value); if (v >= 1 && v <= totalPages) setPage(v); }} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center" disabled={loading} />
          </div>
        </div>
      </div>
      <div className="fixed bottom-2 right-4 text-xs font-bold"><span className="text-red-600">© Ajeevi</span> <span className="text-blue-600">Technologies Pvt. Ltd.</span></div>
    </div>
  );
};

export default ANPRTable;
