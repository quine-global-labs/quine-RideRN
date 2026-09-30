export type Coord = {
  latitude: number;
  longitude: number;
};

export type Place = {
  id: string;
  title: string;
  subtitle: string;
  coordinate: Coord;
};

export type Route = {
  coordinates: Coord[];
  distanceMeters: number;
  durationSeconds: number;
  /** True when the routing service failed and we fell back to a straight line. */
  approximate: boolean;
};

export type Driver = {
  name: string;
  rating: number;
  car: string;
  plate: string;
};

export type Trip = {
  id: string;
  destination: Place;
  rideTypeId: string;
  fare: number;
  distanceMeters: number;
  durationSeconds: number;
  driver: Driver;
  completedAt: string;
};
