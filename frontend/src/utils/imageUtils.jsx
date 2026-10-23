import React, { useState, useEffect } from "react";
import { Image, Spin } from "antd";
import { ANALYTICS_API_URL } from "../config";

/**
 * Builds the analytics snapshot URL handling path formats
 */
export const getSnapshotUrl = (path, cameraName) => {
  if (!path) return null;
  if (path.startsWith("http")) return path;

  const baseUrl = ANALYTICS_API_URL.replace(/\/$/, "");
  let cleanPath = path.replace(/^\//, "");

  if (cameraName && !cleanPath.includes(`/${cameraName}/`)) {
    cleanPath = cleanPath.replace(/^app\/media\//, `app/media/${cameraName}/`);
  }

  return `${baseUrl}/${cleanPath}`;
};

/**
 * Formats a timestamp into Indian Standard Time (IST) DD/MM/YYYY, hh:mm:ss a
 */
export const formatIndianDateTime = (val) => {
  if (!val) return "—";
  try {
    let parseStr = String(val).trim();
    if (!parseStr || parseStr === "-" || parseStr === "—" || parseStr === "null" || parseStr === "undefined") {
      return "—";
    }

    // Normalize Indian date strings (e.g. "22/10/2026, 10:08:00 am" or "22/10/26, 10:08:00 am")
    const dmyMatch = parseStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*([ap]m)$/i);
    if (dmyMatch) {
      const d = dmyMatch[1].padStart(2, "0");
      const m = dmyMatch[2].padStart(2, "0");
      const y = dmyMatch[3].length === 4 ? dmyMatch[3].slice(2) : dmyMatch[3];
      const h = dmyMatch[4].padStart(2, "0");
      const min = dmyMatch[5];
      const s = dmyMatch[6];
      const ampm = dmyMatch[7].toLowerCase();
      return `${d}/${m}/${y}, ${h}:${min}:${s} ${ampm}`;
    }

    // Convert SQL space timestamp "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(parseStr)) {
      parseStr = parseStr.replace(" ", "T");
    }

    // If backend UTC string without timezone offset ('Z' or '+' or '-' offset), append 'Z'
    if (parseStr.includes("T") && !parseStr.includes("Z") && !parseStr.includes("+") && !parseStr.slice(10).includes("-")) {
      parseStr = parseStr + "Z";
    }

    const d = new Date(parseStr);
    if (isNaN(d.getTime())) return String(val);

    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return String(val || "—");
  }
};

/**
 * STQC-Compliant Snapshot Component
 * Bypasses 401 Unauthorized by using authenticated fetch with memory token,
 * and handles both /app/media and /media path formats automatically.
 */
export const AlertSnapshot = ({
  path,
  cameraName,
  alt = "frame",
  width = 80,
  height = 60,
  className = "object-cover rounded border border-purple-100 shadow-sm",
  preview = { mask: "View" },
}) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    let url = null;
    const targetUrl = getSnapshotUrl(path, cameraName);
    const fallbackUrl = targetUrl?.includes("/app/media/")
      ? targetUrl.replace("/app/media/", "/media/")
      : null;

    const loadImg = async () => {
      // 1. Try targetUrl with authenticated fetch (Bearer token injected via main.jsx)
      try {
        const res = await fetch(targetUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (isMounted) {
            url = URL.createObjectURL(blob);
            setBlobUrl(url);
            setLoading(false);
            return;
          }
        }
      } catch (e) {}

      // 2. Try fallbackUrl if /app/media was not found
      if (fallbackUrl) {
        try {
          const res = await fetch(fallbackUrl);
          if (res.ok) {
            const blob = await res.blob();
            if (isMounted) {
              url = URL.createObjectURL(blob);
              setBlobUrl(url);
              setLoading(false);
              return;
            }
          }
        } catch (e) {}
      }

      if (isMounted) setLoading(false);
    };

    loadImg();

    return () => {
      isMounted = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, cameraName]);

  if (loading) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center bg-gray-50 rounded border border-purple-100">
        <Spin size="small" />
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center bg-gray-100 rounded text-gray-400 text-xs border border-gray-200">
        No frame
      </div>
    );
  }

  return (
    <Image
      src={blobUrl}
      alt={alt}
      width={width}
      height={height}
      className={className}
      preview={preview}
    />
  );
};
