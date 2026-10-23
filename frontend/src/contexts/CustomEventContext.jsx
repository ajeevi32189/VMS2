// contexts/CustomEventContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { message } from 'antd';
import { deviceApi } from '../utils/axiosInstance';
import Cookies from 'js-cookie';
import { slugify } from '../utils/slugify';

const CustomEventContext = createContext();

export const CustomEventProvider = ({ children }) => {
  const [customEvents, setCustomEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchCustomEvents = async () => {
    try {
      setLoading(true);
      const userId = Cookies.get('userId');
      const res = await deviceApi.get(`/event/?userid=${userId}`);
      setCustomEvents(res.data.results || []);
    } catch (err) {
      message.error('Failed to load custom events');
      setCustomEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const getCustomEventsForSidebar = () => {
    return customEvents.map(event => ({
      key: `custom_event_${event.eventId}`,
      label: event.eventName || `Custom Event ${event.eventId}`,
      path: `/analytics/event/${slugify(event.eventName)}`,
      eventData: event,
      isCustom: true, // Mark as custom for identification
    }));
  };

  // Refresh both custom events and trigger API events refresh
  const refreshEvents = async () => {
    await fetchCustomEvents();
    // You might want to add a callback mechanism here to refresh API events
  };

  useEffect(() => {
    fetchCustomEvents();
  }, []);

  return (
    <CustomEventContext.Provider
      value={{
        customEvents,
        loading,
        refreshEvents,
        getCustomEventsForSidebar,
        fetchCustomEvents, // Expose fetch function directly
      }}
    >
      {children}
    </CustomEventContext.Provider>
  );
};

export const useCustomEvents = () => {
  const context = useContext(CustomEventContext);
  if (!context) {
    throw new Error('useCustomEvents must be used within a CustomEventProvider');
  }
  return context;
};
