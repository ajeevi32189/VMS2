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
import { formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const columns = [
  columnHelper.accessor("id", { header: "ID" }),
  columnHelper.accessor("camera", {
    header: "Camera",
    cell: (info) => (
      <span className="font-semibold text-[#2c028d]">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("eventType", {
    header: "Event Type",
    cell: (info) => (
      <span className="text-sm font-medium text-gray-700">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor("location", { header: "Location" }),
  columnHelper.accessor("timestamp", {
    header: "Detected At",
    cell: (info) => formatIndianDateTime(info.getValue()),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const val = info.getValue();
      return (
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            val === "Active"
              ? "bg-purple-100 text-purple-800"
              : val === "Resolved"
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {val}
        </span>
      );
    },
  }),
  columnHelper.accessor("severity", {
    header: "Severity",
    cell: (info) => {
      const val = info.getValue();
      return (
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            val === "High"
              ? "bg-red-200 text-red-800"
              : val === "Medium"
              ? "bg-yellow-200 text-yellow-800"
              : "bg-green-200 text-green-800"
          }`}
        >
          {val}
        </span>
      );
    },
  }),
];

const EventDetectionTable = () => {
  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [eventType, setEventType] = useState("all"); // ✅ Event type filter
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // ✅ Fetch event detection data
  const fetchData = async (
    search = "",
    currentPage = 1,
    size = pageSize,
    type = eventType
  ) => {
    try {
      const res = await axios.get("http://localhost:6050/api/fire-detection", {
        params: { search, page: currentPage, pageSize: size, eventType: type },
      });
      setData(res.data.data);
      setTotalPages(res.data.totalPages);
    } catch (err) {
      console.error("API Error:", err);
    }
  };

  useEffect(() => {
    fetchData(globalFilter, page, pageSize, eventType);
  }, [globalFilter, page, pageSize, eventType]);

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
        <h2 className="text-xl font-bold text-[#fce4e4]">Event Data</h2>

        <div className="flex gap-3 items-center flex-wrap">
          {/* 🔍 Search */}
          <input
            type="text"
            placeholder="Search..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 text-white"
          />

          {/* ✅ Event Type Filter */}
          <select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-200"
          >
            <option className="text-black" value="all">All Events</option>
            <option className="text-black" value="fire">Fire</option>
            <option className="text-black" value="crowd">Crowd</option>
            <option className="text-black" value="rodent">Rodent</option>
            <option className="text-black" value="intrusion">Intrusion</option>
            <option className="text-black" value="violence">Violence</option>
          </select>

          {/* Page Size */}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-white"
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
          <div className="text-center text-gray-500 py-6">No events found.</div>
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
    </div>
  );
};

export default EventDetectionTable;
