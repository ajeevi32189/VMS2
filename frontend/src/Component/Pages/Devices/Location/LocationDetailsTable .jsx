import React, { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import debounce from "lodash/debounce";
import { deviceApi } from "../../../../utils/axiosInstance";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { useAuth } from "../../../../Authentication/AuthContext";
import { message, Popconfirm, Modal, Spin, Switch, Tooltip } from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import { formatIndianDateTime } from "../../../../utils/imageUtils";
import LocationMapModal from "./LocationMapModal";

const columnHelper = createColumnHelper();

const LocationDetailsTable = () => {
  const { role, hasPermission } = useAuth();
  const canWrite = (role || "").toLowerCase() === "admin" || hasPermission("location.write");

  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const [viewLocation, setViewLocation] = useState(null);
  const [mapLocation, setMapLocation] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [deletingId, setDeletingId] = useState(null);

  const navigate = useNavigate();
  const userId = Cookies.get("userId");

  // ✅ Fetch location data using deviceApi
  // const fetchData = async (search = globalFilter, currentPage = page, size = pageSize) => {
  //   setLoading(true);
  //   try {
  //     const res = await deviceApi.get("/Location/", {
  //       params: { user_id: userId, search, page: currentPage, pageSize: size },
  //     });
  //     setData(res.data.results || []);
  //     setTotalPages(res.data.totalPages || 1);
  //   } catch (err) {
  //     console.error("API Error:", err);
  //     message.error("Failed to fetch locations!");
  //   } finally {
  //     setLoading(false);
  //   }
  // };


  const fetchData = async (search = globalFilter, currentPage = page, size = pageSize) => {
    setLoading(true);
    try {
      const res = await deviceApi.get("/Location/", {
        params: { search, page: currentPage, page_size: size, userid: userId },
      });

      let list = res.data.results || res.data || [];
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter(
          (l) =>
            (l.name || l.location_name || "").toLowerCase().includes(q) ||
            String(l.description || "").toLowerCase().includes(q)
        );
      }
      setData(list);

      // Calculate total pages from count
      const total = res.data.count || list.length;
      setTotalPages(Math.ceil(total / size) || 1);

    } catch (err) {
      console.error("API Error:", err);
      message.error("Failed to fetch locations!");
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchData(globalFilter, page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter, page, pageSize]);

  const handleSearch = useMemo(
    () =>
      debounce((value) => {
        setGlobalFilter(value);
        setPage(1);
      }, 300),
    []
  );

  // ✅ Delete location with deviceApi
  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deviceApi.delete(`/Location/${id}/`);
      setData((prev) => prev.filter((item) => item.id !== id));
      message.success("Location deleted successfully!");
    } catch (err) {
      console.error("Delete failed:", err);
      message.error("Failed to delete location!");
    } finally {
      setDeletingId(null);
    }
  };

  // ✅ Toggle status with deviceApi
  const handleToggle = async (row, value) => {
    try {
      const payload = { ...row, status: value ? 1 : 0, userId };
      await deviceApi.put(`/Location/${row.id}/`, payload);

      setData((prev) =>
        prev.map((loc) =>
          loc.id === row.id ? { ...loc, status: value ? 1 : 0 } : loc
        )
      );
      message.success("Status updated successfully!");
    } catch (err) {
      console.error("Toggle error:", err);
      message.error("Failed to update status");
      fetchData();
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
    }),
    columnHelper.accessor("name", {
      header: "Location Name",
      cell: (info) => (
        <span className="font-semibold text-[#2c028d]">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("city", { header: "City" }),
    columnHelper.accessor("state", { header: "State" }),
    columnHelper.accessor("pincode", { header: "Pincode" }),
    columnHelper.accessor("locationType", { header: "Type" }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <Switch
          checked={!!info.getValue()}
          disabled={!canWrite}
          onChange={(val) => handleToggle(info.row.original, val)}
        />
      ),
    }),
    columnHelper.accessor("regDate", {
      header: "Created Date Time",
      cell: (info) => formatIndianDateTime(info.getValue() || info.row.original.created_at),
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex gap-3 items-center">
            <EyeOutlined
              style={{ color: "#9000DB", fontSize: "15px", cursor: "pointer" }}
              onClick={() => setViewLocation(row)}
            />
            {canWrite && (
              <EditOutlined
                style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
                onClick={() => navigate(`/location/form`, { state: { location: row } })}
              />
            )}
            {canWrite && (
              <Popconfirm
                title="Are you sure to delete this location?"
                onConfirm={() => handleDelete(row.id)}
                okText="Yes"
                cancelText="No"
              >
                {deletingId === row.id ? (
                  <Spin size="small" />
                ) : (
                  <DeleteOutlined
                    style={{ color: "#dc2626", fontSize: "15px", cursor: "pointer" }}
                  />
                )}
              </Popconfirm>
            )}
            <Tooltip title="View Location & Cameras on GIS Map">
              <EnvironmentOutlined
                style={{ color: "#1677ff", fontSize: "16px", cursor: "pointer" }}
                onClick={() => setMapLocation(row)}
              />
            </Tooltip>
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
        <h2 className="text-xl font-bold text-[#fce4e4]">Location Details</h2>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="Search locations..."
            onChange={(e) => handleSearch(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
          />
          {canWrite && (
            <button
              onClick={() => navigate("/location/form")}
              className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
            >
              + Add Location
            </button>
          )}
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
                    className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
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
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center">
                  <Spin spinning />
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
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
                <td colSpan={columns.length} className="py-6 text-center text-gray-500">
                  No locations found.
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

      {/* View Modal */}
      <Modal
        title="Location Details"
        open={!!viewLocation}
        onCancel={() => setViewLocation(null)}
        footer={null}
      >
        {viewLocation && (
          <div className="space-y-2">
            <p><b>ID:</b> {viewLocation.id}</p>
            <p><b>Name:</b> {viewLocation.name}</p>
            <p><b>Type:</b> {viewLocation.locationType}</p>
            <p><b>Address:</b> {viewLocation.address}</p>
            <p><b>Landmark:</b> {viewLocation.landmark}</p>
            <p><b>Street:</b> {viewLocation.street}</p>
            <p><b>City:</b> {viewLocation.city}</p>
            <p><b>State:</b> {viewLocation.state}</p>
            <p><b>Pincode:</b> {viewLocation.pincode}</p>
            <p><b>Latitude:</b> {viewLocation.latitude}</p>
            <p><b>Longitude:</b> {viewLocation.longitude}</p>
            <p><b>Status:</b> {viewLocation.status ? "Active" : "Inactive"}</p>
            <p><b>Created:</b> {formatIndianDateTime(viewLocation.regDate || viewLocation.created_at)}</p>
            <p><b>Updated:</b> {formatIndianDateTime(viewLocation.updated_at || viewLocation.regDate)}</p>
            <div className="pt-3 mt-3 border-t flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setMapLocation(viewLocation);
                  setViewLocation(null);
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 shadow transition-colors"
              >
                <EnvironmentOutlined /> View on GIS Map
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Interactive Location GIS & Cameras Map Modal */}
      <LocationMapModal
        open={!!mapLocation}
        onClose={() => setMapLocation(null)}
        location={mapLocation}
      />

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default LocationDetailsTable;




///////////////



// import React, { useState, useEffect, useMemo } from "react";
// import {
//   useReactTable,
//   getCoreRowModel,
//   getSortedRowModel,
//   flexRender,
//   createColumnHelper,
// } from "@tanstack/react-table";
// import debounce from "lodash/debounce";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import { useNavigate } from "react-router-dom";
// import Cookies from "js-cookie";
// import { message, Popconfirm, Modal, Spin, Switch } from "antd";
// import {
//   EditOutlined,
//   DeleteOutlined,
//   EyeOutlined,
//   EnvironmentOutlined,
// } from "@ant-design/icons";

// const columnHelper = createColumnHelper();

// const LocationDetailsTable = () => {
//   const [data, setData] = useState([]);
//   const [sorting, setSorting] = useState([]);
//   const [globalFilter, setGlobalFilter] = useState("");
//   const [loading, setLoading] = useState(false);

//   const [viewLocation, setViewLocation] = useState(null);
//   const [page, setPage] = useState(1);
//   const [pageSize] = useState(10);
//   const [totalPages, setTotalPages] = useState(1);
//   const [deletingId, setDeletingId] = useState(null);

//   const navigate = useNavigate();
//   const userId = Cookies.get("userId");

//   // ✅ Fetch location data using deviceApi
//   const fetchData = async (search = globalFilter, currentPage = page, size = pageSize) => {
//     setLoading(true);
//     try {
//       const res = await deviceApi.get("/Location/", {
//         params: { user_id: userId, search, page: currentPage, pageSize: size },
//       });
//       setData(res.data.results || []);
//       setTotalPages(res.data.totalPages || 1);
//     } catch (err) {
//       console.error("API Error:", err);
//       message.error("Failed to fetch locations!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData(globalFilter, page, pageSize);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [globalFilter, page, pageSize]);

//   const handleSearch = useMemo(
//     () =>
//       debounce((value) => {
//         setGlobalFilter(value);
//         setPage(1);
//       }, 300),
//     []
//   );

//   // ✅ Delete location with deviceApi
//   const handleDelete = async (id) => {
//     setDeletingId(id);
//     try {
//       await deviceApi.delete(`/Location/${id}/`);
//       setData((prev) => prev.filter((item) => item.id !== id));
//       message.success("Location deleted successfully!");
//     } catch (err) {
//       console.error("Delete failed:", err);
//       message.error("Failed to delete location!");
//     } finally {
//       setDeletingId(null);
//     }
//   };

//   // ✅ Toggle status with deviceApi
//   const handleToggle = async (row, value) => {
//     try {
//       const payload = { ...row, status: value ? 1 : 0, userId };
//       await deviceApi.put(`/Location/${row.id}/`, payload);

//       setData((prev) =>
//         prev.map((loc) =>
//           loc.id === row.id ? { ...loc, status: value ? 1 : 0 } : loc
//         )
//       );
//       message.success("Status updated successfully!");
//     } catch (err) {
//       console.error("Toggle error:", err);
//       message.error("Failed to update status");
//       fetchData();
//     }
//   };

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
//     columnHelper.accessor("name", {
//       header: "Location Name",
//       cell: (info) => (
//         <span className="font-semibold text-[#2c028d]">{info.getValue()}</span>
//       ),
//     }),
//     columnHelper.accessor("city", { header: "City" }),
//     columnHelper.accessor("state", { header: "State" }),
//     columnHelper.accessor("pincode", { header: "Pincode" }),
//     columnHelper.accessor("locationType", { header: "Type" }),
//     columnHelper.accessor("status", {
//       header: "Status",
//       cell: (info) => (
//         <Switch
//           checked={!!info.getValue()}
//           onChange={(val) => handleToggle(info.row.original, val)}
//         />
//       ),
//     }),
//     columnHelper.accessor("created_at", {
//       header: "Created",
//       cell: (info) =>
//         info.getValue()
//           ? new Date(info.getValue()).toLocaleDateString()
//           : "—",
//     }),
//     columnHelper.display({
//       id: "actions",
//       header: "Actions",
//       cell: (info) => {
//         const row = info.row.original;
//         return (
//           <div className="flex gap-3 items-center">
//             <EyeOutlined
//               style={{ color: "#9000DB", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => setViewLocation(row)}
//             />
//             <EditOutlined
//               style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
//               onClick={() => navigate(`/location/form`, { state: { location: row } })}
//             />
//             <Popconfirm
//               title="Are you sure to delete this location?"
//               onConfirm={() => handleDelete(row.id)}
//               okText="Yes"
//               cancelText="No"
//             >
//               {deletingId === row.id ? (
//                 <Spin size="small" />
//               ) : (
//                 <DeleteOutlined
//                   style={{ color: "#dc2626", fontSize: "15px", cursor: "pointer" }}
//                 />
//               )}
//             </Popconfirm>
//             <EnvironmentOutlined
//               style={{ color: "#1677ff", fontSize: "15px", cursor: "pointer" }}
//               onClick={() =>
//                 window.open(
//                   `https://maps.google.com/?q=${row.latitude},${row.longitude}`,
//                   "_blank"
//                 )
//               }
//             />
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
//         <h2 className="text-xl font-bold text-[#fce4e4]">Warehouse Details</h2>
//         <div className="flex gap-3 items-center flex-wrap">
//           <input
//             type="text"
//             placeholder="Search locations..."
//             onChange={(e) => handleSearch(e.target.value)}
//             className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm text-black"
//           />
//           <button
//             onClick={() => navigate("/location/form")}
//             className="bg-white hover:bg-gray-200 text-black px-3 py-1 rounded-md shadow"
//           >
//             + Add Location
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
//                     className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold whitespace-nowrap cursor-pointer select-none"
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
//             {loading ? (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center">
//                   <Spin spinning />
//                 </td>
//               </tr>
//             ) : table.getRowModel().rows.length > 0 ? (
//               table.getRowModel().rows.map((row) => (
//                 <tr key={row.id} className="hover:bg-purple-50">
//                   {row.getVisibleCells().map((cell) => (
//                     <td
//                       key={cell.id}
//                       className="px-4 py-3 border border-purple-100 whitespace-nowrap"
//                     >
//                       {flexRender(cell.column.columnDef.cell, cell.getContext())}
//                     </td>
//                   ))}
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td colSpan={columns.length} className="py-6 text-center text-gray-500">
//                   No locations found.
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

//       {/* View Modal */}
//       <Modal
//         title="Location Details"
//         open={!!viewLocation}
//         onCancel={() => setViewLocation(null)}
//         footer={null}
//       >
//         {viewLocation && (
//           <div className="space-y-2">
//             <p><b>ID:</b> {viewLocation.id}</p>
//             <p><b>Name:</b> {viewLocation.name}</p>
//             <p><b>Type:</b> {viewLocation.locationType}</p>
//             <p><b>Address:</b> {viewLocation.address}</p>
//             <p><b>Landmark:</b> {viewLocation.landmark}</p>
//             <p><b>Street:</b> {viewLocation.street}</p>
//             <p><b>City:</b> {viewLocation.city}</p>
//             <p><b>State:</b> {viewLocation.state}</p>
//             <p><b>Pincode:</b> {viewLocation.pincode}</p>
//             <p><b>Latitude:</b> {viewLocation.latitude}</p>
//             <p><b>Longitude:</b> {viewLocation.longitude}</p>
//             <p><b>Status:</b> {viewLocation.status ? "Active" : "Inactive"}</p>
//             <p><b>Created:</b> {new Date(viewLocation.created_at).toLocaleString()}</p>
//             <p><b>Updated:</b> {new Date(viewLocation.updated_at).toLocaleString()}</p>
//           </div>
//         )}
//       </Modal>

//       {/* Footer */}
// <div className="fixed bottom-2 right-4 text-xs font-bold">
//   <span className="text-red-600">© Ajeevi</span>{" "}
//   <span className="text-blue-600">Technologies Pvt. Ltd.</span>
// </div>
//     </div>
//   );
// };

// export default LocationDetailsTable;
