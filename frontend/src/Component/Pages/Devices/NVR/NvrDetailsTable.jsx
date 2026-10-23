
import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { message, Popconfirm, Modal, Tag, Spin } from "antd";
import { deviceApi } from "../../../../utils/axiosInstance";
import Cookies from "js-cookie";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../../Authentication/AuthContext";
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  CameraOutlined,
} from "@ant-design/icons";
import Expand from "./Expand";
import { formatIndianDateTime } from "../../../../utils/imageUtils";

const columnHelper = createColumnHelper();

const NvrDetailsTable = () => {
  const { role, hasPermission } = useAuth();
  const canWrite = (role || "").toLowerCase() === "admin" || hasPermission("nvr.write");

  const [data, setData] = useState([]);
  const [cameras, setCameras] = useState([]); // ? Existing cameras
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const userId = Cookies.get("userId");
  const [viewNvr, setViewNvr] = useState(null);
  const [viewOnvif, setViewOnvif] = useState(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  // ? Fetch NVR Data
  const fetchNvrs = async (search = globalFilter, currentPage = page, size = pageSize) => {
    setLoading(true);
    try {
      const res = await deviceApi.get(
        `/NVR/?userid=${userId}&page=${currentPage}&page_size=${size}`
      );
      const nvrs = res.data.results || [];
      const q = (search || "").trim().toLowerCase();
      setData(
        q
          ? nvrs.filter(
              (n) =>
                (n.name || "").toLowerCase().includes(q) ||
                String(n.location || n.location_name || "").toLowerCase().includes(q) ||
                String(n.zone || n.zone_name || "").toLowerCase().includes(q) ||
                String(n.ip || "").toLowerCase().includes(q)
            )
          : nvrs
      );
      setTotalPages(Math.ceil(res.data.count / size));
    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch NVRs!");
    } finally {
      setLoading(false);
    }
  };

  // ? Fetch existing cameras
  const fetchCameras = async () => {
    try {
      const res = await deviceApi.get(`/Camera/?userid=${userId}`);
      setCameras(res.data.results || []);
    } catch (err) {
      console.error("Camera API Error:", err);
      message.error("Failed to fetch cameras!");
    }
  };

  useEffect(() => {
    fetchNvrs(globalFilter, page, pageSize);
    fetchCameras();
  }, [globalFilter, page, pageSize]);

  const handleSearch = useMemo(
    () =>
      debounce((value) => {
        setGlobalFilter(value);
        setPage(1);
      }, 300),
    []
  );

  // ? Delete NVR
  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await deviceApi.delete(`/NVR/${id}/`);
      message.success("NVR deleted successfully!");
      fetchNvrs(globalFilter, page, pageSize);
    } catch (err) {
      message.error("Failed to delete NVR");
    } finally {
      setLoading(false);
    }
  };

  // ? Columns
  const columns = [
    columnHelper.display({
      id: "serial",
      header: "S.No",
      cell: (info) => (
        <span className="font-medium text-gray-700">
          {(page - 1) * pageSize + info.row.index + 1}
        </span>
      ),
    }),
    columnHelper.display({
      id: "onvif",
      header: "ONVIF",
      cell: (info) => {
        const row = info.row.original;
        return (
          <Tag
            style={{
              cursor: "pointer",
              fontWeight: 500,
              color: "#522EA8",
              borderColor: "#522EA8",
            }}
            icon={<CameraOutlined />}
            onClick={() => setViewOnvif(row)}
          >
            Check
          </Tag>
        );
      },
    }),
    columnHelper.accessor("name", {
      header: "NVR Name",
      cell: (info) => (
        <span className="font-semibold text-purple-700">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("nvrip", { header: "IP Address" }),
    columnHelper.accessor("port", { header: "Port" }),
    columnHelper.accessor("location", { header: "Location" }),
    columnHelper.accessor("zone_name", { header: "Zone" }),
    columnHelper.accessor("regDate", {
      header: "Created Date Time",
      cell: (info) => formatIndianDateTime(info.getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-3">
            <EyeOutlined
              style={{ color: "#9000DB", fontSize: "15px", cursor: "pointer" }}
              onClick={() => setViewNvr(row)}
            />
            <EditOutlined
              style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
              onClick={() => navigate(`/nvr/form`, { state: { nvr: row } })}
            />
            <Popconfirm
              title="Are you sure to delete this NVR?"
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
          </div>
        );
      },
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
        <h2 className="text-xl font-bold text-white">NVR Details</h2>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search NVRs..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300"
          />
          {canWrite && (
            <button
              onClick={() => navigate("/nvr/form")}
              className="px-3 py-1.5 bg-white text-purple-700 rounded-md text-sm font-medium hover:bg-purple-100 shadow"
            >
              + Add NVR
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
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold cursor-pointer whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {header.column.getIsSorted() === "asc" && " ?"}
                    {header.column.getIsSorted() === "desc" && " ?"}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center">
                  <Spin spinning={loading} tip="Loading NVRs..." />
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-purple-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 border border-gray-200 whitespace-nowrap"
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
                <td colSpan={columns.length} className="py-6 text-center">
                  No NVRs found.
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
              <option key={size} value={size}>
                Show {size}
              </option>
            ))}
          </select>
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

      {/* View NVR Modal */}
      <Modal
        title="NVR Full Details"
        open={!!viewNvr}
        onCancel={() => setViewNvr(null)}
        footer={null}
      >
        {viewNvr && (
          <div className="space-y-2">
            {Object.entries(viewNvr).map(([key, value]) => (
              <p key={key}>
                <strong className="capitalize">{key === "regDate" ? "Created Date Time" : key}:</strong>{" "}
                {key === "regDate"
                  ? formatIndianDateTime(value)
                  : value !== null
                  ? value.toString()
                  : "—"}
              </p>
            ))}
          </div>
        )}
      </Modal>

      {/* ONVIF Modal */}
      <Modal
        title={`ONVIF Cameras jshu - ${viewOnvif?.name}`}
        open={!!viewOnvif}
        onCancel={() => setViewOnvif(null)}
        footer={null}
        width="80%"
        destroyOnClose   // <-- ADD THIS LINE

      >
        {viewOnvif && (
          <Expand
            data={viewOnvif}
            existingCameras={cameras}
            userId={userId}
            onClose={() => setViewOnvif(null)}
          />
        )}
      </Modal>
      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default NvrDetailsTable;





//////////////////////// RRRRRRRRRRRRR



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { message, Popconfirm, Modal, Tag, Spin } from "antd";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie";
// import { useNavigate } from "react-router-dom";
// import {
//   EditOutlined,
//   DeleteOutlined,
//   EyeOutlined,
//   CameraOutlined,
// } from "@ant-design/icons";
// import Expand from "./Expand";

// const columnHelper = createColumnHelper();

// const NvrDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [cameras, setCameras] = useState([]); // ✅ Existing cameras
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   const userId = Cookies.get("userId");
//   const [viewNvr, setViewNvr] = useState(null);
//   const [viewOnvif, setViewOnvif] = useState(null);
//   const [loading, setLoading] = useState(false);

//   const navigate = useNavigate();

//   // ✅ Fetch NVR Data
//   const fetchNvrs = async (search = globalFilter, currentPage = page, size = pageSize) => {
//     setLoading(true);
//     try {
//       const res = await deviceApi.get(
//         `/NVR/?user_id=${userId}&page=${currentPage}&page_size=${size}`
//       );
//       const nvrs = res.data.results || [];
//       setData(
//         nvrs.filter(
//           (n) =>
//             n.name?.toLowerCase().includes(search.toLowerCase()) ||
//             n.location?.toLowerCase().includes(search.toLowerCase()) ||
//             n.zone?.toLowerCase().includes(search.toLowerCase())
//         )
//       );
//       setTotalPages(Math.ceil(res.data.count / size));
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch NVRs!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   // ✅ Fetch existing cameras
//   const fetchCameras = async () => {
//     try {
//       const res = await deviceApi.get(`/Camera/?user_id=${userId}`);
//       setCameras(res.data.results || []);
//     } catch (err) {
//       console.error("Camera API Error:", err);
//       message.error("Failed to fetch cameras!");
//     }
//   };

//   useEffect(() => {
//     fetchNvrs(globalFilter, page, pageSize);
//     fetchCameras();
//   }, [globalFilter, page, pageSize]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Delete NVR
//   const handleDelete = async (id) => {
//     setLoading(true);
//     try {
//       await deviceApi.delete(`/NVR/${id}/`);
//       message.success("NVR deleted successfully!");
//       fetchNvrs(globalFilter, page, pageSize);
//     } catch (err) {
//       message.error("Failed to delete NVR");
//     } finally {
//       setLoading(false);
//     }
//   };

//   // ✅ Columns
//   const columns = [
//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.display({
//       id: "onvif",
//       header: "ONVIF",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <Tag
//             style={{
//               cursor: "pointer",
//               fontWeight: 500,
//               color: "#522EA8",
//               borderColor: "#522EA8",
//             }}
//             icon={<CameraOutlined />}
//             onClick={() => setViewOnvif(row)}
//           >
//             Check
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("name", {
//       header: "NVR Name",
//       cell: (info) => (
//         <span className="font-semibold text-purple-700">
//           {info.getValue()}
//         </span>
//       ),
//     }),
//     columnHelper.accessor("nvrip", { header: "IP Address" }),
//     columnHelper.accessor("port", { header: "Port" }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3">
//             <EyeOutlined
//               style={{ color: "#9000DB", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => setViewNvr(row)}
//             />
//             <EditOutlined
//               style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => navigate(`/nvr/form`, { state: { nvr: row } })}
//             />
//             <Popconfirm
//               title="Are you sure to delete this NVR?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               <DeleteOutlined
//                 style={{
//                   color: "#dc2626",
//                   fontSize: "15px",
//                   cursor: "pointer",
//                 }}
//               />
//             </Popconfirm>
//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-white">NVR Details</h2>
//         <div className="flex gap-3 items-center">
//           <input
//             type="text"
//             placeholder="Search NVRs..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300"
//           />
//           <button
//             onClick={() => navigate("/nvr/form")}
//             className="px-3 py-1.5 bg-white text-purple-700 rounded-md text-sm font-medium hover:bg-purple-100 shadow"
//           >
//             + Add NVR
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
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
//           <tbody className="bg-white divide-y divide-gray-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning={loading} tip="Loading NVRs..." />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-gray-200 whitespace-nowrap"
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
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   No NVRs found.
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
//           <select
//             value={pageSize}
//             onChange={(e) => {
//               setPageSize(Number(e.target.value));
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             {[10, 25, 50].map((size) => (
//               <option key={size} value={size}>
//                 Show {size}
//               </option>
//             ))}
//           </select>
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

//       {/* View NVR Modal */}
//       <Modal
//         title="NVR Full Details"
//         open={!!viewNvr}
//         onCancel={() => setViewNvr(null)}
//         footer={null}
//         destroyOnClose
//       >
//         {viewNvr && (
//           <div className="space-y-2">
//             {Object.entries(viewNvr).map(([key, value]) => (
//               <p key={key}>
//                 <strong className="capitalize">{key}:</strong>{" "}
//                 {value !== null ? value.toString() : "—"}
//               </p>
//             ))}
//           </div>
//         )}
//       </Modal>

//       {/* ONVIF Modal */}
//       <Modal
//         title={`ONVIF Cameras - ${viewOnvif?.name}`}
//         open={!!viewOnvif}
//         onCancel={() => setViewOnvif(null)}
//         footer={null}
//         width="80%"
//       >
//         {viewOnvif && (
//           <Expand
//             data={viewOnvif}
//             existingCameras={cameras}
//             userId={userId}
//             onClose={() => setViewOnvif(null)}
//           />
//         )}
//       </Modal>
//     </div>
//   );
// };

// export default NvrDetailsTable;



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { message, Popconfirm, Modal, Tag, Spin, Button } from "antd";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie";
// import { useNavigate } from "react-router-dom";
// import { EditOutlined, DeleteOutlined, EyeOutlined, CameraOutlined } from "@ant-design/icons";
// import Expand from "./Expand"; // ✅ Import your Expand component

// const columnHelper = createColumnHelper();

// const NvrDetailsTable = () => {
//   const apiUrl = import.meta.env.VITE_BASE_API_URL;
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);

//   const userId = Cookies.get("userId");
//   const [viewNvr, setViewNvr] = useState(null);
//   const [viewOnvif, setViewOnvif] = useState(null); // ✅ ONVIF Modal State
//   const [loading, setLoading] = useState(false);

//   const navigate = useNavigate();

//   // ✅ Fetch NVR Data (Server Pagination)
//   const fetchData = async (search = globalFilter, currentPage = page, size = pageSize) => {
//     setLoading(true);
//     try {
//       // const res = await deviceApi.get(`/NVR/?page=${currentPage}&page_size=${size}`);
//       const res = await deviceApi.get(`/NVR/?user_id=${userId}&page=${currentPage}&page_size=${size}`);
//       const nvrs = res.data.results || [];
//       setData(
//         nvrs.filter(
//           (n) =>
//             n.name?.toLowerCase().includes(search.toLowerCase()) ||
//             n.location?.toLowerCase().includes(search.toLowerCase()) ||
//             n.zone?.toLowerCase().includes(search.toLowerCase())
//         )
//       );
//       setTotalPages(Math.ceil(res.data.count / size));
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch NVRs!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(globalFilter, page, pageSize);
//   }, [globalFilter, page, pageSize]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Delete NVR
//   const handleDelete = async (id) => {
//     setLoading(true);
//     try {
//       await deviceApi.delete(`/NVR/${id}/`);
//       message.success("NVR deleted successfully!");
//       fetchData(globalFilter, page, pageSize);
//     } catch (err) {
//       message.error("Failed to delete NVR");
//     } finally {
//       setLoading(false);
//     }
//   };

//   // ✅ Table Columns (important fields only)
//   const columns = [

//     columnHelper.display({
//       id: "serial",
//       header: "S.No",
//       cell: (info) => (
//         <span className="font-medium text-gray-700">
//           {(page - 1) * pageSize + info.row.index + 1}
//         </span>
//       ),
//     }),
//     columnHelper.display({
//       id: "onvif",
//       header: "ONVIF",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <Tag
//             style={{ cursor: "pointer", fontWeight: 500, color: "#522EA8", borderColor: "#522EA8" }}
//             icon={<CameraOutlined />}
//             onClick={() => setViewOnvif(row)} // your function to handle ONVIF check
//           >
//             Check
//           </Tag>
//         );
//       },
//     }),
//     columnHelper.accessor("name", {
//       header: "NVR Name",
//       cell: (info) => <span className="font-semibold text-purple-700">{info.getValue()}</span>,
//     }),
//     columnHelper.accessor("nvrip", { header: "IP Address" }),
//     columnHelper.accessor("port", { header: "Port" }),
//     columnHelper.accessor("location", { header: "Location" }),
//     columnHelper.accessor("zone", { header: "Zone" }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3">
//             <EyeOutlined
//               style={{ color: "#9000DB", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => setViewNvr(row)}
//             />
//             <EditOutlined
//               style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => navigate(`/nvr/form`, { state: { nvr: row } })}
//             />
//             <Popconfirm
//               title="Are you sure to delete this NVR?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               <DeleteOutlined
//                 style={{ color: "#dc2626", fontSize: "15px", cursor: "pointer" }}
//               />
//             </Popconfirm>
//           </div>
//         );
//       },
//     }),
//   ];

//   const table = useReactTable({
//     data,
//     columns,
//     state: { sorting },
//     onSortingChange: setSorting,
//     getCoreRowModel: getCoreRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//   });

//   return (
//     <div className="p-4 space-y-4 max-w-full">
//       {/* Header */}
//       <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
//         <h2 className="text-xl font-bold text-white">NVR Details</h2>
//         <div className="flex gap-3 items-center">
//           <input
//             type="text"
//             placeholder="Search NVRs..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300"
//           />
//           <button
//             onClick={() => navigate("/nvr/form")}
//             className="px-3 py-1.5 bg-white text-purple-700 rounded-md text-sm font-medium hover:bg-purple-100 shadow"
//           >
//             + Add NVR
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
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
//           <tbody className="bg-white divide-y divide-gray-100">
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center text-gray-500">
//                   <Spin spinning={loading} tip="Loading NVRs..." />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td key={cell.id} className="px-4 py-3 border border-gray-200 whitespace-nowrap">
//                       {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center text-gray-500">
//                   No NVRs found.
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
//           <select
//             value={pageSize}
//             onChange={(e) => {
//               setPageSize(Number(e.target.value));
//               setPage(1);
//             }}
//             className="px-2 py-1 border border-gray-300 rounded-md text-sm"
//           >
//             {[10, 25, 50].map((size) => (
//               <option key={size} value={size}>
//                 Show {size}
//               </option>
//             ))}
//           </select>
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

//       {/* View NVR Modal */}
//       <Modal
//         title="NVR Full Details"
//         open={!!viewNvr}
//         onCancel={() => setViewNvr(null)}
//         footer={null}
//       >
//         {viewNvr && (
//           <div className="space-y-2">
//             {Object.entries(viewNvr).map(([key, value]) => (
//               <p key={key}>
//                 <strong className="capitalize">{key}:</strong>{" "}
//                 {value !== null ? value.toString() : "—"}
//               </p>
//             ))}
//           </div>
//         )}
//       </Modal>

//       {/* ONVIF Modal */}
//       <Modal
//         title={`ONVIF Cameras - ${viewOnvif?.name}`}
//         open={!!viewOnvif}
//         onCancel={() => setViewOnvif(null)}
//         footer={null}
//         width={800}
//       >
//         {viewOnvif && <Expand data={viewOnvif} />}
//       </Modal>
//     </div>
//   );
// };

// export default NvrDetailsTable;

