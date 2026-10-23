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

const isFireAlert = (objectName, alertType) => {
    try {
        const objStr = String(objectName || "").toLowerCase();
        const typeStr = String(alertType || "").toLowerCase();
        return (
            (objStr.includes("fire") || typeStr.includes("fire")) &&
            !objStr.includes("face") &&
            !typeStr.includes("face") &&
            !objStr.includes("facial") &&
            !typeStr.includes("facial")
        );
    } catch {
        return false;
    }
};

const FireTable = () => {
    const isPreviewOpenRef = useRef(false);
    const lastFetchTimeRef = useRef(Date.now());
    const previousDataHashRef = useRef("");
    const previousTotalCountRef = useRef(0);
    const lastCheckTimeRef = useRef(Date.now());
    const abortControllerRef = useRef(null);
    const pendingPageRef = useRef(null);
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
    const [allFireAlertsCache, setAllFireAlertsCache] = useState([]);

    const userId = Cookies.get("userId");

    const calculateDataHash = useCallback((dataArray) => {
        if (!dataArray || dataArray.length === 0) return "empty";
        const ids = dataArray.map(item => item.id).sort().join(",");
        const timestamps = dataArray.map(item => item.regDate).sort().join(",");
        return `${ids}_${timestamps}`;
    }, []);

    const columns = [
        columnHelper.accessor("id", {
            header: "ID",
            cell: (info) => {
                const rowIndex = info.row.index;
                return (page - 1) * pageSize + rowIndex + 1;
            },
        }),
        columnHelper.accessor("camera_name", {
            header: "Camera name",
            cell: (info) => {
                const raw = info.getValue();
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
        columnHelper.accessor("objectName", {
            header: "Event",
            cell: (info) => {
                const raw = info.getValue();
                try {
                    const cleaned = raw.replace(/'/g, '"');
                    const parsed = JSON.parse(cleaned);
                    const eventName = Object.keys(parsed)[0];
                    let icon = "?";
                    if (eventName.toLowerCase().includes("fire")) icon = "🔥";
                    return (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
                            {icon} {eventName}
                        </span>
                    );
                } catch {
                    return <span>{raw}</span>;
                }
            },
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
                return <span className={`px-2 py-1 text-xs rounded ${color}`}>{label}</span>;
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
                        width={80}
                        height={60}
                        className="object-cover rounded border"
                        preview={{
                            mask: "Click to Preview",
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
                );
            },
        }),
    ];

    const fetchCameras = async () => {
        try {
            const res = await deviceApi.get(
                `/CameraAlert/?userid=${userId}&camera_id=&end_date=&format=json&objectName=Fire&page=1&pageSize=1000&search=&start_date=`
            );
            const uniqueCameras = res.data.results
                .filter(item => isFireAlert(item.objectName, item.alertType))
                .map(item => ({
                    id: item.cameraId,
                    name: item.camera_name || `Camera ${item.cameraId}`
                }))
                .filter((cam, index, self) =>
                    index === self.findIndex(c => c.id === cam.id)
                );
            setCameras(uniqueCameras);
        } catch (err) {
            console.error("Camera fetch failed:", err);
        }
    };

    // Fetch all fire alerts (for accurate count and pagination)
    const fetchAllFireAlerts = useCallback(async (signal) => {
        try {
            // Cancel previous request if exists
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            // Create new abort controller
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            // Fetch all fire alerts with large page size
            const apiUrl = `/CameraAlert/?userid=${userId}&camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=1&pageSize=10000&start_date=`;
            const res = await deviceApi.get(apiUrl, {
                signal: abortController.signal
            });
            
            // Filter to get only fire alerts
            let allFireAlerts = (res.data.results || []).filter(item => isFireAlert(item.objectName, item.alertType));

            if (globalFilter && globalFilter.trim()) {
                const q = globalFilter.trim().toLowerCase();
                allFireAlerts = allFireAlerts.filter(item =>
                    (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
                    (item.objectName || "").toLowerCase().includes(q) ||
                    (item.alertType || "").toLowerCase().includes(q) ||
                    (item.camera_location || item.location || "").toLowerCase().includes(q) ||
                    String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
                    String(item.id || "").toLowerCase().includes(q)
                );
            }
            
            // Sort by regDate descending (newest first)
            allFireAlerts.sort((a, b) => new Date(b.regDate) - new Date(a.regDate));
            
            // Cache the results
            setAllFireAlertsCache(allFireAlerts);
            
            return allFireAlerts;
        } catch (err) {
            if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
                console.log('Request cancelled');
                return null;
            }
            console.error("Error fetching all fire alerts:", err);
            return [];
        }
    }, [cameraFilter, globalFilter]);

    const updatePageData = useCallback((allFireAlerts, targetPage) => {
        if (!allFireAlerts) return;
        
        const totalFireAlerts = allFireAlerts.length;
        const startIndex = (targetPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        
        // Get current page data
        const pageData = allFireAlerts.slice(startIndex, endIndex);
        
        setData(pageData);
        setTotalCount(totalFireAlerts);
        
        // Calculate total pages
        const calculatedTotalPages = Math.max(1, Math.ceil(totalFireAlerts / pageSize));
        setTotalPages(calculatedTotalPages);
        
        // Update refs
        const newDataHash = calculateDataHash(pageData);
        previousDataHashRef.current = newDataHash;
        previousTotalCountRef.current = totalFireAlerts;
        
        setHasNewData(false);
        setNewDataCount(0);
        setLastRefreshTime(Date.now());

        // Adjust page if current page is beyond total pages
        if (targetPage > calculatedTotalPages && calculatedTotalPages > 0) {
            setPage(calculatedTotalPages);
        }
        
        // Auto-create tickets for new fire alerts
        createTicketForAlerts(pageData, "Fire Detection", "Surveillance Alert");

        return pageData;
    }, [pageSize, calculateDataHash]);

    const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false, targetPage = page) => {
        if (isPreviewOpenRef.current && !forceFetch) return;
        if (!autoRefresh && !forceFetch && !isManualRefresh) return;

        const now = Date.now();
        if (now - lastFetchTimeRef.current < 500 && !forceFetch) return;

        try {
            setLoading(true);
            lastFetchTimeRef.current = now;

            // Use cached data if available and filters haven't changed
            let allFireAlerts = allFireAlertsCache;
            
            // If no cache or force fetch, fetch fresh data
            if (allFireAlerts.length === 0 || forceFetch) {
                const abortController = new AbortController();
                allFireAlerts = await fetchAllFireAlerts(abortController.signal);
            }
            
            if (allFireAlerts) {
                updatePageData(allFireAlerts, targetPage);
            }
        } catch (err) {
            console.error("Fire API Error:", err);
        } finally {
            setLoading(false);
            pendingPageRef.current = null;
        }
    }, [page, autoRefresh, fetchAllFireAlerts, updatePageData, allFireAlertsCache]);

    const handlePageChange = useCallback((newPage) => {
        if (loading) {
            // Store the pending page change
            pendingPageRef.current = newPage;
            return;
        }
        
        if (newPage >= 1 && newPage <= totalPages) {
            setPage(newPage);
        }
    }, [loading, totalPages]);

    const handlePrevPage = useCallback(() => {
        const newPage = Math.max(page - 1, 1);
        handlePageChange(newPage);
    }, [page, handlePageChange]);

    const handleNextPage = useCallback(() => {
        const newPage = Math.min(page + 1, totalPages);
        handlePageChange(newPage);
    }, [page, totalPages, handlePageChange]);

    const handleGoToPage = useCallback((e) => {
        const value = parseInt(e.target.value);
        if (value >= 1 && value <= totalPages) {
            handlePageChange(value);
        }
    }, [totalPages, handlePageChange]);

    const handleManualRefresh = () => {
        setHasNewData(false);
        setNewDataCount(0);
        setAllFireAlertsCache([]); // Clear cache
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

    const checkForNewData = useCallback(async () => {
        if (isPreviewOpenRef.current || !autoRefresh) return;

        const now = Date.now();
        if (now - lastCheckTimeRef.current < 5000) return;
        lastCheckTimeRef.current = now;

        try {
            const abortController = new AbortController();
            const allFireAlerts = await fetchAllFireAlerts(abortController.signal);
            
            if (allFireAlerts) {
                const newTotalCount = allFireAlerts.length;

                if (newTotalCount !== previousTotalCountRef.current) {
                    const difference = newTotalCount - previousTotalCountRef.current;
                    setNewDataCount(Math.max(0, difference));
                    setHasNewData(true);
                    return true;
                }
            }
            return false;
        } catch (err) {
            console.error("Check for new data failed:", err);
            return false;
        }
    }, [fetchAllFireAlerts, autoRefresh]);

    // Effect to handle pending page changes after loading completes
    useEffect(() => {
        if (!loading && pendingPageRef.current !== null) {
            const pendingPage = pendingPageRef.current;
            pendingPageRef.current = null;
            if (pendingPage >= 1 && pendingPage <= totalPages) {
                setPage(pendingPage);
            }
        }
    }, [loading, totalPages]);

    // Effect for auto-refresh
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(async () => {
            if (isPreviewOpenRef.current) return;
            const hasNew = await checkForNewData();
            if (hasNew && page === 1) {
                setAllFireAlertsCache([]); // Clear cache on new data
                fetchData(true);
            }
        }, 10000);
        return () => clearInterval(interval);
    }, [checkForNewData, fetchData, autoRefresh, page]);

    // Effect for filter changes
    useEffect(() => {
        if (previousDataHashRef.current === "") return;
        setHasNewData(false);
        setNewDataCount(0);
        setAllFireAlertsCache([]); // Clear cache when filters change
        setPage(1); // Reset to page 1 when filters change
        fetchData(true);
    }, [globalFilter, cameraFilter, pageSize]);

    // Effect for page changes
    useEffect(() => {
        if (previousDataHashRef.current === "" || allFireAlertsCache.length === 0) return;
        
        // Use cached data to update page
        const updateFromCache = async () => {
            updatePageData(allFireAlertsCache, page);
        };
        
        updateFromCache();
    }, [page, allFireAlertsCache, updatePageData]);

    // Initial load
    useEffect(() => {
        fetchCameras();
        fetchData(true);
        
        // Cleanup function to cancel any ongoing requests
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            pagination: { pageIndex: page - 1, pageSize }
        },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        manualPagination: true,
    });

    const handleSearch = useMemo(
        () => debounce((value) => {
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
                    <h2 className="text-xl font-bold text-[#fce4e4]">Fire Alerts</h2>
                    {hasNewData && (
                        <button
                            onClick={handleManualRefresh}
                            className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors flex items-center gap-1 animate-pulse"
                            disabled={loading}
                        >
                            <span>🔄</span>
                            {newDataCount > 0 ? `${newDataCount} New Alert${newDataCount > 1 ? 's' : ''}! Click to Refresh` : 'New Alerts Available! Click to Refresh'}
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
                                {newDataCount > 0 ? `${newDataCount} New` : 'New!'}
                            </span>
                        )}
                        {loading && (
                            <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full animate-pulse">
                                Loading...
                            </span>
                        )}
                    </div>

                    <input
                        type="text"
                        placeholder="Search alerts..."
                        onChange={(e) => handleSearch(e.target.value)}
                        className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]"
                        disabled={loading}
                    />

                    <select
                        value={cameraFilter}
                        onChange={(e) => {
                            setCameraFilter(e.target.value);
                            setPage(1);
                        }}
                        className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
                        disabled={loading}
                    >
                        <option value="">All Cameras</option>
                        {cameras.map((cam) => (
                            <option key={cam.id} value={cam.id}>{cam.name}</option>
                        ))}
                    </select>

                    <select
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                        className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                        disabled={loading}
                    >
                        {[10, 25, 50, 100].map((size) => (
                            <option key={size} value={size}>Show {size}</option>
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
                                        Loading Fire Alerts...
                                    </div>
                                </td>
                            </tr>
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
                            <tr>
                                <td colSpan={columns.length} className="text-center py-12 text-gray-500">
                                    No fire alerts found.
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
                        Showing {data.length} of {totalCount} fire alert{totalCount !== 1 ? 's' : ''}
                    </span>
                    {hasNewData && page !== 1 && (
                        <span className="text-xs text-yellow-600">New alerts available on page 1</span>
                    )}
                </div>
                <div className="flex gap-2 items-center">
                    <button
                        onClick={handlePrevPage}
                        className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        disabled={page === 1 || loading}
                    >
                        Prev
                    </button>
                    <button
                        onClick={handleNextPage}
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
                            onChange={handleGoToPage}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                            disabled={loading}
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

export default FireTable;




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

// const isFireAlert = (objectName) => {
//     try {
//         return objectName.toLowerCase().includes("fire");
//     } catch {
//         return false;
//     }
// };

// const FireTable = () => {
//     const isPreviewOpenRef = useRef(false);
//     const lastFetchTimeRef = useRef(Date.now());
//     const previousDataHashRef = useRef("");
//     const previousTotalCountRef = useRef(0);
//     const lastCheckTimeRef = useRef(Date.now());
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
//     const [autoRefresh, setAutoRefresh] = useState(true);
//     const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
//     const [newDataCount, setNewDataCount] = useState(0);

//     const userId = Cookies.get("userId");

//     const calculateDataHash = useCallback((dataArray) => {
//         if (!dataArray || dataArray.length === 0) return "empty";
//         const ids = dataArray.map(item => item.id).sort().join(",");
//         const timestamps = dataArray.map(item => item.regDate).sort().join(",");
//         return `${ids}_${timestamps}`;
//     }, []);

//     const columns = [
//         columnHelper.accessor("id", {
//             header: "ID",
//             cell: (info) => (page - 1) * pageSize + info.row.index + 1,
//         }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     return (
//                         <div className="flex flex-wrap gap-1">
//                             {Object.entries(parsed).map(([k, v]) => (
//                                 <span key={k} className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
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
//         columnHelper.accessor("objectName", {
//             header: "Event",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     const eventName = Object.keys(parsed)[0];
//                     let icon = "?";
//                     if (eventName.toLowerCase().includes("fire")) icon = "🔥";
//                     return (
//                         <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                             {icon} {eventName}
//                         </span>
//                     );
//                 } catch {
//                     return <span>{raw}</span>;
//                 }
//             },
//         }),
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 switch (code) {
//                     case "B": label = "Basic"; color = "bg-blue-100 text-blue-700"; break;
//                     case "C": label = "Critical"; color = "bg-red-100 text-red-700"; break;
//                     case "S": label = "Severe"; color = "bg-orange-100 text-orange-700"; break;
//                     case "N": label = "Normal"; color = "bg-green-100 text-green-700"; break;
//                 }
//                 return <span className={`px-2 py-1 text-xs rounded ${color}`}>{label}</span>;
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{
//                             mask: "Click to Preview",
//                             onVisibleChange: (visible) => {
//                                 isPreviewOpenRef.current = visible;
//                                 if (visible) {
//                                     setAutoRefresh(false);
//                                 } else {
//                                     setTimeout(() => setAutoRefresh(true), 2000);
//                                 }
//                             },
//                         }}
//                     />
//                 );
//             },
//         }),
//     ];

//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(
//                 `/CameraAlert/?camera_id=&end_date=&format=json&objectName=Fire&page=1&pageSize=100&search=&start_date=`
//             );
//             const uniqueCameras = res.data.results
//                 .filter(item => isFireAlert(item.objectName))
//                 .map(item => ({
//                     id: item.camera_id,
//                     name: item.camera_name || `Camera ${item.camera_id}`
//                 }))
//                 .filter((cam, index, self) =>
//                     index === self.findIndex(c => c.id === cam.id)
//                 );
//             setCameras(uniqueCameras);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     const checkForNewData = useCallback(async () => {
//         if (isPreviewOpenRef.current || !autoRefresh) return;

//         const now = Date.now();
//         if (now - lastCheckTimeRef.current < 5000) return;
//         lastCheckTimeRef.current = now;

//         try {
//             const checkUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=1&pageSize=1000&search=${globalFilter}&start_date=`;
//             const res = await deviceApi.get(checkUrl);
//             // Filter to get only fire alerts and count them
//             const fireAlertsOnly = (res.data.results || []).filter(item => isFireAlert(item.objectName));
//             const newTotalCount = fireAlertsOnly.length;

//             if (newTotalCount !== previousTotalCountRef.current) {
//                 const difference = newTotalCount - previousTotalCountRef.current;
//                 setNewDataCount(Math.max(0, difference));
//                 setHasNewData(true);
//                 return true;
//             }
//             return false;
//         } catch (err) {
//             console.error("Check for new data failed:", err);
//             return false;
//         }
//     }, [cameraFilter, globalFilter, autoRefresh]);

//     const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false) => {
//         if (isPreviewOpenRef.current && !forceFetch) return;
//         if (!autoRefresh && !forceFetch && !isManualRefresh) return;

//         const now = Date.now();
//         if (now - lastFetchTimeRef.current < 2000 && !forceFetch) return;

//         try {
//             setLoading(true);
//             lastFetchTimeRef.current = now;

//             const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;
//             const res = await deviceApi.get(apiUrl);

//             // Filter only Fire alerts from the current page response
//             const newData = (res.data.results || []).filter(item => isFireAlert(item.objectName));
            
//             // To get accurate total count of fire alerts, we need to fetch all pages or make a separate request
//             // Since we can't rely on res.data.count (it might include non-fire alerts),
//             // we'll make a separate request to get the accurate count
//             let accurateTotalCount = 0;
            
//             try {
//                 // Make a request with large pageSize to get all fire alerts (or at least get accurate count)
//                 const countUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=1&pageSize=1000&search=${globalFilter}&start_date=`;
//                 const countRes = await deviceApi.get(countUrl);
//                 // Filter to count only fire alerts
//                 const allFireAlerts = (countRes.data.results || []).filter(item => isFireAlert(item.objectName));
//                 accurateTotalCount = allFireAlerts.length;
//             } catch (err) {
//                 console.error("Error getting accurate count:", err);
//                 // Fallback to the original count if the separate request fails
//                 accurateTotalCount = newData.length;
//             }
            
//             setData(newData);
//             setTotalCount(accurateTotalCount);
            
//             // Calculate total pages based on accurate total count and page size
//             const calculatedTotalPages = Math.max(1, Math.ceil(accurateTotalCount / pageSize));
//             setTotalPages(calculatedTotalPages);
            
//             // Update refs
//             const newDataHash = calculateDataHash(newData);
//             previousDataHashRef.current = newDataHash;
//             previousTotalCountRef.current = accurateTotalCount;
            
//             setHasNewData(false);
//             setNewDataCount(0);
//             setLastRefreshTime(Date.now());

//             // Adjust page if current page is beyond total pages
//             if (page > calculatedTotalPages && calculatedTotalPages > 0) {
//                 setPage(calculatedTotalPages);
//             }
//         } catch (err) {
//             console.error("Fire API Error:", err);
//         } finally {
//             setLoading(false);
//         }
//     }, [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash]);

//     const handleManualRefresh = () => {
//         setHasNewData(false);
//         setNewDataCount(0);
//         fetchData(true, true);
//     };

//     const formatTimeSinceLastRefresh = () => {
//         const seconds = Math.floor((Date.now() - lastRefreshTime) / 1000);
//         if (seconds < 60) return `${seconds}s ago`;
//         const minutes = Math.floor(seconds / 60);
//         if (minutes < 60) return `${minutes}m ago`;
//         const hours = Math.floor(minutes / 60);
//         return `${hours}h ago`;
//     };

//     // Function to get accurate total count of fire alerts
//     const getAccurateTotalCount = useCallback(async () => {
//         try {
//             // Make a request with large pageSize to get all fire alerts
//             const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=1&pageSize=1000&search=${globalFilter}&start_date=`;
//             const res = await deviceApi.get(apiUrl);
//             // Filter to count only fire alerts
//             const fireAlertsOnly = (res.data.results || []).filter(item => isFireAlert(item.objectName));
//             const accurateTotalCount = fireAlertsOnly.length;
//             return accurateTotalCount;
//         } catch (err) {
//             console.error("Error getting accurate total count:", err);
//             return totalCount;
//         }
//     }, [cameraFilter, globalFilter, totalCount]);

//     useEffect(() => {
//         fetchCameras();
//         fetchData(true);
//     }, []);

//     useEffect(() => {
//         if (!autoRefresh) return;
//         const interval = setInterval(async () => {
//             if (isPreviewOpenRef.current) return;
//             const hasNew = await checkForNewData();
//             if (hasNew && page === 1) {
//                 fetchData();
//             }
//         }, 10000);
//         return () => clearInterval(interval);
//     }, [checkForNewData, fetchData, autoRefresh, page]);

//     useEffect(() => {
//         if (previousDataHashRef.current === "") return;
//         setHasNewData(false);
//         setNewDataCount(0);
//         setPage(1); // Reset to page 1 when filters change
//         fetchData(true);
//     }, [globalFilter, cameraFilter, pageSize]);

//     useEffect(() => {
//         if (previousDataHashRef.current === "") return;
        
//         // Update total pages when page changes to ensure correct pagination
//         const updateTotalPages = async () => {
//             const accurateTotalCount = await getAccurateTotalCount();
//             const calculatedTotalPages = Math.max(1, Math.ceil(accurateTotalCount / pageSize));
//             setTotalPages(calculatedTotalPages);
//             setTotalCount(accurateTotalCount);
//         };
        
//         updateTotalPages();
//         fetchData();
//     }, [page]);

//     const table = useReactTable({
//         data,
//         columns,
//         state: {
//             sorting,
//             pagination: { pageIndex: page - 1, pageSize }
//         },
//         onSortingChange: setSorting,
//         getCoreRowModel: getCoreRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//         manualPagination: true,
//     });

//     const handleSearch = useMemo(
//         () => debounce((value) => {
//             setGlobalFilter(value);
//             setPage(1);
//         }, 300),
//         []
//     );

//     return (
//         <div className="p-4 space-y-4 max-w-full">
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
//                     <h2 className="text-xl font-bold text-[#fce4e4]">Fire Alerts</h2>
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

//                     <input
//                         type="text"
//                         placeholder="Search alerts..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300 min-w-[150px]"
//                     />

//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
//                     >
//                         <option value="">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id}>{cam.name}</option>
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
//                             <option key={size} value={size}>Show {size}</option>
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
//                                         {flexRender(header.column.columnDef.header, header.getContext())}
//                                         {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted()] ?? null}
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
//                                         Loading Fire Alerts...
//                                     </div>
//                                 </td>
//                             </tr>
//                         ) : table.getRowModel().rows.length > 0 ? (
//                             table.getRowModel().rows.map((row) => (
//                                 <tr key={row.id} className="hover:bg-green-50">
//                                     {row.getVisibleCells().map((cell) => (
//                                         <td key={cell.id} className="px-4 py-3 border border-green-100 whitespace-normal break-words">
//                                             {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                                         </td>
//                                     ))}
//                                 </tr>
//                             ))
//                         ) : (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-12 text-gray-500">
//                                     No fire alerts found.
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
//                         Showing {data.length} of {totalCount} alert{totalCount !== 1 ? 's' : ''}
//                     </span>
//                     {hasNewData && page !== 1 && (
//                         <span className="text-xs text-yellow-600">New alerts available on page 1</span>
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
//             <div className="fixed bottom-2 right-4 text-xs font-bold">
//                 <span className="text-red-600">© Ajeevi</span>{" "}
//                 <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//             </div>
//         </div>
//     );
// };

// export default FireTable;


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

// const FireTable = () => {
//     const isPreviewOpenRef = useRef(false);
//     const lastFetchTimeRef = useRef(Date.now());
//     const previousDataHashRef = useRef("");
//     const previousTotalCountRef = useRef(0);
//     const lastCheckTimeRef = useRef(Date.now());
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
//     const [autoRefresh, setAutoRefresh] = useState(true);
//     const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
//     const [newDataCount, setNewDataCount] = useState(0);

//     const userId = Cookies.get("userId");

//     // Calculate hash of data to detect changes
//     const calculateDataHash = useCallback((dataArray) => {
//         if (!dataArray || dataArray.length === 0) return "empty";

//         // Use IDs and timestamps to create a unique hash
//         const ids = dataArray.map(item => item.id).sort().join(",");
//         const timestamps = dataArray.map(item => item.regDate).sort().join(",");
//         return `${ids}_${timestamps}`;
//     }, []);

//     // Define table columns (unchanged)
//     const columns = [
//         columnHelper.accessor("id", {
//             header: "ID",
//             cell: (info) =>
//                 // info.row.index + 1,
//             (page - 1) * pageSize + info.row.index + 1,
//         }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//             header: "Event",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     const eventName = Object.keys(parsed)[0];

//                     let icon = "?";
//                     if (eventName.toLowerCase().includes("fire")) icon = "🔥";

//                     return (
//                         <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                             {icon} {eventName}
//                         </span>
//                     );
//                 } catch {
//                     return <span>{raw}</span>;
//                 }
//             },
//         }),
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
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;

//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{
//                             mask: "Click to Preview",
//                             onVisibleChange: (visible) => {
//                                 isPreviewOpenRef.current = visible;
//                                 if (visible) {
//                                     setAutoRefresh(false);
//                                 } else {
//                                     setTimeout(() => setAutoRefresh(true), 2000);
//                                 }
//                             },
//                         }}
//                     />
//                 );
//             },
//         }),
//     ];

//     // Fetch cameras from the same API
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(
//                 `/CameraAlert/?camera_id=&end_date=&format=json&objectName=Fire&page=1&pageSize=100&search=&start_date=`
//             );
//             // Extract unique cameras from results
//             const uniqueCameras = res.data.results.map(item => ({
//                 id: item.camera_id,
//                 name: item.camera_name || `Camera ${item.camera_id}`
//             })).filter((cam, index, self) =>
//                 index === self.findIndex(c => c.id === cam.id)
//             );
//             setCameras(uniqueCameras);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Check for new data WITHOUT fetching full data
//     const checkForNewData = useCallback(async () => {
//         if (isPreviewOpenRef.current || !autoRefresh) return;

//         // Throttle check calls (minimum 5 seconds between checks)
//         const now = Date.now();
//         if (now - lastCheckTimeRef.current < 5000) {
//             return;
//         }

//         lastCheckTimeRef.current = now;

//         try {
//             // Make a lightweight call to get only the count (pageSize=1 to minimize data)
//             const checkUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=1&pageSize=1&search=${globalFilter}&start_date=`;
//             const res = await deviceApi.get(checkUrl);
//             const newTotalCount = res.data.count || 0;

//             // If total count is different, there's new data
//             if (newTotalCount !== previousTotalCountRef.current) {
//                 const difference = newTotalCount - previousTotalCountRef.current;
//                 setNewDataCount(Math.max(0, difference));
//                 setHasNewData(true);
//                 return true; // New data available
//             }

//             return false; // No new data
//         } catch (err) {
//             console.error("Check for new data failed:", err);
//             return false;
//         }
//     }, [cameraFilter, globalFilter, autoRefresh]);

//     // Main data fetching function - ONLY called when we know there's new data
//     const fetchData = useCallback(async (forceFetch = false, isManualRefresh = false) => {
//         // Skip if preview is open and not forced
//         if (isPreviewOpenRef.current && !forceFetch) {
//             return;
//         }

//         // Skip if auto-refresh is disabled and not forced
//         if (!autoRefresh && !forceFetch && !isManualRefresh) {
//             return;
//         }

//         // Throttle API calls (minimum 2 seconds between calls)
//         const now = Date.now();
//         if (now - lastFetchTimeRef.current < 2000 && !forceFetch) {
//             return;
//         }

//         try {
//             setLoading(true);
//             lastFetchTimeRef.current = now;

//             const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;

//             const res = await deviceApi.get(apiUrl);
//             const newData = res.data.results || [];
//             const newTotalCount = res.data.count || 0;

//             // Calculate hash of new data
//             const newDataHash = calculateDataHash(newData);

//             // Update data regardless (since we only fetch when we know there's new data)
//             setData(newData);
//             setTotalCount(newTotalCount);

//             // Update the hash reference
//             previousDataHashRef.current = newDataHash;
//             previousTotalCountRef.current = newTotalCount;

//             // Calculate total pages
//             const calculatedTotalPages = Math.ceil((newTotalCount || 1) / pageSize);
//             setTotalPages(calculatedTotalPages);

//             // Reset new data indicators
//             setHasNewData(false);
//             setNewDataCount(0);

//             // Update last refresh time
//             setLastRefreshTime(Date.now());

//             // Adjust page if current page exceeds total pages after data changes
//             if (page > calculatedTotalPages && calculatedTotalPages > 0) {
//                 setPage(calculatedTotalPages);
//             }
//         } catch (err) {
//             console.error("Fire API Error:", err);
//             // Don't clear data on error, keep showing old data
//         } finally {
//             setLoading(false);
//         }
//     }, [globalFilter, cameraFilter, page, pageSize, autoRefresh, calculateDataHash]);

//     // Manual refresh function
//     const handleManualRefresh = () => {
//         setHasNewData(false);
//         setNewDataCount(0);
//         fetchData(true, true);
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

//     // Auto-check for new data (without fetching full data)
//     useEffect(() => {
//         if (!autoRefresh) return;

//         const interval = setInterval(async () => {
//             if (isPreviewOpenRef.current) return;

//             // Check if there's new data (lightweight call)
//             const hasNewData = await checkForNewData();

//             // If new data found and we're on page 1, fetch it automatically
//             if (hasNewData && page === 1) {
//                 fetchData();
//             }
//         }, 10000); // Check every 10 seconds

//         return () => clearInterval(interval);
//     }, [checkForNewData, fetchData, autoRefresh, page]);

//     // Fetch when filters or pagination changes
//     useEffect(() => {
//         // Don't fetch on initial mount
//         if (previousDataHashRef.current === "") return;

//         setHasNewData(false);
//         setNewDataCount(0);
//         fetchData(true);
//     }, [globalFilter, cameraFilter, pageSize]);

//     // Special effect for page changes
//     useEffect(() => {
//         if (previousDataHashRef.current === "") return;

//         const fetchPageData = async () => {
//             try {
//                 setLoading(true);
//                 lastFetchTimeRef.current = Date.now();

//                 const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;

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
//             } catch (err) {
//                 console.error("Fire API Error on page change:", err);
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
//                         Fire Alerts
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
//                     {/* Refresh status */}
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
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm min-w-[150px]"
//                     >
//                         <option value="">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id}>
//                                 {cam.name}
//                             </option>
//                         ))}
//                     </select>

//                     {/* Page size */}
//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size}>
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
//                                         Loading Fire Alerts...
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
//                                     No fire alerts found.
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

// export default FireTable;

/////////////////////////////////

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

// const FireTable = () => {
//     const isPreviewOpenRef = useRef(false);
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

//     const userId = Cookies.get("userId");

//     // Define table columns (unchanged)
//     const columns = [
//         columnHelper.accessor("id", {
//             header: "ID",
//             cell: (info) => info.row.index + 1,
//         }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//             header: "Event",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     const eventName = Object.keys(parsed)[0];

//                     let icon = "?";
//                     if (eventName.toLowerCase().includes("fire")) icon = "🔥";

//                     return (
//                         <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                             {icon} {eventName}
//                         </span>
//                     );
//                 } catch {
//                     return <span>{raw}</span>;
//                 }
//             },
//         }),
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 let emoji = "?";

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
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {emoji} {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;

//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{
//                             mask: "Click to Preview",
//                             onVisibleChange: (visible) => {
//                                 isPreviewOpenRef.current = visible;
//                             },
//                         }}
//                     />
//                 );
//             },
//         }),
//     ];

//     // ✅ Updated: Fetch cameras from the same API (first page, no filters)
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(
//                 `/CameraAlert/?camera_id=&end_date=&format=json&objectName=Fire&page=1&pageSize=100&search=&start_date=`
//             );
//             // Extract unique cameras from results
//             const uniqueCameras = res.data.results.map(item => ({
//                 id: item.camera_id,
//                 name: item.camera_name || `Camera ${item.camera_id}`
//             })).filter((cam, index, self) =>
//                 index === self.findIndex(c => c.id === cam.id)
//             );
//             setCameras(uniqueCameras);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // ✅ Updated: Use the correct Fire API with all parameters
//     const fetchData = async () => {
//         try {
//             setLoading(true);

//             const apiUrl = `/CameraAlert/?camera_id=${cameraFilter}&end_date=&format=json&objectName=Fire&page=${page}&pageSize=${pageSize}&search=${globalFilter}&start_date=`;

//             const res = await deviceApi.get(apiUrl);

//             setData(res.data.results || []);
//             setTotalCount(res.data.count || 0);
//             setTotalPages(Math.ceil((res.data.count || 1) / pageSize));
//         } catch (err) {
//             console.error("Fire API Error:", err);
//             setData([]);
//         } finally {
//             setLoading(false);
//         }
//     };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//         fetchData();

//         const interval = setInterval(() => {
//             if (isPreviewOpenRef.current) return;
//             fetchData();
//         }, 10000);

//         return () => clearInterval(interval);
//     }, [globalFilter, cameraFilter, page, pageSize]);

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
//         manualPagination: true, // Enable manual pagination
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
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">
//                     Fire Alerts
//                 </h2>

//                 <div className="flex gap-3 items-center flex-wrap">
//                     {/* Search */}
//                     <input
//                         type="text"
//                         placeholder="Search alerts..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     {/* Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id}>
//                                 {cam.name}
//                             </option>
//                         ))}
//                     </select>

//                     {/* Page size */}
//                     <select
//                         value={pageSize}
//                         onChange={(e) => {
//                             setPageSize(Number(e.target.value));
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         {[10, 25, 50].map((size) => (
//                             <option key={size} value={size}>
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
//                         {loading ? (
//                             <tr>
//                                 <td colSpan={columns.length} className="text-center py-6">
//                                     <div className="flex items-center justify-center gap-2">
//                                         <div className="w-6 h-6 border-2 border-[#9864db] border-t-transparent rounded-full animate-spin"></div>
//                                         Loading Fire Alerts...
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
//                                     No fire alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
//             <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//                 <span className="text-sm text-gray-600">
//                     Showing {data.length} of {totalCount} Fire Alerts
//                 </span>
//                 <div className="flex gap-2">
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
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default FireTable;

///////////////////////

// import React, { useState, useEffect, useMemo, useRef } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd"; // ? AntD Image (preview/zoom)
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const FireTable = () => {

// const isPreviewOpenRef = useRef(false);
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState(""); // ? Camera filter state
//     const [cameras, setCameras] = useState([]); // ? Dropdown options
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     // const [isPreviewOpen, setIsPreviewOpen] = useState(false);

//     const userId = Cookies.get("userId");
//     // ? Define table columns
//     const columns = [
//         columnHelper.accessor("id", { header: "ID", cell: (info) => info.row.index + 1, }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//     header: "Event",
//     cell: (info) => {
//         const raw = info.getValue();  // "{'fire!': 2}"

//         try {
//             // Convert Python dict ? valid JSON
//             const cleaned = raw.replace(/'/g, '"');
//             const parsed = JSON.parse(cleaned);
//             const eventName = Object.keys(parsed)[0]; // "fire!"

//             // ? icon mapping system
//             let icon = "??"; // default
//             if (eventName.toLowerCase().includes("fire")) icon = "🔥";
//             if (eventName.toLowerCase().includes("smoke")) icon = "?";
//             if (eventName.toLowerCase().includes("person")) icon = "?";
//             if (eventName.toLowerCase().includes("helmet")) icon = "??";

//             return (
//                 <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                     {icon} {eventName}
//                 </span>
//             );
//         } catch {
//             return <span>{raw}</span>;
//         }
//     },
// }),

//         // columnHelper.accessor("objectName", { header: "Event" }),
//         // Alert Severity Mapping
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 let emoji = "??";

//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         emoji = "?";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         emoji = "?";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         emoji = "??";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         emoji = "?";
//                         break;
//                 }

//                 return (
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {emoji} {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),

// //         columnHelper.accessor("framePath", {
// //   header: "Snapshot",
// //   cell: (info) => {
// //     const path = info.getValue();
// //     const imgUrl = `${ANALYTICS_API_URL}/${path}`;

// //     return (
// //       <Image
// //         src={imgUrl}
// //         alt="frame"
// //         width={80}
// //         height={60}
// //         className="object-cover rounded border"
// //         preview={{
// //           mask: "Click to Preview",
// //           onVisibleChange: (visible) => {
// //             setIsPreviewOpen(visible); // 🔥 pause / resume polling
// //           },
// //         }}
// //       />
// //     );
// //   },
// // }),

// columnHelper.accessor("framePath", {
//   header: "Snapshot",
//   cell: (info) => {
//     const path = info.getValue();
//     const imgUrl = `${ANALYTICS_API_URL}/${path}`;

//     return (
//       <Image
//         src={imgUrl}
//         alt="frame"
//         width={80}
//         height={60}
//         className="object-cover rounded border"
//         preview={{
//           mask: "Click to Preview",
//           onVisibleChange: (visible) => {
//             isPreviewOpenRef.current = visible; // ✅ no re-render
//           },
//         }}
//       />
//     );
//   },
// }),

//     ];

//     // ? Fetch cameras for filter dropdown
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/CameraAlert/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     const fetchData = async () => {
//   try {
//     setLoading(true);

//     const res = await deviceApi.get("/CameraAlert/");

//     setData(res.data.results || []);
//     setTotalPages(Math.ceil((res.data.count || 1) / pageSize));
//   } catch (err) {
//     console.error("API Error:", err);
//   } finally {
//     setLoading(false);
//   }
// };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

// useEffect(() => {
//   fetchData();

//   const interval = setInterval(() => {
//     // ⛔ preview open hai → skip API call
//     if (isPreviewOpenRef.current) return;

//     fetchData();
//   }, 10000);

//   return () => clearInterval(interval);

// }, [globalFilter, page, pageSize, cameraFilter]);

// //     useEffect(() => {
// //   // first time call
// //   fetchData();

// //   // ⛔ preview open hai → auto refresh band
// //   if (isPreviewOpen) return;

// //   // 🔁 auto refresh every 10 seconds
// //   const interval = setInterval(() => {
// //     fetchData();
// //   }, 10000);

// //   return () => clearInterval(interval);

// // }, [globalFilter, page, pageSize, cameraFilter, isPreviewOpen]);

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
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">
//                     Fire
//                 </h2>

//                 <div className="flex gap-3 items-center">
//                     {/* ? Search */}
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     {/* ? Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     {/* ? Page size */}
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

//             {/* Table */}
//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm ">
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
//                                         {header.column.getIsSorted() === "asc" && " ?"}
//                                         {header.column.getIsSorted() === "desc" && " ?"}
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
//                                     No data found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
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

// export default FireTable;

/////////////////////////////

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

// const FireTable = () => {
//     const [allData, setAllData] = useState([]);
//     const [displayData, setDisplayData] = useState([]);
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

//     // Define table columns
//     const columns = useMemo(() => [
//         columnHelper.accessor("id", {
//             header: "ID",
//             cell: (info) => info.row.index + 1
//         }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//             header: "Event",
//             cell: (info) => {
//                 const raw = info.getValue();
//                 try {
//                     const cleaned = raw.replace(/'/g, '"');
//                     const parsed = JSON.parse(cleaned);
//                     const eventName = Object.keys(parsed)[0];

//                     let icon = "🔥";
//                     if (eventName.toLowerCase().includes("fire")) icon = "🔥";
//                     if (eventName.toLowerCase().includes("smoke")) icon = "💨";
//                     if (eventName.toLowerCase().includes("person")) icon = "👤";
//                     if (eventName.toLowerCase().includes("helmet")) icon = "⛑️";

//                     return (
//                         <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                             {icon} {eventName}
//                         </span>
//                     );
//                 } catch {
//                     return <span>{raw}</span>;
//                 }
//             },
//         }),
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 let emoji = "❓";

//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         emoji = "ℹ️";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         emoji = "🚨";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         emoji = "⚠️";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         emoji = "✅";
//                         break;
//                 }

//                 return (
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {emoji} {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{ mask: "Click to Preview" }}
//                     />
//                 );
//             },
//         }),
//     ], []);

//     // Fetch cameras for filter dropdown
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/Camera/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // Fetch all alerts
//     const fetchAllData = async () => {
//         try {
//             setLoading(true);
//             const res = await deviceApi.get(`/CameraAlert/`);
//             setAllData(res.data.results || []);
//         } catch (err) {
//             console.error("API Error:", err);
//             setAllData([]);
//         } finally {
//             setLoading(false);
//         }
//     };

//     // Filter and paginate data
//     const filterAndPaginateData = () => {
//         // Filter for fire events
//         let filteredData = allData.filter(item => {
//             if (!item.objectName) return false;

//             // Check if it's a fire event
//             const isFireEvent = item.objectName.toLowerCase().includes("fire");

//             // Check camera filter
//             const cameraMatch = cameraFilter ?
//                 (item.camera_id === cameraFilter || item.cameraId === cameraFilter) : true;

//             // Check search filter
//             const searchMatch = globalFilter ?
//                 (item.objectName?.toLowerCase().includes(globalFilter.toLowerCase()) ||
//                  item.camera_name?.toLowerCase().includes(globalFilter.toLowerCase())) : true;

//             return isFireEvent && cameraMatch && searchMatch;
//         });

//         // Calculate total pages
//         const totalItems = filteredData.length;
//         setTotalPages(Math.max(1, Math.ceil(totalItems / pageSize)));

//         // Apply pagination
//         const startIndex = (page - 1) * pageSize;
//         const endIndex = startIndex + pageSize;
//         const paginatedData = filteredData.slice(startIndex, endIndex);

//         setDisplayData(paginatedData);
//     };

//     useEffect(() => {
//         fetchCameras();
//         fetchAllData();
//     }, []);

//     useEffect(() => {
//         // Filter and paginate whenever dependencies change
//         filterAndPaginateData();
//     }, [allData, globalFilter, cameraFilter, page, pageSize]);

//     useEffect(() => {
//         // Auto refresh every 10 seconds
//         const interval = setInterval(() => {
//             fetchAllData();
//         }, 10000);

//         return () => clearInterval(interval);
//     }, []);

//     const table = useReactTable({
//         data: displayData,
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
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">
//                     Fire
//                 </h2>

//                 <div className="flex gap-3 items-center">
//                     {/* Search */}
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     {/* Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">All Cameras</option>
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
//                 <table className="min-w-full text-sm ">
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
//                                     No fire alerts found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
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

// export default FireTable;

/////////////////////

// import React, { useState, useEffect, useMemo } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd"; // ? AntD Image (preview/zoom)
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const FireTable = () => {
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState(""); // ? Camera filter state
//     const [cameras, setCameras] = useState([]); // ? Dropdown options
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     const userId = Cookies.get("userId");
//     // ? Define table columns
//     const columns = [
//         columnHelper.accessor("id", { header: "ID", cell: (info) => info.row.index + 1, }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//     header: "Event",
//     cell: (info) => {
//         const raw = info.getValue();  // "{'fire!': 2}"

//         try {
//             // Convert Python dict ? valid JSON
//             const cleaned = raw.replace(/'/g, '"');
//             const parsed = JSON.parse(cleaned);
//             const eventName = Object.keys(parsed)[0]; // "fire!"

//             // ? icon mapping system
//             let icon = "??"; // default
//             if (eventName.toLowerCase().includes("fire")) icon = "🔥";
//             if (eventName.toLowerCase().includes("smoke")) icon = "?";
//             if (eventName.toLowerCase().includes("person")) icon = "?";
//             if (eventName.toLowerCase().includes("helmet")) icon = "??";

//             return (
//                 <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                     {icon} {eventName}
//                 </span>
//             );
//         } catch {
//             return <span>{raw}</span>;
//         }
//     },
// }),

//         // columnHelper.accessor("objectName", { header: "Event" }),
//         // Alert Severity Mapping
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 let emoji = "??";

//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         emoji = "?";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         emoji = "?";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         emoji = "??";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         emoji = "?";
//                         break;
//                 }

//                 return (
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {emoji} {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{ mask: "Click to Preview" }}
//                     />
//                 );
//             },
//         }),
//     ];

//     // ? Fetch cameras for filter dropdown
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/CameraAlert/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // ? Fetch alerts using deviceApi instead of hardcoded URL
//     // const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//     //     try {
//     //         setLoading(true);
//     //         const res = await deviceApi.get(`http://14.195.152.244:9006/api/CameraAlert/?userid=6de5231c-422a-4e41-b971-5cb49042a7a5&page=1&pageSize=10&camera_id=&search=&start_date=&end_date=&objectName=fire`,
//     //             {
//     //             params: {
//     //                 userid: userId,          // you can replace with dynamic userId if needed
//     //                 page: currentPage,
//     //                 pageSize: size,
//     //                 camera_id: cameraFilter || "", // camera filter
//     //                 search,
//     //             },
//     //         });

//     //         setData(res.data.results || []);
//     //         setTotalPages(Math.ceil(res.data.count / size));
//     //     } catch (err) {
//     //         console.error("API Error:", err);
//     //     } finally {
//     //         setLoading(false);
//     //     }
//     // };

//     const fetchData = async () => {
//   try {
//     setLoading(true);

//     const res = await deviceApi.get("/CameraAlert/");

//     setData(res.data.results || []);
//     setTotalPages(Math.ceil((res.data.count || 1) / pageSize));
//   } catch (err) {
//     console.error("API Error:", err);
//   } finally {
//     setLoading(false);
//   }
// };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//     // first time call
//     fetchData(globalFilter, page, pageSize);

//     // 🔁 auto refresh every 10 seconds
//     const interval = setInterval(() => {
//         fetchData(globalFilter, page, pageSize);
//     }, 10000); // 10 sec

//     // 🧹 cleanup (very important)
//     return () => clearInterval(interval);

// }, [globalFilter, page, pageSize, cameraFilter]);

//     // useEffect(() => {
//     //     fetchData(globalFilter, page, pageSize);
//     // }, [globalFilter, page, pageSize, cameraFilter]); // ? refetch when camera changes

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
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">
//                     Video Analytics Alerts
//                 </h2>

//                 <div className="flex gap-3 items-center">
//                     {/* ? Search */}
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     {/* ? Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     {/* ? Page size */}
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

//             {/* Table */}
//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm ">
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
//                                         {header.column.getIsSorted() === "asc" && " ?"}
//                                         {header.column.getIsSorted() === "desc" && " ?"}
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
//                                     No data found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
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

// export default FireTable;

///////////////////////////////////////////

// import React, { useState, useEffect, useMemo } from "react";
// import {
//     useReactTable,
//     getCoreRowModel,
//     getSortedRowModel,
//     flexRender,
//     createColumnHelper,
// } from "@tanstack/react-table";
// import { Image } from "antd"; // ? AntD Image (preview/zoom)
// import debounce from "lodash/debounce";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../utils/axiosInstance";
// import { ANALYTICS_API_URL } from "../../../config";

// const columnHelper = createColumnHelper();

// const FireTable = () => {
//     const [data, setData] = useState([]);
//     const [sorting, setSorting] = useState([]);
//     const [globalFilter, setGlobalFilter] = useState("");
//     const [cameraFilter, setCameraFilter] = useState(""); // ? Camera filter state
//     const [cameras, setCameras] = useState([]); // ? Dropdown options
//     const [page, setPage] = useState(1);
//     const [pageSize, setPageSize] = useState(10);
//     const [totalPages, setTotalPages] = useState(1);
//     const [loading, setLoading] = useState(false);
//     const userId = Cookies.get("userId");
//     // ? Define table columns
//     const columns = [
//         columnHelper.accessor("id", { header: "ID", cell: (info) => info.row.index + 1, }),
//         columnHelper.accessor("camera_name", {
//             header: "Camera name",
//             cell: (info) => {
//                 const raw = info.getValue();
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
//         columnHelper.accessor("objectName", {
//     header: "Event",
//     cell: (info) => {
//         const raw = info.getValue();  // "{'fire!': 2}"

//         try {
//             // Convert Python dict ? valid JSON
//             const cleaned = raw.replace(/'/g, '"');
//             const parsed = JSON.parse(cleaned);
//             const eventName = Object.keys(parsed)[0]; // "fire!"

//             // ? icon mapping system
//             let icon = "??"; // default
//             if (eventName.toLowerCase().includes("fire")) icon = "🔥";
//             if (eventName.toLowerCase().includes("smoke")) icon = "?";
//             if (eventName.toLowerCase().includes("person")) icon = "?";
//             if (eventName.toLowerCase().includes("helmet")) icon = "??";

//             return (
//                 <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-800">
//                     {icon} {eventName}
//                 </span>
//             );
//         } catch {
//             return <span>{raw}</span>;
//         }
//     },
// }),

//         // columnHelper.accessor("objectName", { header: "Event" }),
//         // Alert Severity Mapping
//         columnHelper.accessor("alertStatus", {
//             header: "Severity",
//             cell: (info) => {
//                 const code = info.getValue();
//                 let label = "Unknown";
//                 let color = "bg-gray-100 text-gray-600";
//                 let emoji = "??";

//                 switch (code) {
//                     case "B":
//                         label = "Basic";
//                         color = "bg-blue-100 text-blue-700";
//                         emoji = "?";
//                         break;
//                     case "C":
//                         label = "Critical";
//                         color = "bg-red-100 text-red-700";
//                         emoji = "?";
//                         break;
//                     case "S":
//                         label = "Severe";
//                         color = "bg-orange-100 text-orange-700";
//                         emoji = "??";
//                         break;
//                     case "N":
//                         label = "Normal";
//                         color = "bg-green-100 text-green-700";
//                         emoji = "?";
//                         break;
//                 }

//                 return (
//                     <span className={`px-2 py-1 text-xs rounded ${color}`}>
//                         {emoji} {label}
//                     </span>
//                 );
//             },
//         }),
//         columnHelper.accessor("regDate", {
//             header: "Timestamp",
//             cell: (info) =>
//                 new Date(info.getValue()).toLocaleString("en-IN", {
//                     dateStyle: "short",
//                     timeStyle: "medium",
//                 }),
//         }),
//         columnHelper.accessor("framePath", {
//             header: "Snapshot",
//             cell: (info) => {
//                 const path = info.getValue();
//                 const imgUrl = `${ANALYTICS_API_URL}/${path}`;
//                 return (
//                     <Image
//                         src={imgUrl}
//                         alt="frame"
//                         width={80}
//                         height={60}
//                         className="object-cover rounded border"
//                         preview={{ mask: "Click to Preview" }}
//                     />
//                 );
//             },
//         }),
//     ];

//     // ? Fetch cameras for filter dropdown
//     const fetchCameras = async () => {
//         try {
//             const res = await deviceApi.get(`/CameraAlert/`);
//             setCameras(res.data.results || []);
//         } catch (err) {
//             console.error("Camera fetch failed:", err);
//         }
//     };

//     // ? Fetch alerts using deviceApi instead of hardcoded URL
//     const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
//         try {
//             setLoading(true);
//             const res = await deviceApi.get(`http://14.195.152.244:9006/api/CameraAlert/?userid=6de5231c-422a-4e41-b971-5cb49042a7a5&page=1&pageSize=10&camera_id=&search=&start_date=&end_date=&objectName=fire`,
//                 {
//                 params: {
//                     userid: userId,          // you can replace with dynamic userId if needed
//                     page: currentPage,
//                     pageSize: size,
//                     camera_id: cameraFilter || "", // camera filter
//                     search,
//                 },
//             });

//             setData(res.data.results || []);
//             setTotalPages(Math.ceil(res.data.count / size));
//         } catch (err) {
//             console.error("API Error:", err);
//         } finally {
//             setLoading(false);
//         }
//     };

//     useEffect(() => {
//         fetchCameras();
//     }, []);

//     useEffect(() => {
//     // first time call
//     fetchData(globalFilter, page, pageSize);

//     // 🔁 auto refresh every 10 seconds
//     const interval = setInterval(() => {
//         fetchData(globalFilter, page, pageSize);
//     }, 10000); // 10 sec

//     // 🧹 cleanup (very important)
//     return () => clearInterval(interval);

// }, [globalFilter, page, pageSize, cameraFilter]);

//     // useEffect(() => {
//     //     fetchData(globalFilter, page, pageSize);
//     // }, [globalFilter, page, pageSize, cameraFilter]); // ? refetch when camera changes

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
//             {/* Header */}
//             <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//                 <h2 className="text-xl font-bold text-[#fce4e4]">
//                     Video Analytics Alerts
//                 </h2>

//                 <div className="flex gap-3 items-center">
//                     {/* ? Search */}
//                     <input
//                         type="text"
//                         placeholder="Search (object)..."
//                         onChange={(e) => handleSearch(e.target.value)}
//                         className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
//                     />

//                     {/* ? Camera Filter */}
//                     <select
//                         value={cameraFilter}
//                         onChange={(e) => {
//                             setCameraFilter(e.target.value);
//                             setPage(1);
//                         }}
//                         className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//                     >
//                         <option value="" className="text-black">All Cameras</option>
//                         {cameras.map((cam) => (
//                             <option key={cam.id} value={cam.id} className="text-black">
//                                 {cam.name || `Camera ${cam.id}`}
//                             </option>
//                         ))}
//                     </select>

//                     {/* ? Page size */}
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

//             {/* Table */}
//             <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
//                 <table className="min-w-full text-sm ">
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
//                                         {header.column.getIsSorted() === "asc" && " ?"}
//                                         {header.column.getIsSorted() === "desc" && " ?"}
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
//                                     No data found.
//                                 </td>
//                             </tr>
//                         )}
//                     </tbody>
//                 </table>
//             </div>

//             {/* Pagination */}
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

// export default FireTable;

//////////////////////////////////////////
