import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const EVENT_API_URL = import.meta.env.VITE_EVENT_API_URL || '';

const EventContext = createContext(null);

export const EventProvider = ({ children }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${EVENT_API_URL}/api/event/`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.data && response.data.results) {
        setEvents(response.data.results);
      } else if (Array.isArray(response.data)) {
        setEvents(response.data);
      } else {
        setEvents([]);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
      setError(err.message || 'Failed to fetch events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const value = useMemo(
    () => ({
      events,
      loading,
      error,
      refetch: fetchEvents,
    }),
    [events, loading, error, fetchEvents]
  );

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
};

export const useEventContext = () => {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEventContext must be used within an EventProvider');
  }
  return context;
};
