import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { deviceApi } from '../utils/axiosInstance';
import { useAuth } from '../Authentication/AuthContext';

const DeviceInventoryContext = createContext(null);

const normalizeResults = (response = {}) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.data?.results)) return response.data.results;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

export const DeviceInventoryProvider = ({ children }) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [sites, setSites] = useState([]);
  const [zones, setZones] = useState([]);
  const [nvrs, setNvrs] = useState([]);
  const [cameras, setCameras] = useState([]);

  const [counts, setCounts] = useState({
    siteCount: 0,
    zoneCount: 0,
    nvrCount: 0,
    cameraCount: 0,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const userId = Cookies.get('userId');

  const fetchInventory = useCallback(async (filters = {}) => {
    if (!userId || !isAuthenticated || authLoading) {
      setSites([]);
      setZones([]);
      setNvrs([]);
      setCameras([]);
      setCounts({ siteCount: 0, zoneCount: 0, nvrCount: 0, cameraCount: 0 });
      return;
    }

    const { site, zone, nvr, camera } = filters;

    try {
      setLoading(true);
      setError(null);

      const [siteRes, zoneRes, nvrRes, cameraRes] = await Promise.all([
        deviceApi.get('/Location/', {
          params: {
            userid: userId,
            search: '',
            page: 1,
            page_size: 200,
            ...(site && { site_id: site, location: site }),
          },
        }),

        deviceApi.get('/Zone/', {}),

        deviceApi.get('/NVR/', {
          params: {
            userid: userId,
            search: '',
            page: 1,
            page_size: 200,
            ...(zone && { zone }),
            ...(site && { location: site }),
          },
        }),

        deviceApi.get('/Camera/', {
          params: {
            userid: userId,
            search: '',
            page: 1,
            page_size: 200,
            ...(nvr && { nvr: nvr }),
            ...(camera && { camera_id: camera }),
            ...(zone && { zone }),
          },
        }),
      ]);

      const siteList = normalizeResults(siteRes.data ?? siteRes);
      const zoneList = normalizeResults(zoneRes.data ?? zoneRes);
      const nvrList = normalizeResults(nvrRes.data ?? nvrRes);
      const cameraList = normalizeResults(cameraRes.data ?? cameraRes);

      setSites(siteList);
      setZones(zoneList);
      setNvrs(nvrList);
      setCameras(cameraList);

      setCounts({
        siteCount: siteRes.data?.count ?? siteList.length,
        zoneCount: zoneRes.data?.count ?? zoneList.length,
        nvrCount: nvrRes.data?.count ?? nvrList.length,
        cameraCount: cameraRes.data?.count ?? cameraList.length,
      });
    } catch (err) {
      console.error('Failed to fetch device inventory:', err);
      setError(err?.message || 'Failed to load device data');
    } finally {
      setLoading(false);
    }
  }, [userId, isAuthenticated, authLoading]);

  const filterInventory = useCallback((filters = {}) => {
    fetchInventory(filters);
  }, [fetchInventory]);

  const refreshInventory = useCallback(() => {
    fetchInventory({});
  }, [fetchInventory]);

  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      fetchInventory();
    }
  }, [isAuthenticated, authLoading, fetchInventory]);

  const value = useMemo(() => ({
    sites,
    zones,
    nvrs,
    cameras,
    ...counts,
    loading,
    error,
    refreshInventory,
    filterInventory,
  }), [sites, zones, nvrs, cameras, counts, loading, error, refreshInventory, filterInventory]);

  return (
    <DeviceInventoryContext.Provider value={value}>
      {children}
    </DeviceInventoryContext.Provider>
  );
};

export const useDeviceInventory = () => {
  const ctx = useContext(DeviceInventoryContext);
  if (!ctx) throw new Error('useDeviceInventory must be used within DeviceInventoryProvider');
  return ctx;
};
