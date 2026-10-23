import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { deviceApi } from "../../../utils/axiosInstance";
import { Image, Modal, Radio, Button, Progress, message } from "antd";
import { DownloadOutlined, FileExcelOutlined, FileTextOutlined } from "@ant-design/icons";
import { ANALYTICS_API_URL } from "../../../config";
import { AlertSnapshot, formatIndianDateTime, getSnapshotUrl } from "../../../utils/imageUtils";
import Cookies from "js-cookie";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import Papa from "papaparse";

const columnHelper = createColumnHelper();

/** Parse JSON-wrapped alert type or fallback to string */
const parseAlertType = (obj) => {
  try {
    if (typeof obj === "string" && obj.includes("{")) {
      const parsed = JSON.parse(obj.replace(/'/g, '"'));
      return Object.keys(parsed)[0] || "Unknown";
    }
    return obj || "Unknown";
  } catch {
    return obj || "Unknown";
  }
};

const fetchWithTimeout = async (url, timeoutMs = 4000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (_) {
    clearTimeout(id);
    return null;
  }
};

/**
 * STQC-Compliant Image Buffer Fetcher
 * Downloads image directly into memory using authenticated fetch with memory token,
 * supports /app/media and /media path fallback with timeout guard.
 */
const fetchImageBuffer = async (path, cameraName) => {
  if (!path) return null;
  const targetUrl = getSnapshotUrl(path, cameraName);
  if (!targetUrl) return null;
  const fallbackUrl = targetUrl.includes("/app/media/")
    ? targetUrl.replace("/app/media/", "/media/")
    : null;

  try {
    const res = await fetchWithTimeout(targetUrl, 4000);
    if (res && res.ok) {
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const ext = path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      return { buffer: new Uint8Array(arrayBuffer), extension: ext };
    }
  } catch (_) {}

  if (fallbackUrl) {
    try {
      const res = await fetchWithTimeout(fallbackUrl, 4000);
      if (res && res.ok) {
        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const ext = path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        return { buffer: new Uint8Array(arrayBuffer), extension: ext };
      }
    } catch (_) {}
  }
  return null;
};

/* ========================= TABLE COLUMNS ========================= */
const columns = [
  columnHelper.accessor("serialNumber", {
    header: "ID",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("camera_name", { header: "Camera Name" }),
  columnHelper.accessor("camera_location", { header: "Location" }),

  columnHelper.accessor("objectName", {
    header: "Alert Type",
    cell: (info) => parseAlertType(info.getValue()),
  }),

  columnHelper.accessor("objectCount", { header: "Count" }),

  columnHelper.accessor("regDate", {
    header: "Reported At",
    cell: (info) => formatIndianDateTime(info.getValue()),
  }),

  // ✅ Snapshot using STQC-compliant AlertSnapshot
  columnHelper.accessor("framePath", {
    header: "Snapshot",
    cell: (info) => {
      const path = info.getValue();
      if (!path) return <span className="text-gray-400">No image</span>;
      const row = info.row.original;

      return (
        <AlertSnapshot
          path={path}
          cameraName={row.camera_name}
          alt="snapshot"
          width={80}
          height={60}
          className="object-cover rounded border"
          preview={{ mask: "View" }}
        />
      );
    },
  }),
];

/* ========================= COMPONENT ========================= */

const AlertReportTable = () => {
  const [rawAlerts, setRawAlerts] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  /* ===== Add serial number ===== */
  const addSerialNumbers = (items, currentPage, size) =>
    items.map((item, index) => ({
      ...item,
      serialNumber: (currentPage - 1) * size + index + 1,
    }));

  /* ========================= FETCH ALL ALERTS ========================= */
  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const userId = Cookies.get("userId");
      const baseParams = { pageSize: 1000, page_size: 1000, page: 1 };

      // Try with userid first if available, otherwise base params
      let page1Res;
      try {
        page1Res = await deviceApi.get("/CameraAlert/", {
          params: userId ? { ...baseParams, userid: userId } : baseParams,
        });
      } catch {
        page1Res = await deviceApi.get("/CameraAlert/", { params: baseParams });
      }

      let results = page1Res?.data?.results || page1Res?.data || [];
      let total = typeof page1Res?.data?.count === "number" ? page1Res.data.count : results.length;

      // If with userid it returned 0 results, retry without userid (system-wide alerts)
      if (results.length === 0 && userId) {
        try {
          const fallbackRes = await deviceApi.get("/CameraAlert/", { params: baseParams });
          const fbResults = fallbackRes?.data?.results || fallbackRes?.data || [];
          if (fbResults.length > 0) {
            results = fbResults;
            total = typeof fallbackRes?.data?.count === "number" ? fallbackRes.data.count : results.length;
          }
        } catch (_) {}
      }

      let allRecords = [...results];
      const batchSize = results.length > 0 ? results.length : 10;
      const totalPagesNeeded = Math.ceil(total / batchSize);

      if (totalPagesNeeded > 1 && allRecords.length < total) {
        const maxPages = Math.min(totalPagesNeeded, 50);
        const pagePromises = [];
        for (let p = 2; p <= maxPages; p++) {
          pagePromises.push(
            deviceApi
              .get("/CameraAlert/", { params: { ...baseParams, page: p } })
              .then((r) => r.data?.results || r.data || [])
              .catch(() => [])
          );
        }
        const rest = await Promise.all(pagePromises);
        rest.forEach((batch) => {
          if (Array.isArray(batch)) allRecords.push(...batch);
        });
      }

      setRawAlerts(allRecords);
    } catch (err) {
      console.error("API Error in fetchAlerts:", err);
      message.error("Failed to load alerts");
      setRawAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  /* ========================= FILTERING ========================= */
  const filteredAlerts = useMemo(() => {
    return rawAlerts.filter((item) => {
      // 1. Type filter
      if (typeFilter !== "all") {
        const itemType = (item.alertType || item.objectName || "").toLowerCase();
        const parsedT = parseAlertType(item.objectName).toLowerCase();
        if (!itemType.includes(typeFilter.toLowerCase()) && !parsedT.includes(typeFilter.toLowerCase())) {
          return false;
        }
      }

      // 2. Severity filter
      if (severityFilter !== "all") {
        const itemSev = (item.severity || item.alertStatus || "").toLowerCase();
        if (!itemSev.includes(severityFilter.toLowerCase())) return false;
      }

      // 3. Search filter across camera name, alert type, location, device ID, ID, and date
      if (globalFilter && globalFilter.trim()) {
        const q = globalFilter.trim().toLowerCase();
        const camName = (
          item.camera_name ||
          item.cameraName ||
          item.camera ||
          item.name ||
          ""
        ).toLowerCase();
        const objName = (item.objectName || "").toLowerCase();
        const parsedType = parseAlertType(item.objectName).toLowerCase();
        const aType = (item.alertType || "").toLowerCase();
        const loc = (item.camera_location || item.location || "").toLowerCase();
        const devId = String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase();
        const id = String(item.id || item.serialNumber || "").toLowerCase();
        const count = String(item.objectCount || "").toLowerCase();
        const regDate = String(item.regDate || "").toLowerCase();

        const match =
          camName.includes(q) ||
          objName.includes(q) ||
          parsedType.includes(q) ||
          aType.includes(q) ||
          loc.includes(q) ||
          devId.includes(q) ||
          id.includes(q) ||
          count.includes(q) ||
          regDate.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [rawAlerts, typeFilter, severityFilter, globalFilter]);

  const totalCount = filteredAlerts.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return addSerialNumbers(
      filteredAlerts.slice(start, start + pageSize),
      page,
      pageSize
    );
  }, [filteredAlerts, page, pageSize]);

  /* ========================= TABLE ========================= */
  const table = useReactTable({
    data: paginatedData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const handleSearch = (value) => {
    setGlobalFilter(value);
    setPage(1);
  };

  /* ========================= EXPORT WITH EMBEDDED IMAGES ========================= */
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("excel"); // "excel" | "csv"
  const [exportScope, setExportScope] = useState("all"); // "all" | "page"
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState("");

  const handleOpenExportModal = (format) => {
    setExportFormat(format);
    setExportScope(totalCount > pageSize ? "all" : "page");
    setExportProgress(0);
    setExportStatusText("");
    setIsExportModalOpen(true);
  };

  const handleExecuteExport = async () => {
    setExportLoading(true);
    setExportProgress(5);
    setExportStatusText("Fetching alert records for export...");

    try {
      let recordsToExport = [];
      if (exportScope === "page") {
        recordsToExport = paginatedData;
      } else {
        recordsToExport = addSerialNumbers(filteredAlerts, 1, filteredAlerts.length);
      }

      if (recordsToExport.length === 0) {
        message.warning("No alert records found to export.");
        setExportLoading(false);
        setIsExportModalOpen(false);
        return;
      }

      if (exportFormat === "csv") {
        setExportStatusText("Generating clean CSV file with snapshot links...");
        setExportProgress(80);

        const csvData = recordsToExport.map((item, idx) => {
          const snapshotUrl = getSnapshotUrl(item.framePath, item.camera_name);
          return {
            ID: item.serialNumber || idx + 1,
            "Camera Name": item.camera_name || "—",
            Location: item.camera_location || "—",
            "Alert Type": parseAlertType(item.objectName),
            Count: item.objectCount ?? 1,
            "Reported At": formatIndianDateTime(item.regDate),
            Snapshot: snapshotUrl ? `=HYPERLINK("${snapshotUrl}","View Snapshot")` : "No Image",
            "Snapshot URL": snapshotUrl || "—",
          };
        });

        const csv = Papa.unparse(csvData);
        const fileName = `Alert_Report_${new Date().toISOString().slice(0, 10)}.csv`;
        saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), fileName);

        setExportProgress(100);
        message.success(`Successfully exported ${recordsToExport.length} alerts to CSV!`);
        setIsExportModalOpen(false);
        return;
      }

      // ─── EXCEL WITH EMBEDDED IMAGES (ExcelJS - High Speed Concurrent Processing) ───
      setExportStatusText(`Creating Excel workbook for ${recordsToExport.length} alerts...`);
      setExportProgress(10);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "VMS Surveillance System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Alerts", {
        views: [{ showGridLines: true }],
      });

      // Professional columns without redundant status codes
      worksheet.columns = [
        { header: "ID", key: "id", width: 8 },
        { header: "Camera Name", key: "camera_name", width: 34 },
        { header: "Location", key: "location", width: 18 },
        { header: "Alert Type", key: "alert_type", width: 22 },
        { header: "Count", key: "count", width: 10 },
        { header: "Reported At", key: "reported_at", width: 24 },
        { header: "Snapshot", key: "snapshot", width: 20 },
      ];

      // Format Header row - Executive Corporate Navy Blue
      const headerRow = worksheet.getRow(1);
      headerRow.height = 32;
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E79" }, // Professional Corporate Navy
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };

      // In-memory cache for duplicate image paths
      const imageCache = new Map();
      const BATCH_SIZE = 10; // Download 10 images concurrently
      const totalItems = recordsToExport.length;

      // 1. Pre-populate all text cells in one fast pass
      for (let i = 0; i < totalItems; i++) {
        const item = recordsToExport[i];
        const rowIndex = i + 2;
        const row = worksheet.getRow(rowIndex);
        row.height = 55;

        const alertType = parseAlertType(item.objectName);
        row.values = {
          id: item.serialNumber || i + 1,
          camera_name: item.camera_name || "—",
          location: item.camera_location || "—",
          alert_type: alertType,
          count: item.objectCount ?? 1,
          reported_at: formatIndianDateTime(item.regDate),
          snapshot: "",
        };
        row.alignment = { vertical: "middle", horizontal: "center" };
      }

      // 2. Fetch and embed images in parallel batches of 10
      for (let i = 0; i < totalItems; i += BATCH_SIZE) {
        const chunk = recordsToExport.slice(i, i + BATCH_SIZE);

        const imgResults = await Promise.all(
          chunk.map(async (item) => {
            if (!item.framePath) return null;
            if (imageCache.has(item.framePath)) {
              return imageCache.get(item.framePath);
            }
            const imgData = await fetchImageBuffer(item.framePath, item.camera_name);
            if (imgData) imageCache.set(item.framePath, imgData);
            return imgData;
          })
        );

        imgResults.forEach((imgData, idx) => {
          const globalIdx = i + idx;
          const rowIndex = globalIdx + 2;
          const row = worksheet.getRow(rowIndex);

          if (imgData && imgData.buffer) {
            try {
              const imageId = workbook.addImage({
                buffer: imgData.buffer,
                extension: imgData.extension,
              });

              worksheet.addImage(imageId, {
                tl: { col: 6.08, row: rowIndex - 1 + 0.08 },
                ext: { width: 95, height: 50 },
                editAs: "oneCell",
              });
            } catch (_) {
              row.getCell("snapshot").value = "No Image";
            }
          } else {
            row.getCell("snapshot").value = "No Image";
          }
        });

        const completedCount = Math.min(i + BATCH_SIZE, totalItems);
        const currentProgress = Math.round(15 + (completedCount / totalItems) * 80);
        setExportProgress(currentProgress);
        setExportStatusText(`Embedding snapshots: ${completedCount} of ${totalItems}...`);
      }

      setExportStatusText("Generating final Excel file...");
      setExportProgress(96);

      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `Alert_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      saveAs(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        fileName
      );

      setExportProgress(100);
      message.success(`Successfully exported ${totalItems} alerts with snapshot images to Excel!`);
      setIsExportModalOpen(false);
    } catch (err) {
      console.error("Export Error:", err);
      message.error("Failed to export report: " + (err.message || "Unknown error"));
    } finally {
      setExportLoading(false);
    }
  };

  /* ========================= RESTORED ORIGINAL UI ========================= */
  return (
    // <div className="space-y-4">
        <div className="p-4 space-y-4 max-w-full">

      {/* Header Section */}
      <div className="flex justify-between items-center bg-[#9864db] p-3 rounded shadow-sm">
        <h2 className="text-xl font-semibold text-white m-0">Alert Report</h2>
        <div className="flex gap-2.5 items-center">
          <input
            type="text"
            placeholder="Search alerts..."
            value={globalFilter}
            onChange={(e) => handleSearch(e.target.value)}
            className="border border-purple-300 rounded px-3 py-1 text-sm bg-white text-slate-800 focus:outline-none"
          />
          <button
            onClick={() => handleOpenExportModal("excel")}
            className="bg-white/20 hover:bg-green-600 text-white font-medium px-3.5 py-1 rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <FileExcelOutlined /> Export Excel
          </button>
          <button
            onClick={() => handleOpenExportModal("csv")}
            className="bg-white/20 hover:bg-blue-600 text-white font-medium px-3.5 py-1 rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <FileTextOutlined /> Export CSV
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-300">
          <thead className="bg-[#9864db] text-[#E6E6FA]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-2 text-left text-sm font-semibold  border border-gray-300"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-4">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-4">
                  No data available
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-2 text-sm text-gray-700 border border-gray-300"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Section - Restored original design */}
      <div className="flex justify-between items-center mt-4">
        <div className="text-sm text-gray-700">
          Showing page {page} of {totalPages} | Total records: {totalCount}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className={`px-3 py-1 rounded text-sm ${
              page === 1
                ? "bg-[#9864db] text-gray-500 cursor-not-allowed"
                : "bg-[#9864db] hover:bg-gray-300 text-gray-700"
            }`}
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page === totalPages}
            className={`px-3 py-1 rounded text-sm ${
              page === totalPages
                ? "bg-[#9864db] text-gray-500 cursor-not-allowed"
                : "bg-[#9864db] hover:bg-gray-300 text-gray-700"
            }`}
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Export Configuration & Progress Modal ── */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-800">
            {exportFormat === "excel" ? (
              <FileExcelOutlined className="text-emerald-600 text-lg" />
            ) : (
              <FileTextOutlined className="text-blue-600 text-lg" />
            )}
            <span>Export Alert Report ({exportFormat === "excel" ? "Excel with Snapshots" : "CSV"})</span>
          </div>
        }
        open={isExportModalOpen}
        onCancel={() => {
          if (!exportLoading) setIsExportModalOpen(false);
        }}
        footer={null}
        centered
        width={460}
        destroyOnHidden
      >
        <div className="mt-3 space-y-4 text-sm text-slate-700">
          <div>
            <span className="font-semibold block mb-2 text-slate-800">Select Export Range:</span>
            <Radio.Group
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
              disabled={exportLoading}
              className="flex flex-col gap-2.5"
            >
              <Radio value="all">
                <span className="font-medium text-slate-800">All Matching Records</span>{" "}
                <span className="text-xs text-purple-700 font-semibold">({totalCount || rawAlerts.length} alerts)</span>
              </Radio>
              <Radio value="page">
                <span className="font-medium text-slate-800">Current Page Only</span>{" "}
                <span className="text-xs text-slate-500">({paginatedData.length} alerts)</span>
              </Radio>
            </Radio.Group>
          </div>

          {exportLoading && (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex justify-between items-center text-xs text-slate-600 mb-1.5">
                <span className="font-semibold text-slate-700">{exportStatusText}</span>
                <span className="font-mono">{exportProgress}%</span>
              </div>
              <Progress percent={exportProgress} status="active" strokeColor="#1F4E79" showInfo={false} />
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
            <Button
              onClick={() => setIsExportModalOpen(false)}
              disabled={exportLoading}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={handleExecuteExport}
              loading={exportLoading}
              className="bg-[#1F4E79] hover:bg-[#163857] text-white"
              icon={<DownloadOutlined />}
            >
              {exportLoading ? "Exporting..." : `Download ${exportFormat.toUpperCase()}`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AlertReportTable;

/////////////////


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import axios from "axios";
// // import axiosInstance from "../../../utils/axiosInstance";
// import { deviceApi } from '../../../utils/axiosInstance';


// import * as XLSX from "xlsx";
// import { saveAs } from "file-saver";
// import Papa from "papaparse";

// const columnHelper = createColumnHelper();

// // ✅ Updated columns with sequential ID
// const columns = [
//   columnHelper.accessor("serialNumber", { 
//     header: "ID",
//     cell: (info) => info.getValue() || "-"
//   }),
//   columnHelper.accessor("camera_name", { header: "Camera Name" }),
//   columnHelper.accessor("camera_location", { header: "Location" }),
//   columnHelper.accessor("objectName", { 
//     header: "Alert Type",
//     cell: (info) => {
//       try {
//         // Parse the objectName string to extract alert type
//         const objName = info.getValue();
//         if (typeof objName === 'string' && objName.includes('{')) {
//           const parsed = JSON.parse(objName.replace(/'/g, '"'));
//           return Object.keys(parsed)[0] || "Unknown";
//         }
//         return "Unknown";
//       } catch (e) {
//         return "Unknown";
//       }
//     }
//   }),
//   columnHelper.accessor("objectCount", { header: "Count" }),
//   columnHelper.accessor("regDate", {
//     header: "Reported At",
//     cell: (info) => {
//       const date = info.getValue();
//       return date ? new Date(date).toLocaleString() : "-";
//     },
//   }),
//   columnHelper.accessor("status", { 
//     header: "Status",
//     cell: (info) => {
//       const status = info.getValue();
//       return status === 0 ? "Active" : status === 1 ? "Resolved" : "-";
//     }
//   }),
//   columnHelper.accessor("alertStatus", { 
//     header: "Alert Status",
//     cell: (info) => info.getValue() || "-"
//   }),
// ];

// const AlertReportTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [typeFilter, setTypeFilter] = useState("all");
//   const [severityFilter, setSeverityFilter] = useState("all");
//   const [page, setPage] = useState(1);
//   const [pageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [totalCount, setTotalCount] = useState(0);
//   const [loading, setLoading] = useState(false);

//   // ✅ Function to add serial numbers to data
//   const addSerialNumbers = (apiData, currentPage, pageSize) => {
//     return apiData.map((item, index) => ({
//       ...item,
//       serialNumber: (currentPage - 1) * pageSize + index + 1
//     }));
//   };

//   // ✅ Updated fetchData to handle new API response structure
//   const fetchData = async (
//     search = "",
//     currentPage = 1,
//     size = pageSize,
//     type = "all",
//     severity = "all"
//   ) => {
//     setLoading(true);
//     try {
//       const params = { 
//         page: currentPage, 
//         page_size: size 
//       };

//       // Add search if provided
//       if (search) {
//         params.search = search;
//       }

//       // Add filters if not "all"
//       if (type !== "all") {
//         params.alert_type = type;
//       }
      
//       if (severity !== "all") {
//         params.severity = severity;
//       }


//       const res = await deviceApi.get("/CameraAlert/", {
//        params
//        });

//       // const res = await axios.get("http://14.195.152.244:9006/api/CameraAlert/", {
//       //   params
//       // });
      
//       // Extract data from results array and add serial numbers
//       const apiData = res.data.results || [];
//       const dataWithSerial = addSerialNumbers(apiData, currentPage, size);
//       setData(dataWithSerial);
      
//       // Calculate total pages from count and pageSize
//       const total = res.data.count || 0;
//       setTotalCount(total);
//       setTotalPages(Math.ceil(total / size));
      
//     } catch (err) {
//       console.error("API Error:", err);
//       setData([]);
//       setTotalCount(0);
//       setTotalPages(1);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(globalFilter, page, pageSize, typeFilter, severityFilter);
//   }, [globalFilter, page, pageSize, typeFilter, severityFilter]);

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

//   // ✅ Download Excel with formatted data
//   const downloadExcel = () => {
//     if (data.length === 0) {
//       alert("No data to download");
//       return;
//     }

//     // Format data for export
//     const exportData = data.map(item => ({
//       'ID': item.serialNumber,
//       'Camera Name': item.camera_name,
//       'Location': item.camera_location,
//       'Alert Type': (() => {
//         try {
//           if (item.objectName?.includes('{')) {
//             const parsed = JSON.parse(item.objectName.replace(/'/g, '"'));
//             return Object.keys(parsed)[0] || 'Unknown';
//           }
//           return 'Unknown';
//         } catch {
//           return 'Unknown';
//         }
//       })(),
//       'Count': item.objectCount,
//       'Reported At': new Date(item.regDate).toLocaleString(),
//       'Status': item.status === 0 ? 'Active' : 'Resolved',
//       'Alert Status': item.alertStatus
//     }));

//     const worksheet = XLSX.utils.json_to_sheet(exportData);
//     const workbook = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(workbook, worksheet, "Alerts");
//     const excelBuffer = XLSX.write(workbook, {
//       bookType: "xlsx",
//       type: "array",
//     });
//     const blob = new Blob([excelBuffer], {
//       type: "application/octet-stream",
//     });
//     saveAs(blob, `alert_report_page_${page}.xlsx`);
//   };

//   // ✅ Download CSV with formatted data
//   const downloadCSV = () => {
//     if (data.length === 0) {
//       alert("No data to download");
//       return;
//     }

//     // Format data for export
//     const exportData = data.map(item => ({
//       'ID': item.serialNumber,
//       'Camera Name': item.camera_name,
//       'Location': item.camera_location,
//       'Alert Type': (() => {
//         try {
//           if (item.objectName?.includes('{')) {
//             const parsed = JSON.parse(item.objectName.replace(/'/g, '"'));
//             return Object.keys(parsed)[0] || 'Unknown';
//           }
//           return 'Unknown';
//         } catch {
//           return 'Unknown';
//         }
//       })(),
//       'Count': item.objectCount,
//       'Reported At': new Date(item.regDate).toLocaleString(),
//       'Status': item.status === 0 ? 'Active' : 'Resolved',
//       'Alert Status': item.alertStatus
//     }));

//     const csv = Papa.unparse(exportData);
//     const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
//     saveAs(blob, `alert_report_page_${page}.csv`);
//   };

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <div>
//           <h2 className="text-xl font-bold text-[#fce4e4]">Alert Report</h2>
//           <span className="text-xs text-white/80">Total Alerts: {totalCount}</span>
//         </div>

//         <div className="flex gap-3 items-center flex-wrap">
//           {/* Search */}
//           <input
//             type="text"
//             placeholder="Search alerts..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 text-white placeholder:text-white/70 bg-white/10"
//           />

//           {/* Type Filter */}
//           <select
//             value={typeFilter}
//             onChange={(e) => {
//               setTypeFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200 bg-white/10"
//           >
//             <option className="text-black" value="all">All Types</option>
//             <option className="text-black" value="Rodent">Rodent</option>
//             <option className="text-black" value="Fire">Fire</option>
//             <option className="text-black" value="Intrusion">Intrusion</option>
//             <option className="text-black" value="Other">Other</option>
//           </select>

//           {/* Severity Filter */}
//           <select
//             value={severityFilter}
//             onChange={(e) => {
//               setSeverityFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200 bg-white/10"
//           >
//             <option className="text-black" value="all">All Severity</option>
//             <option className="text-black" value="critical">Critical</option>
//             <option className="text-black" value="severe">Severe</option>
//             <option className="text-black" value="normal">Normal</option>
//           </select>

//           {/* Download Buttons */}
//           <button
//             onClick={downloadExcel}
//             className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow hover:bg-white/10"
//             disabled={loading || data.length === 0}
//           >
//             ⬇ Excel
//           </button>
//           <button
//             onClick={downloadCSV}
//             className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow hover:bg-white/10"
//             disabled={loading || data.length === 0}
//           >
//             ⬇ CSV
//           </button>
//         </div>
//       </div>

//       {/* Loading State */}
//       {loading && (
//         <div className="text-center py-4">
//           <span className="text-purple-600">Loading alerts...</span>
//         </div>
//       )}

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border border-[#e7e5ec] shadow">
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer whitespace-nowrap"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(header.column.columnDef.header, header.getContext())}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {table.getRowModel().rows.map((row) => (
//               <tr key={row.id} className="hover:bg-purple-50">
//                 {row.getVisibleCells().map((cell) => (
//                   <td
//                     key={cell.id}
//                     className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                   >
//                     {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                   </td>
//                 ))}
//               </tr>
//             ))}
//           </tbody>
//         </table>

//         {!loading && table.getRowModel().rows.length === 0 && (
//           <div className="text-center text-gray-500 py-6">
//             No alerts found.
//           </div>
//         )}
//       </div>

//       {/* Pagination */}
//       <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
//         <span className="text-sm text-gray-600">
//           Page {page} of {totalPages} (Total: {totalCount} alerts)
//         </span>
//         <div className="flex gap-2">
//           <button
//             onClick={() => setPage((p) => Math.max(p - 1, 1))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === 1 || loading}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
//             disabled={page === totalPages || loading}
//           >
//             Next
//           </button>
//         </div>
//       </div>

//       {/* Footer */}
//       <div className="fixed bottom-2 right-4 text-xs font-bold">
//         <span className="text-red-600">© Ajeevi</span>{" "}
//         <span className="text-blue-600">Technologies Pvt. Ltd.</span>
//       </div>
//     </div>
//   );
// };

// export default AlertReportTable;


/////////////////////


// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import axios from "axios";
// import * as XLSX from "xlsx";
// import { saveAs } from "file-saver";
// import Papa from "papaparse";

// const columnHelper = createColumnHelper();

// const columns = [
//   columnHelper.accessor("id", { header: "ID" }),
//   columnHelper.accessor("type", { header: "Alert Type" }),
//   columnHelper.accessor("severity", { header: "Severity" }),
//   columnHelper.accessor("location", { header: "Location" }),
//   columnHelper.accessor("timestamp", {
//     header: "Reported At",
//     cell: (info) => new Date(info.getValue()).toLocaleString(),
//   }),
//   columnHelper.accessor("status", { header: "Status" }),
// ];

// const AlertReportTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [typeFilter, setTypeFilter] = useState("all");
//   const [severityFilter, setSeverityFilter] = useState("all");
//   const [page, setPage] = useState(1);
//   const [pageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   // ✅ Fetch alert data
//   const fetchData = async (
//     search = "",
//     currentPage = 1,
//     size = pageSize,
//     type = "all",
//     severity = "all"
//   ) => {
//     try {
//       const res = await axios.get("http://localhost:6050/api/alerts", {
//         params: { search, page: currentPage, pageSize: size, type, severity },
//       });
//       setData(res.data.data);
//       setTotalPages(res.data.totalPages);
//     } catch (err) {
//       console.error("API Error:", err);
//     }
//   };

//   useEffect(() => {
//     fetchData(globalFilter, page, pageSize, typeFilter, severityFilter);
//   }, [globalFilter, page, pageSize, typeFilter, severityFilter]);

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

//   // ✅ Download Excel
//   const downloadExcel = () => {
//     const worksheet = XLSX.utils.json_to_sheet(data);
//     const workbook = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(workbook, worksheet, "Alerts");
//     const excelBuffer = XLSX.write(workbook, {
//       bookType: "xlsx",
//       type: "array",
//     });
//     const blob = new Blob([excelBuffer], {
//       type: "application/octet-stream",
//     });
//     saveAs(blob, "alert_report.xlsx");
//   };

//   // ✅ Download CSV
//   const downloadCSV = () => {
//     const csv = Papa.unparse(data);
//     const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
//     saveAs(blob, "alert_report.csv");
//   };

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-[#fce4e4]">Alert Report</h2>

//         <div className="flex gap-3 items-center flex-wrap">
//           {/* Search */}
//           <input
//             type="text"
//             placeholder="Search alerts..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 text-white"
//           />

//           {/* Type Filter */}
//           <select
//             value={typeFilter}
//             onChange={(e) => {
//               setTypeFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200"
//           >
//             <option className="text-black" value="all">All Types</option>
//             <option className="text-black" value="fire">Fire</option>
//             <option className="text-black" value="rodent">Rodent</option>
//             <option className="text-black" value="intrusion">Intrusion</option>
//             <option className="text-black" value="other">Other</option>
//           </select>

//           {/* Severity Filter */}
//           <select
//             value={severityFilter}
//             onChange={(e) => {
//               setSeverityFilter(e.target.value);
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200 "
//           >
//             <option className="text-black" value="all">All Severity</option>
//             <option className="text-black" value="critical">Critical</option>
//             <option className="text-black" value="severe">Severe</option>
//             <option className="text-black" value="normal">Normal</option>
//           </select>

//           {/* Download Buttons */}
//           <button
//             onClick={downloadExcel}
//             className="text-white px-3 py-1  border border-gray-300 rounded-md text-sm shadow "
//           >
//             ⬇ Excel
//           </button>
//           <button
//             onClick={downloadCSV}
//             className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow"
//           >
//             ⬇ CSV
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
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer whitespace-nowrap"
//                     onClick={header.column.getToggleSortingHandler()}
//                   >
//                     {flexRender(header.column.columnDef.header, header.getContext())}
//                     {header.column.getIsSorted() === "asc" && " 🔼"}
//                     {header.column.getIsSorted() === "desc" && " 🔽"}
//                   </th>
//                 ))}
//               </tr>
//             ))}
//           </thead>
//           <tbody className="bg-white divide-y divide-purple-100">
//             {table.getRowModel().rows.map((row) => (
//               <tr key={row.id} className="hover:bg-purple-50">
//                 {row.getVisibleCells().map((cell) => (
//                   <td
//                     key={cell.id}
//                     className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                   >
//                     {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                   </td>
//                 ))}
//               </tr>
//             ))}
//           </tbody>
//         </table>

//         {table.getRowModel().rows.length === 0 && (
//           <div className="text-center text-gray-500 py-6">
//             No alerts found.
//           </div>
//         )}
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

// {/* Footer */}
// <div className="fixed bottom-2 right-4 text-xs font-bold">
//   <span className="text-red-600">© Ajeevi</span>{" "}
//   <span className="text-blue-600">Technologies Pvt. Ltd.</span>
// </div>

//     </div>
//   );
// };

// export default AlertReportTable;
