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

const isSmokeAlert = (objectName, alertType) => {
    try {
        const objStr = String(objectName || "").toLowerCase();
        const typeStr = String(alertType || "").toLowerCase();
        return (
            (objStr.includes("smoke") || typeStr.includes("smoke")) &&
            !objStr.includes("face") &&
            !typeStr.includes("face")
        );
    } catch {
        return false;
    }
};

const SmokeTable = () => {
    const isPreviewOpenRef = useRef(false);
    const lastFetchTimeRef = useRef(Date.now());
    const previousDataHashRef = useRef("");
    const previousTotalCountRef = useRef(0);
    const lastCheckTimeRef = useRef(Date.now());
    const checkIntervalRef = useRef(null);
    
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
    const [autoRefresh, setAutoRefresh] = useState(false); 
    const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
    const [newDataCount, setNewDataCount] = useState(0);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const userId = Cookies.get("userId");

    // Calculate hash of data to detect changes
    const calculateDataHash = useCallback((dataArray) => {
        if (!dataArray || dataArray.length === 0) return "empty";
        const ids = dataArray.map(item => item.id).sort().join(",");
        const timestamps = dataArray.map(item => item.regDate).sort().join(",");
        return `${ids}_${timestamps}`;
    }, []);

    // Columns
    const columns = useMemo(() => [
        columnHelper.display({
            id: "srno",
            header: "Sr. No.",
            cell: (info) => pageSize * (page - 1) + info.row.index + 1,
        }),
        columnHelper.accessor("camera_name", {
            header: "Camera Name",
            cell: (info) => {
                const raw = info.getValue();
                if (!raw) return "-";
                try {
                    const cleaned = raw.replace(/'/g, '"');
                    const parsed = JSON.parse(cleaned);
                    return (
                        <div className="flex flex-wrap gap-1">
                            {Object.entries(parsed).map(([k, v]) => (
                                <span key={k} className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
                                    {k}: {v}
                                </span>
                            ))}
                        </div>
                    );
                } catch {
                    return <span className="whitespace-normal break-words">{raw}</span>;
                }
            },
        }),
        columnHelper.display({
            id: "event",
            header: "Event",
            cell: () => (
                <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                    💨 Smoke
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
                    case "B": label = "Basic"; color = "bg-blue-100 text-blue-700"; break;
                    case "C": label = "Critical"; color = "bg-red-100 text-red-700"; break;
                    case "S": label = "Severe"; color = "bg-orange-100 text-orange-700"; break;
                    case "N": label = "Normal"; color = "bg-green-100 text-green-700"; break;
                }
                return <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>{label}</span>;
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
                    <AlertSnapshot
                        path={path}
                        cameraName={row.camera_name}
                        alt="frame"
                        width={90}
                        height={70}
                        className="object-cover rounded border"
                        preview={{
                            mask: "Click to Preview",
                            onVisibleChange: (visible) => {
                                isPreviewOpenRef.current = visible;
                                if (visible) {
                                    if (checkIntervalRef.current) { clearInterval(checkIntervalRef.current); checkIntervalRef.current = null; }
                                } else {
                                    if (autoRefresh) startDataCheckInterval();
                                }
                            }
                        }}
                    />
                );
            },
        }),
    ], [page, pageSize, autoRefresh]);

    // Fetch cameras
    const fetchCameras = async () => {
        try {
            const res = await deviceApi.get(`/Camera/?userid=${userId}&page_size=100`);
            setCameras(res.data.results || []);
        } catch (err) {
            console.error("Camera fetch failed:", err);
        }
    };

    // Get accurate total count of smoke alerts
    const getAccurateTotalCount = useCallback(async () => {
        try {
            const apiUrl = `/CameraAlert/?userid=${userId}&camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=1&pageSize=1000&start_date=`;
            const res = await deviceApi.get(apiUrl);
            let smokeAlertsOnly = (res.data.results || []).filter(item => isSmokeAlert(item.objectName));
            if (globalFilter && globalFilter.trim()) {
                const q = globalFilter.trim().toLowerCase();
                smokeAlertsOnly = smokeAlertsOnly.filter(item =>
                    (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
                    (item.objectName || "").toLowerCase().includes(q) ||
                    (item.alertType || "").toLowerCase().includes(q) ||
                    (item.camera_location || item.location || "").toLowerCase().includes(q) ||
                    String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
                    String(item.id || "").toLowerCase().includes(q)
                );
            }
            return smokeAlertsOnly.length;
        } catch (err) {
            console.error("Error getting accurate total count:", err);
            return totalCount;
        }
    }, [cameraFilter, globalFilter, totalCount, userId]);

    // Check for new data
    const checkForNewData = useCallback(async () => {
        if (isPreviewOpenRef.current || !autoRefresh) return;
        const now = Date.now();
        if (now - lastCheckTimeRef.current < 10000) return;
        lastCheckTimeRef.current = now;
        try {
            const checkUrl = `/CameraAlert/?userid=${userId}&camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=1&pageSize=1000&start_date=`;
            const res = await deviceApi.get(checkUrl);
            const smokeAlertsOnly = (res.data.results || []).filter(item => isSmokeAlert(item.objectName));
            const newTotalCount = smokeAlertsOnly.length;
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

    // Fetch smoke data
    const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false) => {
        if (isPreviewOpenRef.current && !forceFetch) return;
        if (!autoRefresh && !forceFetch && !isManualRefresh) return;
        const now = Date.now();
        if (now - lastFetchTimeRef.current < 5000 && !forceFetch && !isManualRefresh) return;
        try {
            setLoading(true);
            lastFetchTimeRef.current = now;
            const apiUrl = `/CameraAlert/?userid=${userId}&camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=1&pageSize=1000&start_date=`;
            const res = await deviceApi.get(apiUrl);
            let allSmokeAlerts = (res.data.results || []).filter(item => isSmokeAlert(item.objectName));

            if (globalFilter && globalFilter.trim()) {
                const q = globalFilter.trim().toLowerCase();
                allSmokeAlerts = allSmokeAlerts.filter(item =>
                    (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
                    (item.objectName || "").toLowerCase().includes(q) ||
                    (item.alertType || "").toLowerCase().includes(q) ||
                    (item.camera_location || item.location || "").toLowerCase().includes(q) ||
                    String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
                    String(item.id || "").toLowerCase().includes(q)
                );
            }

            const accurateTotalCount = allSmokeAlerts.length;
            const startIndex = (page - 1) * pageSize;
            const newData = allSmokeAlerts.slice(startIndex, startIndex + pageSize);

            const newDataHash = calculateDataHash(newData);
            if (newDataHash !== previousDataHashRef.current || isManualRefresh || forceFetch) {
                setData(newData);
                setTotalCount(accurateTotalCount);
                previousDataHashRef.current = newDataHash;
                previousTotalCountRef.current = accurateTotalCount;
                setTotalPages(Math.max(1, Math.ceil(accurateTotalCount / pageSize)));
                setHasNewData(false);
                setNewDataCount(0);
                // Auto-create tickets for new alerts
                createTicketForAlerts(newData, "Smoke Detection", "Surveillance Alert");
            }
            setLastRefreshTime(Date.now());
        } catch (err) {
            console.error("Smoke API Error:", err);
        } finally {
            setLoading(false);
            setIsInitialLoad(false);
        }
    }, [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash, userId]);

    const handleManualRefresh = () => {
        setHasNewData(false);
        setNewDataCount(0);
        fetchData(true, true);
    };

    const startDataCheckInterval = () => {
        if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
        if (!autoRefresh || isPreviewOpenRef.current) return;
        checkIntervalRef.current = setInterval(async () => {
            if (isPreviewOpenRef.current || !autoRefresh) return;
            const hasNew = await checkForNewData();
            if (hasNew && page === 1) fetchData();
        }, 30000);
    };

    const stopDataCheckInterval = () => {
        if (checkIntervalRef.current) { clearInterval(checkIntervalRef.current); checkIntervalRef.current = null; }
    };

    const formatTimeSinceLastRefresh = () => {
        const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        return `${Math.floor(minutes / 60)}h ago`;
    };

    useEffect(() => {
        if (userId) { fetchCameras(); fetchData(true); }
    }, [userId]);

    useEffect(() => {
        if (autoRefresh) startDataCheckInterval(); else stopDataCheckInterval();
        return () => stopDataCheckInterval();
    }, [autoRefresh]);

    useEffect(() => {
        if (previousDataHashRef.current === "") return;
        setHasNewData(false);
        setNewDataCount(0);
        setPage(1);
        fetchData(true);
    }, [globalFilter, cameraFilter, pageSize]);

    useEffect(() => {
        if (previousDataHashRef.current === "") return;
        const fetchPageData = async () => {
            try {
                setLoading(true);
                lastFetchTimeRef.current = Date.now();
                const apiUrl = `/CameraAlert/?userid=${userId}&camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=1&pageSize=1000&start_date=`;
                const res = await deviceApi.get(apiUrl);
                let allSmokeAlerts = (res.data.results || []).filter(item => isSmokeAlert(item.objectName));

                if (globalFilter && globalFilter.trim()) {
                    const q = globalFilter.trim().toLowerCase();
                    allSmokeAlerts = allSmokeAlerts.filter(item =>
                        (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
                        (item.objectName || "").toLowerCase().includes(q) ||
                        (item.alertType || "").toLowerCase().includes(q) ||
                        (item.camera_location || item.location || "").toLowerCase().includes(q) ||
                        String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
                        String(item.id || "").toLowerCase().includes(q)
                    );
                }

                const accurateTotalCount = allSmokeAlerts.length;
                const startIndex = (page - 1) * pageSize;
                const newData = allSmokeAlerts.slice(startIndex, startIndex + pageSize);

                setData(newData);
                setTotalCount(accurateTotalCount);
                setTotalPages(Math.max(1, Math.ceil(accurateTotalCount / pageSize)));
                setLastRefreshTime(Date.now());
                previousDataHashRef.current = calculateDataHash(newData);
                previousTotalCountRef.current = accurateTotalCount;
                setHasNewData(false);
                setNewDataCount(0);
            } catch (err) {
                console.error("Smoke API Error on page change:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchPageData();
    }, [page, userId, cameraFilter, globalFilter, pageSize, calculateDataHash]);

    const table = useReactTable({
        data,
        columns,
        state: { sorting, pagination: { pageIndex: page - 1, pageSize } },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        manualPagination: true,
    });

    const handleSearch = useMemo(() => debounce((value) => { setGlobalFilter(value); setPage(1); }, 300), []);

    return (
        <div className="p-4 space-y-4 max-w-full">
            <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <h2 className="text-xl font-bold text-[#fce4e4]">Smoke Alerts</h2>
                    {hasNewData && (
                        <button onClick={handleManualRefresh} className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors flex items-center gap-1 animate-pulse">
                            <span>🔄</span> {newDataCount > 0 ? `${newDataCount} New Alert${newDataCount > 1 ? 's' : ''}! Click to Refresh` : 'New Alerts Available! Click to Refresh'}
                        </button>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-300">Last updated: {formatTimeSinceLastRefresh()}</span>
                        {hasNewData && <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-pulse">{newDataCount > 0 ? `${newDataCount} New` : 'New!'}</span>}
                    </div>
                    <input type="text" placeholder="Search alerts..." onChange={(e) => handleSearch(e.target.value)} className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]" />
                    <select value={cameraFilter} onChange={(e) => { setCameraFilter(e.target.value); setPage(1); }} className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]">
                        <option value="">All Cameras</option>
                        {cameras.map((cam) => <option key={cam.id} value={cam.id} className="text-black">{cam.name || `Camera ${cam.id}`}</option>)}
                    </select>
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="px-2 py-1 border border-gray-300 rounded-md text-sm">
                        {[10, 25, 50].map((size) => <option key={size} value={size} className="text-black">Show {size}</option>)}
                    </select>
                </div>
            </div>
            <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
                <table className="min-w-full text-sm">
                    <thead className="bg-[#9864db] text-[#E6E6FA]">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <th key={header.id} className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer" onClick={header.column.getToggleSortingHandler()}>
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === "asc" ? " 🔼" : header.column.getIsSorted() === "desc" ? " 🔽" : null}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="bg-white divide-y divide-green-100">
                        {loading && data.length === 0 ? (
                            <tr><td colSpan={columns.length} className="text-center py-6"><div className="flex items-center justify-center gap-2"><div className="w-6 h-6 border-2 border-[#9864db] border-t-transparent rounded-full animate-spin"></div>Loading Smoke Alerts...</div></td></tr>
                        ) : table.getRowModel().rows.length > 0 ? (
                            table.getRowModel().rows.map((row) => (
                                <tr key={row.id} className="hover:bg-green-50">
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className="px-4 py-3 border border-green-100 whitespace-normal break-words">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan={columns.length} className="text-center py-12 text-gray-500">No smoke alerts found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                    <span className="text-sm text-gray-600">Page {page} of {totalPages || 1}</span>
                    <span className="text-sm text-gray-600">Showing {data.length} of {totalCount} alert{totalCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex gap-2 items-center">
                    <button onClick={() => setPage((p) => Math.max(p - 1, 1))} className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={page === 1 || loading}>Prev</button>
                    <button onClick={() => setPage((p) => Math.min(p + 1, totalPages))} className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={page === totalPages || loading}>Next</button>
                    <div className="flex items-center gap-1 ml-2">
                        <span className="text-sm text-gray-600">Go to:</span>
                        <input type="number" min="1" max={totalPages} value={page} onChange={(e) => { const value = parseInt(e.target.value); if (value >= 1 && value <= totalPages) setPage(value); }} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center" />
                    </div>
                </div>
            </div>
            <div className="fixed bottom-2 right-4 text-xs font-bold">
                <span className="text-red-600">© Ajeevi</span> <span className="text-blue-600">Technologies Pvt. Ltd.</span>
            </div>
        </div>
    );
};

export default SmokeTable;




//////////////////////



// import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd";
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const SmokeTable = () => {
//     const isPreviewOpenRef = useRef(false);
//     const lastFetchTimeRef = useRef(Date.now());
//     const previousDataHashRef = useRef("");
//     const previousTotalCountRef = useRef(0);
//     const lastCheckTimeRef = useRef(Date.now());
//     const checkIntervalRef = useRef(null);
    
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState("");
//     const [cameras, setCameras] = useState([]);
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [totalCount, setTotalCount] = useState(0);
//     const [loading, setLoading] = useState(false);
//     const [hasNewData, setHasNewData] = useState(false);
//     const [autoRefresh, setAutoRefresh] = useState(false); // Changed to false by default
//     const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
//     const [newDataCount, setNewDataCount] = useState(0);
//     const [isInitialLoad, setIsInitialLoad] = useState(true);

//     // Calculate hash of data to detect changes
//     const calculateDataHash = useCallback((dataArray) => {
//         if (!dataArray || dataArray.length === 0) return "empty";
        
//         // Use IDs and timestamps to create a unique hash
//         const ids = dataArray.map(item => item.id).sort().join(",");
//         const timestamps = dataArray.map(item => item.regDate).sort().join(",");
//         return `${ids}_${timestamps}`;
//     }, []);

//     // Columns
//     const columns = useMemo(() => [
//         // Sr. No.
//         columnHelper.display({
//             id: "srno",
//             header: "Sr. No.",
//             cell: (info) => 
//                 pageSize * (page - 1) + info.row.index + 1,
//         }),
//         // Camera Name
//         columnHelper.accessor("camera_name", {
//             header: "Camera Name",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 if (!raw) return "-";
                
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     return (
//                         <div className="flex flex-wrap gap-1">
//                             {Object.entries(parsed).map(([k, v]) => (
//                                 <span
//                                     key={k}
//                                     className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
//                                 >
//                                     {k}: {v}
//                                 </span>
//                             ))}
//                         </div>
//                     );
//                 } catch {
//                     return <span className="whitespace-normal break-words">{raw}</span>;
//                 }
//             },
//         }),
//         // Event
//         columnHelper.display({
//             id: "event",
//             header: "Event",
//             cell: () => (
//                 <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
//                     💨 smoke
//                 </span>
//             ),
//         }),
//         // Severity
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
                
//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         break;
//                 }

//                 return (
//                     <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
//                         {label}
//                     </span>
//                 );
//             },
//         }),
//         // Timestamp
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         // Snapshot
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={90}
//                         height={70}
//                         className="object-cover rounded border"
//                         preview={{
//                             mask: "Click to Preview",
//                             onVisibleChange: (visible) => {
//                                 isPreviewOpenRef.current = visible;
//                                 if (visible) {
//                                     // Clear interval when preview opens
//                                     if (checkIntervalRef.current) {
//                                         clearInterval(checkIntervalRef.current);
//                                         checkIntervalRef.current = null;
//                                     }
//                                 } else {
//                                     // Restart interval when preview closes (if autoRefresh is ON)
//                                     if (autoRefresh) {
//                                         startDataCheckInterval();
//                                     }
//                                 }
//                             }
//                         }}
//                     />
//                 );
//             },
//         }),
//     ], [page, pageSize, autoRefresh]);

//     // Fetch cameras
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/Camera/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Check for new data WITHOUT fetching full data
//     const checkForNewData = useCallback(async () => {
//         if (isPreviewOpenRef.current || !autoRefresh) return;
        
//         // Throttle check calls (minimum 10 seconds between checks)
//         const now = Date.now();
//         if (now - lastCheckTimeRef.current < 10000) {
//             return;
//         }
        
//         lastCheckTimeRef.current = now;

//         try {
//             // Make a lightweight call to get only the count (pageSize=1 to minimize data)
//             const checkUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=1&pageSize=1&search=${globalFilter}&start_date=`;
//             const res = await deviceApi.get(checkUrl);
//             const newTotalCount = res.data.count || 0;
            
//             // If total count is different, there's new data
//             if (newTotalCount !== previousTotalCountRef.current) {
//                 const difference = newTotalCount - previousTotalCountRef.current;
//                 setNewDataCount(Math.max(0, difference));
//                 setHasNewData(true);
//                 console.log(`New data detected! Difference: ${difference}`);
//                 return true; // New data available
//             }
            
//             console.log("No new data detected.");
//             return false; // No new data
//         } catch (err) {
//             console.error("Check for new data failed:", err);
//             return false;
//         }
//     }, [cameraFilter, globalFilter, autoRefresh]);

//     // Fetch smoke data using deviceApi
//     const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false) => {
//         // Skip if preview is open and not forced
//         if (isPreviewOpenRef.current && !forceFetch) {
//             return;
//         }

//         // Skip if auto-refresh is disabled and not forced
//         if (!autoRefresh && !forceFetch && !isManualRefresh) {
//             return;
//         }

//         // Throttle API calls (minimum 5 seconds between calls)
//         const now = Date.now();
//         if (now - lastFetchTimeRef.current < 5000 && !forceFetch && !isManualRefresh) {
//             console.log("Throttling API call - too soon");
//             return;
//         }

//         try {
//             setLoading(true);
//             lastFetchTimeRef.current = now;

//             const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;
            
//             console.log("Fetching data from:", apiUrl);
//             const res = await deviceApi.get(apiUrl);
//             const newData = res.data.results || [];
//             const newTotalCount = res.data.count || 0;

//             console.log("Data fetched. Count:", newTotalCount, "Previous count:", previousTotalCountRef.current);

//             // Calculate hash of new data
//             const newDataHash = calculateDataHash(newData);
            
//             // Only update if data actually changed
//             if (newDataHash !== previousDataHashRef.current || isManualRefresh || forceFetch) {
//                 setData(newData);
//                 setTotalCount(newTotalCount);
                
//                 // Update the hash reference
//                 previousDataHashRef.current = newDataHash;
//                 previousTotalCountRef.current = newTotalCount;
                
//                 // Calculate total pages
//                 const calculatedTotalPages = Math.ceil((newTotalCount || 1) / pageSize);
//                 setTotalPages(calculatedTotalPages);
                
//                 // Reset new data indicators
//                 setHasNewData(false);
//                 setNewDataCount(0);
                
//                 console.log("Data updated successfully");
//             } else {
//                 console.log("Data hasn't changed, skipping update");
//             }
            
//             // Update last refresh time
//             setLastRefreshTime(Date.now());
            
//             // Adjust page if current page exceeds total pages after data changes
//             if (page > calculatedTotalPages && calculatedTotalPages > 0) {
//                 setPage(calculatedTotalPages);
//             }
//         } catch (err) {
//             console.error("Smoke API Error:", err);
//             // Don't clear data on error, keep showing old data
//         } finally {
//             setLoading(false);
//             setIsInitialLoad(false);
//         }
//     }, [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash]);

//     // Manual refresh function
//     const handleManualRefresh = () => {
//         console.log("Manual refresh triggered");
//         setHasNewData(false);
//         setNewDataCount(0);
//         fetchData(true, true);
//     };

//     // Start data check interval (lightweight check only)
//     const startDataCheckInterval = () => {
//         if (checkIntervalRef.current) {
//             clearInterval(checkIntervalRef.current);
//         }
        
//         if (!autoRefresh || isPreviewOpenRef.current) return;
        
//         console.log("Starting data check interval (30 seconds)");
//         checkIntervalRef.current = setInterval(async () => {
//             if (isPreviewOpenRef.current || !autoRefresh) return;
            
//             console.log("Checking for new data...");
//             const hasNewData = await checkForNewData();
            
//             if (hasNewData) {
//                 console.log("New data found! Will fetch if on page 1");
//                 // If new data found and we're on page 1, fetch it
//                 if (page === 1) {
//                     fetchData();
//                 }
//             }
//         }, 30000); // Check every 30 seconds (not 10)
//     };

//     // Stop data check interval
//     const stopDataCheckInterval = () => {
//         if (checkIntervalRef.current) {
//             console.log("Stopping data check interval");
//             clearInterval(checkIntervalRef.current);
//             checkIntervalRef.current = null;
//         }
//     };

//     // Toggle auto-refresh
//     const toggleAutoRefresh = () => {
//         const newAutoRefreshState = !autoRefresh;
//         setAutoRefresh(newAutoRefreshState);
        
//         if (newAutoRefreshState) {
//             console.log("Auto-refresh enabled");
//             // Start checking for new data
//             startDataCheckInterval();
            
//             // Also check immediately when turning on
//             setTimeout(() => {
//                 checkForNewData();
//             }, 1000);
//         } else {
//             console.log("Auto-refresh disabled");
//             // Stop checking for new data
//             stopDataCheckInterval();
//             setHasNewData(false);
//             setNewDataCount(0);
//         }
//     };

//     // Format time since last refresh
//     const formatTimeSinceLastRefresh = () => {
//         const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000);
//         if (seconds < 60) return `${seconds}s ago`;
//         const minutes = Math.floor(seconds / 60);
//         if (minutes < 60) return `${minutes}m ago`;
//         const hours = Math.floor(minutes / 60);
//         return `${hours}h ago`;
//     };

//     // Initial data and cameras fetch
//     useEffect(() => {
//         fetchCameras();
//         fetchData(true); // Force initial fetch
//     }, []);

//     // Handle auto-refresh changes
//     useEffect(() => {
//         if (autoRefresh) {
//             startDataCheckInterval();
//         } else {
//             stopDataCheckInterval();
//         }
        
//         return () => {
//             stopDataCheckInterval();
//         };
//     }, [autoRefresh]);

//     // Fetch when filters or pagination changes
//     useEffect(() => {
//         // Don't fetch on initial mount
//         if (previousDataHashRef.current === "") return;
        
//         console.log("Filter or pageSize changed, fetching data");
//         setHasNewData(false);
//         setNewDataCount(0);
//         fetchData(true);
//     }, [globalFilter, cameraFilter, pageSize]);

//     // Special effect for page changes
//     useEffect(() => {
//         if (previousDataHashRef.current === "") return;
        
//         console.log("Page changed to:", page);
//         const fetchPageData = async () => {
//             try {
//                 setLoading(true);
//                 lastFetchTimeRef.current = Date.now();

//                 const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;
                
//                 console.log("Fetching page data from:", apiUrl);
//                 const res = await deviceApi.get(apiUrl);
//                 const newData = res.data.results || [];
//                 const newTotalCount = res.data.count || 0;

//                 setData(newData);
//                 setTotalCount(newTotalCount);
//                 setTotalPages(Math.ceil((newTotalCount || 1) / pageSize));
//                 setLastRefreshTime(Date.now());
//                 previousDataHashRef.current = calculateDataHash(newData);
//                 previousTotalCountRef.current = newTotalCount;
                
//                 // Clear new data indicators when user navigates
//                 setHasNewData(false);
//                 setNewDataCount(0);
                
//                 console.log("Page data fetched successfully");
//             } catch (err) {
//                 console.error("Smoke API Error on page change:", err);
//             } finally {
//                 setLoading(false);
//             }
//         };

//         fetchPageData();
//     }, [page]);

//     const table = useReactTable({
//         data,
//         columns,
//         state: { 
//             sorting,
//             pagination: { 
//                 pageIndex: page - 1, 
//                 pageSize 
//             }
//         },
//         onSortingChange: setSorting,
//         getCoreRowModel: getCoreRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//         manualPagination: true,
//     });

//     const handleSearch = useMemo(
//         () =>
//             debounce((value) => {
//                 console.log("Search changed to:", value);
//                 setGlobalFilter(value);
//                 setPage(1);
//             }, 300),
//         []
//     );

//     return (
//         <div className="p-4 space-y-4 max-w-full">
//             {/* Header with new data indicator */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
//                     <h2 className="text-xl font-bold text-[#fce4e4]">
//                         Smoke Alerts
//                     </h2>
//                     {hasNewData && (
//                         <button
//                             onClick={handleManualRefresh}
//                             className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors flex items-center gap-1 animate-pulse"
//                         >
//                             <span>🔄</span>
//                             {newDataCount > 0 ? `${newDataCount} New Alert${newDataCount > 1 ? 's' : ''}! Click to Refresh` : 'New Alerts Available! Click to Refresh'}
//                         </button>
//                     )}
//                 </div>

//                 <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
//                     {/* Refresh status and controls */}
//                     <div className="flex items-center gap-2">
//                         <span className="text-xs text-gray-300">
//                             Last updated: {formatTimeSinceLastRefresh()}
//                         </span>
//                         {hasNewData && (
//                             <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-pulse">
//                                 {newDataCount > 0 ? `${newDataCount} New` : 'New!'}
//                             </span>
//                         )}
                        
                       
//                     </div>

//                     {/* Search */}
//                     <input
//                         type="text"
//                         placeholder="Search alerts..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]"
//                     />

//                     {/* Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             console.log("Camera filter changed to:", e.target.value);
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
//                     >
//                         <option value="">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     {/* Page size */}
//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             console.log("Page size changed to:", e.target.value);
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size} className="text-black">
//                                 Show {size}
//                             </option>
//                         ))}
//                     </select>
//                 </div>
//             </div>

//             {/* Table */}
//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm">
//                     <thead className="bg-[#9864db] text-[#E6E6FA]">
//                         {table.getHeaderGroups().map((headerGroup) => (
//                             <tr key={headerGroup.id}>
//                                 {headerGroup.headers.map((header) => (
//                                     <th
//                                         key={header.id}
//                                         className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
//                                         onClick={header.column.getToggleSortingHandler()}
//                                     >
//                                         {flexRender(
//                                             header.column.columnDef.header,
//                                             header.getContext()
//                                         )}
//                                         {{
//                                             asc: " 🔼",
//                                             desc: " 🔽",
//                                         }[header.column.getIsSorted()] ?? null}
//                                     </th>
//                                 ))}
//                             </tr>
//                         ))}
//                     </thead>
//                     <tbody className="bg-white divide-y divide-green-100">
//                         {loading && data.length === 0 ? (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     <div className="flex items-center justify-center gap-2">
//                                         <div className="w-6 h-6 border-2 border-[#9864db] border-t-transparent rounded-full animate-spin"></div>
//                                         Loading Smoke Alerts...
//                                     </div>
//                                 </td>
//                             </tr>
//                         ) : table.getRowModel().rows.length > 0 ? (
//                             table.getRowModel().rows.map((row) => (
//                                 <tr key={row.id} className="hover:bg-green-50">
//                                     {row.getVisibleCells().map((cell) => (
//                                         <td
//                                             key={cell.id}
//                                             className="px-4 py-3 border border-green-100 whitespace-normal break-words"
//                                         >
//                                             {flexRender(
//                                                 cell.column.columnDef.cell,
//                                                 cell.getContext()
//                                             )}
//                                         </td>
//                                     ))}
//                                 </tr>
//                             ))
//                         ) : (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-12 text-gray-500">
//                                     No smoke alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
//             <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//                 <div className="flex flex-col sm:flex-row items-center gap-2">
//                     <span className="text-sm text-gray-600">
//                         Page {page} of {totalPages || 1}
//                     </span>
//                     <span className="text-sm text-gray-600">
//                         Showing {data.length} of {totalCount} alerts
//                     </span>
//                     {hasNewData && page !== 1 && (
//                         <span className="text-xs text-yellow-600">
//                             New alerts available on page 1
//                         </span>
//                     )}
//                 </div>
//                 <div className="flex gap-2 items-center">
//                     <button
//                         onClick={() => setPage((p) => Math.max(p - 1, 1))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
//                         disabled={page === 1 || loading}
//                     >
//                         Prev
//                     </button>
                    
//                     <button
//                         onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
//                         disabled={page === totalPages || loading}
//                     >
//                         Next
//                     </button>
                    
//                     {/* Go to page input */}
//                     <div className="flex items-center gap-1 ml-2">
//                         <span className="text-sm text-gray-600">Go to:</span>
//                         <input
//                             type="number"
//                             min="1"
//                             max={totalPages}
//                             value={page}
//                             onChange={(e) => {
//                                 const value = parseInt(e.target.value);
//                                 if (value >= 1 && value <= totalPages) {
//                                     setPage(value);
//                                 }
//                             }}
//                             className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
//                         />
//                     </div>
//                 </div>
//             </div>
//             {/* Footer */}
// <div className="fixed bottom-2 right-4 text-xs font-bold">
//   <span className="text-red-600">© Ajeevi</span>{" "}
//   <span className="text-blue-600">Technologies Pvt. Ltd.</span>
// </div>
//         </div>
//     );
// };

// export default SmokeTable;




///////////////////////////////


// import React, { useState, useEffect, useMemo, useRef } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd";
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const SmokeTable = () => {
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState("");
//     const [cameras, setCameras] = useState([]);
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    
//     const refreshIntervalRef = useRef(null);

//     // Columns
//     const columns = useMemo(() => [
//         // Sr. No.
//         columnHelper.display({
//             id: "srno",
//             header: "Sr. No.",
//             cell: (info) => 
//                 pageSize * (page - 1) + info.row.index + 1,
//         }),
//         // Camera Name
//         columnHelper.accessor("camera_name", {
//             header: "Camera Name",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 if (!raw) return "-";
                
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     return (
//                         <div className="flex flex-wrap gap-1">
//                             {Object.entries(parsed).map(([k, v]) => (
//                                 <span
//                                     key={k}
//                                     className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
//                                 >
//                                     {k}: {v}
//                                 </span>
//                             ))}
//                         </div>
//                     );
//                 } catch {
//                     return <span className="whitespace-normal break-words">{raw}</span>;
//                 }
//             },
//         }),
//         // Event
//         columnHelper.display({
//             id: "event",
//             header: "Event",
//             cell: () => (
//                 <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
//                     💨 smoke
//                 </span>
//             ),
//         }),
//         // Severity
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
                
//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         break;
//                 }

//                 return (
//                     <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
//                         {label}
//                     </span>
//                 );
//             },
//         }),
//         // Timestamp
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         // Snapshot
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={90}
//                         height={70}
//                         className="object-cover rounded border"
//                         preview={{
//                             mask: "Click to Preview",
//                             onVisibleChange: (visible) => {
//                                 setIsPreviewOpen(visible);
//                                 if (visible) {
//                                     // Clear interval when preview opens
//                                     if (refreshIntervalRef.current) {
//                                         clearInterval(refreshIntervalRef.current);
//                                         refreshIntervalRef.current = null;
//                                     }
//                                 } else {
//                                     // Restart interval when preview closes
//                                     startRefreshInterval();
//                                 }
//                             }
//                         }}
//                     />
//                 );
//             },
//         }),
//     ], [page, pageSize]);

//     // Fetch cameras
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/Camera/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Fetch smoke data using the specific API
//     const fetchData = async () => {
//         try {
//             setLoading(true);
            
//             // Direct API URL without deviceApi wrapper
//             const response = await fetch(
//                 `http://14.195.152.244:9006/api/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Smoke&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`
//             );
            
//             if (!response.ok) {
//                 throw new Error(`HTTP error! status: ${response.status}`);
//             }
            
//             const result = await response.json();
            
//             setData(result.results || []);
//             setTotalPages(Math.max(1, Math.ceil((result.count || 0) / pageSize)));
//         } catch (err) {
//             console.error("API Error:", err);
//             setData([]);
//             setTotalPages(1);
//         } finally {
//             setLoading(false);
//         }
//     };

//     // Start refresh interval
//     const startRefreshInterval = () => {
//         if (refreshIntervalRef.current) {
//             clearInterval(refreshIntervalRef.current);
//         }
        
//         // Only start interval if preview is not open
//         if (!isPreviewOpen) {
//             refreshIntervalRef.current = setInterval(() => {
//                 fetchData();
//             }, 10000); // 10 seconds
//         }
//     };

//     // Cleanup interval
//     const cleanupInterval = () => {
//         if (refreshIntervalRef.current) {
//             clearInterval(refreshIntervalRef.current);
//             refreshIntervalRef.current = null;
//         }
//     };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//         // Initial fetch
//         fetchData();
        
//         // Start refresh interval
//         startRefreshInterval();
        
//         // Cleanup on unmount
//         return () => {
//             cleanupInterval();
//         };
//     }, [globalFilter, page, pageSize, cameraFilter]);

//     // Handle preview state changes
//     useEffect(() => {
//         if (!isPreviewOpen && !refreshIntervalRef.current) {
//             // Restart interval when preview closes and interval was stopped
//             startRefreshInterval();
//         }
        
//         // If preview opens, stop the interval
//         if (isPreviewOpen && refreshIntervalRef.current) {
//             cleanupInterval();
//         }
//     }, [isPreviewOpen]);

//     const table = useReactTable({
//         data,
//         columns,
//         state: { sorting },
//         onSortingChange: setSorting,
//         getCoreRowModel: getCoreRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//     });

//     const handleSearch = useMemo(
//         () =>
//             debounce((value) => {
//                 setGlobalFilter(value);
//                 setPage(1);
//             }, 300),
//         []
//     );

//     return (
//         <div className="p-4 space-y-4 max-w-full">
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">Smoke</h2>

//                 <div className="flex gap-3 items-center">
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">
//                             All Cameras
//                         </option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size} className="text-black">
//                                 Show {size}
//                             </option>
//                         ))}
//                     </select>
//                 </div>
//             </div>

//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm">
//                     <thead className="bg-[#9864db] text-[#E6E6FA]">
//                         {table.getHeaderGroups().map((headerGroup) => (
//                             <tr key={headerGroup.id}>
//                                 {headerGroup.headers.map((header) => (
//                                     <th
//                                         key={header.id}
//                                         className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
//                                         onClick={header.column.getToggleSortingHandler()}
//                                     >
//                                         {flexRender(
//                                             header.column.columnDef.header,
//                                             header.getContext()
//                                         )}
//                                         {header.column.getIsSorted() === "asc" && " 🔼"}
//                                         {header.column.getIsSorted() === "desc" && " 🔽"}
//                                     </th>
//                                 ))}
//                             </tr>
//                         ))}
//                     </thead>
//                     <tbody className="bg-white divide-y divide-green-100">
//                         {loading ? (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     Loading...
//                                 </td>
//                             </tr>
//                         ) : table.getRowModel().rows.length > 0 ? (
//                             table.getRowModel().rows.map((row) => (
//                                 <tr key={row.id} className="hover:bg-green-50">
//                                     {row.getVisibleCells().map((cell) => (
//                                         <td
//                                             key={cell.id}
//                                             className="px-4 py-3 border border-green-100 whitespace-normal break-words"
//                                         >
//                                             {flexRender(
//                                                 cell.column.columnDef.cell,
//                                                 cell.getContext()
//                                             )}
//                                         </td>
//                                     ))}
//                                 </tr>
//                             ))
//                         ) : (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     No smoke alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//                 <span className="text-sm text-gray-600">
//                     Page {page} of {totalPages}
//                 </span>
//                 <div className="flex gap-2">
//                     <button
//                         onClick={() => setPage((p) => Math.max(p - 1, 1))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === 1}
//                     >
//                         Prev
//                     </button>
//                     <button
//                         onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === totalPages}
//                     >
//                         Next
//                     </button>
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default SmokeTable;






// import React, { useState, useEffect, useMemo, useRef } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd";
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const SmokeTable = () => {
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState("");
//     const [cameras, setCameras] = useState([]);
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     const userId = Cookies.get("userId");
//     const intervalRef = useRef(null);

//     // Columns
//     const columns = useMemo(() => [
//         // Sr. No.
//         columnHelper.display({
//             id: "srno",
//             header: "Sr. No.",
//             cell: (info) => pageSize * (page - 1) + info.row.index + 1,
//         }),
//         // Camera Name
//         columnHelper.accessor("camera_name", {
//             header: "Camera Name",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 if (!raw) return "-";
                
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     return (
//                         <div className="flex flex-wrap gap-1">
//                             {Object.entries(parsed).map(([k, v]) => (
//                                 <span
//                                     key={k}
//                                     className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
//                                 >
//                                     {k}: {v}
//                                 </span>
//                             ))}
//                         </div>
//                     );
//                 } catch {
//                     return <span className="whitespace-normal break-words">{raw}</span>;
//                 }
//             },
//         }),
//         // Event
//         columnHelper.display({
//             id: "event",
//             header: "Event",
//             cell: () => (
//                 <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
//                     💨 smoke
//                 </span>
//             ),
//         }),
//         // Severity
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
                
//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         break;
//                 }

//                 return (
//                     <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
//                         {label}
//                     </span>
//                 );
//             },
//         }),
//         // Timestamp
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         // Snapshot
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={90}
//                         height={70}
//                         className="object-cover rounded border"
//                         preview={{ mask: "Click to Preview" }}
//                     />
//                 );
//             },
//         }),
//     ], [page, pageSize]);

//     // Fetch cameras
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/Camera/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Fetch smoke data
//     // const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//     //     try {
//     //         setLoading(true);
//     //         const res = await deviceApi.get(`/CameraAlert/`);
            
//     //         // Filter for smoke events on the client side
//     //         const allData = res.data.results || [];
//     //         const smokeData = allData.filter(item => {
//     //             const searchMatch = search ? 
//     //                 (item.objectName?.toLowerCase().includes(search.toLowerCase()) ||
//     //                  item.camera_name?.toLowerCase().includes(search.toLowerCase())) : true;
                
//     //             const cameraMatch = cameraFilter ? 
//     //                 (item.camera_id === cameraFilter || item.cameraId === cameraFilter) : true;
                
//     //             const smokeMatch = item.objectName?.toLowerCase().includes("smoke");
                
//     //             return searchMatch && cameraMatch && smokeMatch;
//     //         });
            
//     //         // Pagination on client side
//     //         const startIndex = (currentPage - 1) * size;
//     //         const endIndex = startIndex + size;
//     //         const paginatedData = smokeData.slice(startIndex, endIndex);
            
//     //         setData(paginatedData);
//     //         setTotalPages(Math.max(1, Math.ceil(smokeData.length / size)));
//     //     } catch (err) {
//     //         console.error("API Error:", err);
//     //         setData([]);
//     //         setTotalPages(1);
//     //     } finally {
//     //         setLoading(false);
//     //     }
//     // };


//     const fetchData = async () => {
//   try {
//     setLoading(true);

//     const res = await deviceApi.get(
//       `/CameraAlert/?format=json&objectName=Smoke&page=${page}&pageSize=${pageSize}`
//     );

//     setData(res.data.results || []);
//     setTotalPages(
//       Math.max(1, Math.ceil((res.data.count || 1) / pageSize))
//     );
//   } catch (err) {
//     console.error("API Error:", err);
//     setData([]);
//     setTotalPages(1);
//   } finally {
//     setLoading(false);
//   }
// };


//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//   fetchData();

//   if (intervalRef.current) clearInterval(intervalRef.current);

//   intervalRef.current = setInterval(() => {
//     fetchData();
//   }, 10000);

//   return () => clearInterval(intervalRef.current);
// }, [page, pageSize]);


//     const table = useReactTable({
//         data,
//         columns,
//         state: { sorting },
//         onSortingChange: setSorting,
//         getCoreRowModel: getCoreRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//     });

//     const handleSearch = useMemo(
//         () =>
//             debounce((value) => {
//                 setGlobalFilter(value);
//                 setPage(1);
//             }, 300),
//         []
//     );

//     return (
//         <div className="p-4 space-y-4 max-w-full">
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">Smoke</h2>

//                 <div className="flex gap-3 items-center">
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">
//                             All Cameras
//                         </option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size} className="text-black">
//                                 Show {size}
//                             </option>
//                         ))}
//                     </select>
//                 </div>
//             </div>

//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm">
//                     <thead className="bg-[#9864db] text-[#E6E6FA]">
//                         {table.getHeaderGroups().map((headerGroup) => (
//                             <tr key={headerGroup.id}>
//                                 {headerGroup.headers.map((header) => (
//                                     <th
//                                         key={header.id}
//                                         className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
//                                         onClick={header.column.getToggleSortingHandler()}
//                                     >
//                                         {flexRender(
//                                             header.column.columnDef.header,
//                                             header.getContext()
//                                         )}
//                                         {header.column.getIsSorted() === "asc" && " 🔼"}
//                                         {header.column.getIsSorted() === "desc" && " 🔽"}
//                                     </th>
//                                 ))}
//                             </tr>
//                         ))}
//                     </thead>
//                     <tbody className="bg-white divide-y divide-green-100">
//                         {loading ? (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     Loading...
//                                 </td>
//                             </tr>
//                         ) : table.getRowModel().rows.length > 0 ? (
//                             table.getRowModel().rows.map((row) => (
//                                 <tr key={row.id} className="hover:bg-green-50">
//                                     {row.getVisibleCells().map((cell) => (
//                                         <td
//                                             key={cell.id}
//                                             className="px-4 py-3 border border-green-100 whitespace-normal break-words"
//                                         >
//                                             {flexRender(
//                                                 cell.column.columnDef.cell,
//                                                 cell.getContext()
//                                             )}
//                                         </td>
//                                     ))}
//                                 </tr>
//                             ))
//                         ) : (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     No smoke alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//                 <span className="text-sm text-gray-600">
//                     Page {page} of {totalPages}
//                 </span>
//                 <div className="flex gap-2">
//                     <button
//                         onClick={() => setPage((p) => Math.max(p - 1, 1))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === 1}
//                     >
//                         Prev
//                     </button>
//                     <button
//                         onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === totalPages}
//                     >
//                         Next
//                     </button>
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default SmokeTable;



//////////////////////////////



// import React, { useState, useEffect, useMemo, useRef } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd";
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const SmokeTable = () => {
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState("");
//     const [cameras, setCameras] = useState([]);
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     const userId = Cookies.get("userId");
//     const intervalRef = useRef(null);

//     // Columns
//     const columns = useMemo(() => [
//         // Sr. No.
//         columnHelper.display({
//             id: "srno",
//             header: "Sr. No.",
//             cell: (info) => pageSize * (page - 1) + info.row.index + 1,
//         }),
//         // Camera Name
//         columnHelper.accessor("camera_name", {
//             header: "Camera Name",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 if (!raw) return "-";
                
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     return (
//                         <div className="flex flex-wrap gap-1">
//                             {Object.entries(parsed).map(([k, v]) => (
//                                 <span
//                                     key={k}
//                                     className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
//                                 >
//                                     {k}: {v}
//                                 </span>
//                             ))}
//                         </div>
//                     );
//                 } catch {
//                     return <span className="whitespace-normal break-words">{raw}</span>;
//                 }
//             },
//         }),
//         // Event
//         columnHelper.display({
//             id: "event",
//             header: "Event",
//             cell: () => (
//                 <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
//                     💨 smoke
//                 </span>
//             ),
//         }),
//         // Severity
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
                
//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         break;
//                 }

//                 return (
//                     <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
//                         {label}
//                     </span>
//                 );
//             },
//         }),
//         // Timestamp
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         // Snapshot
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={90}
//                         height={70}
//                         className="object-cover rounded border"
//                         preview={{ mask: "Click to Preview" }}
//                     />
//                 );
//             },
//         }),
//     ], [page, pageSize]);

//     // Fetch cameras
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/Camera/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Fetch smoke data
//     const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//         try {
//             setLoading(true);
//             const res = await deviceApi.get(`/CameraAlert/`);
            
//             // Filter for smoke events on the client side
//             const allData = res.data.results || [];
//             const smokeData = allData.filter(item => {
//                 const searchMatch = search ? 
//                     (item.objectName?.toLowerCase().includes(search.toLowerCase()) ||
//                      item.camera_name?.toLowerCase().includes(search.toLowerCase())) : true;
                
//                 const cameraMatch = cameraFilter ? 
//                     (item.camera_id === cameraFilter || item.cameraId === cameraFilter) : true;
                
//                 const smokeMatch = item.objectName?.toLowerCase().includes("smoke");
                
//                 return searchMatch && cameraMatch && smokeMatch;
//             });
            
//             // Pagination on client side
//             const startIndex = (currentPage - 1) * size;
//             const endIndex = startIndex + size;
//             const paginatedData = smokeData.slice(startIndex, endIndex);
            
//             setData(paginatedData);
//             setTotalPages(Math.max(1, Math.ceil(smokeData.length / size)));
//         } catch (err) {
//             console.error("API Error:", err);
//             setData([]);
//             setTotalPages(1);
//         } finally {
//             setLoading(false);
//         }
//     };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//         // Initial call
//         fetchData(globalFilter, page, pageSize);

//         // Clear old interval
//         if (intervalRef.current) {
//             clearInterval(intervalRef.current);
//         }

//         // Auto refresh every 10 seconds
//         intervalRef.current = setInterval(() => {
//             fetchData(globalFilter, page, pageSize);
//         }, 10000);

//         // Cleanup
//         return () => {
//             if (intervalRef.current) {
//                 clearInterval(intervalRef.current);
//             }
//         };
//     }, [globalFilter, page, pageSize, cameraFilter]);

//     const table = useReactTable({
//         data,
//         columns,
//         state: { sorting },
//         onSortingChange: setSorting,
//         getCoreRowModel: getCoreRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//     });

//     const handleSearch = useMemo(
//         () =>
//             debounce((value) => {
//                 setGlobalFilter(value);
//                 setPage(1);
//             }, 300),
//         []
//     );

//     return (
//         <div className="p-4 space-y-4 max-w-full">
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">Smoke</h2>

//                 <div className="flex gap-3 items-center">
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">
//                             All Cameras
//                         </option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size} className="text-black">
//                                 Show {size}
//                             </option>
//                         ))}
//                     </select>
//                 </div>
//             </div>

//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm">
//                     <thead className="bg-[#9864db] text-[#E6E6FA]">
//                         {table.getHeaderGroups().map((headerGroup) => (
//                             <tr key={headerGroup.id}>
//                                 {headerGroup.headers.map((header) => (
//                                     <th
//                                         key={header.id}
//                                         className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
//                                         onClick={header.column.getToggleSortingHandler()}
//                                     >
//                                         {flexRender(
//                                             header.column.columnDef.header,
//                                             header.getContext()
//                                         )}
//                                         {header.column.getIsSorted() === "asc" && " 🔼"}
//                                         {header.column.getIsSorted() === "desc" && " 🔽"}
//                                     </th>
//                                 ))}
//                             </tr>
//                         ))}
//                     </thead>
//                     <tbody className="bg-white divide-y divide-green-100">
//                         {loading ? (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     Loading...
//                                 </td>
//                             </tr>
//                         ) : table.getRowModel().rows.length > 0 ? (
//                             table.getRowModel().rows.map((row) => (
//                                 <tr key={row.id} className="hover:bg-green-50">
//                                     {row.getVisibleCells().map((cell) => (
//                                         <td
//                                             key={cell.id}
//                                             className="px-4 py-3 border border-green-100 whitespace-normal break-words"
//                                         >
//                                             {flexRender(
//                                                 cell.column.columnDef.cell,
//                                                 cell.getContext()
//                                             )}
//                                         </td>
//                                     ))}
//                                 </tr>
//                             ))
//                         ) : (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     No smoke alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//                 <span className="text-sm text-gray-600">
//                     Page {page} of {totalPages}
//                 </span>
//                 <div className="flex gap-2">
//                     <button
//                         onClick={() => setPage((p) => Math.max(p - 1, 1))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === 1}
//                     >
//                         Prev
//                     </button>
//                     <button
//                         onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//                         className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//                         disabled={page === totalPages}
//                     >
//                         Next
//                     </button>
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default SmokeTable;





////////////////


// import React, { useState, useEffect, useMemo ,useRef} from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd";
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const SmokeTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [cameraFilter, setCameraFilter] = useState("");
//   const [cameras, setCameras] = useState([]);
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [loading, setLoading] = useState(false);
//   const userId = Cookies.get("userId");
//   const intervalRef = useRef(null);

//   // Columns same order as image: Sr. No., Camera Name, Event, Severity, Timestamp, Snapshot
//   const columns = [
//     // Sr. No.
//     columnHelper.display({
//       id: "srno",
//       header: "Sr. No.",
//       cell: (info) => pageSize * (page - 1) + info.row.index + 1,
//     }),
//     // Camera Name (assume API returns camera_name or cameraName)
//     columnHelper.accessor("camera_name", {
//       header: "Camera Name",
//       cell: (info) => info.getValue() || "-",
//     }),
//     // Event (fixed smoke badge)
//     columnHelper.display({
//       id: "event",
//       header: "Event",
//       cell: () => (
//         <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
//           <span className="w-2 h-2 rounded-full bg-purple-500" />
//           smoke
//         </span>
//       ),
//     }),
//     // Severity
//     columnHelper.accessor("alertStatus", {
//       header: "Severity",
//       cell: (info) => {
//         const code = info.getValue();
//         let label = "Unknown";
//         let color = "bg-gray-100 text-gray-600";
//         let emoji = "ℹ️";

//         switch (code) {
//           case "B":
//             label = "Basic";
//             color = "bg-blue-100 text-blue-700";
//             emoji = "🔵";
//             break;
//           case "C":
//             label = "Critical";
//             color = "bg-red-100 text-red-700";
//             emoji = "🚨";
//             break;
//           case "S":
//             label = "Severe";
//             color = "bg-orange-100 text-orange-700";
//             emoji = "⚠️";
//             break;
//           case "N":
//             label = "Normal";
//             color = "bg-green-100 text-green-700";
//             emoji = "✅";
//             break;
//         }

//         return (
//           <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full ${color}`}>
//             <span className="w-2 h-2 rounded-full bg-blue-500" />
//             {label}
//           </span>
//         );
//       },
//     }),
//     // Timestamp
//     columnHelper.accessor("regDate", {
//       header: "Timestamp",
//       cell: (info) =>
//         new Date(info.getValue()).toLocaleString("en-IN", {
//           dateStyle: "short",
//           timeStyle: "medium",
//         }),
//     }),
//     // Snapshot
//     columnHelper.accessor("framePath", {
//       header: "Snapshot",
//       cell: (info) => {
//         const path = info.getValue();
//         const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//         return (
//           <Image
//             src={imgUrl}
//             alt="frame"
//             width={90}
//             height={70}
//             className="object-cover rounded border"
//             preview={{ mask: "Click to Preview" }}
//           />
//         );
//       },
//     }),
//   ];

//   const fetchCameras = async () => {
//     try {
//       const res = await deviceApi.get(
//         `/Camera/?user_id=${userId}&page=1&pageSize=100`
//       );
//       setCameras(res.data.results || []);
//     } catch (err) {
//       console.error("Camera fetch failed:", err);
//     }
//   };

//   const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//     try {
//       setLoading(true);
//       const res = await deviceApi.get("/CameraAlert/"
//         , {
//         params: {
//           userid: userId,
//           page: currentPage,
//           pageSize: size,
//           camera_id: cameraFilter || "",
//           search,
//           alertType: "smoke",   // smoke table fix
//           objectName: "smoke",
//         },
//       });

//       setData(res.data.results || []);
//       setTotalPages(Math.max(1, Math.ceil((res.data.count || 0) / size)));
//     } catch (err) {
//       console.error("API Error:", err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchCameras();
//   }, []);


//   useEffect(() => {
//   // initial call
//   fetchData(globalFilter, page, pageSize);

//   // clear old interval (important)
//   if (intervalRef.current) {
//     clearInterval(intervalRef.current);
//   }

//   // auto refresh every 10 seconds
//   intervalRef.current = setInterval(() => {
//     fetchData(globalFilter, page, pageSize);
//   }, 10000);

//   // cleanup on unmount
//   return () => {
//     if (intervalRef.current) {
//       clearInterval(intervalRef.current);
//     }
//   };
// }, [globalFilter, page, pageSize, cameraFilter]);


//   // useEffect(() => {
//   //   fetchData(globalFilter, page, pageSize);
//   // }, [globalFilter, page, pageSize, cameraFilter]);

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Smoke</h2>

//         <div className="flex gap-3 items-center">
//           <input
//             type="text"
//             placeholder="Search (object)..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//           />

//           <select
//             value={cameraFilter}
//             onChange={(e) => {
//               setCameraFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             <option value="" className="text-black">
//               All Cameras
//             </option>
//             {cameras.map((cam) => (
//               <option key={cam.id} value={cam.id} className="text-black">
//                 {cam.name || `Camera ${cam.id}`}
//               </option>
//             ))}
//           </select>

//           <select
//             value={pageSize}
//             onChange={(e) => {
//               setPageSize(Number(e.target.value));
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             {[10, 25, 50].map((size) => (
//               <option key={size} value={size} className="text-black">
//                 Show {size}
//               </option>
//             ))}
//           </select>
//         </div>
//       </div>

//       <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
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
//           <tbody className="bg-white divide-y divide-green-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="text-center py-6">
//                   Loading...
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-green-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-green-100 whitespace-normal break-words"
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
//                 <td colSpan={columns.length} className="text-center py-6">
//                   No data found.
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>

//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <span className="text-sm text-gray-600">
//           Page {page} of {totalPages}
//         </span>
//         <div className="flex gap-2">
//           <button
//             onClick={() => setPage((p) => Math.max(p - 1, 1))}
//             className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === 1}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === totalPages}
//           >
//             Next
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default SmokeTable;


////////////////////




// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd"; // ✅ AntD Image (preview/zoom)
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";


// const columnHelper = createColumnHelper();

// const AnalyticsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [cameraFilter, setCameraFilter] = useState(""); // ✅ Camera filter state
//   const [cameras, setCameras] = useState([]); // ✅ Dropdown options
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [loading, setLoading] = useState(false);
//   const userId = Cookies.get("userId");
//   // ✅ Define table columns
//   const columns = [
//     columnHelper.accessor("id", { header: "ID" }),
//     columnHelper.accessor("objectName", {
//       header: "Objects",
//       cell: (info) => {
//         const raw = info.getValue();
//         try {
//           const cleaned = raw.replace(/'/g, '"');
//           const parsed = JSON.parse(cleaned);
//           return (
//             <div className="flex flex-wrap gap-1">
//               {Object.entries(parsed).map(([k, v]) => (
//                 <span
//                   key={k}
//                   className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
//                 >
//                   {k}: {v}
//                 </span>
//               ))}
//             </div>
//           );
//         } catch {
//           return <span className="whitespace-normal break-words">{raw}</span>;
//         }
//       },
//     }),
//     columnHelper.accessor("objectCount", { header: "Count" }),
//     // Alert Severity Mapping
//     columnHelper.accessor("alertStatus", {
//       header: "Severity",
//       cell: (info) => {
//         const code = info.getValue();
//         let label = "Unknown";
//         let color = "bg-gray-100 text-gray-600";
//         let emoji = "ℹ️";

//         switch (code) {
//           case "B":
//             label = "Basic";
//             color = "bg-blue-100 text-blue-700";
//             emoji = "🔵";
//             break;
//           case "C":
//             label = "Critical";
//             color = "bg-red-100 text-red-700";
//             emoji = "🚨";
//             break;
//           case "S":
//             label = "Severe";
//             color = "bg-orange-100 text-orange-700";
//             emoji = "⚠️";
//             break;
//           case "N":
//             label = "Normal";
//             color = "bg-green-100 text-green-700";
//             emoji = "✅";
//             break;
//         }

//         return (
//           <span className={`px-2 py-1 text-xs rounded ${color}`}>
//             {emoji} {label}
//           </span>
//         );
//       },
//     }),
//     columnHelper.accessor("regDate", {
//       header: "Timestamp",
//       cell: (info) =>
//         new Date(info.getValue()).toLocaleString("en-IN", {
//           dateStyle: "short",
//           timeStyle: "medium",
//         }),
//     }),
//     columnHelper.accessor("framePath", {
//       header: "Snapshot",
//       cell: (info) => {
//         const path = info.getValue();
//         const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//         return (
//           <Image
//             src={imgUrl}
//             alt="frame"
//             width={80}
//             height={60}
//             className="object-cover rounded border"
//             preview={{ mask: "Click to Preview" }}
//           />
//         );
//       },
//     }),
//   ];

//   // ✅ Fetch cameras for filter dropdown
//   const fetchCameras = async () => {
//     try {
//       const res = await deviceApi.get(`/Camera/?user_id=${userId}&page=1&pageSize=100`);
//       setCameras(res.data.results || []);
//     } catch (err) {
//       console.error("Camera fetch failed:", err);
//     }
//   };

//   // ✅ Fetch alerts using deviceApi instead of hardcoded URL
//   const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//     try {
//       setLoading(true);
//       const res = await deviceApi.get("/CameraAlert/", {
//         params: {
//           userid: userId,          // you can replace with dynamic userId if needed
//           page: currentPage,
//           pageSize: size,
//           camera_id: cameraFilter || "", // camera filter
//           search,
//         },
//       });

//       setData(res.data.results || []);
//       setTotalPages(Math.ceil(res.data.count / size));
//     } catch (err) {
//       console.error("API Error:", err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchCameras();
//   }, []);

//   useEffect(() => {
//     fetchData(globalFilter, page, pageSize);
//   }, [globalFilter, page, pageSize, cameraFilter]); // ✅ refetch when camera changes

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">
//           Smoke
//         </h2>

//         <div className="flex gap-3 items-center">
//           {/* 🔍 Search */}
//           <input
//             type="text"
//             placeholder="Search (object)..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//           />

//           {/* 📷 Camera Filter */}
//           <select
//             value={cameraFilter}
//             onChange={(e) => {
//               setCameraFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             <option value="" className="text-black">All Cameras</option>
//             {cameras.map((cam) => (
//               <option key={cam.id} value={cam.id} className="text-black">
//                 {cam.name || `Camera ${cam.id}`}
//               </option>
//             ))}
//           </select>

//           {/* 📄 Page size */}
//           <select
//             value={pageSize}
//             onChange={(e) => {
//               setPageSize(Number(e.target.value));
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             {[10, 25, 50].map((size) => (
//               <option key={size} value={size} className="text-black">
//                 Show {size}
//               </option>
//             ))}
//           </select>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm ">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
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
//           <tbody className="bg-white divide-y divide-green-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="text-center py-6">
//                   Loading...
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-green-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-green-100 whitespace-normal break-words"
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
//                 <td colSpan={columns.length} className="text-center py-6">
//                   No data found.
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
//             className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === 1}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === totalPages}
//           >
//             Next
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default AnalyticsTable;
