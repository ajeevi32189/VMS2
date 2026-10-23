import React, { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';
import { useAlertData } from '../../contexts/AlertDataContext';

const DashboardFilters = () => {
  const {
    sites,
    zones,
    nvrs,
    cameras,
    loading: inventoryLoading,
    refreshInventory,
    filterInventory,
  } = useDeviceInventory();

  const { refreshAlerts } = useAlertData();

  const [selected, setSelected] = useState({
    site: '',
    zone: '',
    nvr: '',
    camera: '',
  });

  const handleChange = (key, value) => {
    setSelected(prev => {
      const updated = { ...prev, [key]: value ?? "" };

      // If user selects "All", clear that filter
      if (value === "") {
        updated[key] = "";
      }

      // Reset dependent filters
      if (key === 'site') {
        updated.zone = "";
        updated.nvr = "";
        updated.camera = "";
      }
      if (key === 'zone') {
        updated.nvr = "";
        updated.camera = "";
      }
      if (key === 'nvr') {
        updated.camera = "";
      }

      // Apply both filters instantly
      filterInventory(updated);
      refreshAlerts(updated);
      return updated;
    });
  };

  // NVR filtered by zone
  const filteredNvrs = useMemo(() => {
    if (!selected.zone) return nvrs || [];
    return (nvrs || []).filter(n => Number(n.zone) === Number(selected.zone));
  }, [nvrs, selected.zone]);

  // Cameras filtered by zone + nvr
  const filteredCameras = useMemo(() => {
    return (cameras || []).filter(cam => {
      const camZone = cam?.zone ?? cam?.zone_id ?? null;
      const camNvr = cam?.nvrId ?? cam?.nvr_id ?? cam?.NVRId ?? null;

      const byZone = selected.zone ? Number(camZone) === Number(selected.zone) : true;
      const byNvr = selected.nvr ? Number(camNvr) === Number(selected.nvr) : true;

      return byZone && byNvr;
    });
  }, [cameras, selected.zone, selected.nvr]);

  // Dropdown definitions
  const dropdowns = [
    {
      key: 'site',
      label: 'Sites',
      placeholder: 'All Sites',
      options: [
        { label: "All", value: "" },
        ...((sites || []).map(s => ({
          label: s.name ?? s.locationName ?? `Site ${s.id}`,
          value: s.id
        })))
      ],
    },
    {
      key: 'zone',
      label: 'Zones',
      placeholder: 'All Zones',
      options: [
        { label: "All", value: "" },
        ...((zones || []).map(z => ({
          label: z.name ?? `Zone ${z.id}`,
          value: z.id
        })))
      ],
    },
    {
      key: 'nvr',
      label: 'NVRs',
      placeholder: 'All NVRs',
      options: [
        { label: "All", value: "" },
        ...((filteredNvrs || []).map(n => ({
          label: n.name ?? `NVR ${n.id}`,
          value: n.id
        })))
      ],
    },
    {
      key: 'camera',
      label: 'Cameras',
      placeholder: 'All Cameras',
      options: [
        { label: "All", value: "" },
        ...((filteredCameras || []).map(c => ({
          label: c.name ?? `Camera ${c.id}`,
          value: c.id
        })))
      ],
    },
  ];

  const handleSubmit = () => {
    filterInventory(selected);
    refreshAlerts(selected);
  };

  const handleRefresh = () => {
    const reset = { site: '', zone: '', nvr: '', camera: '' };
    setSelected(reset);
    refreshInventory();
    refreshAlerts(reset);
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {dropdowns.map(dd => (
          <div key={dd.key} className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-700">{dd.label}</label>
            <Select
              value={selected[dd.key] || undefined}
              placeholder={dd.placeholder}
              onChange={value => handleChange(dd.key, value)}
              options={dd.options}
              loading={inventoryLoading}
              allowClear
              showSearch
              size="large"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={handleSubmit}
          className="text-sm text-purple-600 underline mr-4"
          disabled={inventoryLoading}
        >
          Submit
        </button>

        <button
          type="button"
          onClick={handleRefresh}
          className="text-sm text-purple-600 underline"
          disabled={inventoryLoading}
        >
          Refresh
        </button>
      </div>
    </div>
  );
};

export default DashboardFilters;
