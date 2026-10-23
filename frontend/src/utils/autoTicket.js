/**
 * autoTicket.js
 * Shared utility: auto-creates a ticket whenever a new analytics alert arrives.
 * Deduplicates against local storage, in-flight locks, and backend existing tickets.
 */

import { ticketApi } from "./axiosInstance";
import Cookies from "js-cookie";
import { formatIndianDateTime } from "./imageUtils";

// ---------- helpers ----------

const STORAGE_KEY = "vms_ticketed_alert_ids";

// In-flight mutex to prevent concurrent tabs or polling from creating duplicates simultaneously
const _inFlightAlertIds = new Set();

// In-memory cache of alert IDs already present in backend tickets
let _backendSyncedAlertIds = new Set();
let _lastBackendSyncTime = 0;
const SYNC_INTERVAL_MS = 60000; // 1 minute

/** Return the Set of alert IDs that already have tickets */
const getTicketedIds = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const local = new Set(raw ? JSON.parse(raw) : []);
    // Merge with backend-synced IDs
    _backendSyncedAlertIds.forEach((id) => local.add(id));
    return local;
  } catch {
    return _backendSyncedAlertIds;
  }
};

/** Persist a new alert ID to the ticketed set */
const markTicketed = (alertId) => {
  const strId = String(alertId);
  _backendSyncedAlertIds.add(strId);
  _inFlightAlertIds.delete(strId);
  try {
    const ids = getTicketedIds();
    ids.add(strId);
    // Keep only last 2000 IDs to avoid unbounded growth
    const arr = [...ids].slice(-2000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // silent
  }
};

/**
 * Sync existing tickets from backend database to ensure that opening
 * another browser/tab or clearing localStorage never creates duplicate tickets!
 */
const syncBackendTickets = async () => {
  const now = Date.now();
  if (now - _lastBackendSyncTime < SYNC_INTERVAL_MS && _backendSyncedAlertIds.size > 0) {
    return;
  }
  _lastBackendSyncTime = now;

  try {
    const res = await ticketApi.get("/api/tickets", { params: { page: 1, pageSize: 100 } });
    const items = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.items)
      ? res.data.items
      : Array.isArray(res.data?.data)
      ? res.data.data
      : [];

    items.forEach((t) => {
      const desc = String(t.description || "");
      const match = desc.match(/Alert ID:\s*(\w+)/i);
      if (match && match[1]) {
        _backendSyncedAlertIds.add(String(match[1]));
      }
    });

    // Also persist to localStorage
    const combined = getTicketedIds();
    _backendSyncedAlertIds.forEach((id) => combined.add(id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...combined].slice(-2000)));
  } catch (err) {
    console.warn("autoTicket: could not sync existing tickets from backend", err);
  }
};

/** Map alertStatus codes → severity string */
const mapSeverity = (alertStatus) => {
  switch ((alertStatus || "").toUpperCase()) {
    case "C": return "High";
    case "S": return "High";
    case "B": return "Medium";
    case "N": return "Low";
    default:  return "Medium";
  }
};

/** Map alertStatus codes → priority string */
const mapPriority = (alertStatus) => {
  switch ((alertStatus || "").toUpperCase()) {
    case "C": return "High";
    case "S": return "High";
    case "B": return "Medium";
    case "N": return "Low";
    default:  return "Medium";
  }
};

// Cache the first SLA id so we don't fetch every time
let _cachedSlaId = null;

const getFirstSlaId = async () => {
  if (_cachedSlaId) return _cachedSlaId;
  try {
    const res = await ticketApi.get("/api/sla");
    const slas =
      Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.items)
        ? res.data.items
        : Array.isArray(res.data?.data)
        ? res.data.data
        : [];
    if (slas.length > 0) {
      _cachedSlaId = slas[0].id;
      return _cachedSlaId;
    }
  } catch (err) {
    console.warn("autoTicket: could not fetch SLAs", err);
  }
  return null;
};

// ---------- main export ----------

/**
 * createTicketForAlerts
 *
 * @param {Object[]} alerts   – array of alert objects from the camera API
 * @param {string}   alertType – human-readable label e.g. "Fire", "Garbage", "Facial Recognition"
 * @param {string}   category  – ticket category e.g. "Surveillance Alert"
 */
export const createTicketForAlerts = async (alerts, alertType, category = "Surveillance Alert") => {
  if (!alerts || alerts.length === 0) return;

  // 1. Sync existing backend tickets so different browsers don't recreate tickets
  await syncBackendTickets();

  const ticketedIds = getTicketedIds();
  const reporterId = Cookies.get("email") || Cookies.get("userId") || "vms_system";
  const now = Date.now();

  // 2. Filter to only NEW, LIVE/RECENT alerts (within last 5 minutes)
  const newAlerts = alerts.filter((a) => {
    const id = String(a.id ?? a.alert_id ?? "");
    if (!id || ticketedIds.has(id) || _inFlightAlertIds.has(id)) {
      return false;
    }

    // Freshness check: Skip historical alerts older than 5 minutes
    const alertTimeStr = a.regDate || a.timestamp || a.created_at;
    if (alertTimeStr) {
      const d = new Date(alertTimeStr);
      if (!isNaN(d.getTime())) {
        const ageMs = now - d.getTime();
        // If alert is older than 5 minutes, mark it as already handled and skip
        if (ageMs > 5 * 60 * 1000) {
          markTicketed(id);
          return false;
        }
      }
    }

    return true;
  });

  if (newAlerts.length === 0) return;

  const slaId = await getFirstSlaId();
  if (!slaId) {
    console.warn("autoTicket: No SLA found, skipping auto-ticket creation");
    return;
  }

  for (const alert of newAlerts) {
    const alertId = String(alert.id ?? alert.alert_id ?? "");
    _inFlightAlertIds.add(alertId);

    try {
      const severity = mapSeverity(alert.alertStatus);
      const priority = mapPriority(alert.alertStatus);
      const cameraName = alert.camera_name || alert.cameraName || `Camera ${alert.camera_id || ""}`;
      const nowIso = new Date().toISOString();

      const framePath = alert.framePath || alert.frame_path || alert.image_path || "";
      const framePart = framePath ? ` Frame: ${framePath}.` : "";

      await ticketApi.post("/api/tickets", {
        title: `${alertType} Alert – ${cameraName}`,
        description: `Automatic ticket for ${alertType} alert detected on ${cameraName}. Alert ID: ${alertId}.${framePart}`,
        incidentOn: nowIso,
        incidentLoggedOn: nowIso,
        category,
        subCategory: alertType,
        reporterId,
        severity,
        priority,
        slaId,
        latitude: 0,
        longitude: 0,
        landmark: cameraName,
        ticketType: "Automatic",
        deviceId: String(alert.camera_id || ""),
        attachmentUrl: framePath || "",
        projectName: "VMS",
      });

      markTicketed(alertId);
      console.info(`autoTicket: Ticket created for ${alertType} alert ${alertId}`);
    } catch (err) {
      _inFlightAlertIds.delete(alertId);
      console.warn(`autoTicket: Failed to create ticket for alert ${alertId}`, err);
    }
  }
};
