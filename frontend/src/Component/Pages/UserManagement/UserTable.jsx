import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { api } from "../../../utils/axiosInstance"; // centralized axios instance
import { message, Popconfirm, Modal, Tag, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { EditOutlined, DeleteOutlined, EyeOutlined } from "@ant-design/icons";
import { useAuth } from "../../../Authentication/AuthContext";
import { formatIndianDateTime } from "../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const UserTable = () => {
  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [viewUser, setViewUser] = useState(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { role, hasPermission } = useAuth();
  const isAdmin = (role || "").toLowerCase() === "admin";

  // Fetch users
  const fetchData = async (search = globalFilter, currentPage = page, size = pageSize) => {
    setLoading(true);
    try {
      const res = await api.get("/users"); // ✅ centralized axios
      const users = res.data || [];

      const q = (search || "").trim().toLowerCase();
      let filtered = users.filter(
        (u) =>
          (u.email || "").toLowerCase().includes(q) ||
          (u.roles || []).join(",").toLowerCase().includes(q) ||
          String(u.id || "").toLowerCase().includes(q)
      );

      setTotalPages(Math.ceil(filtered.length / size) || 1);
      const paginated = filtered.slice(
        (currentPage - 1) * size,
        currentPage * size
      );
      setData(paginated);
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch users!");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(globalFilter, page, pageSize);
  }, [globalFilter, page, pageSize]);

  const handleSearch = useMemo(
    () =>
      debounce((value) => {
        setGlobalFilter(value);
        setPage(1);
      }, 300),
    []
  );

  // Delete
  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await api.delete(`/users/${id}`);
      message.success("User deleted successfully!");

      // ✅ Re-fetch data after delete
      const res = await api.get("/users");
      const users = res.data;

      let filtered = users.filter(
        (u) =>
          u.email.toLowerCase().includes(globalFilter.toLowerCase()) ||
          u.roles.join(",").toLowerCase().includes(globalFilter.toLowerCase())
      );

      const newTotalPages = Math.ceil(filtered.length / pageSize);
      setTotalPages(newTotalPages);

      // ✅ Adjust page if current one becomes empty
      if ((page - 1) * pageSize >= filtered.length && page > 1) {
        setPage(page - 1);
      } else {
        fetchData(globalFilter, page, pageSize);
      }
    } catch (err) {
      message.error("Failed to delete user");
    } finally {
      setLoading(false);
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
      enableSorting: false,
    }),
    columnHelper.accessor("id", {
      header: "ID",
      cell: (info) => (
        <span className="text-xs text-gray-500">{info.getValue()}</span>
      ),
      enableSorting: true,
    }),
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => (
        <span className="font-semibold text-purple-700">
          {info.getValue()}
        </span>
      ),
      enableSorting: true,
    }),
    columnHelper.accessor("roles", {
      header: "Roles",
      cell: (info) =>
        info.getValue()?.length > 0 ? (
          <>
            {info.getValue().map((role, idx) => (
              <Tag key={idx} color="purple">
                {role}
              </Tag>
            ))}
          </>
        ) : (
          <Tag color="default">No Role</Tag>
        ),
      enableSorting: false,
    }),
    columnHelper.display({
      id: "createdAt",
      header: "Created Date & Time",
      cell: (info) => {
        const u = info.row.original;
        const rawDate = u.createdAt || u.created_at || u.createdDate || u.createdOn || null;
        return (
          <span className="text-xs text-gray-600 font-medium">
            {rawDate ? formatIndianDateTime(rawDate) : "—"}
          </span>
        );
      },
      enableSorting: true,
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-3">
            <EyeOutlined
              style={{
                color: "#9000DB",
                fontSize: "15px",
                cursor: "pointer",
              }}
              onClick={() => setViewUser(row)}
            />
            {isAdmin && (
              <>
                <EditOutlined
                  style={{
                    color: "#16a34a",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    navigate(`/user/form`, { state: { user: row } })
                  }
                />
                <Popconfirm
                  title="Are you sure to delete this user?"
                  onConfirm={() => handleDelete(row.id)}
                  okText="Yes"
                  cancelText="No"
                >
                  <DeleteOutlined
                    style={{
                      color: "#dc2626",
                      fontSize: "15px",
                      cursor: "pointer",
                    }}
                  />
                </Popconfirm>
              </>
            )}
          </div>
        );
      },
      enableSorting: false,
    }),
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <h2 className="text-xl font-bold text-[#fce4e4]">Users</h2>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search users..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-green-300"
          />
            {isAdmin && (
              <button
                onClick={() => navigate("/user/form")}
                className="px-3 py-1.5 bg-purple-700 text-white rounded-md text-sm hover:bg-purple-700"
              >
                + Add User
              </button>
            )}
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
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold text-[#E6E6FA] whitespace-nowrap cursor-pointer select-none"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {{
                      asc: " 🔼",
                      desc: " 🔽",
                    }[header.column.getIsSorted()] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-green-100">
            {/* Show loader row when loading */}
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-6 text-center text-gray-500"
                >
                  <Spin tip="Loading users..." />
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-green-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 border border-green-100 whitespace-nowrap"
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
                  No users found.
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

      {/* View Modal */}
      <Modal
        title="User Details"
        open={!!viewUser}
        onCancel={() => setViewUser(null)}
        footer={null}
      >
        {viewUser && (
          <div className="space-y-2">
            <p>
              <strong>ID:</strong> {viewUser.id}
            </p>
            <p>
              <strong>Email:</strong> {viewUser.email}
            </p>
            <p>
              <strong>Roles:</strong>{" "}
              {viewUser.roles?.length > 0
                ? viewUser.roles.join(", ")
                : "No Role"}
            </p>
          </div>
        )}
        {/* //"Audit Logs" and "Log History" jisse mai switch kar saku aur isme form mat do jaisa usertable me de rahe ho */}
      </Modal>
      {/* Footer */}
<div className="fixed bottom-2 right-4 text-xs font-bold">
  <span className="text-red-600">© Ajeevi</span>{" "}
  <span className="text-blue-600">Technologies Pvt. Ltd.</span>
</div>
    </div>
  );
};

export default UserTable;
