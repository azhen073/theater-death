export interface HealthPayload {
  status: 'ok';
  service: 'theater-death';
  version: string;
}

export function healthPayload(): HealthPayload {
  return {
    status: 'ok',
    service: 'theater-death',
    version: '0.1.0',
  };
}
