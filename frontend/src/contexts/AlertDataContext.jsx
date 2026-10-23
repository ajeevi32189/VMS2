import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { deviceApi } from '../utils/axiosInstance';

const AlertDataContext = createContext(null);

const todayISOString = () => new Date().toISOString().split('T')[0];
const getPastDateISOString = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
};

export const AlertDataProvider = ({ children }) => {
  const [alerts, setAlerts] = useState([]);
  const [alertsCount, setAlertsCount] = useState(0);
  const [weeklyCounts, setWeeklyCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const userId = Cookies.get('userId');

  /**
   * fetchAlertData
   * @param {Object} filters - { nvr, zone, location, camera }
   */
  const fetchAlertData = useCallback(
    async (filters = {}) => {
      if (!userId) {
        setAlerts([]);
        setAlertsCount(0);
        setWeeklyCounts([]);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const toDate = todayISOString();
        const fromDate = getPastDateISOString(30);

        const { nvr, zone, location, camera } = filters;

        // Fetch weekly counts
        const weeklyResPromise = deviceApi.get('/CameraalertsCount/', {
          params: {
            user_id: userId,
            from_date: fromDate,
            to_date: toDate,
          },
        });

        // Step 1: Fetch page 1 to get total count and first batch of results
        const page1Res = await deviceApi.get('/CameraAlert/', {
          params: {
            userid: userId,
            page: 1,
            pageSize: 200,
            page_size: 200,
            search: '',
            nvr,
            zone,
            location,
            camera,
          },
        });

        const page1Data = page1Res?.data || page1Res;
        const page1Results = page1Data?.results || page1Data?.data || [];
        // The TRUE total count as reported by the backend
        const trueTotal = typeof page1Data?.count === 'number' ? page1Data.count : page1Results.length;
        
        // Detect actual server batch size (e.g. 10 or whatever the backend returned)
        const serverBatchSize = page1Results.length > 0 ? page1Results.length : 10;
        const totalPages = Math.ceil(trueTotal / serverBatchSize);

        let allAlerts = [...page1Results];

        // Step 2: If there are more pages, fetch them in parallel up to total
        if (totalPages > 1 && allAlerts.length < trueTotal) {
          const maxPagesToFetch = Math.min(totalPages, 50);
          const remainingPageNumbers = Array.from({ length: maxPagesToFetch - 1 }, (_, i) => i + 2);
          const remainingResults = await Promise.all(
            remainingPageNumbers.map((pageNum) =>
              deviceApi.get('/CameraAlert/', {
                params: {
                  userid: userId,
                  page: pageNum,
                  pageSize: serverBatchSize,
                  page_size: serverBatchSize,
                  search: '',
                  nvr,
                  zone,
                  location,
                  camera,
                },
              }).then((res) => {
                const d = res?.data || res;
                return d?.results || d?.data || [];
              }).catch(() => []) // Don't let one bad page kill everything
            )
          );
          allAlerts = [...allAlerts, ...remainingResults.flat()];
        }

        // Deduplicate alerts by ID
        const seenIds = new Set();
        const uniqueAlerts = [];
        for (const item of allAlerts) {
          if (item && item.id != null) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              uniqueAlerts.push(item);
            }
          } else if (item) {
            uniqueAlerts.push(item);
          }
        }

        const weeklyRes = await weeklyResPromise;

        // Store all alerts dynamically and the true total count
        setAlerts(uniqueAlerts);
        setAlertsCount(trueTotal);

        const countsData = Array.isArray(weeklyRes?.data)
          ? weeklyRes.data
          : Array.isArray(weeklyRes)
          ? weeklyRes
          : [];

        setWeeklyCounts(
          countsData.map((item) => ({
            date: item.date,
            count: item.count,
            day: new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' }),
          }))
        );
      } catch (err) {
        console.error('Failed to fetch alert data:', err);
        setError(err.message || 'Failed to load alerts');
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    // initial fetch with no filters
    fetchAlertData();
  }, [fetchAlertData]);

  const value = useMemo(
    () => ({
      alerts,
      alertsCount,
      weeklyCounts,
      loading,
      error,
      refreshAlerts: fetchAlertData, // pass filters as argument when calling
    }),
    [alerts, alertsCount, weeklyCounts, loading, error, fetchAlertData]
  );

  return <AlertDataContext.Provider value={value}>{children}</AlertDataContext.Provider>;
};

export const useAlertData = () => {
  const context = useContext(AlertDataContext);
  if (!context) {
    throw new Error('useAlertData must be used within an AlertDataProvider');
  }
  return context;
};
