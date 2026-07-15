import {
  loadPackageDefinition,
  Client,
  Metadata,
  type ChannelCredentials,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';

/** Options every generated client accepts. */
export interface RpcOptions {
  /** host:port of the gRPC server, e.g. "auth:50051". */
  address: string;
  /**
   * Channel credentials. Internal callers pass mutual-TLS credentials from
   * `@micros-ya/mtls` (`createClientCredentials()`); tests may use
   * `grpc.credentials.createInsecure()`.
   */
  credentials: ChannelCredentials;
  /** Optional metadata factory added to every call (e.g. correlation id). */
  metadata?: () => Metadata;
}

export interface GrpcClientConfig extends RpcOptions {
  /** Absolute path to the service's .proto (from its client SDK). */
  protoPath: string;
  /** Fully-qualified package, e.g. "micros.auth.v1". */
  package: string;
  /** Service name inside the package, e.g. "AuthService". */
  service: string;
}

export interface Closable {
  close(): void;
}

type RawClient = Client & Record<string, (...a: unknown[]) => unknown>;

/**
 * Builds a typed, promise-based unary gRPC client from a proto descriptor.
 *
 * The returned object is a Proxy: accessing `client.<method>` yields a function
 * that promisifies the matching unary RPC. Interface methods are camelCase
 * (`getUser`) and map to the PascalCase RPC (`GetUser`). `keepCase` is fixed so
 * snake_case wire fields (de)serialize correctly, matching the servers.
 *
 * This is the single place to add cross-cutting gRPC concerns (deadlines,
 * retries, tracing) for every service client.
 */
export function createGrpcClient<T extends object>(
  cfg: GrpcClientConfig,
): T & Closable {
  const def = loadSync(cfg.protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = loadPackageDefinition(def) as any;
  const Ctor = cfg.package.split('.').reduce((a, k) => a[k], pkg)[cfg.service];
  const raw: RawClient = new Ctor(cfg.address, cfg.credentials);

  const call = (method: string, req: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const md = cfg.metadata?.() ?? new Metadata();
      raw[method](req, md, (err: unknown, res: unknown) =>
        err ? reject(err) : resolve(res),
      );
    });

  return new Proxy({} as T & Closable, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'close') return () => raw.close();
      // camelCase interface method -> PascalCase RPC name.
      const rpc = prop.charAt(0).toUpperCase() + prop.slice(1);
      return (req: unknown) => call(rpc, req);
    },
  });
}
