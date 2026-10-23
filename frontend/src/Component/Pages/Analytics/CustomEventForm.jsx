import React, { useEffect, useState } from 'react';
import { useCustomEvents } from '../../../contexts/CustomEventContext';
import Cookies from 'js-cookie';
import { deviceApi } from '../../../utils/axiosInstance';
import { ANALYTICS_API_URL } from '../../../config';


const OBJECT_OPTIONS = [
  'Person',
  'Vehicle',
  'Bicycle',
  'Car',
  'Dog',
  'Animal',
  'Bag',
  'Box',
  'Suitcase',
  'Laptop',
  'Chair',
  'TV',
  'Artwork',
  'Group',
  'Children',
  'Adult',
  'Bus',
  'Smoke',
  'Fire',
  'Flame',
  'Steam',
  'Unknown Object',
  'Camera Covered',
  'Camera Moved',
];


const EVENT_NAME_OPTIONS = ['Fire', 'Smoke', 'Rodent', 'Cattle', 'Crowd', 'Person'];


const OPERATORS = ['>', '>=', '==', '<', '<='];


const dayAbbreviations = {
  Monday: 'M',
  Tuesday: 'T',
  Wednesday: 'W',
  Thursday: 'Th',
  Friday: 'F',
  Saturday: 'Sa',
  Sunday: 'Su',
};


