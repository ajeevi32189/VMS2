import React, { useState, useEffect } from "react";
import { Modal, Form, Input, Select, message, Spin, Tag, Tooltip } from "antd";
import {
  UserOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  UserAddOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { ticketApi, api, deviceApi } from "../../../utils/axiosInstance";
import { formatIndianDateTime, AlertSnapshot } from "../../../utils/imageUtils";
import { useAuth } from "../../../Authentication/AuthContext";
import Cookies from "js-cookie";

const TicketTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  // Users list for assignment
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isCloseOpen, setIsCloseOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [detailedTicket, setDetailedTicket] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  // Forms
  const [createForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [closeForm] = Form.useForm();

  // Lookups
  const [slas, setSlas] = useState([]);

  const { user } = useAuth();
  const userEmail = user?.email || Cookies.get("email") || import.meta.env.VITE_DEFAULT_EMAIL || "";

  // ─── Fetch System Users for Assign Dropdown ───
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await api.get("/users");
      if (Array.isArray(res.data)) {
        setUsersList(res.data);
      } else if (Array.isArray(res.data?.items)) {
        setUsersList(res.data.items);
      } else {
        setUsersList([]);
      }
    } catch (err) {
      console.warn("Failed to fetch users for assignment:", err);
      // Fallback default list if API fails
      setUsersList([
        { email: userEmail, userName: userEmail }
      ]);
    } finally {
      setLoadingUsers(false);
    }
  };

  // ─── Fetch SLAs ───
  const fetchSlas = async () => {
    try {
      const res = await ticketApi.get("/api/sla");
      if (Array.isArray(res.data)) {
        setSlas(res.data);
      } else if (res.data && Array.isArray(res.data.items)) {
        setSlas(res.data.items);
      } else if (res.data && Array.isArray(res.data.data)) {
        setSlas(res.data.data);
      }
    } catch (err) {
      console.error("Failed to fetch SLAs:", err);
    }
  };

  // ─── Fetch Tickets (GET /api/tickets) ───
  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = { page, pageSize };
      if (searchQuery) params.search = searchQuery;

      const res = await ticketApi.get("/api/tickets", { params });

      let list = [];
      if (Array.isArray(res.data)) {
        list = res.data;
        setTotal(res.data.length);
      } else if (res.data && Array.isArray(res.data.items)) {
        list = res.data.items;
        setTotal(res.data.totalCount || res.data.total || res.data.items.length);
      } else if (res.data && Array.isArray(res.data.data)) {
        list = res.data.data;
      } else {
        list = [];
        setTotal(0);
      }

      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter((t) => {
          const matchTitle = (t.ticketTitle || t.title || "").toLowerCase().includes(q);
          const matchDesc = (t.description || "").toLowerCase().includes(q);
          const matchCategory = (t.category || "").toLowerCase().includes(q);
          const matchSubCategory = (t.subCategory || "").toLowerCase().includes(q);
          const matchAssignee = (t.assignedTo || t.assignee || "").toLowerCase().includes(q);
          const matchDevice = (t.deviceId || t.landmark || "").toLowerCase().includes(q);
          const matchStatus = (t.status || "").toLowerCase().includes(q);
          const matchId = String(t.ticketId || t.id || "").toLowerCase().includes(q);
          return matchTitle || matchDesc || matchCategory || matchSubCategory || matchAssignee || matchDevice || matchStatus || matchId;
        });
      }
      setData(list);
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      message.error("Failed to load tickets from backend API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlas();
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [page, pageSize, searchQuery]);

  // ─── Fetch Ticket Details by ID (GET /api/tickets/{id}) ───
  const handleOpenDetails = async (ticket) => {
    const tId = ticket?.ticketId || ticket?.id || ticket?.ticket_id;
    setSelectedTicket(ticket);
    // Pre-fill with row data immediately so modal isn't blank
    setDetailedTicket(ticket);
    setIsDetailsOpen(true);
    setLoadingDetails(true);
    try {
      const res = await ticketApi.get(`/api/tickets/${tId}`);
      let merged = { ...ticket, ...(res.data || {}) };

      if (!merged.assignedToId) merged.assignedToId = ticket.assignedToId;
      if (!merged.incidentLoggedOn) merged.incidentLoggedOn = ticket.incidentLoggedOn;
      if (!merged.incidentOn) merged.incidentOn = ticket.incidentOn;
      if (!merged.ticketTitle) merged.ticketTitle = ticket.ticketTitle;

      // Extract alert frame path if present in description or ticket attachments
      let framePath = merged.attachmentUrl || merged.framePath || null;
      let matchedCameraName = merged.deviceId || merged.landmark || "";
      const descStr = String(merged.description || "");
      const frameMatch = descStr.match(/Frame:\s*([^\s,;]+)/i);

      if (frameMatch && frameMatch[1]) {
        framePath = frameMatch[1];
      } else if (!framePath) {
        // Look up alert by Alert ID if auto-generated
        const alertIdMatch = descStr.match(/Alert ID:\s*(\w+)/i);
        if (alertIdMatch && alertIdMatch[1]) {
          const alertId = alertIdMatch[1];
          const userId = Cookies.get("userId") || user?.id || "";
          setLoadingSnapshot(true);
          try {
            let matched = null;

            // 1. Try single alert by ID
            try {
              const resSingle = await deviceApi.get(`/CameraAlert/${alertId}/`, {
                params: userId ? { userid: userId } : {},
              });
              const sData = resSingle?.data;
              if (sData && (sData.framePath || sData.image_path || sData.frame_path)) {
                matched = sData;
              }
            } catch (_) {}

            // 2. Try CameraAlert list with search and userid
            if (!matched) {
              try {
                const alertRes = await deviceApi.get("/CameraAlert/", {
                  params: {
                    userid: userId || undefined,
                    search: alertId,
                    page: 1,
                    pageSize: 20,
                  },
                });
                const alerts = alertRes.data?.results || alertRes.data?.data || (Array.isArray(alertRes.data) ? alertRes.data : []);
                matched = alerts.find((a) => String(a.id) === String(alertId)) || alerts[0];
              } catch (_) {}
            }

            // 3. Fallback: query recent alerts by userid
            if (!matched && userId) {
              try {
                const alertResRecent = await deviceApi.get("/CameraAlert/", {
                  params: { userid: userId, page: 1, pageSize: 50 },
                });
                const alerts = alertResRecent.data?.results || alertResRecent.data?.data || (Array.isArray(alertResRecent.data) ? alertResRecent.data : []);
                matched = alerts.find((a) => String(a.id) === String(alertId));
              } catch (_) {}
            }

            if (matched) {
              framePath = matched.framePath || matched.image_path || matched.frame_path || matched.snapshot_path || null;
              if (matched.camera_name || matched.cameraName) {
                matchedCameraName = matched.camera_name || matched.cameraName;
              }
            }
          } catch (e) {
            console.warn("Could not fetch alert snapshot for ticket:", e);
          } finally {
            setLoadingSnapshot(false);
          }
        }
      }

      merged.alertFramePath = framePath;
      merged.alertCameraName = matchedCameraName;
      setDetailedTicket(merged);
    } catch (err) {
      console.warn("Could not fetch extended ticket details:", err);
      setDetailedTicket(ticket);
    } finally {
      setLoadingDetails(false);
    }
  };

  // ─── Create Ticket (POST /api/tickets) ───
  const handleOpenCreateModal = () => {
    setIsCreateOpen(true);
    setTimeout(() => {
      createForm.resetFields();
      createForm.setFieldsValue({
        reporterId: userEmail,
        projectName: "VMS",
        category: "Surveillance Alert",
        severity: "Medium",
        priority: "Medium",
      });
    }, 0);
  };

  const handleCreateTicket = async (values) => {
    setLoading(true);
    try {
      await ticketApi.post("/api/tickets", {
        title: values.title,
        description: values.description,
        category: values.category,
        subCategory: values.subCategory || "General",
        reporterId: values.reporterId,
        severity: values.severity,
        priority: values.priority,
        slaId: values.slaId,
        latitude: 0,
        longitude: 0,
        landmark: values.landmark || "",
        ticketType: "Manual",
        deviceId: values.deviceId || "",
        projectName: values.projectName || "VMS",
      });
      message.success("Ticket created successfully!");
      setIsCreateOpen(false);
      fetchTickets();
    } catch (err) {
      console.error("Failed to create ticket:", err);
      const errMsg =
        err.response?.data?.title ||
        err.response?.data?.message ||
        err.response?.data ||
        "Failed to create ticket";
      message.error(typeof errMsg === "string" ? errMsg : "Failed to create ticket");
    } finally {
      setLoading(false);
    }
  };

  // ─── Open Assign Modal & Assign Ticket (PATCH /api/tickets/{id}/assign) ───
  const handleOpenAssignModal = (ticket) => {
    setSelectedTicket(ticket);
    setIsAssignOpen(true);
    fetchUsers();
    setTimeout(() => {
      assignForm.resetFields();
      assignForm.setFieldsValue({
        assignTo: ticket.assignedTo || ticket.assignee || userEmail,
      });
    }, 0);
  };

  const handleAssignTicketSubmit = async (values) => {
    setLoading(true);
    const tId = selectedTicket?.ticketId || selectedTicket?.id || selectedTicket?.ticket_id;
    const assignee = values.assignTo;

    try {
      await ticketApi.patch(
        `/api/tickets/${tId}/assign`,
        JSON.stringify(assignee),
        { headers: { "Content-Type": "application/json" } }
      );
      message.success(`Ticket #${tId} successfully assigned to ${assignee}!`);
      setIsAssignOpen(false);
      setSelectedTicket(null);
      fetchTickets();
    } catch (err) {
      console.error("Failed to assign ticket:", err);
      const errMsg =
        err.response?.data?.title ||
        err.response?.data?.message ||
        err.response?.data ||
        "Failed to assign ticket";
      message.error(typeof errMsg === "string" ? errMsg : "Failed to assign ticket");
    } finally {
      setLoading(false);
    }
  };

  // ─── Open Close Modal & Close Ticket (PATCH /api/tickets/{id}/close) ───
  const handleOpenCloseModal = (ticket) => {
    setSelectedTicket(ticket);
    setIsCloseOpen(true);
    setTimeout(() => {
      closeForm.resetFields();
    }, 0);
  };

  const handleCloseTicketSubmit = async (values) => {
    setLoading(true);
    const tId = selectedTicket?.ticketId || selectedTicket?.id || selectedTicket?.ticket_id;
    try {
      await ticketApi.patch(
        `/api/tickets/${tId}/close`,
        JSON.stringify(values.reason),
        { headers: { "Content-Type": "application/json" } }
      );
      message.success(`Ticket #${tId} closed successfully!`);
      setIsCloseOpen(false);
      setSelectedTicket(null);
      fetchTickets();
    } catch (err) {
      console.error("Failed to close ticket:", err);
      const errMsg =
        err.response?.data?.title ||
        err.response?.data?.message ||
        err.response?.data ||
        "Failed to close ticket";
      message.error(typeof errMsg === "string" ? errMsg : "Failed to close ticket");
    } finally {
      setLoading(false);
    }
  };

  // Helper to strip conflicting alert detection timestamp from ticket description
  const cleanTicketDescription = (desc) => {
    if (!desc) return "";
    return String(desc)
      .replace(/\s+at\s+\d{1,2}[\/\s-][0-9a-zA-Z\s,/:.-]+?(?:[ap]m)?(?=\.|\s+Alert|\s+Location|$)/i, "")
      .trim();
  };

  // ─── Clean Title & Extract Date Helper ───
  const formatTicketDisplay = (record) => {
    // API provides a clean ticketTitle field — use it directly
    const ticketTitle = record.ticketTitle || record.title || "";
    const rawDesc = String(record.description || "");

    // Clean title: strip leading "#123 " if present
    const cleanTitle = ticketTitle.replace(/^#\d+\s*/, "").trim() || "—";

    // Clean description: only show if it adds info not already in the title
    let cleanDesc = "";
    const titleLower = cleanTitle.toLowerCase();
    const sub = record.subCategory || "";
    const cam = record.landmark || "";
    const subInTitle = sub && titleLower.includes(sub.toLowerCase());
    const camInTitle = cam && titleLower.includes(cam.toLowerCase());

    if (sub && !subInTitle) cleanDesc = sub;
    if (cam && !camInTitle) {
      cleanDesc = cleanDesc ? `${cleanDesc} · ${cam}` : cam;
    }

    // Strictly show Ticket Created At timestamp (alert detection time removed per requirement)
    const extractedTime =
      record.createdAt ||
      record.created_at ||
      record.createdDate ||
      record.incidentLoggedOn ||
      record.incidentOn ||
      record.updatedAt ||
      record.timestamp;

    const formattedDateTime = extractedTime ? formatIndianDateTime(extractedTime) : "—";

    return { cleanTitle, cleanDesc, formattedDateTime };
  };

  // ─── Status Tag ───
  const getStatusTag = (status) => {
    const s = (status || "").toLowerCase();
    const base = "px-2.5 py-1 text-[11px] rounded-full font-bold tracking-wide shadow-xs";
    switch (s) {
      case "open":
      case "new":
        return <span className={`${base} bg-blue-100 text-blue-700 border border-blue-200`}>OPEN</span>;
      case "assigned":
      case "acknowledged":
        return <span className={`${base} bg-amber-100 text-amber-800 border border-amber-200`}>ASSIGNED</span>;
      case "inprogress":
      case "in_progress":
        return <span className={`${base} bg-indigo-100 text-indigo-700 border border-indigo-200`}>IN PROGRESS</span>;
      case "resolved":
        return <span className={`${base} bg-purple-100 text-purple-700 border border-purple-200`}>RESOLVED</span>;
      case "closed":
        return <span className={`${base} bg-emerald-100 text-emerald-800 border border-emerald-200`}>CLOSED</span>;
      default:
        return <span className={`${base} bg-gray-100 text-gray-700 border border-gray-200`}>{status?.toUpperCase() || "—"}</span>;
    }
  };

  // ─── Priority Tag ───
  const getPriorityTag = (priority) => {
    const p = (priority || "").toLowerCase();
    const base = "px-2 py-0.5 text-[11px] rounded font-bold tracking-wide";
    switch (p) {
      case "high":
        return <span className={`${base} bg-red-100 text-red-700 border border-red-200`}>HIGH</span>;
      case "medium":
        return <span className={`${base} bg-amber-100 text-amber-700 border border-amber-200`}>MEDIUM</span>;
      case "low":
        return <span className={`${base} bg-slate-100 text-slate-700 border border-slate-200`}>LOW</span>;
      default:
        return <span className={`${base} bg-gray-100 text-gray-600`}>{priority?.toUpperCase() || "—"}</span>;
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  const canAct = (status) => {
    const s = (status || "").toLowerCase();
    return s !== "closed" && s !== "resolved";
  };

  // Allow assign always for non-closed tickets (even if already assigned — re-assign)
  const canAssign = (status) => {
    const s = (status || "").toLowerCase();
    return s !== "closed" && s !== "resolved";
  };

  // Resolve assignee from all possible API field names
  const getAssignee = (record) =>
    record.assignedToId ||
    record.assignedTo ||
    record.assignee ||
    record.assigned_to ||
    record.assignedUser ||
    record.assignedToEmail ||
    record.assignedToName ||
    record.assignTo ||
    record.handler ||
    record.responsibleUser ||
    null;

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* ── Header Banner ── */}
      <div className="flex px-4 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🎫 Ticket Management
          </h2>
          <span className="text-xs text-white/80">
            Real-time surveillance & device alert tickets with SLA tracking
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            type="text"
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 text-slate-800 min-w-[180px]"
          />
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-1.5 bg-[#7844bb] text-white rounded-md text-sm font-semibold hover:bg-[#6834aa] transition-colors shadow flex items-center gap-1"
          >
            <PlusOutlined /> Create Ticket
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg shadow border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-[#9864db] text-white">
            <tr>
              <th className="px-3 py-3 text-left font-semibold w-[50px]">S.No</th>
              <th className="px-3 py-3 text-left font-semibold min-w-[220px]">Title & Description</th>
              <th className="px-3 py-3 text-left font-semibold w-[120px]">Category</th>
              <th className="px-3 py-3 text-center font-semibold w-[90px]">Priority</th>
              <th className="px-3 py-3 text-left font-semibold w-[160px]">Created Date & Time</th>
              <th className="px-3 py-3 text-center font-semibold w-[100px]">Status</th>
              <th className="px-3 py-3 text-left font-semibold w-[140px]">Assigned To</th>
              <th className="px-3 py-3 text-center font-semibold w-[170px]">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading && data.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-400">
                  <Spin tip="Loading tickets from API..."><div className="min-h-[50px]" /></Spin>
                </td>
              </tr>
            ) : data.length > 0 ? (
              data.map((record, index) => {
                const serial = (page - 1) * pageSize + index + 1;
                const showActions = canAct(record.status);
                const tId = record.ticketId || record.id || record.ticket_id;
                const assignee = getAssignee(record);
                const { cleanTitle, cleanDesc, formattedDateTime } = formatTicketDisplay(record);

                return (
                  <tr key={tId || index} className="hover:bg-purple-50/40 transition-colors">
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-500 text-center">
                      {serial}
                    </td>
                    <td className="px-3 py-3 whitespace-normal break-words">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-black">{cleanTitle}</span>
                          {(record.ticketType === "Automatic" || record.ticketType === "Auto-Generated" || String(record.description || "").includes("Alert ID:")) ? (
                            <Tag color="purple" className="text-[10px] px-1.5 py-0 m-0 border-purple-200 font-medium">Auto Alert</Tag>
                          ) : (
                            <Tag color="cyan" className="text-[10px] px-1.5 py-0 m-0 font-medium">Manual</Tag>
                          )}
                        </div>
                        {cleanDesc && (
                          <span className="text-[12px] text-gray-700 block mt-0.5">
                            {cleanDesc}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-xs text-slate-700 font-medium">
                        {record.category || "General"}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center">
                      {getPriorityTag(record.priority || record.severity)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                      <div className="flex items-center gap-1">
                        <ClockCircleOutlined className="text-gray-400" />
                        <span>{formattedDateTime}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center">
                      {getStatusTag(record.status)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {assignee ? (
                        <span className="text-indigo-600 font-semibold flex items-center gap-1">
                          <UserOutlined /> {assignee}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* View Details Button */}
                        <Tooltip title="View Ticket Details">
                          <button
                            onClick={() => handleOpenDetails(record)}
                            className="p-1.5 text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded transition"
                          >
                            <EyeOutlined size={14} />
                          </button>
                        </Tooltip>

                        {showActions ? (
                          <>
                            {/* Assign/Re-assign button — always visible for non-closed tickets */}
                            {canAssign(record.status) && (
                              <button
                                onClick={() => handleOpenAssignModal(record)}
                                disabled={loading}
                                title={assignee ? `Re-assign (currently: ${assignee})` : "Assign ticket"}
                                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
                              >
                                <UserAddOutlined /> {assignee ? "Re-assign" : "Assign"}
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenCloseModal(record)}
                              disabled={loading}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                              <CheckCircleOutlined /> Close
                            </button>
                          </>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                            <CheckCircleOutlined /> Closed
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="py-16 text-center text-gray-400 text-base">
                  No tickets found in database.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
        <span className="text-sm text-gray-500">
          Page {page} of {totalPages} · {total} ticket{total !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-2 items-center">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm"
          >
            {[10, 25, 50].map((s) => (
              <option key={s} value={s}>
                Show {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            className="px-3 py-1 border rounded bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-40 transition-colors text-sm"
            disabled={page === 1}
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            className="px-3 py-1 border rounded bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-40 transition-colors text-sm"
            disabled={page === totalPages || totalPages <= 1}
          >
            Next →
          </button>
        </div>
      </div>

      {/* ── Details Ticket Modal ── */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <SafetyCertificateOutlined className="text-purple-600 text-lg" />
            <span>Ticket Details #{detailedTicket?.ticketId || detailedTicket?.id || detailedTicket?.ticket_id}</span>
          </div>
        }
        open={isDetailsOpen}
        onCancel={() => {
          setIsDetailsOpen(false);
          setDetailedTicket(null);
        }}
        footer={null}
        centered
        width={650}
      >
        {loadingDetails ? (
          <div className="py-12 text-center">
            <Spin tip="Fetching ticket details..." />
          </div>
        ) : detailedTicket ? (
          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-start border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  {formatTicketDisplay(detailedTicket).cleanTitle}
                </h3>
                <span className="text-xs text-gray-500">
                  Created by: <b className="text-slate-700">{detailedTicket.reporterId || "System"}</b>
                </span>
              </div>
              <div>{getStatusTag(detailedTicket.status)}</div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm bg-purple-50/50 p-3 rounded-lg border border-purple-100">
              <div>
                <span className="text-gray-500 text-xs block">Category</span>
                <span className="font-semibold text-slate-700">
                  {detailedTicket.category || "General"} ({detailedTicket.subCategory || "—"})
                </span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Priority / Severity</span>
                <div className="flex gap-1.5 mt-0.5">
                  {getPriorityTag(detailedTicket.priority || "Medium")}
                  <Tag color="orange">{detailedTicket.severity || "Medium"}</Tag>
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Assigned To</span>
                <span className="font-semibold text-indigo-700">
                  {getAssignee(detailedTicket) || "Unassigned"}
                </span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Created Time</span>
                <span className="font-semibold text-slate-700">
                  {formatTicketDisplay(detailedTicket).formattedDateTime}
                </span>
              </div>
              {detailedTicket.deviceId && (
                <div>
                  <span className="text-gray-500 text-xs block">Device / Camera ID</span>
                  <span className="font-semibold text-purple-700">
                    {detailedTicket.deviceId} {detailedTicket.landmark ? `(${detailedTicket.landmark})` : ""}
                  </span>
                </div>
              )}
              {detailedTicket.slaPlan && (
                <div>
                  <span className="text-gray-500 text-xs block">SLA Plan</span>
                  <span className="font-semibold text-slate-700">{detailedTicket.slaPlan}</span>
                </div>
              )}
            </div>

            {/* Alert Snapshot Evidence for Automatic Surveillance Tickets */}
            {(detailedTicket.alertFramePath || detailedTicket.ticketType === "Automatic" || detailedTicket.ticketType === "Auto-Generated" || String(detailedTicket.description || "").includes("Alert ID:")) ? (
              <div className="bg-purple-50/60 rounded-xl p-3.5 border border-purple-200/80 shadow-sm text-slate-800">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    <span className="text-xs font-bold text-purple-900">
                      AI Event Snapshot Evidence
                    </span>
                    <Tag color="purple" className="text-[10px] m-0 border-purple-200 font-medium">Auto Surveillance</Tag>
                  </div>
                  {detailedTicket.deviceId && (
                    <span className="text-[11px] text-slate-500 font-mono">
                      {detailedTicket.deviceId}
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3.5">
                  <div className="w-full sm:w-56 h-36 bg-white rounded-lg overflow-hidden border border-purple-100 flex items-center justify-center shrink-0 shadow-sm">
                    {detailedTicket.alertFramePath ? (
                      <AlertSnapshot
                        path={detailedTicket.alertFramePath}
                        cameraName={detailedTicket.alertCameraName || detailedTicket.deviceId || detailedTicket.landmark}
                        alt="Alert Snapshot"
                        width="100%"
                        height="100%"
                        className="w-full h-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                        preview={{ mask: "🔍 Enlarge Evidence" }}
                      />
                    ) : loadingSnapshot ? (
                      <div className="text-slate-500 text-xs text-center p-3">
                        <Spin size="small" />
                        <p className="mt-1.5 text-[11px] text-purple-700 font-medium m-0">Fetching snapshot evidence...</p>
                      </div>
                    ) : (
                      <div className="text-slate-400 text-xs text-center p-3">
                        <span className="text-xl block mb-1 opacity-60">📷</span>
                        <p className="text-[11px] text-slate-500 m-0">No snapshot image available</p>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 text-xs space-y-2 text-slate-600 w-full">
                    <p className="m-0 text-slate-500 text-[11px] leading-relaxed">
                      Real-time video frame captured automatically when the AI surveillance model triggered this alert. Click the image to view in full resolution.
                    </p>
                    <div className="pt-2 border-t border-purple-100 space-y-1.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Event Detection:</span>
                        <span className="font-semibold text-purple-800">{detailedTicket.subCategory || "Surveillance Alert"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Camera Source:</span>
                        <span className="font-semibold text-slate-700">{detailedTicket.alertCameraName || detailedTicket.deviceId || detailedTicket.landmark || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ticket Origin:</span>
                        <span className="text-emerald-700 font-semibold">Automatic System Generated</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900">
                <span className="font-semibold">Manual Helpdesk Ticket</span>
                <span className="text-[11px] text-blue-600">Created manually by operator (no automatic camera snapshot)</span>
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-gray-500 block mb-1">Description & Notes</span>
              <div className="p-3 bg-gray-50 rounded border border-gray-200 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                {cleanTicketDescription(detailedTicket.description) || "No additional description provided."}
              </div>
            </div>

            {detailedTicket.resolutionNotes && (
              <div>
                <span className="text-xs font-semibold text-emerald-600 block mb-1">Closure / Resolution Notes</span>
                <div className="p-3 bg-emerald-50 rounded border border-emerald-200 text-xs text-emerald-800 font-medium whitespace-pre-wrap">
                  {detailedTicket.resolutionNotes}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── Assign Ticket Modal (PATCH /api/tickets/{id}/assign) ── */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <UserAddOutlined className="text-purple-600" />
            <span>Assign Ticket #{selectedTicket?.ticketId || selectedTicket?.id}</span>
          </div>
        }
        open={isAssignOpen}
        onCancel={() => {
          setIsAssignOpen(false);
          setSelectedTicket(null);
        }}
        onOk={() => assignForm.submit()}
        confirmLoading={loading}
        centered
        width={480}
        destroyOnHidden
      >
        <Form form={assignForm} layout="vertical" onFinish={handleAssignTicketSubmit} className="mt-4">
          <Form.Item
            label="Select User to Assign"
            name="assignTo"
            rules={[{ required: true, message: "Please select or type a user to assign to" }]}
          >
            <Select
              showSearch
              placeholder="Select or type user email/name"
              loading={loadingUsers}
              allowClear
              optionFilterProp="children"
            >
              {usersList.map((u, idx) => {
                const email = u.email || u.userName || u.name || String(u);
                const roleName = Array.isArray(u.roles) ? u.roles.join(", ") : u.role || "User";
                return (
                  <Select.Option key={idx} value={email}>
                    {email} <span className="text-xs text-gray-400">({roleName})</span>
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Create Ticket Modal (POST /api/tickets) ── */}
      <Modal
        title="Create Ticket"
        open={isCreateOpen}
        onCancel={() => setIsCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={loading}
        centered
        width={600}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreateTicket}
          className="mt-4 grid grid-cols-2 gap-x-4"
        >
          <Form.Item
            label="Ticket Title"
            name="title"
            rules={[{ required: true, message: "Please enter ticket title" }]}
            className="col-span-2"
          >
            <Input placeholder="e.g., Camera 02 Down / Feed Broken" />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
            rules={[{ required: true, message: "Please enter description" }]}
            className="col-span-2"
          >
            <Input.TextArea rows={3} placeholder="Provide details about the issue..." />
          </Form.Item>

          <Form.Item
            label="SLA Plan"
            name="slaId"
            rules={[{ required: true, message: "Please select an SLA Plan" }]}
          >
            <Select placeholder="Select SLA">
              {slas.map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name} ({s.resolutionTimeInMinutes} min)
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="Category" name="category">
            <Select>
              <Select.Option value="Surveillance Alert">Surveillance Alert</Select.Option>
              <Select.Option value="Camera Issue">Camera Issue</Select.Option>
              <Select.Option value="Network Issue">Network Issue</Select.Option>
              <Select.Option value="General">General</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Severity" name="severity">
            <Select>
              <Select.Option value="Low">Low</Select.Option>
              <Select.Option value="Medium">Medium</Select.Option>
              <Select.Option value="High">High</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Priority" name="priority">
            <Select>
              <Select.Option value="Low">Low</Select.Option>
              <Select.Option value="Medium">Medium</Select.Option>
              <Select.Option value="High">High</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Device / Camera" name="deviceId">
            <Input placeholder="e.g., CAM-02-Lobby" />
          </Form.Item>

          <Form.Item label="Landmark" name="landmark">
            <Input placeholder="e.g., Main Entrance" />
          </Form.Item>

          <Form.Item name="reporterId" rules={[{ required: true }]} className="hidden">
            <Input />
          </Form.Item>
          <Form.Item name="projectName" rules={[{ required: true }]} className="hidden">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Close Ticket Modal (PATCH /api/tickets/{id}/close) ── */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <CheckCircleOutlined className="text-emerald-600" />
            <span>Close Ticket #{selectedTicket?.ticketId || selectedTicket?.id}</span>
          </div>
        }
        open={isCloseOpen}
        onCancel={() => {
          setIsCloseOpen(false);
          setSelectedTicket(null);
        }}
        onOk={() => closeForm.submit()}
        confirmLoading={loading}
        centered
        destroyOnHidden
      >
        <Form form={closeForm} layout="vertical" onFinish={handleCloseTicketSubmit} className="mt-4">
          <Form.Item
            label="Closure / Resolution Reason"
            name="reason"
            rules={[{ required: true, message: "Please provide a resolution reason" }]}
          >
            <Input.TextArea rows={4} placeholder="Specify how this issue was resolved..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default TicketTable;
