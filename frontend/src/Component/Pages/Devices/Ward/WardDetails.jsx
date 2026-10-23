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
import { EditOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";

const columnHelper = createColumnHelper();

const WardDetails = () => {
  const [wards, setWards] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [formData, setFormData] = useState({ name: "", code: "" });
  const [editingWard, setEditingWard] = useState(null);

  const baseUrl = import.meta.env.VITE_WARD_API_URL || "";

  // Fetch wards
  const fetchWards = async (search = "", currentPage = 1, size = pageSize) => {
    try {
      const res = await axios.get(`${baseUrl}/wards/`, {
        params: { search, page: currentPage, page_size: size },
      });
      setWards(res.data.results || res.data);
      setTotalPages(res.data.totalPages || Math.ceil(res.data.count / size) || 1);
    } catch (err) {
      console.error("API Error:", err);
    }
  };

  useEffect(() => {
    fetchWards(globalFilter, page, pageSize);
  }, [globalFilter, page, pageSize]);

  // Save ward
  const handleSave = async () => {
    if (!formData.name) return;

    try {
      if (editingWard) {
        await axios.put(`${baseUrl}/wards/${editingWard.id}/`, formData);
      } else {
        await axios.post(`${baseUrl}/wards/`, formData);
      }
      setFormData({ name: "", code: "" });
      setEditingWard(null);
      fetchWards(globalFilter, page, pageSize);
    } catch (err) {
      console.error("Save Error:", err);
    }
  };

  // Delete ward
  const handleDelete = async (id) => {
    try {
      await axios.delete(`${baseUrl}/wards/${id}/`);
      fetchWards(globalFilter, page, pageSize);
    } catch (err) {
      console.error("Delete Error:", err);
    }
  };

  const columns = [
    columnHelper.accessor("id", { header: "ID" }),
    columnHelper.accessor("name", {
      header: "Ward Name",
      cell: (info) => (
        <span className="font-semibold text-green-800">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("code", {
      header: "Code",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.display({
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-2">
            <button
              className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
              onClick={() => {
                setEditingWard(row);
                setFormData({ name: row.name, code: row.code });
              }}
            >
              <EditOutlined />
            </button>
            <button
              className="px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200"
              onClick={() => handleDelete(row.id)}
            >
              <DeleteOutlined />
            </button>
          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: wards,
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
      {/* Form Header */}
      <div className="px-4 py-3 rounded-md bg-purple-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h2 className="text-xl font-bold text-purple-900">
          {editingWard ? "Edit Ward" : "Add Ward"}
        </h2>

        <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
          <input
            type="text"
            placeholder="Ward name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm text-black"
          />
          <input
            type="text"
            placeholder="Code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm text-black"
          />
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            <SaveOutlined />
            {editingWard ? "Update Ward" : "Add Ward"}
          </button>
        </div>
      </div>

      {/* Search + Page Size */}
      <div className="flex justify-between items-center">
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

        <input
          type="text"
          placeholder="Search..."
          onChange={(e) => handleSearch(e.target.value)}
          className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300"
        />
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
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold text-[#E6E6FA] cursor-pointer whitespace-nowrap"
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
          <tbody className="bg-white divide-y divide-green-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-green-50">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-4 py-3 border border-green-100 whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {table.getRowModel().rows.length === 0 && (
          <div className="text-center text-gray-500 py-6">No data found.</div>
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
            className="px-3 py-1 border rounded bg-purple-100 text-purple-700 disabled:opacity-50"
            disabled={page === 1}
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            className="px-3 py-1 border rounded bg-purple-100 text-purple-700 disabled:opacity-50"
            disabled={page === totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default WardDetails;
