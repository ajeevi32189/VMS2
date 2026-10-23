import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import axios from "axios";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import { formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

// ✅ Add more fields relevant to analytics
const columns = [
  columnHelper.accessor("id", { header: "ID" }),
  columnHelper.accessor("camera", { header: "Camera" }),
  columnHelper.accessor("analyticsType", { header: "Analytics Type" }),
  columnHelper.accessor("objectDetected", { header: "Object Detected" }),
  columnHelper.accessor("location", { header: "Location" }),
  columnHelper.accessor("severity", { header: "Severity" }),
  columnHelper.accessor("timestamp", {
    header: "Recorded At",
    cell: (info) => formatIndianDateTime(info.getValue()),
  }),
  columnHelper.accessor("status", { header: "Status" }),
];

const AnalyticsReportTable = () => {
  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [analyticsTypeFilter, setAnalyticsTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // ✅ Fetch analytics data
  const fetchData = async (
    search = "",
    currentPage = 1,
    type = "all",
    severity = "all"
  ) => {
    try {
      const res = await axios.get("http://localhost:6050/api/analytics", {
        params: { search, page: currentPage, pageSize, analyticsType: type, severity },
      });
      setData(res.data.data);
      setTotalPages(res.data.totalPages);
    } catch (err) {
      console.error("API Error:", err);
    }
  };

  useEffect(() => {
    fetchData(globalFilter, page, analyticsTypeFilter, severityFilter);
  }, [globalFilter, page, analyticsTypeFilter, severityFilter]);

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

  // ✅ Download Excel
  const downloadExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AnalyticsReport");
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, "analytics_report.xlsx");
  };

  // ✅ Download CSV
  const downloadCSV = () => {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, "analytics_report.csv");
  };

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <h2 className="text-xl font-bold text-[#fce4e4]">Analytics Report</h2>

        <div className="flex gap-3 items-center flex-wrap">
          {/* Search */}
          <input
            type="text"
            placeholder="Search analytics..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 text-white"
          />

          {/* Analytics Type Filter */}
          <select
            value={analyticsTypeFilter}
            onChange={(e) => {
              setAnalyticsTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200"
          >
            <option className="text-black" value="all">All Types</option>
            <option className="text-black" value="Face Recognition">Face Recognition</option>
            <option className="text-black" value="People Counting">People Counting</option>
            <option className="text-black" value="Intrusion Detection">Intrusion Detection</option>
            <option className="text-black" value="Heatmap">Heatmap</option>
          </select>

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200"
          >
            <option className="text-black" value="all">All Severity</option>
            <option className="text-black" value="Critical">Critical</option>
            <option className="text-black" value="Severe">Severe</option>
            <option className="text-black" value="Normal">Normal</option>
          </select>

          {/* Download Buttons */}
          <button
            onClick={downloadExcel}
            className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow"
          >
            ⬇ Excel
          </button>
          <button
            onClick={downloadCSV}
            className="text-white px-3 py-1 border border-gray-300 rounded-md text-sm shadow"
          >
            ⬇ CSV
          </button>
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
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc" && " 🔼"}
                    {header.column.getIsSorted() === "desc" && " 🔽"}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-purple-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-purple-50">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-4 py-3 border border-purple-100 whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {table.getRowModel().rows.length === 0 && (
          <div className="text-center text-gray-500 py-6">
            No analytics records found.
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
        <span className="text-sm text-gray-600">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
            disabled={page === 1}
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
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

export default AnalyticsReportTable;
