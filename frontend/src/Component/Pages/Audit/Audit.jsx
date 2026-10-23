import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { message, Tag, Spin, DatePicker, Select } from "antd";
import dayjs from "dayjs";
import { api } from "../../../utils/axiosInstance"; // centralized axios instance

const { RangePicker } = DatePicker;
const { Option } = Select;

const auditColumnHelper = createColumnHelper();
const loginColumnHelper = createColumnHelper();

const ACTION_OPTIONS = [
  "PASSWORD_RESET",
  "PASSWORD_RESET_REQUESTED",
];

const actionTagColor = (action) => {
  if (!action) return "default";
  if (action.includes("PASSWORD_RESET_REQUESTED")) return "gold";
  if (action.includes("PASSWORD_RESET")) return "green";
  return "purple";
};

const formatDateTime = (iso) => {
  if (!iso) return "-";
  const utcString = iso.endsWith("Z") ? iso : iso + "Z";
  return dayjs(utcString).format("DD MMM YYYY, hh:mm:ss A");
};

const Audit = () => {
  const [activeTab, setActiveTab] = useState("logs"); // "logs" | "history"

  // Shared: user id -> email map (used to resolve names instead of raw ids)
  const [userMap, setUserMap] = useState({});

  // ---------------- Audit Logs tab state ----------------
  const [logsData, setLogsData] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(25);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsSorting, setLogsSorting] = useState([]);
  const [actionFilter, setActionFilter] = useState(null);
  const [dateRange, setDateRange] = useState(null); // [dayjs, dayjs]

  // ---------------- Log History tab state ----------------
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historySorting, setHistorySorting] = useState([]);

  // Fetch users once to resolve id -> email for display
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get("/users");
        const map = {};
        (res.data || []).forEach((u) => {
          map[u.id] = u.email;
        });
        setUserMap(map);
      } catch (err) {
        // Non-fatal: table will fall back to showing raw ids
        console.error("Failed to fetch users for name resolution:", err);
      }
    };
    fetchUsers();
  }, []);

  const resolveName = useCallback(
    (id) => userMap[id] || id || "-",
    [userMap]
  );

  // ---------------- Fetch Audit Logs ----------------
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = { page: logsPage, pageSize: logsPageSize };
      if (actionFilter) params.action = actionFilter;
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].startOf("day").toISOString();
        params.to = dateRange[1].endOf("day").toISOString();
      }
      const res = await api.get("/audit", { params });
      const payload = res.data;
      setLogsData(payload?.items || []);
      setLogsTotal(payload?.total || 0);
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch audit logs!");
    } finally {
      setLogsLoading(false);
    }
  }, [logsPage, logsPageSize, actionFilter, dateRange]);

  useEffect(() => {
    if (activeTab === "logs") fetchLogs();
  }, [activeTab, fetchLogs]);

  // ---------------- Fetch Log History ----------------
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get("/audit/login-history", {
        params: { page: historyPage, pageSize: historyPageSize },
      });
      const payload = res.data;
      setHistoryData(payload?.items || []);
      setHistoryTotal(payload?.total || 0);
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch login history!");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyPageSize]);

  useEffect(() => {
    if (activeTab === "history") fetchHistory();
  }, [activeTab, fetchHistory]);

  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / logsPageSize));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  // ---------------- Audit Logs columns ----------------
  const logsColumns = useMemo(
    () => [
      auditColumnHelper.display({
        id: "serial",
        header: "S.No",
        cell: (info) => (
          <span className="font-medium text-gray-700">
            {(logsPage - 1) * logsPageSize + info.row.index + 1}
          </span>
        ),
        enableSorting: false,
      }),
      auditColumnHelper.accessor("action", {
        header: "Action",
        cell: (info) => (
          <Tag color={actionTagColor(info.getValue())}>{info.getValue()}</Tag>
        ),
        enableSorting: true,
      }),
      auditColumnHelper.accessor("performedByUserId", {
        id: "performedBy",
        header: "Performed By",
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className="font-semibold text-purple-700">
              {row.performedByEmail || resolveName(row.performedByUserId)}
            </span>
          );
        },
        enableSorting: false,
      }),
      auditColumnHelper.accessor("targetUserId", {
        id: "target",
        header: "Target User",
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className="text-gray-700">
              {row.targetEmail || resolveName(row.targetUserId)}
            </span>
          );
        },
        enableSorting: false,
      }),
      auditColumnHelper.accessor("notes", {
        header: "Notes",
        cell: (info) => (
          <span className="text-gray-600">{info.getValue() || "-"}</span>
        ),
        enableSorting: false,
      }),
      auditColumnHelper.accessor("ipAddress", {
        header: "IP Address",
        cell: (info) => (
          <span className="text-xs text-gray-500">{info.getValue() || "-"}</span>
        ),
        enableSorting: false,
      }),
      auditColumnHelper.accessor("timestampUtc", {
        header: "Timestamp",
        cell: (info) => (
          <span className="text-xs text-gray-600 whitespace-nowrap">
            {formatDateTime(info.getValue())}
          </span>
        ),
        enableSorting: true,
      }),
    ],
    [logsPage, logsPageSize, resolveName]
  );

  // ---------------- Log History columns ----------------
  const historyColumns = useMemo(
    () => [
      loginColumnHelper.display({
        id: "serial",
        header: "S.No",
        cell: (info) => (
          <span className="font-medium text-gray-700">
            {(historyPage - 1) * historyPageSize + info.row.index + 1}
          </span>
        ),
        enableSorting: false,
      }),
      loginColumnHelper.accessor("userId", {
        header: "User",
        cell: (info) => (
          <span className="font-semibold text-purple-700">
            {resolveName(info.getValue())}
          </span>
        ),
        enableSorting: false,
      }),
      loginColumnHelper.accessor("succeeded", {
        header: "Status",
        cell: (info) =>
          info.getValue() ? (
            <Tag color="green">Success</Tag>
          ) : (
            <Tag color="red">Failed</Tag>
          ),
        enableSorting: true,
      }),
      loginColumnHelper.accessor("ipAddress", {
        header: "IP Address",
        cell: (info) => (
          <span className="text-xs text-gray-500">{info.getValue() || "-"}</span>
        ),
        enableSorting: false,
      }),
      loginColumnHelper.accessor("userAgent", {
        header: "User Agent",
        cell: (info) => (
          <span
            className="text-xs text-gray-500 block max-w-[280px] truncate"
            title={info.getValue()}
          >
            {info.getValue() || "-"}
          </span>
        ),
        enableSorting: false,
      }),
      loginColumnHelper.accessor("loggedInAtUtc", {
        header: "Logged In At",
        cell: (info) => (
          <span className="text-xs text-gray-600 whitespace-nowrap">
            {formatDateTime(info.getValue())}
          </span>
        ),
        enableSorting: true,
      }),
    ],
    [historyPage, historyPageSize, resolveName]
  );

  const logsTable = useReactTable({
    data: logsData,
    columns: logsColumns,
    state: { sorting: logsSorting },
    onSortingChange: setLogsSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const historyTable = useReactTable({
    data: historyData,
    columns: historyColumns,
    state: { sorting: historySorting },
    onSortingChange: setHistorySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const clearLogsFilters = () => {
    setActionFilter(null);
    setDateRange(null);
    setLogsPage(1);
  };

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header with tabs */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <h2 className="text-xl font-bold text-[#fce4e4]">Audit</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${
              activeTab === "logs"
                ? "bg-white text-purple-700"
                : "bg-purple-600 text-white hover:bg-purple-500"
            }`}
          >
            Audit Logs
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${
              activeTab === "history"
                ? "bg-white text-purple-700"
                : "bg-purple-600 text-white hover:bg-purple-500"
            }`}
          >
            Login History
          </button>
        </div>
      </div>

      {activeTab === "logs" ? (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-start sm:items-center bg-white p-3 rounded-md border border-gray-200 shadow-sm">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Action</label>
              <Select
                allowClear
                placeholder="All actions"
                style={{ width: 220 }}
                value={actionFilter}
                onChange={(val) => {
                  setActionFilter(val || null);
                  setLogsPage(1);
                }}
              >
                {ACTION_OPTIONS.map((a) => (
                  <Option key={a} value={a}>
                    {a}
                  </Option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Date Range</label>
              <RangePicker
                value={dateRange}
                onChange={(vals) => {
                  setDateRange(vals);
                  setLogsPage(1);
                }}
                allowClear
              />
            </div>

            <button
              onClick={clearLogsFilters}
              className="mt-5 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-[#9864db] text-[#E6E6FA]">
                {logsTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold text-[#E6E6FA] whitespace-nowrap cursor-pointer select-none"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted()] ?? null}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="bg-white divide-y divide-purple-100">
                {logsLoading ? (
                  <tr>
                    <td colSpan={logsColumns.length} className="py-6 text-center text-gray-500">
                      <Spin tip="Loading audit logs..." />
                    </td>
                  </tr>
                ) : logsTable.getRowModel().rows.length > 0 ? (
                  logsTable.getRowModel().rows.map((row) => (
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={logsColumns.length} className="py-6 text-center text-gray-500">
                      No audit logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
            <span className="text-sm text-gray-600">
              Page {logsPage} of {logsTotalPages} ({logsTotal} total)
            </span>
            <div className="flex gap-2">
              <select
                value={logsPageSize}
                onChange={(e) => {
                  setLogsPageSize(Number(e.target.value));
                  setLogsPage(1);
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
                onClick={() => setLogsPage((p) => Math.max(p - 1, 1))}
                className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
                disabled={logsPage === 1}
              >
                Prev
              </button>
              <button
                onClick={() => setLogsPage((p) => Math.min(p + 1, logsTotalPages))}
                className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
                disabled={logsPage === logsTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-[#9864db] text-[#E6E6FA]">
                {historyTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold text-[#E6E6FA] whitespace-nowrap cursor-pointer select-none"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted()] ?? null}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="bg-white divide-y divide-purple-100">
                {historyLoading ? (
                  <tr>
                    <td colSpan={historyColumns.length} className="py-6 text-center text-gray-500">
                      <Spin tip="Loading login history..." />
                    </td>
                  </tr>
                ) : historyTable.getRowModel().rows.length > 0 ? (
                  historyTable.getRowModel().rows.map((row) => (
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={historyColumns.length} className="py-6 text-center text-gray-500">
                      No login history found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
            <span className="text-sm text-gray-600">
              Page {historyPage} of {historyTotalPages} ({historyTotal} total)
            </span>
            <div className="flex gap-2">
              <select
                value={historyPageSize}
                onChange={(e) => {
                  setHistoryPageSize(Number(e.target.value));
                  setHistoryPage(1);
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
                onClick={() => setHistoryPage((p) => Math.max(p - 1, 1))}
                className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
                disabled={historyPage === 1}
              >
                Prev
              </button>
              <button
                onClick={() => setHistoryPage((p) => Math.min(p + 1, historyTotalPages))}
                className="px-3 py-1 border rounded bg-purple-100 text-[#2c028d] disabled:opacity-50"
                disabled={historyPage === historyTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default Audit;