const API_URL =
  window?.env?.API_URL && window.env.API_URL !== "__API_URL__"
    ? window.env.API_URL
    : import.meta.env.VITE_API_URL;

const CAMERA_API_URL =
  window?.env?.CAMERA_API_URL && window.env.CAMERA_API_URL !== "__CAMERA_API_URL__"
    ? window.env.CAMERA_API_URL
    : import.meta.env.VITE_CAMERA_API_URL;

const STREAMING_API_URL =
  window?.env?.STREAMING_API_URL && window.env.STREAMING_API_URL !== "__STREAMING_API_URL__"
    ? window.env.STREAMING_API_URL
    : import.meta.env.VITE_STREAMING_API_URL;

const GO2RTC_URL =
  window?.env?.GO2RTC_URL && window.env.GO2RTC_URL !== "__GO2RTC_URL__"
    ? window.env.GO2RTC_URL
    : import.meta.env.VITE_GO2RTC_URL;

const ONVIF_API_URL =
  window?.env?.ONVIF_API_URL && window.env.ONVIF_API_URL !== "__ONVIF_API_URL__"
    ? window.env.ONVIF_API_URL
    : import.meta.env.VITE_ONVIF_API_URL;

const RECORDING_API_URL =
  window?.env?.RECORDING_API_URL && window.env.RECORDING_API_URL !== "__RECORDING_API_URL__"
    ? window.env.RECORDING_API_URL
    : import.meta.env.VITE_RECORDING_API_URL;

const ANALYTICS_API_URL =
  window?.env?.ANALYTICS_API_URL && window.env.ANALYTICS_API_URL !== "__ANALYTICS_API_URL__"
    ? window.env.ANALYTICS_API_URL
    : import.meta.env.VITE_ANALYTICS_API_URL;

const TICKET_API_URL =
  window?.env?.TICKET_API_URL && window.env.TICKET_API_URL !== "__TICKET_API_URL__"
    ? window.env.TICKET_API_URL
    : import.meta.env.VITE_TICKET_API_URL || "https://ticketmanagementms.ajeevi.in";

const ROI_API_URL =
  window?.env?.ROI_API_URL && window.env.ROI_API_URL !== "__ROI_API_URL__"
    ? window.env.ROI_API_URL
    : import.meta.env.VITE_ROI_API_URL || "";

const FACE_WATCHLIST_API_URL =
  window?.env?.FACE_WATCHLIST_API_URL && window.env.FACE_WATCHLIST_API_URL !== "__FACE_WATCHLIST_API_URL__"
    ? window.env.FACE_WATCHLIST_API_URL
    : import.meta.env.VITE_FACE_WATCHLIST_API_URL || "https://faceenrollmentapi.gyanakshi.com";

export {
  API_URL,
  CAMERA_API_URL,
  STREAMING_API_URL,
  GO2RTC_URL,
  ONVIF_API_URL,
  RECORDING_API_URL,
  ANALYTICS_API_URL,
  TICKET_API_URL,
  ROI_API_URL,
  FACE_WATCHLIST_API_URL,
};


// const API_URL = window?.env?.API_URL || import.meta.env.VITE_API_URL;
// const CAMERA_API_URL = window?.env?.CAMERA_API_URL || import.meta.env.VITE_CAMERA_API_URL;
// const STREAMING_API_URL = window?.env?.STREAMING_API_URL || import.meta.env.VITE_STREAMING_API_URL;
// const ONVIF_API_URL = window?.env?.ONVIF_API_URL || import.meta.env.VITE_ONVIF_API_URL;
// const RECORDING_API_URL = window?.env?.RECORDING_API_URL || import.meta.env.VITE_RECORDING_API_URL;
// const ANALYTICS_API_URL = window?.env?.ANALYTICS_API_URL || import.meta.env.VITE_ANALYTICS_API_URL;

// export {
//   API_URL,
//   CAMERA_API_URL,
//   STREAMING_API_URL,
//   ONVIF_API_URL,
//   RECORDING_API_URL,
//   ANALYTICS_API_URL
// };



