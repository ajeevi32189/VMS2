import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { EditOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { Switch, message, Spin } from "antd";
import { deviceApi } from "../../../../utils/axiosInstance";
import Cookies from "js-cookie";
import { useAuth } from "../../../../Authentication/AuthContext";
import { formatIndianDateTime } from "../../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const ZoneDetails = () => {
  const { role, hasPermission } = useAuth();
  const canWrite = (role || "").toLowerCase() === "admin" || hasPermission("zone.write");

  const [zones, setZones] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [formData, setFormData] = useState({ name: "", status: true });
  const [editingZone, setEditingZone] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const userId = Cookies.get("userId");

  // 🔹 Fetch zones
  const fetchZones = async (search = "", currentPage = 1, size = pageSize) => {
    try {
      setLoading(true);
      const res = await deviceApi.get(`/Zone/`,
        {
          params: {
            search, page: currentPage, page_size: size,
            userid: userId
          },
        }
      );
      let list = res.data.results || res.data || [];
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter((z) => (z.name || "").toLowerCase().includes(q));
      }
      setZones(list);
      setTotalPages(
        res.data.totalPages || Math.ceil((res.data.count || list.length) / size) || 1
      );
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch zones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones(globalFilter, page, pageSize);
  }, [globalFilter, page, pageSize]);

  // 🔹 Save zone (Add/Edit)
  const handleSave = async () => {
    if (!formData.name) return;

    try {
      setSaving(true);
      const payload = { ...formData, userid: String(userId) };

      if (editingZone) {
        await deviceApi.put(`/Zone/${editingZone.id}/`, payload);
        message.success("Zone updated!");
      } else {
        await deviceApi.post(`/Zone/`, payload);
        message.success("Zone added!");
      }

      setFormData({ name: "", status: true });
      setEditingZone(null);
      fetchZones(globalFilter, page, pageSize);
    } catch (err) {
      console.error("Save Error:", err);
      message.error("Failed to save zone");
    } finally {
      setSaving(false);
    }
  };

  // 🔹 Delete zone
  const handleDelete = async (id) => {
    try {
      setDeletingId(id);
      await deviceApi.delete(`/Zone/${id}/`);
      message.success("Zone deleted!");
      fetchZones(globalFilter, page, pageSize);
    } catch (err) {
      console.error("Delete Error:", err);
      message.error("Failed to delete zone");
    } finally {
      setDeletingId(null);
    }
  };

  // 🔹 Toggle status
  const handleToggle = async (row, value) => {
    try {
      setTogglingId(row.id);
      await deviceApi.put(`/Zone/${row.id}/`, {
        ...row,
        status: value,
        userId: String(userId),
      });
      setZones((prev) =>
        prev.map((z) => (z.id === row.id ? { ...z, status: value } : z))
      );
      message.success("Status updated!");
    } catch (err) {
      console.error("Toggle Error:", err);
      message.error("Failed to update status");
    } finally {
      setTogglingId(null);
    }
  };

  // 🔹 Table columns
  const columns = [
    // columnHelper.accessor("id", { header: "ID" }),
    columnHelper.display({
      header: "ID",
      cell: (info) => (page - 1) * pageSize + info.row.index + 1,
    }),
    columnHelper.accessor("name", {
      header: "Region Name",
      cell: (info) => (
        <span className="font-semibold text-green-800">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <Switch
          checked={!!info.getValue()}
          loading={togglingId === info.row.original.id}
          onChange={(val) => handleToggle(info.row.original, val)}
        />
      ),
    }),
    columnHelper.accessor("regDate", {
      header: "Created Date Time",
      cell: (info) => formatIndianDateTime(info.getValue()),
    }),
    columnHelper.display({
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-2">
            <button
              className="px-2 py-1 text-green-800 rounded "
              onClick={() => {
                setEditingZone(row);
                setFormData({ name: row.name, status: row.status });
              }}
            >
              <EditOutlined />
            </button>
            <button
              className="px-2 py-1  text-red-800 rounded "
              onClick={() => handleDelete(row.id)}
              disabled={deletingId === row.id}
            >
              {deletingId === row.id ? <Spin size="small" /> : <DeleteOutlined />}
            </button>
          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: zones,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // 🔹 Debounced search
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
      {canWrite && (
        <div className="px-4 py-3 rounded-md bg-purple-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="text-xl font-bold text-purple-900">
            {editingZone ? "Edit Region" : "Add Region"}
          </h2>

          <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
            <input
              type="text"
              placeholder="Region name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="px-3 py-1 border border-gray-300 rounded-md text-sm text-black"
            />
            <Switch
              checked={formData.status}
              onChange={(val) => setFormData({ ...formData, status: val })}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-1 px-3 py-1 rounded-md text-white ${saving
                ? "bg-purple-400 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-700"
                }`}
            >
              {saving ? <Spin size="small" /> : <SaveOutlined />}
              {editingZone ? "Update Region" : "Add Region"}
            </button>
          </div>
        </div>
      )}

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
      <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50 z-10">
            <Spin size="large" />
          </div>
        )}
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

        {table.getRowModel().rows.length === 0 && !loading && (
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

// 🔹 Final Page Layout with ZoneDetails + VMS Paragraph/Video
const ZonePage = () => {
  return (
    <div className="flex flex-col md:flex-row w-full h-screen">
      {/* Left Half - ZoneDetails */}
      <div className="w-full md:w-1/2 h-full overflow-y-auto border-r border-gray-200">
        <ZoneDetails />
      </div>

      {/* Right Half - Paragraph + Video */}
      <div className="w-full md:w-1/2 h-full p-6 flex flex-col items-start justify-start bg-gray-50 overflow-y-auto">
        <h2 className="text-2xl font-bold text-purple-700 mb-4">
          Video Management System (VMS)
        </h2>
        <p className="text-gray-700 leading-relaxed text-justify mb-6">
          A Video Management System (VMS) is a software solution that enables
          organizations to manage, record, and analyze video feeds from
          surveillance cameras. It provides features like live monitoring,
          playback, event recording, user management, and integrations with
          other security systems. With VMS, businesses can enhance security,
          improve situational awareness, and ensure compliance with safety
          regulations.
        </p>

        {/* Embedded Video */}
        <div className="w-full aspect-video bg-black rounded-lg shadow-lg overflow-hidden">
          <iframe
            class="w-full h-full"
            src="https://www.youtube.com/embed/X25WjkSpnbQ?si=5SmWPiNrxmwjQzeT&autoplay=1"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          ></iframe>
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

export default ZonePage;


///////////////////////



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { EditOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
// import { Switch, message, Spin } from "antd";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie"; // ✅ import cookies

// const columnHelper = createColumnHelper();

// const ZoneDetails = () => {
//   const [zones, setZones] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   const [formData, setFormData] = useState({ name: "", status: true });
//   const [editingZone, setEditingZone] = useState(null);

//   const [loading, setLoading] = useState(false); // ✅ API loading
//   const [saving, setSaving] = useState(false);   // ✅ Add/Edit loading
//   const [deletingId, setDeletingId] = useState(null); // ✅ Track deleting zone
//   const [togglingId, setTogglingId] = useState(null); // ✅ Track toggle zone

//   const userId = Cookies.get("userId"); // ✅ get userId

//   // 🔹 Fetch zones
//   const fetchZones = async (search = "", currentPage = 1, size = pageSize) => {
//     try {
//       setLoading(true);
//       const res = await deviceApi.get(`/Zone/`, {
//         params: { search, page: currentPage, page_size: size, user_id: userId },
//       });
//       setZones(res.data.results || res.data);
//       setTotalPages(
//         res.data.totalPages || Math.ceil(res.data.count / size) || 1
//       );
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch zones");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchZones(globalFilter, page, pageSize);
//   }, [globalFilter, page, pageSize]);

//   // 🔹 Save zone (Add/Edit)
//   const handleSave = async () => {
//     if (!formData.name) return;

//     try {
//       setSaving(true);
//       const payload = { ...formData, userid: String(userId) };

//       if (editingZone) {
//         await deviceApi.put(`/Zone/${editingZone.id}/`, payload);
//         message.success("Zone updated!");
//       } else {
//         await deviceApi.post(`/Zone/`, payload);
//         message.success("Zone added!");
//       }

//       setFormData({ name: "", status: true });
//       setEditingZone(null);
//       fetchZones(globalFilter, page, pageSize);
//     } catch (err) {
//       console.error("Save Error:", err);
//       message.error("Failed to save zone");
//     } finally {
//       setSaving(false);
//     }
//   };

//   // 🔹 Delete zone
//   const handleDelete = async (id) => {
//     try {
//       setDeletingId(id);
//       await deviceApi.delete(`/Zone/${id}/`);
//       message.success("Zone deleted!");
//       fetchZones(globalFilter, page, pageSize);
//     } catch (err) {
//       console.error("Delete Error:", err);
//       message.error("Failed to delete zone");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // 🔹 Toggle status
//   const handleToggle = async (row, value) => {
//     try {
//       setTogglingId(row.id);
//       await deviceApi.put(`/Zone/${row.id}/`, {
//         ...row,
//         status: value,
//         userId: String(userId),
//       });
//       setZones((prev) =>
//         prev.map((z) => (z.id === row.id ? { ...z, status: value } : z))
//       );
//       message.success("Status updated!");
//     } catch (err) {
//       console.error("Toggle Error:", err);
//       message.error("Failed to update status");
//     } finally {
//       setTogglingId(null);
//     }
//   };

//   // 🔹 Table columns
//   const columns = [
//     columnHelper.accessor("id", { header: "ID" }),
//     columnHelper.accessor("name", {
//       header: "Zone Name",
//       cell: (info) => (
//         <span className="font-semibold text-green-800">{info.getValue()}</span>
//       ),
//     }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           loading={togglingId === info.row.original.id} // ✅ loader
//           onChange={(val) => handleToggle(info.row.original, val)}
//         />
//       ),
//     }),
//     columnHelper.display({
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-2">
//             <button
//               className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
//               onClick={() => {
//                 setEditingZone(row);
//                 setFormData({ name: row.name, status: row.status });
//               }}
//             >
//               <EditOutlined />
//             </button>
//             <button
//               className="px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200"
//               onClick={() => handleDelete(row.id)}
//               disabled={deletingId === row.id} // ✅ disable while deleting
//             >
//               {deletingId === row.id ? <Spin size="small" /> : <DeleteOutlined />}
//             </button>
//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data: zones,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   // 🔹 Debounced search
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
//       {/* Form Header */}
//       <div className="px-4 py-3 rounded-md bg-purple-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
//         <h2 className="text-xl font-bold text-purple-900">
//           {editingZone ? "Edit Zone" : "Add Zone"}
//         </h2>

//         <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
//           <input
//             type="text"
//             placeholder="Zone name"
//             value={formData.name}
//             onChange={(e) =>
//               setFormData({ ...formData, name: e.target.value })
//             }
//             className="px-3 py-1 border border-gray-300 rounded-md text-sm text-black"
//           />
//           <Switch
//             checked={formData.status}
//             onChange={(val) => setFormData({ ...formData, status: val })}
//           />
//           <button
//             onClick={handleSave}
//             disabled={saving}
//             className={`flex items-center gap-1 px-3 py-1 rounded-md text-white ${
//               saving
//                 ? "bg-purple-400 cursor-not-allowed"
//                 : "bg-purple-600 hover:bg-purple-700"
//             }`}
//           >
//             {saving ? <Spin size="small" /> : <SaveOutlined />}
//             {editingZone ? "Update Zone" : "Add Zone"}
//           </button>
//         </div>
//       </div>

//       {/* Search + Page Size */}
//       <div className="flex justify-between items-center">
//         <select
//           value={pageSize}
//           onChange={(e) => {
//             setPageSize(Number(e.target.value));
//             setPage(1);
//           }}
//           className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//         >
//           {[10, 25, 50].map((size) => (
//             <option key={size} value={size} className="text-black">
//               Show {size}
//             </option>
//           ))}
//         </select>

//         <input
//           type="text"
//           placeholder="Search..."
//           onChange={(e) => handleSearch(e.target.value)}
//           className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300"
//         />
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow relative">
//         {loading && (
//           <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50 z-10">
//             <Spin size="large" />
//           </div>
//         )}
//         <table className="min-w-full text-sm">
//           <thead className="bg-[#9864db] text-[#E6E6FA]">
//             {table.getHeaderGroups().map((headerGroup) => (
//               <tr key={headerGroup.id}>
//                 {headerGroup.headers.map((header) => (
//                   <th
//                     key={header.id}
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold text-[#E6E6FA] cursor-pointer whitespace-nowrap"
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
//             {table.getRowModel().rows.map((row) => (
//               <tr key={row.id} className="hover:bg-green-50">
//                 {row.getVisibleCells().map((cell) => (
//                   <td
//                     key={cell.id}
//                     className="px-4 py-3 border border-green-100 whitespace-nowrap"
//                   >
//                     {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                   </td>
//                 ))}
//               </tr>
//             ))}
//           </tbody>
//         </table>

//         {table.getRowModel().rows.length === 0 && !loading && (
//           <div className="text-center text-gray-500 py-6">No data found.</div>
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
//             className="px-3 py-1 border rounded bg-purple-100 text-purple-700 disabled:opacity-50"
//             disabled={page === 1}
//           >
//             Prev
//           </button>
//           <button
//             onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
//             className="px-3 py-1 border rounded bg-purple-100 text-purple-700 disabled:opacity-50"
//             disabled={page === totalPages}
//           >
//             Next
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ZoneDetails;
