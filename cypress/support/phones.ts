import type { PhoneSpec } from './e2e';

// The cast shared by the auction scenarios.
export const alice: PhoneSpec = { role: 'rider', id: 'alice', name: 'Alice' };
export const bob: PhoneSpec = { role: 'rider', id: 'bob', name: 'Bob' };
export const maria: PhoneSpec = { role: 'driver', id: 'maria', name: 'Maria', car: 'Toyota Camry · Silver', plate: '7KDL294', rating: 4.95 };
export const james: PhoneSpec = { role: 'driver', id: 'james', name: 'James', car: 'Honda Accord · Black', plate: '8TRW115', rating: 4.88 };
export const aisha: PhoneSpec = { role: 'driver', id: 'aisha', name: 'Aisha', car: 'Tesla Model 3 · White', plate: '9EVA662', rating: 4.97 };