const CustomEventForm = ({ editingData, onClose }) => {
  const { refreshEvents } = useCustomEvents();


  const userId = parseInt(Cookies.get('userId')) || 5;


  // States for current event being created/edited
  const [eventName, setEventName] = useState(editingData?.eventName || '');
  const [tags, setTags] = useState(editingData?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [selectedPresetEvents, setSelectedPresetEvents] = useState(editingData?.presetEvents || []);
  const [conditions, setConditions] = useState(editingData?.conditions || []);
  const [currentCondition, setCurrentCondition] = useState({ object: 'Person', operator: '>', threshold: 1 });
  const [step, setStep] = useState(1);
  const [selectedCameras, setSelectedCameras] = useState(editingData?.cameras || []);
  const [scheduling, setScheduling] = useState({
    dateRange: {
      startDate: editingData?.scheduling?.dateRange?.startDate || '',
      endDate: editingData?.scheduling?.dateRange?.endDate || '',
    },
    specificDays: editingData?.scheduling?.specificDays || [],
    timeRange: {
      startTime: editingData?.scheduling?.timeRange?.startTime || '',
      endTime: editingData?.scheduling?.timeRange?.endTime || '',
    },
    isEnabled: !!editingData?.scheduling,
  });


  // Store all saved events here before final submission
  const [savedEvents, setSavedEvents] = useState([]);


  // Cameras list for selection
  const [cameraList, setCameraList] = useState([]);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [cameraError, setCameraError] = useState(null);


  useEffect(() => {
    const fetchCameras = async () => {
      setLoadingCameras(true);
      setCameraError(null);
      try {
        const response = await deviceApi.get('/Camera/');
        const cameras = response.data.results || response.data || [];


        if (Array.isArray(cameras)) {
          setCameraList(
            cameras.map(cam => ({
              id: cam.id || cam.cameraId,
              name: cam.name || cam.cameraName || `Camera ${cam.id}`,
              status: cam.status,
              location: cam.location,
              rtspurl: cam.rtspurl,
            }))
          );
        } else {
          setCameraList([]);
        }
      } catch (error) {
        setCameraError('Failed to load cameras');
        setCameraList([]);
      } finally {
        setLoadingCameras(false);
      }
    };
    fetchCameras();
  }, []);


  // Reset form for new event
  const resetForm = () => {
    setEventName('');
    setTags([]);
    setTagInput('');
    setSelectedPresetEvents([]);
    setConditions([]);
    setCurrentCondition({ object: 'Person', operator: '>', threshold: 1 });
    setSelectedCameras([]);
    setScheduling({
      dateRange: { startDate: '', endDate: '' },
      specificDays: [],
      timeRange: { startTime: '', endTime: '' },
      isEnabled: false,
    });
    setStep(1);
  };


  const addCondition = e => {
    e?.preventDefault();
    e?.stopPropagation();
    if (currentCondition.object && currentCondition.operator && currentCondition.threshold !== undefined && currentCondition.threshold >= 0) {
      setConditions(prev => [...prev, { ...currentCondition }]);
      setCurrentCondition({ object: 'Person', operator: '>', threshold: 1 });
    }
  };


  const removeCondition = index => {
    setConditions(prev => prev.filter((_, i) => i !== index));
  };


  const toggleCamera = cameraId => {
    setSelectedCameras(prev =>
      prev.includes(cameraId) ? prev.filter(id => id !== cameraId) : [...prev, cameraId]
    );
  };


  const toggleSpecificDay = day => {
    setScheduling(prev => ({
      ...prev,
      specificDays: prev.specificDays.includes(day)
        ? prev.specificDays.filter(d => d !== day)
        : [...prev.specificDays, day],
    }));
  };


  const updateScheduling = (field, value) => {
    setScheduling(prev => ({ ...prev, [field]: value }));
  };


  const updateSchedulingNested = (parentField, childField, value) => {
    setScheduling(prev => ({
      ...prev,
      [parentField]: { ...prev[parentField], [childField]: value },
    }));
  };


  const handleNext = () => {
    if (step === 1 && eventName.trim() && conditions.length > 0) {
      setStep(2);
    } else if (step === 2 && selectedCameras.length > 0) {
      setStep(3);
    }
  };


  // Format current event data
  const formatCurrentEvent = () => ({
    eventName: eventName.trim(),
    tags,
    conditions: conditions.map(cond => ({
      object: cond.object.toLowerCase(),
      operator: cond.operator,
      threshold: String(cond.threshold),
    })),
    cameras: [...selectedCameras],
    scheduling: scheduling.isEnabled ? { ...scheduling } : null,
  });


  // Add current event to savedEvents and reset form for new event
  const saveCurrentEvent = () => {
    if (eventName.trim() && conditions.length > 0 && selectedCameras.length > 0) {
      const newEvent = formatCurrentEvent();
      setSavedEvents(prev => [...prev, newEvent]);
      resetForm();
      alert(`Event "${newEvent.eventName}" saved successfully! You can now add another event.`);
    } else {
      alert('Please complete all required fields: Event Name, Conditions, and select at least one camera.');
    }
  };


  // Remove a saved event
  const removeSavedEvent = (index) => {
    const updatedEvents = [...savedEvents];
    updatedEvents.splice(index, 1);
    setSavedEvents(updatedEvents);
  };


  // Build combined payload structure exactly like your example
  const buildCombinedPayload = () => {
    const allEvents = [...savedEvents];
    
    // Check if current form has valid data and add it to payload
    const currentEventData = formatCurrentEvent();
    if (eventName.trim() && conditions.length > 0 && selectedCameras.length > 0) {
      allEvents.push(currentEventData);
    }


    if (allEvents.length === 0) {
      throw new Error('No events to submit');
    }


    // Collect all unique camera IDs from all events
    const cameraIdSet = new Set();
    allEvents.forEach(ev => {
      ev.cameras.forEach(id => cameraIdSet.add(id));
    });
    const cameraIds = Array.from(cameraIdSet);


    if (cameraIds.length === 0) {
      throw new Error('camera_id list is empty');
    }


    // Map camera ids → url
    const cameraUrls = cameraIds.map(id => {
      const cam = cameraList.find(c => c.id === id);
      return cam?.rtspurl || `camera_${id}_url`;
    });


    // events: { fire: [..], smoke: [..] }
    const eventsByName = {};
    // event_rules: { fire: [..], smoke: [..] }
    const rulesByName = {};


    allEvents.forEach(ev => {
      const evKey = ev.eventName.toLowerCase();


      eventsByName[evKey] = ev.conditions.map(cond => ({
        objects: cond.object,
        operator: cond.operator,
        threshold: cond.threshold,
      }));


      const rules = [];
      if (ev.scheduling?.isEnabled) {
        if (ev.scheduling.dateRange.startDate || ev.scheduling.dateRange.endDate) {
          rules.push({
            DateRange: [{
              StartDate: ev.scheduling.dateRange.startDate || '',
              EndDate: ev.scheduling.dateRange.endDate || '',
            }],
          });
        }
        if (ev.scheduling.timeRange.startTime || ev.scheduling.timeRange.endTime) {
          rules.push({
            TimeRange: [{
              StartTime: ev.scheduling.timeRange.startTime || '',
              EndTime: ev.scheduling.timeRange.endTime || '',
            }],
          });
        }
        if (ev.scheduling.specificDays.length > 0) {
          rules.push({
            WorkingDays: ev.scheduling.specificDays.map(
              d => dayAbbreviations[d] || d
            ),
          });
        }
      }
      rulesByName[evKey] = rules;
    });


    return {
      cameras: [
        {
          camera_id: cameraIds,
          url: cameraUrls,
          events: eventsByName,
          running: true,
          user_id: userId,
          event_rules: rulesByName,
        },
      ],
    };
  };


  // Submit all saved events in one API call to camera API
  const submitAllEvents = async () => {
    try {
      const payload = buildCombinedPayload();
      console.log('Payload to send:', JSON.stringify(payload, null, 2));


      const response = await deviceApi.post(
        `${ANALYTICS_API_URL}/EventCameraDetails`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );


      alert('All events submitted successfully!');
      setSavedEvents([]);
      resetForm();
      if (refreshEvents) await refreshEvents();
      window.dispatchEvent(new CustomEvent('customEventsUpdated'));
      onClose();
    } catch (err) {
      console.error('Error submitting combined events:', err);
      alert(err.message || 'Failed to submit events. Please try again.');
    }
  };

  // When event name changes in step 1, check if we have previous saved events with same name
  // and pre-select their cameras if going to step 2
  const handleEventNameChange = (value) => {
    setEventName(value);
    
    // Check if we have saved events with this same name
    const sameNameEvents = savedEvents.filter(ev => ev.eventName.toLowerCase() === value.toLowerCase());
    
    if (sameNameEvents.length > 0 && step === 1) {
      // If there are saved events with same name, we'll show a message but NOT auto-select cameras
      // User can manually select cameras in step 2
    }
  };

  // Function to get cameras used by same event name
  const getCamerasForSameEventName = () => {
    if (!eventName.trim()) return [];
    
    const sameNameEvents = savedEvents.filter(ev => 
      ev.eventName.toLowerCase() === eventName.toLowerCase()
    );
    
    const cameraSet = new Set();
    sameNameEvents.forEach(ev => {
      ev.cameras.forEach(camId => cameraSet.add(camId));
    });
    
    return Array.from(cameraSet);
  };

  // Function to check if all cameras are already used by same event
  const areAllCamerasUsedBySameEvent = () => {
    const camerasForSameEvent = getCamerasForSameEventName();
    return camerasForSameEvent.length === cameraList.length;
  };


  return (
    <div className="w-full max-w-2xl mx-auto bg-white p-6 rounded-lg shadow-lg">
      {/* Progress Indicator */}
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          {editingData ? 'Edit Event' : 'Create Custom Events'}
        </h2>
        <div className="flex justify-center items-center space-x-2">
          {[1, 2, 3].map(num => (
            <React.Fragment key={num}>
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step === num
                    ? 'bg-purple-600 text-white ring-2 ring-purple-300'
                    : step > num
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {num}
              </div>
              {num < 3 && (
                <div className={`w-16 h-1 ${step > num ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
        <p className="text-gray-600 mt-3">
          {step === 1 && 'Define Event Conditions'}
          {step === 2 && 'Select Cameras'}
          {step === 3 && 'Configure Scheduling'}
        </p>
      </div>

      {/* Saved Events Summary */}
      {savedEvents.length > 0 && (
        <div className="mb-6 p-4 border border-blue-300 rounded-lg bg-blue-50">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-blue-700 font-semibold text-lg">
              📋 Saved Events ({savedEvents.length})
            </h3>
            <button
              onClick={submitAllEvents}
              className="px-5 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white font-medium rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-md"
            >
              🚀 Submit All Events
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto pr-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {savedEvents.map((ev, i) => (
                <div 
                  key={i} 
                  className="bg-white border border-gray-200 rounded-lg p-3 flex justify-between items-center hover:shadow transition-shadow"
                >
                  <div>
                    <div className="font-medium text-gray-800">{ev.eventName}</div>
                    <div className="text-xs text-gray-500">
                      {ev.conditions.length} conditions • {ev.cameras.length} cameras
                      {ev.scheduling?.isEnabled && ' • With scheduling'}
                    </div>
                  </div>
                  <button
                    onClick={() => removeSavedEvent(i)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                    title="Remove event"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Event Details */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Event Name *
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white"
              value={eventName}
              onChange={e => handleEventNameChange(e.target.value)}
            >
              <option value="" className="text-gray-400">
                Select event type
              </option>
              {EVENT_NAME_OPTIONS.map(opt => (
                <option key={opt} value={opt} className="text-gray-700">
                  {opt}
                </option>
              ))}
            </select>
            {eventName && (
              <div className="mt-2">
                <p className="text-sm text-green-600 font-medium">Selected: {eventName}</p>
                {/* Show warning if same event name already exists */}
                {savedEvents.some(ev => ev.eventName.toLowerCase() === eventName.toLowerCase()) && (
                  <div className="mt-1 text-sm text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                    ⚠️ You already have saved events with this name. You can select the same or different cameras for this new event.
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tags (optional)
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag, index) => (
                <span 
                  key={index} 
                  className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((_, i) => i !== index))}
                    className="text-purple-600 hover:text-purple-800"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  const raw = tagInput.trim().replace(/,$/, '');
                  if (raw) {
                    const newTags = raw.split(',').map(s => s.trim()).filter(Boolean);
                    const merged = [...tags, ...newTags]
                      .map(t => t.toLowerCase())
                      .filter((t, i, arr) => arr.indexOf(t) === i);
                    setTags(merged);
                  }
                  setTagInput('');
                }
              }}
              onBlur={() => {
                const raw = tagInput.trim().replace(/,$/, '');
                if (raw) {
                  const newTags = raw.split(',').map(s => s.trim()).filter(Boolean);
                  const merged = [...tags, ...newTags]
                    .map(t => t.toLowerCase())
                    .filter((t, i, arr) => arr.indexOf(t) === i);
                  setTags(merged);
                }
                setTagInput('');
              }}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Type tags separated by commas and press Enter"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Conditions *
              </label>
              {conditions.length > 0 && (
                <span className="text-sm text-gray-500">
                  {conditions.length} condition(s) added
                </span>
              )}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <select
                className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                value={currentCondition.object}
                onChange={e => setCurrentCondition({ ...currentCondition, object: e.target.value })}
              >
                {OBJECT_OPTIONS.map(obj => (
                  <option key={obj} value={obj}>
                    {obj}
                  </option>
                ))}
              </select>
              
              <select
                className="w-24 border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                value={currentCondition.operator}
                onChange={e => setCurrentCondition({ ...currentCondition, operator: e.target.value })}
              >
                {OPERATORS.map(op => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              
              <input
                type="number"
                className="w-28 border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                value={currentCondition.threshold}
                min="0"
                onChange={e =>
                  setCurrentCondition({
                    ...currentCondition,
                    threshold: parseInt(e.target.value) || 0,
                  })
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') addCondition(e);
                }}
              />
              
              <button
                onClick={addCondition}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-medium rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all shadow-md"
              >
                Add
              </button>
            </div>
            
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              {conditions.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No conditions added yet</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {conditions.map((cond, i) => (
                    <div 
                      key={i} 
                      className="inline-flex items-center gap-2 bg-white border border-gray-300 rounded-full px-4 py-2 shadow-sm"
                    >
                      <span className="text-gray-700 font-medium">
                        {cond.object} {cond.operator} {cond.threshold}
                      </span>
                      <button
                        onClick={() => removeCondition(i)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full p-1"
                        title="Remove condition"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between pt-6 border-t border-gray-200">
            <button 
              onClick={onClose} 
              className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleNext}
              disabled={!eventName.trim() || conditions.length === 0}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-medium rounded-lg hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
            >
              Next → Select Cameras
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Camera Selection */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">
              Select Cameras for "{eventName || 'Event'}"
            </h2>
            <div className="text-sm text-gray-600">
              Step 2 of 3
            </div>
          </div>
          
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
              <p className="text-purple-700 font-medium">Event: {eventName}</p>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              {conditions.length} conditions • Select one or more cameras
            </p>
            
            {/* Show info if same event name exists */}
            {savedEvents.some(ev => ev.eventName.toLowerCase() === eventName.toLowerCase()) && (
              <div className="mt-2 text-sm text-amber-700 bg-amber-100 p-2 rounded">
                ℹ️ You already have saved events with name "{eventName}". 
                You can select the same cameras or different ones for this new event.
              </div>
            )}
          </div>
          
          {loadingCameras && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto"></div>
              <p className="text-gray-600 mt-3">Loading cameras...</p>
            </div>
          )}
          
          {cameraError && (
            <div className="text-center py-8">
              <p className="text-red-600 font-medium mb-2">{cameraError}</p>
              <p className="text-gray-500 text-sm">Please try again later</p>
            </div>
          )}
          
          {!loadingCameras && !cameraError && cameraList.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No cameras available</p>
            </div>
          )}
          
          {!loadingCameras && !cameraError && cameraList.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <p className="text-sm text-gray-600">
                    {selectedCameras.length} of {cameraList.length} cameras selected
                  </p>
                  <p className="text-xs text-gray-500">
                    All cameras are available for selection
                  </p>
                </div>
                <div className="flex gap-2">
                  {selectedCameras.length > 0 && (
                    <button
                      onClick={() => setSelectedCameras([])}
                      className="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1 border border-red-200 rounded hover:bg-red-50"
                    >
                      Clear all
                    </button>
                  )}
                  {/* Button to select cameras from previous same-name events */}
                  {savedEvents.some(ev => ev.eventName.toLowerCase() === eventName.toLowerCase()) && (
                    <button
                      onClick={() => {
                        const camerasForSameEvent = getCamerasForSameEventName();
                        setSelectedCameras(camerasForSameEvent);
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1 border border-blue-200 rounded hover:bg-blue-50"
                      title="Select cameras from previous events with same name"
                    >
                      Use cameras from previous "{eventName}" events
                    </button>
                  )}
                </div>
              </div>
              
              {/* Show warning if all cameras are already used by same event */}
              {areAllCamerasUsedBySameEvent() && (
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-sm text-yellow-700">
                    ⚠️ All cameras are already used in previous "{eventName}" events. 
                    You can still select them for this new event.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cameraList.map(cam => {
                  // Check if this camera is used in previous same-name events
                  const camerasForSameEvent = getCamerasForSameEventName();
                  const isUsedInSameEvent = camerasForSameEvent.includes(cam.id);
                  
                  return (
                    <label 
                      key={cam.id} 
                      className={`flex items-center p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        selectedCameras.includes(cam.id)
                          ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-300'
                          : 'border-gray-200 bg-white hover:border-purple-300'
                      } ${isUsedInSameEvent ? 'border-l-4 border-l-blue-500' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCameras.includes(cam.id)}
                        onChange={() => toggleCamera(cam.id)}
                        className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                      />
                      <div className="ml-4 flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-gray-900">{cam.name}</p>
                            {cam.location && (
                              <p className="text-sm text-gray-500 mt-1">{cam.location}</p>
                            )}
                            {isUsedInSameEvent && (
                              <p className="text-xs text-blue-600 mt-1">
                                Used in previous "{eventName}" events
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {cam.status && (
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                cam.status === 'online'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {cam.status}
                              </span>
                            )}
                            {isUsedInSameEvent && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                Previously Selected
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          
          <div className="flex justify-between pt-6 border-t border-gray-200">
            <button 
              onClick={() => setStep(1)}
              className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-all"
            >
              ← Back to Event Details
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleNext}
                disabled={selectedCameras.length === 0}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-medium rounded-lg hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
              >
                Next → Configure Scheduling
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Scheduling */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">
              Configure Scheduling for "{eventName || 'Event'}"
            </h2>
            <div className="text-sm text-gray-600">
              Step 3 of 3
            </div>
          </div>
          
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
              <p className="text-purple-700 font-medium">Event: {eventName}</p>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              {conditions.length} conditions • {selectedCameras.length} cameras selected
            </p>
            
            {/* Show if any cameras were previously used */}
            {savedEvents.some(ev => ev.eventName.toLowerCase() === eventName.toLowerCase()) && (
              <div className="mt-2 text-sm text-blue-700 bg-blue-100 p-2 rounded">
                ℹ️ Some cameras were previously used in "{eventName}" events. This is okay - you can reuse cameras.
              </div>
            )}
          </div>
          
          <div className="flex items-center mb-6">
            <input
              type="checkbox"
              id="enableScheduling"
              checked={scheduling.isEnabled}
              onChange={e => updateScheduling('isEnabled', e.target.checked)}
              className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
            />
            <label htmlFor="enableScheduling" className="ml-3 text-gray-700 font-medium">
              Enable Scheduling (Optional)
            </label>
          </div>
          
          {scheduling.isEnabled && (
            <div className="space-y-8">
              {/* Date Range */}
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">Date Range</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={scheduling.dateRange.startDate}
                      onChange={e => updateSchedulingNested('dateRange', 'startDate', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={scheduling.dateRange.endDate}
                      onChange={e => updateSchedulingNested('dateRange', 'endDate', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Specific Days */}
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">Specific Days</h3>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
                  {Object.keys(dayAbbreviations).map(day => (
                    <label 
                      key={day} 
                      className={`flex flex-col items-center p-3 border rounded-lg cursor-pointer transition-all ${
                        scheduling.specificDays.includes(day)
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-purple-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={scheduling.specificDays.includes(day)}
                        onChange={() => toggleSpecificDay(day)}
                        className="sr-only"
                      />
                      <span className="text-sm font-medium mb-1">{day.substring(0, 3)}</span>
                      <span className="text-xs text-gray-500">{dayAbbreviations[day]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Time Range */}
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">Time Range</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={scheduling.timeRange.startTime}
                      onChange={e => updateSchedulingNested('timeRange', 'startTime', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={scheduling.timeRange.endTime}
                      onChange={e => updateSchedulingNested('timeRange', 'endTime', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-8 border-t border-gray-200">
            <button 
              onClick={() => setStep(2)}
              className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-all"
            >
              ← Back to Cameras
            </button>
            
            <div className="flex gap-4">
              {!editingData && savedEvents.length > 0 && (
                <button
                  onClick={submitAllEvents}
                  className="px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-medium rounded-lg hover:from-orange-600 hover:to-orange-700 transition-all shadow-md"
                >
                  Submit All Events ({savedEvents.length})
                </button>
              )}
              
              <button
                onClick={saveCurrentEvent}
                disabled={!eventName.trim() || conditions.length === 0 || selectedCameras.length === 0}
                className="px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-medium rounded-lg hover:from-green-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
              >
                {editingData ? 'Update Event' : 'Save Event & Add Another'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default CustomEventForm;
