import { create } from "zustand";

const useDroneStore = create((set, get) => ({
  drones: {},
  selectedDroneId: null,

  setSelectedDrone: (id) => set({ selectedDroneId: id }),

  addOrUpdateDrone: (droneData) =>
    set((state) => {
      const id = droneData.id;
      const existing = state.drones[id] || {};
      const path = existing.path
        ? [...existing.path, [droneData.lon, droneData.lat]]
        : [[droneData.lon, droneData.lat]];

      return {
        drones: {
          ...state.drones,
          [id]: {
            ...existing,
            ...droneData,
            path,
            firstSeen: existing.firstSeen || Date.now(),
          },
        },
      };
    }),
}));

export default useDroneStore;

