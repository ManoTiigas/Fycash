declare module 'pluggy-connect-sdk' {
  export type ConnectEventType = string;
  export type ConnectEventPayload = { item?: { id?: string } };
  export class PluggyConnect { show(): void; hide(): void; }
  export interface PluggyConnectProps { connectToken: string; includeSandbox?: boolean; onSuccess?: (payload: ConnectEventPayload) => void | Promise<void>; onClose?: () => void | Promise<void>; }
}
