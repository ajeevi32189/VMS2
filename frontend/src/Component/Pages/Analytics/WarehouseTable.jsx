



import React, { useState, useEffect, useMemo,useRef } from "react";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    createColumnHelper,
} from "@tanstack/react-table";
import { Image } from "antd"; // ✅ AntD Image (preview/zoom)
import debounce from "lodash/debounce";
import Cookies from "js-cookie";
import { deviceApi } from "../../../utils/axiosInstance";
import { ANALYTICS_API_URL } from "../../../config";
import { AlertSnapshot, formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const WarehouseTable = () => {
    const [data, setData] = useState([]);
    const [sorting, setSorting] = useState([]);
    const [globalFilter, setGlobalFilter] = useState("");
    const [cameraFilter, setCameraFilter] = useState(""); // ✅ Camera filter state
    const [cameras, setCameras] = useState([]); // ✅ Dropdown options
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const userId = Cookies.get("userId");
    const intervalRef = useRef(null);




    // ✅ Define table columns
    const columns = [
        columnHelper.accessor("id", { header: "S.No", cell: (info) => info.row.index + 1, }),
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
                                <span
                                    key={k}
                                    className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-800"
                                >
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
        columnHelper.accessor("objectCount", { header: "Count" }),
        // Alert Severity Mapping
        columnHelper.accessor("alertStatus", {
            header: "Severity",
            cell: (info) => {
                const code = info.getValue();
                let label = "Unknown";
                let color = "bg-gray-100 text-gray-600";
                let emoji = "ℹ️";

                switch (code) {
                    case "B":
                        label = "Basic";
                        color = "bg-blue-100 text-blue-700";
                        emoji = "🔵";
                        break;
                    case "C":
                        label = "Critical";
                        color = "bg-red-100 text-red-700";
                        emoji = "🚨";
                        break;
                    case "S":
                        label = "Severe";
                        color = "bg-orange-100 text-orange-700";
                        emoji = "⚠️";
                        break;
                    case "N":
                        label = "Normal";
                        color = "bg-green-100 text-green-700";
                        emoji = "✅";
                        break;
                }

                return (
                    <span className={`px-2 py-1 text-xs rounded ${color}`}>
                        {emoji} {label}
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
                    <AlertSnapshot
                        path={path}
                        cameraName={row.camera_name}
                        alt="frame"
                        width={80}
                        height={60}
                        className="object-cover rounded border"
                        preview={{ mask: "Click to Preview" }}
                    />
                );
            },
        }),
    ];

    // ✅ Fetch cameras for filter dropdown
    const fetchCameras = async () => {
        try {
            const res = await deviceApi.get(`/Camera/?userid=${userId}&page_size=100`);
            setCameras(res.data.results || []);
        } catch (err) {
            console.error("Camera fetch failed:", err);
        }
    };

    // ✅ Fetch alerts using deviceApi instead of hardcoded URL
    const fetchData = async (search = "", currentPage = 1, size = pageSize) => {
        try {
            setLoading(true);
            const res = await deviceApi.get(`/CameraAlert/`, {
                params: {
                    userid: userId,
                    page: 1,
                    pageSize: 1000,
                    camera_id: cameraFilter || "",
                    objectName: "Free" // Keeping existing logic
                },
            });

            let alerts = res.data.results || [];
            if (search && search.trim()) {
                const q = search.trim().toLowerCase();
                alerts = alerts.filter(item =>
                    (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
                    (item.objectName || "").toLowerCase().includes(q) ||
                    (item.alertType || "").toLowerCase().includes(q) ||
                    (item.camera_location || item.location || "").toLowerCase().includes(q) ||
                    String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
                    String(item.id || "").toLowerCase().includes(q)
                );
            }

            const total = alerts.length;
            const startIndex = (currentPage - 1) * size;
            setData(alerts.slice(startIndex, startIndex + size));
            setTotalPages(Math.max(1, Math.ceil(total / size)));
        } catch (err) {
            console.error("API Error:", err);
        } finally {
            setLoading(false);
        }
    };



    useEffect(() => {
        fetchCameras();
    }, []);


    useEffect(() => {
    // first call
    fetchData(globalFilter, page, pageSize);

    // clear previous interval
    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }

    // auto refresh every 10 seconds
    intervalRef.current = setInterval(() => {
        fetchData(globalFilter, page, pageSize);
    }, 10000);

    // cleanup
    return () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };
}, [globalFilter, page, pageSize, cameraFilter]);


    // useEffect(() => {
    //     fetchData(globalFilter, page, pageSize);
    // }, [globalFilter, page, pageSize, cameraFilter]); // ✅ refetch when camera changes

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
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
                <h2 className="text-xl font-bold text-[#fce4e4]">
                   Location Volumetric
                </h2>

                <div className="flex gap-3 items-center">
                    {/* 🔍 Search */}
                    <input
                        type="text"
                        placeholder="Search (object)..."
                        onChange={(e) => handleSearch(e.target.value)}
                        className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
                    />

                    {/* 📷 Camera Filter */}
                    <select
                        value={cameraFilter}
                        onChange={(e) => {
                            setCameraFilter(e.target.value);
                            setPage(1);
                        }}
                        className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                    >
                        <option value="" className="text-black">All Cameras</option>
                        {cameras.map((cam) => (
                            <option key={cam.id} value={cam.id} className="text-black">
                                {cam.name || `Camera ${cam.id}`}
                            </option>
                        ))}
                    </select>

                    {/* 📄 Page size */}
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
                <table className="min-w-full text-sm ">
                    <thead className="bg-[#9864db] text-[#E6E6FA]">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer"
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
                    <tbody className="bg-white divide-y divide-green-100">
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} className="text-center py-6">
                                    Loading...
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
                                <td colSpan={columns.length} className="text-center py-6">
                                    No data found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
                <span className="text-sm text-gray-600">
                    Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                    <button
                        onClick={() => setPage((p) => Math.max(p - 1, 1))}
                        className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
                        disabled={page === 1}
                    >
                        Prev
                    </button>
                    <button
                        onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                        className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] disabled:opacity-50"
                        disabled={page === totalPages}
                    >
                        Next
                    </button>
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

export default WarehouseTable;
